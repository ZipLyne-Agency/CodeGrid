use crate::commands::{AppState, SessionInfo};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Arc;
use tauri::Manager;
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::net::UnixListener;
use tokio::sync::Semaphore;

#[derive(Deserialize)]
struct RpcRequest {
    #[allow(dead_code)]
    jsonrpc: String,
    method: String,
    params: Option<serde_json::Value>,
    id: Option<serde_json::Value>,
}

#[derive(Serialize)]
struct RpcResponse {
    jsonrpc: String,
    result: Option<serde_json::Value>,
    error: Option<RpcError>,
    id: serde_json::Value,
}

#[derive(Serialize)]
struct RpcError {
    code: i32,
    message: String,
}

fn socket_path() -> PathBuf {
    let home = std::env::var("HOME").expect("HOME environment variable must be set");
    PathBuf::from(format!("{home}/.codegrid/socket"))
}

pub async fn start_rpc_server(app_handle: tauri::AppHandle) {
    let path = socket_path();

    // Remove stale socket
    let _ = std::fs::remove_file(&path);

    // Ensure directory exists with restricted permissions
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(parent, std::fs::Permissions::from_mode(0o700));
    }

    // Write socket path to a discoverable file
    let Some(parent) = path.parent() else {
        eprintln!("[rpc] Socket path has no parent directory");
        return;
    };
    let socket_path_file = parent.join("socket-path");
    let _ = std::fs::write(&socket_path_file, path.to_string_lossy().as_bytes());

    let listener = match UnixListener::bind(&path) {
        Ok(l) => l,
        Err(e) => {
            eprintln!("[rpc] Failed to bind socket: {e}");
            return;
        }
    };

    println!("[rpc] Listening on {}", path.display());

    let semaphore = Arc::new(Semaphore::new(10));

    loop {
        match listener.accept().await {
            Ok((stream, _)) => {
                let handle = app_handle.clone();
                let permit = match semaphore.clone().acquire_owned().await {
                    Ok(p) => p,
                    Err(_) => continue,
                };
                tokio::spawn(async move {
                    let (reader, mut writer) = stream.into_split();
                    let mut lines = BufReader::new(reader.take(1_048_576)).lines();

                    while let Ok(Some(line)) = lines.next_line().await {
                        let response = handle_request(&handle, &line).await;
                        let json = serde_json::to_string(&response).unwrap_or_default();
                        let _ = writer.write_all(format!("{json}\n").as_bytes()).await;
                    }
                    drop(permit);
                });
            }
            Err(e) => eprintln!("[rpc] Accept error: {e}"),
        }
    }
}

async fn handle_request(app: &tauri::AppHandle, line: &str) -> RpcResponse {
    let req: RpcRequest = match serde_json::from_str(line) {
        Ok(r) => r,
        Err(e) => {
            return RpcResponse {
                jsonrpc: "2.0".into(),
                result: None,
                error: Some(RpcError {
                    code: -32700,
                    message: format!("Parse error: {e}"),
                }),
                id: serde_json::Value::Null,
            }
        }
    };

    let id = req.id.clone().unwrap_or(serde_json::Value::Null);
    let params = req.params.unwrap_or(serde_json::Value::Null);

    let result = match req.method.as_str() {
        "ping" => Ok(serde_json::json!("pong")),

        "open_folder" | "new_session" => {
            let path = params.get("path").and_then(|v| v.as_str());
            match path {
                Some(p) => {
                    let canonical = std::fs::canonicalize(p);
                    match canonical {
                        Ok(cp) if cp.is_dir() => {
                            use tauri::Emitter;
                            let safe_path = cp.to_string_lossy().to_string();
                            let event = if req.method == "open_folder" { "rpc:open-folder" } else { "rpc:new-session" };
                            let _ = app.emit(event, &safe_path);
                            Ok(serde_json::json!({"status": "ok", "path": safe_path}))
                        }
                        Ok(_) => Err("Path is not a directory"),
                        Err(_) => Err("Invalid or non-existent path"),
                    }
                }
                None => Err("Missing 'path' parameter"),
            }
        }

        "list_sessions" => {
            use tauri::Emitter;
            let _ = app.emit("rpc:list-sessions", ());
            Ok(serde_json::json!({"status": "ok"}))
        }

        "new_workspace" => {
            let name = params
                .get("name")
                .and_then(|v| v.as_str())
                .unwrap_or("Workspace");
            use tauri::Emitter;
            let _ = app.emit("rpc:new-workspace", name);
            Ok(serde_json::json!({"status": "ok", "name": name}))
        }

        // ---- Agent bus: let one agent observe / message another agent's pane ----
        "agent_list" => match app.try_state::<Arc<AppState>>() {
            Some(state) => {
                let sessions = state.sessions.lock().await;
                // Scratch (ephemeral) terminals are private to their pane — never
                // expose them to other agents on the bus.
                let agents: Vec<SessionInfo> = sessions
                    .iter()
                    .filter(|s| !crate::commands::is_ephemeral_workspace(&s.workspace_id))
                    .map(SessionInfo::from)
                    .collect();
                Ok(serde_json::json!({ "agents": agents }))
            }
            None => Err("App state unavailable"),
        },

        "agent_read" => {
            let sid = params.get("session_id").and_then(|v| v.as_str());
            let max = params
                .get("max_bytes")
                .and_then(|v| v.as_u64())
                .unwrap_or(4000) as usize;
            match (app.try_state::<Arc<AppState>>(), sid) {
                (Some(state), Some(id)) => match state.pty_manager.read_output(id, max) {
                    Some(bytes) => {
                        let text = String::from_utf8_lossy(&bytes).to_string();
                        Ok(serde_json::json!({ "output": text }))
                    }
                    None => Err("Session not found or has no output"),
                },
                (None, _) => Err("App state unavailable"),
                (_, None) => Err("Missing 'session_id'"),
            }
        }

        "agent_send" => {
            let sid = params.get("session_id").and_then(|v| v.as_str());
            let text = params.get("text").and_then(|v| v.as_str());
            let submit = params
                .get("submit")
                .and_then(|v| v.as_bool())
                .unwrap_or(true);
            match (app.try_state::<Arc<AppState>>(), sid, text) {
                (Some(state), Some(id), Some(t)) => {
                    match state.pty_manager.write_to_pty(id, t.as_bytes()) {
                        Ok(_) => {
                            if submit {
                                // Let the target CLI register the pasted text before Enter.
                                tokio::time::sleep(std::time::Duration::from_millis(120)).await;
                                let _ = state.pty_manager.write_to_pty(id, b"\r");
                            }
                            Ok(serde_json::json!({ "status": "ok" }))
                        }
                        Err(_) => Err("Failed to write to session"),
                    }
                }
                (None, _, _) => Err("App state unavailable"),
                (_, None, _) => Err("Missing 'session_id'"),
                (_, _, None) => Err("Missing 'text'"),
            }
        }

        _ => Err("Method not found"),
    };

    match result {
        Ok(val) => RpcResponse {
            jsonrpc: "2.0".into(),
            result: Some(val),
            error: None,
            id,
        },
        Err(msg) => RpcResponse {
            jsonrpc: "2.0".into(),
            result: None,
            error: Some(RpcError {
                code: -32601,
                message: msg.into(),
            }),
            id,
        },
    }
}

pub fn cleanup() {
    let path = socket_path();
    let _ = std::fs::remove_file(&path);
    let socket_path_file = path.parent().map(|p| p.join("socket-path"));
    if let Some(f) = socket_path_file {
        let _ = std::fs::remove_file(f);
    }
}
