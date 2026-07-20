mod analytics;
mod commands;
mod db;
mod entitlement;
mod env_setup;
mod native_ui;
mod pty_manager;
mod rpc_server;
mod session;
mod voice;
mod workspace;
mod worktree;

use commands::AppState;
use db::Database;
use pty_manager::PtyManager;
use std::sync::Arc;
use tauri::{Manager, RunEvent, WindowEvent};
use tokio::sync::Mutex as TokioMutex;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // GUI-launched macOS bundles inherit a minimal launchd PATH. Resolve the
    // real user PATH up front so `which::which` (agent/Node detection) and every
    // spawned child process can find Homebrew- and version-manager-installed CLIs.
    let _ = env_setup::apply();

    let app = tauri::Builder::default()
        .plugin(
            // Global hotkey backbone for voice: the "summon Max" key (app-wide,
            // registered from settings) and push-to-talk (per PTT session).
            // voice::on_global_shortcut tells them apart.
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    voice::on_global_shortcut(
                        app,
                        shortcut,
                        matches!(event.state, tauri_plugin_global_shortcut::ShortcutState::Pressed),
                    );
                })
                .build(),
        )
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_deep_link::init())
        .setup(|_app| {
            #[cfg(desktop)]
            _app.handle().plugin(tauri_plugin_updater::Builder::new().build())?;

            // Native macOS chrome: application menu + menu-bar (tray) extra.
            #[cfg(desktop)]
            {
                let menu = native_ui::build_menu(_app)?;
                _app.set_menu(menu)?;
                _app.on_menu_event(|app, event| {
                    native_ui::handle_action(app, event.id().as_ref());
                });
                if let Err(e) = native_ui::build_tray(_app) {
                    eprintln!("[CodeGrid] tray init failed: {e}");
                }

                // Forward deep links (codegrid://…) to the frontend.
                {
                    use tauri::Emitter;
                    use tauri_plugin_deep_link::DeepLinkExt;
                    let handle = _app.handle().clone();
                    _app.deep_link().on_open_url(move |event| {
                        let urls: Vec<String> =
                            event.urls().iter().map(|u| u.to_string()).collect();
                        let _ = handle.emit("codegrid://deep-link", urls);
                    });
                }
            }

            let db = match Database::new() {
                Ok(db) => db,
                Err(e) => {
                    eprintln!("Database initialization failed: {e}. Attempting recovery...");
                    // Try to recover by backing up the corrupt DB and creating a fresh one
                    let db_dir = if let Ok(home) = std::env::var("HOME") {
                        std::path::PathBuf::from(home).join(".config").join("codegrid")
                    } else {
                        std::path::PathBuf::from("/tmp/codegrid")
                    };
                    let db_path = db_dir.join("codegrid.db");
                    if db_path.exists() {
                        let backup = db_path.with_extension("db.corrupt");
                        let _ = std::fs::rename(&db_path, &backup);
                        eprintln!("Backed up corrupt database to {}", backup.display());
                    }
                    Database::new().expect("Failed to initialize database even after recovery")
                }
            };
            let state = Arc::new(AppState {
                pty_manager: PtyManager::new(),
                db,
                sessions: TokioMutex::new(Vec::new()),
                connect_signals: TokioMutex::new(std::collections::HashMap::new()),
                last_output: std::sync::Mutex::new(std::collections::HashMap::new()),
            });
            _app.manage(state);
            _app.manage(Arc::new(voice::VoiceManager::default()));

            // Start JSON-RPC Unix socket server
            let handle = _app.handle().clone();
            tauri::async_runtime::spawn(rpc_server::start_rpc_server(handle));

            // Register the app-wide "summon Max" hotkey from settings.
            voice::register_summon_from_settings(_app.handle());

            // Rust-side agent-settled detection — works while the webview's
            // timers are throttled in the background (user in another app).
            voice::spawn_idle_settler(_app.handle().clone());

            // Ask for Notification Center permission up front so Max's
            // background announcements can also surface as native banners
            // (works across every workspace, even with no voice session).
            {
                use tauri_plugin_notification::NotificationExt;
                match _app.notification().permission_state() {
                    Ok(tauri_plugin_notification::PermissionState::Granted) => {}
                    _ => {
                        let _ = _app.notification().request_permission();
                    }
                }
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::create_session,
            commands::write_to_pty,
            commands::resize_pty,
            commands::kill_session,
            commands::get_sessions,
            commands::get_persisted_sessions,
            commands::clear_persisted_sessions,
            commands::rename_session,
            commands::update_session_status,
            commands::create_workspace,
            commands::get_workspaces,
            commands::delete_workspace,
            commands::set_active_workspace,
            commands::save_layout,
            commands::rename_workspace,
            commands::get_git_branch,
            commands::is_git_repo,
            commands::get_claude_path,
            commands::get_setting,
            commands::set_setting,
            commands::get_default_shell,
            commands::spawn_shell_session,
            commands::clone_repo,
            commands::get_home_dir,
            commands::create_project_dir,
            commands::list_recent_dirs,
            commands::list_recent_projects,
            commands::record_recent_project,
            commands::remove_recent_project,
            commands::pin_recent_project,
            commands::get_project_search_roots,
            commands::set_project_search_roots,
            commands::rescan_project_roots,
            commands::detect_claude_skills,
            commands::detect_all_skills,
            commands::get_available_models,
            commands::send_to_session,
            commands::dir_exists,
            // Git manager
            commands::git_status,
            commands::git_push,
            commands::git_pull,
            commands::git_commit,
            commands::git_stage_file,
            commands::git_unstage_file,
            commands::git_create_branch,
            commands::git_switch_branch,
            commands::git_list_branches,
            commands::git_log,
            commands::git_discard_file,
            commands::git_stage_all,
            commands::git_show_commit,
            commands::git_fetch,
            commands::git_stash,
            commands::git_diff_stat,
            commands::git_diff_file,
            // Legacy no-op (wallet link disconnected)
            commands::poll_entitlement,
            // AI assist (BYOK): commit names + terminal summaries
            commands::ai_commit_message,
            commands::summarize_terminal,
            // Workspace-repo binding
            commands::set_workspace_repo,
            commands::create_workspace_with_repo,
            // CLAUDE.md management
            commands::read_claude_md,
            commands::write_claude_md,
            // MCP manager
            commands::list_mcps,
            commands::save_mcp_config,
            commands::toggle_mcp_server,
            commands::remove_mcp_server,
            commands::add_mcp_server,
            commands::connect_pty,
            commands::list_github_repos,
            commands::search_github_repos,
            // File tree
            commands::list_directory,
            commands::create_folder,
            // File operations
            commands::rename_file,
            commands::delete_file,
            commands::move_file,
            commands::copy_file,
            // Project search
            commands::search_files,
            // Git hunk staging
            commands::git_stage_hunk,
            // Git setup wizard
            commands::check_git_setup,
            commands::set_git_config,
            commands::run_gh_auth_login,
            commands::get_gh_install_instructions,
            commands::run_gh_setup_git,
            commands::start_github_device_flow,
            commands::poll_github_token,
            commands::save_github_token,
            // Code viewer
            commands::read_file_contents,
            commands::write_file_contents,
            // Repo quick status
            commands::check_repo_status,
            commands::get_github_identity,
            // Quick publish / save
            commands::quick_publish,
            commands::quick_save,
            commands::get_env_allow_status,
            commands::toggle_env_allow,
            // Dependency graph
            commands::analyze_dependencies,
            // (Browser-pane native-webview commands removed — replaced by
            //  iframe-based React implementation.)
            // Notes persistence
            commands::notes_list,
            commands::notes_write,
            commands::notes_delete,
            // System info
            commands::get_system_memory,
            // File context menu actions
            commands::reveal_in_finder,
            commands::open_in_default_app,
            commands::clipboard_write,
            // Additional git commands
            commands::git_init,
            commands::git_delete_branch,
            commands::git_merge_branch,
            commands::git_amend_commit,
            commands::git_discard_all,
            commands::git_blame_file,
            commands::git_tag,
            commands::git_list_tags,
            commands::git_cherry_pick,
            commands::git_revert_commit,
            commands::git_stash_list,
            commands::git_stash_drop,
            commands::git_unstage_all,
            commands::git_stash_apply,
            commands::git_tag_delete,
            commands::git_rename_branch,
            commands::git_list_remotes,
            commands::git_add_remote,
            commands::git_remove_remote,
            // Onboarding
            commands::check_agent_clis,
            commands::setup_agent_bus,
            // Native menu-bar (tray) status
            native_ui::set_tray_status,
            // Legacy entitlement storage (unused; free/BYOK path)
            entitlement::store_entitlement,
            entitlement::get_entitlement,
            entitlement::clear_entitlement,
            // AI code review + coding analytics (BYOK / local)
            commands::get_active_diff,
            commands::run_review,
            analytics::get_coding_analytics,
            // Voice control (BYOK OpenAI Realtime)
            voice::voice_start,
            voice::voice_stop,
            voice::voice_state,
            voice::voice_set_api_key,
            voice::voice_key_status,
            voice::voice_clear_api_key,
            voice::voice_set_mic_paused,
            voice::voice_set_summon,
            voice::voice_request_notifications,
            voice::voice_tool_response,

        ])
        // Intercept close (red X / Cmd+Q) → show confirmation if sessions are running.
        .on_window_event(|window, event| {
            // Voice focus gating: in "focused" mode the mic stream is paused
            // the moment CodeGrid stops being the frontmost window.
            if let WindowEvent::Focused(focused) = event {
                voice::on_window_focus(window.app_handle(), *focused);
            }
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();

                let window = window.clone();
                tauri::async_runtime::spawn(async move {
                    // Ask the frontend to flush its latest canvas layout to disk before
                    // we tear down the webview — window.destroy() otherwise races the
                    // debounced save and loses layout edits made in the last second.
                    {
                        use tauri::Emitter;
                        let _ = window.emit("codegrid:flush-before-quit", ());
                    }

                    // Check if any PTY sessions are alive
                    let has_sessions = window
                        .try_state::<Arc<AppState>>()
                        .map(|state| state.pty_manager.session_count() > 0)
                        .unwrap_or(false);

                    if has_sessions {
                        use tauri_plugin_dialog::DialogExt;
                        let dialog = window.dialog().clone();
                        let confirmed = tauri_plugin_dialog::MessageDialogBuilder::new(
                            dialog,
                            "Quit CodeGrid?",
                            "Quitting will close all your terminal sessions.\nYou can minimize instead to keep them running.",
                        )
                        .kind(tauri_plugin_dialog::MessageDialogKind::Warning)
                        .buttons(tauri_plugin_dialog::MessageDialogButtons::OkCancelCustom(
                            "Quit".to_string(),
                            "Minimize".to_string(),
                        ))
                        .blocking_show();

                        if confirmed {
                            // User chose Quit
                            let _ = window.destroy();
                        } else {
                            // User chose Minimize
                            let _ = window.hide();
                        }
                    } else {
                        // No active sessions — give the flush a brief moment to land,
                        // then close.
                        tokio::time::sleep(std::time::Duration::from_millis(150)).await;
                        let _ = window.destroy();
                    }
                });
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building CodeGrid");

    app.run(|app_handle, event| {
        match event {
            RunEvent::Exit => {
                eprintln!("[CodeGrid] App exiting, cleaning up PTY sessions");
                voice::shutdown(app_handle);
                rpc_server::cleanup();
                if let Some(state) = app_handle.try_state::<Arc<AppState>>() {
                    state.pty_manager.kill_all();
                }
            }
            // macOS: dock icon clicked while app is running → show window
            RunEvent::Reopen {
                has_visible_windows: false,
                ..
            } => {
                if let Some(window) = app_handle.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
            _ => {}
        }
    });
}
