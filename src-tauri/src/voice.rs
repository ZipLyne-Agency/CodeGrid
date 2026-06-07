//! CodeGrid Voice — speech-to-speech control of the canvas (Pro-only, BYOK).
//!
//! A live WebSocket session to OpenAI's Realtime API (`gpt-realtime-2`):
//! mic audio is captured in Rust via cpal (no WKWebView getUserMedia), model
//! audio plays back via rodio, and function calls map onto the same
//! infrastructure the agent-bus RPC server uses (spawn / message / read /
//! list / focus / close / interrupt agents), scoped to the bound workspace.
//!
//! Design doc: docs/voice-control.md. Key properties:
//!   - The OpenAI key lives in the macOS Keychain and never touches the webview.
//!   - `voice_start` re-verifies the entitlement JWT in Rust (tier >= 1).
//!   - Focus gating: in "focused" mode (default) the cpal stream is *paused*
//!     (OS mic indicator off) whenever the CodeGrid window loses focus.
//!   - Idle auto-stop caps runaway per-minute audio cost.

use crate::commands::AppState;
use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::sync::{mpsc, oneshot, watch};
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::Message;

const KEY_SERVICE: &str = "app.codegrid.voice";
const KEY_ACCOUNT: &str = "openai-api-key";
const REALTIME_URL: &str = "wss://api.openai.com/v1/realtime?model=gpt-realtime-2";
const TARGET_RATE: u32 = 24_000;
/// ~200ms of 24kHz mono PCM16 per append event.
const MIC_CHUNK_SAMPLES: usize = 4_800;
const SPAWN_REPLY_TIMEOUT: Duration = Duration::from_secs(20);
const READY_POLL_INTERVAL: Duration = Duration::from_millis(500);
const READY_TIMEOUT: Duration = Duration::from_secs(90);

// ─────────────────────────────────────────────────────────────── state ──

#[derive(Clone, Copy, PartialEq)]
enum VoiceMode {
    /// Mic only hot while the CodeGrid window is focused (default).
    Focused,
    /// Mic stays hot regardless of focus — hands-free background mode.
    Always,
    /// Push-to-talk: mic dead except while the global hotkey is held.
    /// Server VAD is disabled; we commit the buffer on key release.
    Ptt,
}

enum MicCmd {
    SetPaused(bool),
    Stop,
}

enum PlayCmd {
    /// PCM16LE mono @ 24kHz from the model.
    Chunk(Vec<u8>),
    /// Barge-in: drop everything queued.
    Clear,
    Stop,
}

/// Proactive event flowing INTO the live session (agent finished / needs you /
/// crashed / watch-for hit). Delivered as a system message + response so Max
/// announces it out loud.
enum Announce {
    /// System-event text for Max to act on (announce, and chain if asked).
    Event(String),
    /// Window regained focus — flush anything held for the away-recap.
    Refocus,
}

struct ActiveVoice {
    /// Monotonic session generation — lets a finished session's cleanup tell
    /// whether it is still the current one (or has been superseded by a
    /// restart) before tearing anything down.
    generation: u64,
    workspace_id: Arc<Mutex<String>>,
    mode: VoiceMode,
    shutdown: watch::Sender<bool>,
    mic_cmd: std::sync::mpsc::Sender<MicCmd>,
    mic_paused: Arc<AtomicBool>,
    started_at: Instant,
    /// Outbound Realtime events — lets the PTT handler commit/cancel directly.
    out_tx: mpsc::UnboundedSender<Value>,
    /// Speaker queue — lets PTT press cut the assistant off (manual barge-in).
    play_tx: std::sync::mpsc::Sender<PlayCmd>,
    /// Registered global hold-to-talk hotkey (PTT mode), unregistered on stop.
    ptt_shortcut: Option<String>,
    /// True while the server has a response in flight (response.created → done).
    response_active: Arc<AtomicBool>,
    /// A response was requested while one was active — fire it on response.done.
    response_pending: Arc<AtomicBool>,
    /// Inbox for proactive announcements (agent events, watch-for hits).
    announce_tx: mpsc::UnboundedSender<Announce>,
    /// Mirrors the main window's focus — drives the away-recap hold.
    window_focused: Arc<AtomicBool>,
}

/// Ask for a model response without double-firing: the Realtime API rejects
/// `response.create` while another response is in flight (parallel tool
/// completions and fast PTT re-presses both hit this). If one is active we
/// just flag it; the session loop re-requests on `response.done`.
fn request_response(
    out_tx: &mpsc::UnboundedSender<Value>,
    active: &Arc<AtomicBool>,
    pending: &Arc<AtomicBool>,
) {
    if active.load(Ordering::Relaxed) {
        pending.store(true, Ordering::Relaxed);
    } else {
        // Optimistic — confirmed/corrected by response.created / response.done.
        active.store(true, Ordering::Relaxed);
        let _ = out_tx.send(json!({ "type": "response.create" }));
    }
}

#[derive(Default)]
pub struct VoiceManager {
    active: Mutex<Option<ActiveVoice>>,
    /// In-flight spawn_agent round-trips awaiting a frontend `voice_tool_response`.
    pending_tools: Mutex<HashMap<String, oneshot::Sender<Value>>>,
    /// Source for ActiveVoice::generation.
    generation: std::sync::atomic::AtomicU64,
    /// Registered app-wide "summon Max" hotkey (combo string + parsed form) —
    /// independent of any session: pressing it starts/stops the session.
    summon: Mutex<Option<(String, tauri_plugin_global_shortcut::Shortcut)>>,
}

// ──────────────────────────────────────────────────────── keychain key ──

fn key_entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new(KEY_SERVICE, KEY_ACCOUNT).map_err(|e| format!("keychain entry: {e}"))
}

#[tauri::command]
pub fn voice_set_api_key(key: String) -> Result<(), String> {
    let key = key.trim().to_string();
    if key.is_empty() {
        return Err("Key is empty".into());
    }
    key_entry()?
        .set_password(&key)
        .map_err(|e| format!("keychain store: {e}"))
}

#[tauri::command]
pub fn voice_key_status() -> Result<bool, String> {
    match key_entry()?.get_password() {
        Ok(_) => Ok(true),
        Err(keyring::Error::NoEntry) => Ok(false),
        Err(e) => Err(format!("keychain read: {e}")),
    }
}

/// Ensure macOS notification permission, prompting if undetermined. Returns
/// whether banners are allowed. Used by the "Alerts" toggle so turning it on
/// surfaces the system prompt instead of silently failing.
#[tauri::command]
pub fn voice_request_notifications(app: AppHandle) -> Result<bool, String> {
    use tauri_plugin_notification::{NotificationExt, PermissionState};
    let current = app
        .notification()
        .permission_state()
        .map_err(|e| e.to_string())?;
    let granted = match current {
        PermissionState::Granted => true,
        _ => matches!(
            app.notification()
                .request_permission()
                .map_err(|e| e.to_string())?,
            PermissionState::Granted
        ),
    };
    Ok(granted)
}

#[tauri::command]
pub fn voice_clear_api_key() -> Result<(), String> {
    match key_entry()?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(format!("keychain clear: {e}")),
    }
}

fn get_api_key() -> Result<String, String> {
    match key_entry()?.get_password() {
        Ok(k) => Ok(k),
        Err(keyring::Error::NoEntry) => {
            Err("No OpenAI API key set. Add one in Settings → Voice.".into())
        }
        Err(e) => Err(format!("keychain read: {e}")),
    }
}

// ─────────────────────────────────────────────────────────── commands ──

#[tauri::command]
pub async fn voice_start(
    app: AppHandle,
    vm: State<'_, Arc<VoiceManager>>,
    workspace_id: String,
) -> Result<(), String> {
    start_session(app, vm.inner().clone(), workspace_id).await
}

/// Session bring-up, callable from both the command and the summon hotkey.
async fn start_session(
    app: AppHandle,
    vm: Arc<VoiceManager>,
    workspace_id: String,
) -> Result<(), String> {
    // Scratch workspaces are private/ephemeral by design (hidden from the
    // agent bus) — voice follows the same rule.
    if crate::commands::is_ephemeral_workspace(&workspace_id) {
        return Err("Voice isn't available in scratch workspaces — switch to a project workspace.".into());
    }
    // BYOK for everyone — the only requirement is an OpenAI key in the Keychain.
    let api_key = get_api_key()?;

    // Tear down any existing session first (restart semantics).
    stop_active(&app, &vm);

    let state = app
        .try_state::<Arc<AppState>>()
        .ok_or("App state unavailable")?
        .inner()
        .clone();

    let mode = match state.db.get_setting("voice_mode").as_deref() {
        Some("always") => VoiceMode::Always,
        Some("ptt") => VoiceMode::Ptt,
        _ => VoiceMode::Focused,
    };
    let idle_minutes: u64 = state
        .db
        .get_setting("voice_idle_minutes")
        .and_then(|v| v.parse().ok())
        .unwrap_or(5);
    // Echo protection: mute the mic while the assistant's audio is playing.
    // Default on (speaker output re-entering the mic confuses VAD without
    // headphones). PTT doesn't need it — holding the key states intent.
    let half_duplex = mode != VoiceMode::Ptt
        && state
            .db
            .get_setting("voice_half_duplex")
            .map(|v| v != "false")
            .unwrap_or(true);
    // Wake word retired by product decision: turning Max on means he listens;
    // off means he doesn't. (The state-machine plumbing below is kept dormant
    // — `wake_word` is always false now — rather than ripped out.)
    let wake_word = false;

    let ws_id = Arc::new(Mutex::new(workspace_id));
    // PTT starts deaf — the hotkey opens the mic.
    let mic_paused = Arc::new(AtomicBool::new(mode == VoiceMode::Ptt));
    let speaking = Arc::new(AtomicBool::new(false));
    let response_active = Arc::new(AtomicBool::new(false));
    let response_pending = Arc::new(AtomicBool::new(false));
    let (shutdown_tx, shutdown_rx) = watch::channel(false);
    let (mic_cmd_tx, mic_cmd_rx) = std::sync::mpsc::channel::<MicCmd>();
    let (audio_tx, audio_rx) = mpsc::unbounded_channel::<Vec<u8>>();
    let (play_tx, play_rx) = std::sync::mpsc::channel::<PlayCmd>();
    // Outbound Realtime channel is created here (not in the session loop) so
    // the PTT handler can push commit/cancel events directly.
    let (out_tx, out_rx) = mpsc::unbounded_channel::<Value>();
    // Proactive-announcement inbox (agent events, watch-for hits, refocus).
    let (announce_tx, announce_rx) = mpsc::unbounded_channel::<Announce>();
    let window_focused = Arc::new(AtomicBool::new(true));

    spawn_mic_thread(app.clone(), audio_tx, mic_cmd_rx, mic_paused.clone());
    spawn_playback_thread(app.clone(), play_rx, speaking.clone());

    // PTT: claim the global hotkey for the lifetime of the session.
    let ptt_shortcut = if mode == VoiceMode::Ptt {
        use tauri_plugin_global_shortcut::GlobalShortcutExt;
        let combo = state
            .db
            .get_setting("voice_ptt_shortcut")
            .filter(|s| !s.trim().is_empty())
            .unwrap_or_else(|| "F9".to_string());
        match app.global_shortcut().register(combo.as_str()) {
            Ok(()) => Some(combo),
            Err(e) => {
                // Session still works via the mic button's right-click unmute.
                let _ = app.emit(
                    "voice-status",
                    json!({ "status": "warning", "detail": format!("Couldn't register hotkey '{combo}': {e}") }),
                );
                None
            }
        }
    } else {
        None
    };

    let generation = vm
        .generation
        .fetch_add(1, std::sync::atomic::Ordering::Relaxed)
        + 1;
    {
        let mut active = vm.active.lock().map_err(|_| "voice state poisoned")?;
        *active = Some(ActiveVoice {
            generation,
            workspace_id: ws_id.clone(),
            mode,
            shutdown: shutdown_tx,
            mic_cmd: mic_cmd_tx,
            mic_paused: mic_paused.clone(),
            started_at: Instant::now(),
            out_tx: out_tx.clone(),
            play_tx: play_tx.clone(),
            ptt_shortcut,
            response_active: response_active.clone(),
            response_pending: response_pending.clone(),
            announce_tx,
            window_focused: window_focused.clone(),
        });
    }

    emit_status(&app, "connecting", None);

    let vm_arc = vm.clone();
    tauri::async_runtime::spawn(async move {
        let result = run_session(
            app.clone(),
            state,
            vm_arc.clone(),
            api_key,
            ws_id,
            mic_paused,
            audio_rx,
            play_tx.clone(),
            out_tx,
            out_rx,
            shutdown_rx,
            idle_minutes,
            mode == VoiceMode::Ptt,
            half_duplex,
            wake_word,
            speaking,
            response_active,
            response_pending,
            announce_rx,
            window_focused,
        )
        .await;
        // Whatever ended the session (error, idle, server close, voice_stop),
        // make sure the audio threads die. Generation-guarded: if a newer
        // session has already replaced this one (restart), tearing down or
        // emitting status here would kill/stomp the new session.
        let _ = play_tx.send(PlayCmd::Stop);
        let was_current = stop_if_generation(&app, &vm_arc, generation);
        match result {
            Ok(reason) => {
                if was_current {
                    emit_status(&app, "off", Some(&reason));
                }
            }
            Err(e) => {
                eprintln!("[voice] session error: {e}");
                if was_current {
                    emit_status(&app, "error", Some(&e));
                }
            }
        }
    });

    Ok(())
}

/// Global-hotkey handler (PTT). Hold = mic open; press also cuts the
/// assistant off (manual barge-in); release commits the turn — VAD is
/// disabled in PTT mode, so turn-taking is fully key-driven.
pub fn on_ptt(app: &AppHandle, pressed: bool) {
    let Some(vm) = app.try_state::<Arc<VoiceManager>>() else {
        return;
    };
    let Ok(active) = vm.active.lock() else { return };
    let Some(a) = active.as_ref() else { return };
    if a.mode != VoiceMode::Ptt {
        return;
    }
    a.mic_paused.store(!pressed, Ordering::Relaxed);
    let _ = a.mic_cmd.send(MicCmd::SetPaused(!pressed));
    if pressed {
        let _ = a.play_tx.send(PlayCmd::Clear);
        // A new turn is starting — drop any queued re-request and cancel
        // whatever the model was saying.
        a.response_pending.store(false, Ordering::Relaxed);
        let _ = a.out_tx.send(json!({ "type": "response.cancel" }));
    } else {
        let _ = a.out_tx.send(json!({ "type": "input_audio_buffer.commit" }));
        request_response(&a.out_tx, &a.response_active, &a.response_pending);
    }
    let _ = app.emit("voice-mic", json!({ "paused": !pressed, "reason": "ptt" }));
}

#[tauri::command]
pub async fn voice_stop(app: AppHandle, vm: State<'_, Arc<VoiceManager>>) -> Result<(), String> {
    stop_active(&app, &vm);
    emit_status(&app, "off", None);
    Ok(())
}

#[tauri::command]
pub fn voice_state(vm: State<'_, Arc<VoiceManager>>) -> Result<Value, String> {
    let active = vm.active.lock().map_err(|_| "voice state poisoned")?;
    Ok(match active.as_ref() {
        Some(a) => json!({
            "active": true,
            "workspaceId": *a.workspace_id.lock().unwrap_or_else(|p| p.into_inner()),
            "micPaused": a.mic_paused.load(Ordering::Relaxed),
            "elapsedMs": a.started_at.elapsed().as_millis() as u64,
        }),
        None => json!({ "active": false }),
    })
}

/// Manual mic mute toggle from the UI (independent of focus gating).
#[tauri::command]
pub fn voice_set_mic_paused(vm: State<'_, Arc<VoiceManager>>, paused: bool) -> Result<(), String> {
    let active = vm.active.lock().map_err(|_| "voice state poisoned")?;
    if let Some(a) = active.as_ref() {
        a.mic_paused.store(paused, Ordering::Relaxed);
        let _ = a.mic_cmd.send(MicCmd::SetPaused(paused));
    }
    Ok(())
}

/// Frontend reply for tools that must round-trip through the webview
/// (spawn_agent → canvas layout lives in React).
#[tauri::command]
pub fn voice_tool_response(
    vm: State<'_, Arc<VoiceManager>>,
    request_id: String,
    result: Value,
) -> Result<(), String> {
    let tx = vm
        .pending_tools
        .lock()
        .map_err(|_| "voice state poisoned")?
        .remove(&request_id);
    if let Some(tx) = tx {
        let _ = tx.send(result);
    }
    Ok(())
}

/// Window focus hook (wired in lib.rs). In "focused" mode the mic stream is
/// physically paused on blur — the macOS orange mic indicator goes away.
/// All modes mirror focus into the session for the away-recap hold.
pub fn on_window_focus(app: &AppHandle, focused: bool) {
    let Some(vm) = app.try_state::<Arc<VoiceManager>>() else {
        return;
    };
    let Ok(active) = vm.active.lock() else { return };
    if let Some(a) = active.as_ref() {
        a.window_focused.store(focused, Ordering::Relaxed);
        if focused {
            // Flush anything held while the user was away.
            let _ = a.announce_tx.send(Announce::Refocus);
        }
        if a.mode == VoiceMode::Focused {
            a.mic_paused.store(!focused, Ordering::Relaxed);
            let _ = a.mic_cmd.send(MicCmd::SetPaused(!focused));
            let _ = app.emit("voice-mic", json!({ "paused": !focused, "reason": "focus" }));
        }
    }
}

// ─────────────────────────────────────────────────── summon hotkey (Max) ──

/// Register the app-wide "summon Max" hotkey from settings. Called at startup
/// and whenever the user changes the combo. Pass None/empty to clear.
pub fn apply_summon_shortcut(app: &AppHandle, combo: Option<String>) -> Result<(), String> {
    use tauri_plugin_global_shortcut::GlobalShortcutExt;
    let Some(vm) = app.try_state::<Arc<VoiceManager>>() else {
        return Err("voice manager unavailable".into());
    };
    let mut summon = vm.summon.lock().map_err(|_| "voice state poisoned")?;
    // Drop any previous registration first.
    if let Some((old, _)) = summon.take() {
        let _ = app.global_shortcut().unregister(old.as_str());
    }
    let Some(combo) = combo.filter(|c| !c.trim().is_empty()) else {
        return Ok(());
    };
    let parsed: tauri_plugin_global_shortcut::Shortcut = combo
        .parse()
        .map_err(|e| format!("can't parse hotkey '{combo}': {e}"))?;
    app.global_shortcut()
        .register(combo.as_str())
        .map_err(|e| format!("couldn't register '{combo}': {e}"))?;
    eprintln!("[voice] summon hotkey registered: {combo}");
    *summon = Some((combo, parsed));
    Ok(())
}

/// Startup registration from the persisted setting (lib.rs setup).
pub fn register_summon_from_settings(app: &AppHandle) {
    let combo = app
        .try_state::<Arc<AppState>>()
        .and_then(|s| s.db.get_setting("voice_summon_shortcut"));
    if let Err(e) = apply_summon_shortcut(app, combo) {
        eprintln!("[voice] summon hotkey: {e}");
    }
}

/// Persist + apply a new summon combo (None clears it).
#[tauri::command]
pub fn voice_set_summon(app: AppHandle, combo: Option<String>) -> Result<(), String> {
    if let Some(state) = app.try_state::<Arc<AppState>>() {
        let _ = state
            .db
            .set_setting("voice_summon_shortcut", combo.as_deref().unwrap_or(""));
    }
    apply_summon_shortcut(&app, combo)
}

/// Single dispatcher for every global shortcut the app registers: the summon
/// key toggles the session from anywhere; the PTT key drives hold-to-talk.
pub fn on_global_shortcut(
    app: &AppHandle,
    shortcut: &tauri_plugin_global_shortcut::Shortcut,
    pressed: bool,
) {
    let Some(vm) = app.try_state::<Arc<VoiceManager>>() else {
        return;
    };
    let vm = vm.inner().clone();

    // Summon: toggle on key-down only.
    let is_summon = vm
        .summon
        .lock()
        .ok()
        .and_then(|s| s.as_ref().map(|(_, p)| p == shortcut))
        .unwrap_or(false);
    eprintln!("[voice] global shortcut fired (pressed={pressed}, summon={is_summon})");
    if is_summon {
        if !pressed {
            return;
        }
        let session_live = vm
            .active
            .lock()
            .map(|a| a.is_some())
            .unwrap_or(false);
        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            if session_live {
                stop_active(&app, &vm);
                emit_status(&app, "off", Some("summon hotkey"));
            } else {
                // Bind to whichever workspace is active right now.
                let ws = app
                    .try_state::<Arc<AppState>>()
                    .and_then(|s| s.db.load_workspaces().ok())
                    .and_then(|all| all.into_iter().find(|w| w.is_active))
                    .map(|w| w.id);
                match ws {
                    Some(ws_id) => {
                        if let Err(e) = start_session(app.clone(), vm, ws_id).await {
                            emit_status(&app, "error", Some(&e));
                        }
                    }
                    None => emit_status(&app, "error", Some("No active workspace to bind Max to.")),
                }
            }
        });
        return;
    }

    // Otherwise: hold-to-talk for the live PTT session.
    on_ptt(app, pressed);
}

// ─────────────────────────────────────────────── proactive agent events ──

/// What just happened to an agent pane (sourced from status transitions in
/// commands.rs and from the watch-for tool).
#[derive(Clone, Copy)]
pub enum AgentEvent {
    Finished,
    NeedsAttention,
    StillWaiting,
    Errored,
    Died,
}

/// Forward an agent event to the live voice session so Max can announce it
/// (and optionally to Notification Center). Respects the per-event settings
/// and the session's workspace scope. No-op when voice is off.
pub fn on_agent_event(
    app: &AppHandle,
    workspace_id: &str,
    session_id: &str,
    pane: u32,
    agent: &str,
    event: AgentEvent,
    tail: Option<String>,
) {
    let Some(state) = app.try_state::<Arc<AppState>>() else {
        return;
    };
    let (setting, label) = match event {
        AgentEvent::Finished => ("voice_announce_done", "finished its task".to_string()),
        AgentEvent::NeedsAttention => (
            "voice_announce_attention",
            "is waiting on the user — a permission prompt or question".to_string(),
        ),
        AgentEvent::StillWaiting => (
            "voice_announce_attention",
            "has now been waiting on the user for over 2 minutes".to_string(),
        ),
        AgentEvent::Errored => ("voice_announce_errors", "hit an error".to_string()),
        AgentEvent::Died => ("voice_announce_errors", "exited — its terminal is dead".to_string()),
    };
    // Per-event interest gate (default ON) — covers BOTH delivery channels.
    // Turning an event off means you don't want to hear about it at all.
    if state.db.get_setting(setting).map(|v| v == "false").unwrap_or(false) {
        return;
    }

    // Channel 1 — Max speaks it aloud. Requires a live voice session AND the
    // "speak announcements" switch (default ON). Independent of notifications,
    // so you can keep silent banners while Max stays quiet.
    // One Max session narrates the WHOLE app: events from other workspaces are
    // announced too, tagged with that workspace's name so the user knows where.
    let speak = state
        .db
        .get_setting("voice_announce_speak")
        .map(|v| v != "false")
        .unwrap_or(true);
    let delivered_to_voice = speak && (|| {
        let vm = app.try_state::<Arc<VoiceManager>>()?;
        let active = vm.active.lock().ok()?;
        let a = active.as_ref()?;
        let bound_ws = a.workspace_id.lock().ok().map(|w| w.clone())?;
        let where_ = if bound_ws == workspace_id {
            String::new()
        } else {
            // Name the foreign workspace so "Codex finished" isn't ambiguous.
            let name = state
                .db
                .load_workspaces()
                .ok()
                .and_then(|all| all.into_iter().find(|w| w.id == workspace_id))
                .map(|w| w.name)
                .unwrap_or_else(|| "another workspace".into());
            format!(" in the \"{name}\" workspace")
        };
        let mut text = format!("[event] Pane {pane} ({agent}){where_} {label}.");
        if let Some(t) = &tail {
            text.push_str(&format!(" Recent output tail:\n{t}"));
        }
        a.announce_tx.send(Announce::Event(text)).ok()
    })()
    .is_some();

    // Channel 2 — desktop (Notification Center) banner. Default ON, and fires
    // completely independently of Max: you get notified whether or not a voice
    // session is running, in any workspace, even with the window in the
    // background. This is the always-on safety net.
    if state
        .db
        .get_setting("voice_announce_push")
        .map(|v| v != "false")
        .unwrap_or(true)
    {
        use tauri_plugin_notification::NotificationExt;
        let _ = app
            .notification()
            .builder()
            .title("CodeGrid")
            .body(format!("Pane {pane} ({agent}) {label}."))
            .show();
    }

    // Stuck-agent watchdog: a fresh "needs you" gets one escalation if the
    // pane is still waiting in 2 minutes.
    if matches!(event, AgentEvent::NeedsAttention) && delivered_to_voice {
        let app = app.clone();
        let sid = session_id.to_string();
        let ws = workspace_id.to_string();
        let agent = agent.to_string();
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(Duration::from_secs(120)).await;
            let Some(state) = app.try_state::<Arc<AppState>>() else {
                return;
            };
            let still_waiting = {
                let sessions = state.sessions.lock().await;
                sessions
                    .iter()
                    .any(|s| s.id == sid && matches!(s.status, crate::session::SessionStatus::Waiting))
            };
            if still_waiting {
                on_agent_event(&app, &ws, &sid, pane, &agent, AgentEvent::StillWaiting, None);
            }
        });
    }
}

/// Rust-side "agent settled" watcher (spawned once at startup). The webview's
/// JS timers throttle when CodeGrid is backgrounded, so a pane finishing while
/// the user is in Chrome would only be *detected* on refocus. This loop runs
/// in Rust where nothing throttles: a Running pane with no PTY output for 10s
/// flips to Idle here — announcing via Max and notifying the frontend store.
/// Waiting panes are exempt (they're quiet by nature, the user owes them input).
pub fn spawn_idle_settler(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        const QUIET: Duration = Duration::from_secs(10);
        loop {
            tokio::time::sleep(Duration::from_secs(2)).await;
            let Some(state) = app.try_state::<Arc<AppState>>() else {
                continue;
            };
            let state = state.inner().clone();

            // Collect Running panes that have gone quiet, flipping them under
            // the lock; announce after the lock is released.
            let mut settled: Vec<(String, String, u32, String, String)> = Vec::new();
            {
                let quiet_ids: Vec<String> = {
                    let Ok(last) = state.last_output.lock() else { continue };
                    last.iter()
                        .filter(|(_, t)| t.elapsed() > QUIET)
                        .map(|(id, _)| id.clone())
                        .collect()
                };
                if quiet_ids.is_empty() {
                    continue;
                }
                let mut sessions = state.sessions.lock().await;
                for s in sessions.iter_mut() {
                    if quiet_ids.contains(&s.id)
                        && matches!(s.status, crate::session::SessionStatus::Running)
                    {
                        s.status = crate::session::SessionStatus::Idle;
                        if !crate::commands::is_ephemeral_workspace(&s.workspace_id) {
                            let _ = state.db.save_session(s);
                        }
                        settled.push((
                            s.id.clone(),
                            s.workspace_id.clone(),
                            s.pane_number,
                            s.command.clone(),
                            s.created_at.clone(),
                        ));
                    }
                }
            }

            for (sid, ws, pane, command, created_at) in settled {
                // Keep the frontend store in sync (tab dots, pulses) even while
                // its own timers are throttled in the background.
                let _ = app.emit(
                    "session-status-changed",
                    json!({ "sessionId": sid, "status": "idle" }),
                );
                // Boot settle isn't a finished task — same gate as the
                // update_session_status hook.
                let just_booted = chrono::DateTime::parse_from_rfc3339(&created_at)
                    .map(|t| (chrono::Utc::now() - t.with_timezone(&chrono::Utc)).num_seconds() < 30)
                    .unwrap_or(false);
                if just_booted {
                    continue;
                }
                let tail = state
                    .pty_manager
                    .read_output(&sid, 1500)
                    .map(|b| strip_ansi(&b));
                on_agent_event(
                    &app,
                    &ws,
                    &sid,
                    pane,
                    agent_kind(&command),
                    AgentEvent::Finished,
                    tail,
                );
            }
        }
    });
}

/// App-exit cleanup (RunEvent::Exit in lib.rs).
pub fn shutdown(app: &AppHandle) {
    if let Some(vm) = app.try_state::<Arc<VoiceManager>>() {
        let vm = vm.inner().clone();
        stop_active(app, &vm);
    }
}

fn stop_active(app: &AppHandle, vm: &Arc<VoiceManager>) {
    let Ok(mut active) = vm.active.lock() else { return };
    teardown(app, active.take());
}

/// Take down the active session only if it is still the given generation —
/// used by a session's own cleanup task so a finished *old* session can never
/// kill the *new* one that replaced it.
fn stop_if_generation(app: &AppHandle, vm: &Arc<VoiceManager>, generation: u64) -> bool {
    let Ok(mut active) = vm.active.lock() else { return false };
    if active.as_ref().map(|a| a.generation) == Some(generation) {
        teardown(app, active.take());
        true
    } else {
        false
    }
}

fn teardown(app: &AppHandle, taken: Option<ActiveVoice>) {
    if let Some(a) = taken {
        let _ = a.shutdown.send(true);
        let _ = a.mic_cmd.send(MicCmd::Stop);
        // Release the PTT hotkey back to the OS.
        if let Some(combo) = a.ptt_shortcut {
            use tauri_plugin_global_shortcut::GlobalShortcutExt;
            let _ = app.global_shortcut().unregister(combo.as_str());
        }
    }
}

fn emit_status(app: &AppHandle, status: &str, detail: Option<&str>) {
    let _ = app.emit("voice-status", json!({ "status": status, "detail": detail }));
    // Mirror state into the menu-bar so "Talk to Max" + the glyph stay in sync
    // even when the window is in the background.
    crate::native_ui::set_max_tray(app, status);
}

/// Toggle the voice session from the tray ("Talk to Max"): start in the active
/// workspace if off, stop if on. Surfaces errors as status (and a notification
/// since the window may not be visible).
pub fn toggle_from_tray(app: &AppHandle) {
    let Some(vm) = app.try_state::<Arc<VoiceManager>>() else {
        return;
    };
    let vm = vm.inner().clone();
    let session_live = vm.active.lock().map(|a| a.is_some()).unwrap_or(false);
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        if session_live {
            stop_active(&app, &vm);
            emit_status(&app, "off", Some("stopped from menu bar"));
        } else {
            let ws = app
                .try_state::<Arc<AppState>>()
                .and_then(|s| s.db.load_workspaces().ok())
                .and_then(|all| all.into_iter().find(|w| w.is_active))
                .map(|w| w.id);
            match ws {
                Some(ws_id) => {
                    if let Err(e) = start_session(app.clone(), vm, ws_id).await {
                        emit_status(&app, "error", Some(&e));
                        // The window may be hidden — make the failure visible.
                        use tauri_plugin_notification::NotificationExt;
                        let _ = app.notification().builder().title("CodeGrid — Max").body(e).show();
                    }
                }
                None => emit_status(&app, "error", Some("No active workspace to talk to.")),
            }
        }
    });
}

// ─────────────────────────────────────────────────────────── mic (cpal) ──

/// Stateful linear resampler — fine for speech into a 24kHz model feed.
struct Resampler {
    ratio: f64,
    pos: f64,
    last: f32,
}

impl Resampler {
    fn new(from: u32, to: u32) -> Self {
        Self { ratio: from as f64 / to as f64, pos: 0.0, last: 0.0 }
    }

    /// Mono f32 in → mono i16 out at the target rate.
    fn push(&mut self, input: &[f32], out: &mut Vec<i16>) {
        if input.is_empty() {
            return;
        }
        // Virtual timeline: sample 0 is `last` (previous chunk's tail), then input.
        while self.pos < input.len() as f64 {
            let idx = self.pos.floor() as isize;
            let frac = (self.pos - self.pos.floor()) as f32;
            let a = if idx < 0 { self.last } else { input[idx as usize] };
            let b_idx = idx + 1;
            let b = if b_idx < 0 {
                self.last
            } else if (b_idx as usize) < input.len() {
                input[b_idx as usize]
            } else {
                input[input.len() - 1]
            };
            let s = a + (b - a) * frac;
            out.push((s.clamp(-1.0, 1.0) * 32767.0) as i16);
            self.pos += self.ratio;
        }
        self.pos -= input.len() as f64;
        self.last = input[input.len() - 1];
    }
}

/// The cpal `Stream` is !Send, so it lives on a dedicated thread that owns it
/// and services pause/resume/stop commands. Audio flows out through an
/// unbounded tokio sender (sync send — safe from the audio callback).
fn spawn_mic_thread(
    app: AppHandle,
    audio_tx: mpsc::UnboundedSender<Vec<u8>>,
    cmd_rx: std::sync::mpsc::Receiver<MicCmd>,
    paused: Arc<AtomicBool>,
) {
    std::thread::Builder::new()
        .name("voice-mic".into())
        .spawn(move || {
            let host = cpal::default_host();
            let Some(device) = host.default_input_device() else {
                let _ = app.emit("voice-status", json!({ "status": "error", "detail": "No microphone found" }));
                return;
            };
            let config = match device.default_input_config() {
                Ok(c) => c,
                Err(e) => {
                    let _ = app.emit("voice-status", json!({ "status": "error", "detail": format!("Mic config: {e}") }));
                    return;
                }
            };
            let channels = config.channels() as usize;
            let in_rate = config.sample_rate();
            let stream_config: cpal::StreamConfig = config.config();

            let resampler = Mutex::new(Resampler::new(in_rate, TARGET_RATE));
            let pending: Mutex<Vec<i16>> = Mutex::new(Vec::with_capacity(MIC_CHUNK_SAMPLES * 2));
            let paused_cb = paused.clone();
            let tx = audio_tx.clone();

            let on_samples = move |mono: &[f32]| {
                if paused_cb.load(Ordering::Relaxed) {
                    return;
                }
                let (Ok(mut rs), Ok(mut buf)) = (resampler.lock(), pending.lock()) else {
                    return;
                };
                rs.push(mono, &mut buf);
                while buf.len() >= MIC_CHUNK_SAMPLES {
                    let chunk: Vec<i16> = buf.drain(..MIC_CHUNK_SAMPLES).collect();
                    let mut bytes = Vec::with_capacity(chunk.len() * 2);
                    for s in chunk {
                        bytes.extend_from_slice(&s.to_le_bytes());
                    }
                    let _ = tx.send(bytes);
                }
            };

            // Downmix to mono in the callback, then hand to the shared path.
            let err_app = app.clone();
            let err_fn = move |e: cpal::Error| {
                eprintln!("[voice] mic stream error: {e}");
                let _ = err_app.emit("voice-status", json!({ "status": "error", "detail": format!("Mic: {e}") }));
            };

            let stream = match config.sample_format() {
                cpal::SampleFormat::I16 => device.build_input_stream(
                    stream_config,
                    move |data: &[i16], _| {
                        let mono: Vec<f32> = data
                            .chunks(channels)
                            .map(|f| f.iter().map(|&s| s as f32 / 32768.0).sum::<f32>() / channels as f32)
                            .collect();
                        on_samples(&mono);
                    },
                    err_fn,
                    None,
                ),
                _ => device.build_input_stream(
                    stream_config,
                    move |data: &[f32], _| {
                        let mono: Vec<f32> = data
                            .chunks(channels)
                            .map(|f| f.iter().sum::<f32>() / channels as f32)
                            .collect();
                        on_samples(&mono);
                    },
                    err_fn,
                    None,
                ),
            };

            let stream = match stream {
                Ok(s) => s,
                Err(e) => {
                    let _ = app.emit("voice-status", json!({ "status": "error", "detail": format!("Mic open: {e}") }));
                    return;
                }
            };
            if let Err(e) = stream.play() {
                let _ = app.emit("voice-status", json!({ "status": "error", "detail": format!("Mic start: {e}") }));
                return;
            }
            // PTT sessions start deaf — pause immediately so the OS mic
            // indicator only lights while the key is held.
            if paused.load(Ordering::Relaxed) {
                let _ = stream.pause();
            }

            // Service pause/resume until told to stop; dropping the stream
            // releases the device (and the macOS mic indicator).
            while let Ok(cmd) = cmd_rx.recv() {
                match cmd {
                    MicCmd::SetPaused(p) => {
                        paused.store(p, Ordering::Relaxed);
                        let _ = if p { stream.pause() } else { stream.play() };
                    }
                    MicCmd::Stop => break,
                }
            }
            drop(stream);
        })
        .ok();
}

// ───────────────────────────────────────────────────── playback (rodio) ──

/// rodio's device sink is also !Send — same dedicated-thread pattern. The
/// model's PCM16 deltas are appended as small buffers; barge-in clears the
/// queue so the assistant shuts up the instant the user starts talking.
///
/// `speaking` is the echo-protection signal: true while assistant audio is
/// audible (+300ms tail) — the session loop drops mic chunks during it so the
/// model never hears itself through open speakers.
fn spawn_playback_thread(
    app: AppHandle,
    cmd_rx: std::sync::mpsc::Receiver<PlayCmd>,
    speaking: Arc<AtomicBool>,
) {
    std::thread::Builder::new()
        .name("voice-speaker".into())
        .spawn(move || {
            let sink = match rodio::DeviceSinkBuilder::from_default_device()
                .and_then(|b| b.open_stream())
            {
                Ok(s) => s,
                Err(e) => {
                    let _ = app.emit("voice-status", json!({ "status": "error", "detail": format!("Speaker: {e}") }));
                    return;
                }
            };
            let player = rodio::Player::connect_new(sink.mixer());
            let ch = std::num::NonZeroU16::new(1).expect("nonzero");
            let rate = std::num::NonZeroU32::new(TARGET_RATE).expect("nonzero");
            let mut empty_since: Option<Instant> = None;

            loop {
                match cmd_rx.recv_timeout(Duration::from_millis(100)) {
                    Ok(PlayCmd::Chunk(bytes)) => {
                        let samples: Vec<f32> = bytes
                            .chunks_exact(2)
                            .map(|b| i16::from_le_bytes([b[0], b[1]]) as f32 / 32768.0)
                            .collect();
                        player.append(rodio::buffer::SamplesBuffer::new(ch, rate, samples));
                        player.play();
                        speaking.store(true, Ordering::Relaxed);
                        empty_since = None;
                    }
                    Ok(PlayCmd::Clear) => {
                        player.clear();
                        speaking.store(false, Ordering::Relaxed);
                        empty_since = None;
                    }
                    Ok(PlayCmd::Stop) => break,
                    Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {}
                    Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => break,
                }
                // Clear the flag ~300ms after the queue drains (device tail).
                if speaking.load(Ordering::Relaxed) {
                    if player.empty() {
                        let t = *empty_since.get_or_insert_with(Instant::now);
                        if t.elapsed() > Duration::from_millis(300) {
                            speaking.store(false, Ordering::Relaxed);
                            empty_since = None;
                        }
                    } else {
                        empty_since = None;
                    }
                }
            }
        })
        .ok();
}

// ───────────────────────────────────────────────────────── session loop ──

#[allow(clippy::too_many_arguments)]
async fn run_session(
    app: AppHandle,
    state: Arc<AppState>,
    vm: Arc<VoiceManager>,
    api_key: String,
    ws_id: Arc<Mutex<String>>,
    mic_paused: Arc<AtomicBool>,
    mut audio_rx: mpsc::UnboundedReceiver<Vec<u8>>,
    play_tx: std::sync::mpsc::Sender<PlayCmd>,
    out_tx: mpsc::UnboundedSender<Value>,
    mut out_rx: mpsc::UnboundedReceiver<Value>,
    mut shutdown_rx: watch::Receiver<bool>,
    idle_minutes: u64,
    ptt: bool,
    half_duplex: bool,
    wake_word: bool,
    speaking: Arc<AtomicBool>,
    response_active: Arc<AtomicBool>,
    response_pending: Arc<AtomicBool>,
    mut announce_rx: mpsc::UnboundedReceiver<Announce>,
    window_focused: Arc<AtomicBool>,
) -> Result<String, String> {
    let mut request = REALTIME_URL
        .into_client_request()
        .map_err(|e| format!("realtime url: {e}"))?;
    request.headers_mut().insert(
        "Authorization",
        format!("Bearer {api_key}")
            .parse()
            .map_err(|_| "bad api key header".to_string())?,
    );

    let (ws, _) = tokio_tungstenite::connect_async(request)
        .await
        .map_err(|e| format!("Realtime connect failed: {e}"))?;
    let (mut ws_sink, mut ws_stream) = ws.split();

    // All outbound traffic goes through one channel (created by voice_start so
    // the PTT handler can also push events) — audio appends, tool outputs, and
    // session updates never interleave mid-frame.
    let writer = tauri::async_runtime::spawn(async move {
        while let Some(v) = out_rx.recv().await {
            let msg = Message::text(v.to_string());
            if ws_sink.send(msg).await.is_err() {
                break;
            }
        }
        let _ = ws_sink.close().await;
    });

    // Wake-word state: asleep until the name is heard; engaged thereafter.
    // Non-wake sessions are permanently "engaged".
    let mut engaged = !wake_word;

    // Prime the session: instructions + tools + current workspace context.
    let mut last_instructions = build_instructions(&state, &ws_id).await;
    out_tx
        .send(session_update(&last_instructions, true, ptt, engaged))
        .map_err(|_| "ws writer gone".to_string())?;

    emit_status(&app, if engaged { "listening" } else { "sleeping" }, None);

    // The mic thread has been streaming since voice_start — drop whatever
    // queued up while we were connecting so the model doesn't get a backlog
    // of stale (pre-session) audio the moment the session opens.
    while audio_rx.try_recv().is_ok() {}

    let idle_limit = Duration::from_secs(idle_minutes.max(1) * 60);
    let mut last_activity = Instant::now();
    let mut roster_tick = tokio::time::interval(Duration::from_secs(10));
    roster_tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    let mut assistant_line = String::new();

    // Announcement politeness: never talk over the user mid-sentence, and in
    // away-recap mode hold everything while the window is unfocused.
    let away_hold = state
        .db
        .get_setting("voice_announce_away")
        .map(|v| v == "true")
        .unwrap_or(false);
    let mut user_speaking = false;
    let mut held_events: Vec<String> = Vec::new();

    // Push one event (or a combined recap) into the conversation and ask Max
    // to respond. System-role items keep his replies clearly app-initiated.
    fn deliver_events(
        events: &mut Vec<String>,
        out_tx: &mpsc::UnboundedSender<Value>,
        response_active: &Arc<AtomicBool>,
        response_pending: &Arc<AtomicBool>,
    ) {
        if events.is_empty() {
            return;
        }
        let text = if events.len() == 1 {
            format!(
                "{}\nAnnounce this to the user in ONE short spoken sentence. If the user \
previously asked you to take an action when this happens, do it now with your tools.",
                events[0]
            )
        } else {
            format!(
                "While the user was away, these happened:\n{}\nGive ONE short spoken recap \
covering all of them. If the user previously asked for follow-up actions on any of \
these, do them now with your tools.",
                events.join("\n")
            )
        };
        events.clear();
        let _ = out_tx.send(json!({
            "type": "conversation.item.create",
            "item": {
                "type": "message",
                "role": "system",
                "content": [{ "type": "input_text", "text": text }],
            },
        }));
        request_response(out_tx, response_active, response_pending);
    }

    let end_reason: String = loop {
        tokio::select! {
            _ = shutdown_rx.changed() => break "stopped".into(),

            // Proactive events (agent finished / needs you / watch hits).
            ann = announce_rx.recv() => {
                let Some(ann) = ann else { break "stopped".into() };
                match ann {
                    Announce::Refocus => {
                        if !user_speaking {
                            deliver_events(&mut held_events, &out_tx, &response_active, &response_pending);
                        }
                    }
                    Announce::Event(text) => {
                        last_activity = Instant::now();
                        held_events.push(text);
                        let away = away_hold && !window_focused.load(Ordering::Relaxed);
                        if !away && !user_speaking {
                            deliver_events(&mut held_events, &out_tx, &response_active, &response_pending);
                        }
                    }
                }
            }

            // Mic → input_audio_buffer.append
            chunk = audio_rx.recv() => {
                let Some(chunk) = chunk else { break "mic closed".into() };
                // Echo protection: while the assistant is audible through the
                // speakers, drop mic input so it can't hear itself.
                if half_duplex && speaking.load(Ordering::Relaxed) {
                    continue;
                }
                let _ = out_tx.send(json!({
                    "type": "input_audio_buffer.append",
                    "audio": B64.encode(&chunk),
                }));
            }

            // Periodic roster/context refresh + idle policy.
            _ = roster_tick.tick() => {
                if last_activity.elapsed() > idle_limit {
                    // Agents still working or waiting? Stay alive — the user is
                    // probably in another app counting on Max to announce the
                    // finish. The session winds down only once the canvas is quiet.
                    let agents_busy = {
                        let ws = ws_id.lock().map(|w| w.clone()).unwrap_or_default();
                        let sessions = state.sessions.lock().await;
                        sessions.iter().any(|s| {
                            s.workspace_id == ws
                                && matches!(
                                    s.status,
                                    crate::session::SessionStatus::Running
                                        | crate::session::SessionStatus::Waiting
                                )
                        })
                    };
                    if agents_busy {
                        // Re-check on the next tick; don't reset the clock so we
                        // stop promptly once the last agent goes quiet.
                    } else if wake_word {
                        // Wake-word sessions never die on idle — Max just goes
                        // back to sleep until he hears his name again.
                        if engaged {
                            engaged = false;
                            let _ = out_tx.send(session_update(&last_instructions, true, ptt, false));
                            emit_status(&app, "sleeping", None);
                        }
                        last_activity = Instant::now();
                    } else {
                        break format!("auto-stopped after {idle_minutes} min idle");
                    }
                }
                let instructions = build_instructions(&state, &ws_id).await;
                if instructions != last_instructions {
                    last_instructions = instructions;
                    let _ = out_tx.send(session_update(&last_instructions, false, ptt, engaged));
                }
            }

            // Server events
            msg = ws_stream.next() => {
                let Some(msg) = msg else { break "connection closed".into() };
                let msg = match msg {
                    Ok(m) => m,
                    Err(e) => break format!("connection error: {e}"),
                };
                let text = match msg {
                    Message::Text(t) => t.to_string(),
                    Message::Close(_) => break "server closed".into(),
                    _ => continue,
                };
                let Ok(event): Result<Value, _> = serde_json::from_str(&text) else { continue };
                let etype = event.get("type").and_then(|v| v.as_str()).unwrap_or("");

                match etype {
                    // Barge-in: user started talking → silence the speaker now,
                    // and hold announcements until their sentence lands.
                    "input_audio_buffer.speech_started" => {
                        let _ = play_tx.send(PlayCmd::Clear);
                        user_speaking = true;
                        if engaged {
                            last_activity = Instant::now();
                            emit_status(&app, "listening", None);
                        }
                    }

                    "input_audio_buffer.speech_stopped" => {
                        user_speaking = false;
                        if !(away_hold && !window_focused.load(Ordering::Relaxed)) {
                            deliver_events(&mut held_events, &out_tx, &response_active, &response_pending);
                        }
                    }

                    // Model audio out (GA name + legacy fallback).
                    "response.output_audio.delta" | "response.audio.delta" => {
                        if let Some(b64) = event.get("delta").and_then(|v| v.as_str()) {
                            if let Ok(bytes) = B64.decode(b64) {
                                let _ = play_tx.send(PlayCmd::Chunk(bytes));
                            }
                        }
                        emit_status(&app, "speaking", None);
                    }

                    // Live assistant transcript for the UI strip.
                    "response.output_audio_transcript.delta" | "response.audio_transcript.delta" => {
                        if let Some(d) = event.get("delta").and_then(|v| v.as_str()) {
                            assistant_line.push_str(d);
                            let _ = app.emit("voice-transcript", json!({
                                "role": "assistant", "text": assistant_line, "final": false,
                            }));
                        }
                    }
                    "response.output_audio_transcript.done" | "response.audio_transcript.done" => {
                        let text = event.get("transcript").and_then(|v| v.as_str())
                            .unwrap_or(&assistant_line).to_string();
                        let _ = app.emit("voice-transcript", json!({
                            "role": "assistant", "text": text, "final": true,
                        }));
                        assistant_line.clear();
                    }

                    // What the user said, post-VAD. In wake mode this is also
                    // the wake-word detector: unaddressed speech is deleted
                    // from the conversation so it's never processed or billed.
                    "conversation.item.input_audio_transcription.completed" => {
                        let transcript = event.get("transcript")
                            .and_then(|v| v.as_str())
                            .unwrap_or("")
                            .trim()
                            .to_string();
                        if wake_word && !engaged {
                            if mentions_max(&transcript) {
                                // Woken. Flip to auto-responding, answer the
                                // wake utterance itself (it usually carries
                                // the command), and stay engaged.
                                engaged = true;
                                let _ = out_tx.send(session_update(&last_instructions, true, ptt, true));
                                let _ = app.emit("voice-transcript", json!({
                                    "role": "user", "text": transcript, "final": true,
                                }));
                                emit_status(&app, "listening", None);
                                request_response(&out_tx, &response_active, &response_pending);
                                last_activity = Instant::now();
                            } else if let Some(item_id) = event.get("item_id").and_then(|v| v.as_str()) {
                                // Not for Max — drop it from context entirely.
                                let _ = out_tx.send(json!({
                                    "type": "conversation.item.delete",
                                    "item_id": item_id,
                                }));
                            }
                        } else {
                            if !transcript.is_empty() {
                                let _ = app.emit("voice-transcript", json!({
                                    "role": "user", "text": transcript, "final": true,
                                }));
                            }
                            last_activity = Instant::now();
                        }
                    }

                    // Function calls arrive complete on output_item.done.
                    "response.output_item.done" => {
                        let item = event.get("item").cloned().unwrap_or_default();
                        if item.get("type").and_then(|v| v.as_str()) == Some("function_call") {
                            last_activity = Instant::now();
                            let name = item.get("name").and_then(|v| v.as_str()).unwrap_or("").to_string();
                            let call_id = item.get("call_id").and_then(|v| v.as_str()).unwrap_or("").to_string();
                            let args: Value = item.get("arguments")
                                .and_then(|v| v.as_str())
                                .and_then(|s| serde_json::from_str(s).ok())
                                .unwrap_or(json!({}));

                            emit_status(&app, "tool", Some(&name));
                            let _ = app.emit("voice-tool-call", json!({
                                "name": name, "args": args, "phase": "start",
                            }));

                            // Run the tool without blocking the event loop —
                            // spawn_agent can take seconds.
                            let app2 = app.clone();
                            let state2 = state.clone();
                            let vm2 = vm.clone();
                            let ws_id2 = ws_id.clone();
                            let out2 = out_tx.clone();
                            let active2 = response_active.clone();
                            let pending2 = response_pending.clone();
                            tauri::async_runtime::spawn(async move {
                                let result = execute_tool(&app2, &state2, &vm2, &ws_id2, &name, &args).await;
                                let output = match &result {
                                    Ok(v) => v.to_string(),
                                    Err(e) => json!({ "error": e }).to_string(),
                                };
                                let _ = app2.emit("voice-tool-call", json!({
                                    "name": name, "args": args,
                                    "phase": "done", "ok": result.is_ok(),
                                    "result": result.as_ref().ok().cloned(),
                                    "error": result.as_ref().err().cloned(),
                                }));
                                let _ = out2.send(json!({
                                    "type": "conversation.item.create",
                                    "item": {
                                        "type": "function_call_output",
                                        "call_id": call_id,
                                        "output": output,
                                    },
                                }));
                                // Parallel tool calls finish independently —
                                // gate the response so two creates never collide.
                                request_response(&out2, &active2, &pending2);
                            });
                        }
                    }

                    "response.created" => {
                        response_active.store(true, Ordering::Relaxed);
                    }

                    "response.done" => {
                        last_activity = Instant::now();
                        response_active.store(false, Ordering::Relaxed);
                        // A turn or tool output queued up while this response
                        // ran — give the model its follow-up now.
                        if response_pending.swap(false, Ordering::Relaxed) {
                            request_response(&out_tx, &response_active, &response_pending);
                        }
                        emit_status(&app, "listening", None);
                    }

                    "error" => {
                        let msg = event.pointer("/error/message")
                            .and_then(|v| v.as_str())
                            .unwrap_or("unknown realtime error");
                        eprintln!("[voice] realtime error: {msg}");
                        // PTT housekeeping noise (cancel with nothing active,
                        // commit of a near-empty buffer) isn't worth a toast.
                        let benign = msg.contains("no active response")
                            || msg.contains("Cancellation failed")
                            || msg.contains("buffer too small")
                            || msg.contains("buffer is empty")
                            || msg.contains("already has an active response")
                            // Wake-word housekeeping: deleting an unaddressed
                            // item can race the server's own lifecycle.
                            || msg.contains("does not exist");
                        // Our optimistic flag was wrong — resync and retry
                        // once the in-flight response finishes.
                        if msg.contains("already has an active response") {
                            response_active.store(true, Ordering::Relaxed);
                            response_pending.store(true, Ordering::Relaxed);
                        } else if !benign {
                            // A rejected response.create would otherwise latch
                            // response_active=true forever (no response.done
                            // will ever arrive) and mute the assistant. Unlatch
                            // and replay anything queued; a spurious unlatch
                            // self-heals via the "already active" resync above.
                            response_active.store(false, Ordering::Relaxed);
                            if response_pending.swap(false, Ordering::Relaxed) {
                                request_response(&out_tx, &response_active, &response_pending);
                            }
                        }
                        if !benign {
                            let _ = app.emit("voice-status", json!({
                                "status": "warning", "detail": msg,
                            }));
                        }
                    }

                    _ => {}
                }
            }
        }
    };

    // Suppress the unused warning — paused state is owned by the mic thread;
    // the session loop only needs it alive for voice_state queries.
    let _ = mic_paused;

    // Abort rather than await: ActiveVoice still holds an out_tx clone at this
    // point (it's removed by the cleanup task *after* we return), so the writer
    // would never see channel-closed and awaiting it deadlocks every session
    // end that isn't an explicit voice_stop. The session is over — drop frames.
    drop(out_tx);
    writer.abort();
    Ok(end_reason)
}

/// session.update — GA shape. `full` includes audio config + tools; refreshes
/// only re-send instructions (server merges fields). In PTT mode server VAD
/// is off entirely: turns are committed by the hotkey release.
///
/// `auto_respond=false` is the wake-word "asleep" state: VAD still detects
/// and commits turns (so we get transcripts to scan for the name), but the
/// model never responds on its own — we fire response.create manually once
/// Max is engaged.
fn session_update(instructions: &str, full: bool, ptt: bool, auto_respond: bool) -> Value {
    let mut session = json!({
        "type": "realtime",
        "instructions": instructions,
    });
    if full {
        session["output_modalities"] = json!(["audio"]);
        session["audio"] = json!({
            "input": {
                "format": { "type": "audio/pcm", "rate": TARGET_RATE },
                "transcription": { "model": "whisper-1" },
                "turn_detection": if ptt {
                    Value::Null
                } else {
                    json!({ "type": "semantic_vad", "create_response": auto_respond })
                },
            },
            "output": {
                "format": { "type": "audio/pcm", "rate": TARGET_RATE },
                "voice": "marin",
            },
        });
        session["tools"] = tool_schemas();
        session["tool_choice"] = json!("auto");
    }
    json!({ "type": "session.update", "session": session })
}

/// Does a transcript address Max by name? Word-boundary match so "maximum"
/// or "climax" can't wake him.
fn mentions_max(transcript: &str) -> bool {
    transcript
        .to_lowercase()
        .split(|c: char| !c.is_alphanumeric())
        .any(|w| w == "max")
}

async fn build_instructions(state: &Arc<AppState>, ws_id: &Arc<Mutex<String>>) -> String {
    let workspace_id = ws_id
        .lock()
        .map(|w| w.clone())
        .unwrap_or_default();

    let ws_label = state
        .db
        .load_workspaces()
        .ok()
        .and_then(|all| all.into_iter().find(|w| w.id == workspace_id))
        .map(|w| match &w.repo_path {
            Some(p) => format!("\"{}\" (repo: {p})", w.name),
            None => format!("\"{}\"", w.name),
        })
        .unwrap_or_else(|| "(unknown)".into());

    let sessions = state.sessions.lock().await;
    let mut roster = String::new();
    for s in sessions
        .iter()
        .filter(|s| s.workspace_id == workspace_id)
    {
        let agent = agent_kind(&s.command);
        let status = format!("{:?}", s.status).to_lowercase();
        let name = s
            .name
            .as_deref()
            .map(|n| format!(" \"{n}\""))
            .unwrap_or_default();
        roster.push_str(&format!(
            "  - pane {} — {agent}{name} ({status}, dir: {})\n",
            s.pane_number, s.working_dir
        ));
    }
    if roster.is_empty() {
        roster = "  (no agents running)\n".into();
    }
    drop(sessions);

    format!(
        "You are Max — CodeGrid's voice operator. Your name is Max; the user will \
address you as \"Max\" and you may refer to yourself that way. CodeGrid is a terminal \
canvas where AI coding agents (Claude Code, Codex, Gemini, Cursor, Grok, Venice) run \
in panes. You control the app exclusively through your tools.\n\
\n\
Current workspace: {ws_label}\n\
Agents on the canvas right now:\n{roster}\
\n\
WHAT LIVES ON A CODEGRID CANVAS — and you can create all of it:\n\
- Agent panes: claude, codex, gemini, cursor, grok, venice (spawn_agent), plus plain \
shells (agent_type \"shell\") for running arbitrary commands.\n\
- Notes: markdown scratchpads pinned to the canvas (create_note) — use them to write \
plans, summaries, task lists, or anything the user asks you to jot down.\n\
- Browser panes: live previews of localhost dev servers or any URL (open_browser).\n\
- Git: the workspace is usually a git repo — the git tool covers status, commit \
(stages everything), push, pull, branches, and recent log.\n\
You can do nearly anything the user could do by hand. If a request has no dedicated \
tool, spawn a shell pane and run the commands there with message_agent.\n\
\n\
PROMPT CRAFTING — your most important job:\n\
- Never relay the user's spoken words verbatim to an agent. Rewrite every task into a \
clear, complete prompt a coding agent can execute well: state the goal, name the \
concrete files/paths/branches/symbols mentioned, include constraints the user implied, \
and say what the agent should produce or verify when done.\n\
- Example: \"have it fix that flaky login test\" becomes \"Find the flaky test covering \
the login flow, diagnose why it fails intermittently, fix the root cause (not the \
symptom), and run the test 5 times to confirm it passes consistently.\"\n\
- Speech-to-text mishears things (\"cloud\" usually means \"Claude\"). Fix obvious \
transcription slips silently; ask only when genuinely unclear.\n\
\n\
ORCHESTRATION — multi-agent goals:\n\
- For a goal that needs several agents, spawn each with spawn_agent and a focused \
sub-task prompt, then make them collaborate: every agent has the codegrid-agent-bus \
MCP (agent_list, agent_send, agent_read) to message and read the other panes in this \
workspace. Appoint one agent as coordinator in its prompt — e.g. \"You are coordinating \
panes 2 and 3 via the codegrid-agent-bus MCP: delegate X to the codex pane, Y to the \
gemini pane, read their replies, and assemble the final result.\"\n\
- After dispatching a fleet, briefly tell the user who is doing what.\n\
\n\
PROACTIVE EVENTS:\n\
- Messages starting with [event] are app notifications: an agent finished, needs \
input, errored, or a watch you set matched. Announce each in ONE short spoken \
sentence (e.g. \"Codex in pane 3 is done — tests are passing\"), using the output \
tail to say WHAT happened, not just that something happened.\n\
- If the user earlier asked you to chain an action on an event (\"when codex \
finishes, have claude review it\"), perform it now with your tools, then briefly report.\n\
- Use watch_output for \"tell me when…\" requests, and workspace_digest for \
full status sweeps.\n\
\n\
RULES:\n\
- Keep spoken replies short — one or two sentences. You are a dispatcher, not a narrator.\n\
- spawn_agent starts a new pane (its prompt is typed in automatically once the agent \
boots). message_agent sends a task to a pane that is already running.\n\
- Refer to panes by their exact pane number. If a reference like \"the Claude pane\" \
matches more than one pane, the tool returns the candidates — ask the user which pane \
number they mean. Never guess between duplicates.\n\
- For \"what is X doing?\" use read_pane and summarize the tail of the output in a \
sentence or two. Do not read terminal output verbatim.\n\
- close_agent kills a pane permanently, and git push publishes to the remote: for \
both, confirm verbally and wait for a yes first. Announce branch switches. If the \
user says stop/cancel/interrupt, use interrupt_agent — it stops the current task but \
keeps the pane alive.\n\
- Panes with status \"dead\" are finished or crashed — they can be closed but not \
messaged or interrupted.\n\
- If a tool returns an error, say what failed briefly and suggest the next step.\n\
- Everything is scoped to the current workspace. Never claim to act outside it."
    )
}

fn tool_schemas() -> Value {
    json!([
        {
            "type": "function",
            "name": "spawn_agent",
            "description": "Create a new agent pane on the canvas. Optionally give it an initial task prompt, which is typed into the agent once it has booted.",
            "parameters": {
                "type": "object",
                "properties": {
                    "agent_type": { "type": "string", "enum": ["claude", "codex", "gemini", "cursor", "grok", "venice", "shell"], "description": "Which agent CLI to launch." },
                    "prompt": { "type": "string", "description": "Optional initial task to type into the agent when it is ready." },
                    "working_dir": { "type": "string", "description": "Optional directory; defaults to the workspace repo." }
                },
                "required": ["agent_type"]
            }
        },
        {
            "type": "function",
            "name": "message_agent",
            "description": "Type a message/task into an existing agent pane and submit it.",
            "parameters": {
                "type": "object",
                "properties": {
                    "pane": { "type": "string", "description": "Pane number or fuzzy name, e.g. '3' or 'codex'." },
                    "text": { "type": "string" },
                    "submit": { "type": "boolean", "description": "Press Enter after typing (default true)." }
                },
                "required": ["pane", "text"]
            }
        },
        {
            "type": "function",
            "name": "read_pane",
            "description": "Read the recent terminal output of a pane so you can summarize what the agent is doing.",
            "parameters": {
                "type": "object",
                "properties": {
                    "pane": { "type": "string" },
                    "max_bytes": { "type": "integer", "description": "Tail size, default 4000." }
                },
                "required": ["pane"]
            }
        },
        {
            "type": "function",
            "name": "list_agents",
            "description": "List the agent panes in the current workspace with status.",
            "parameters": { "type": "object", "properties": {} }
        },
        {
            "type": "function",
            "name": "focus_pane",
            "description": "Bring a pane into view on the canvas (switch/zoom/focus).",
            "parameters": {
                "type": "object",
                "properties": { "pane": { "type": "string" } },
                "required": ["pane"]
            }
        },
        {
            "type": "function",
            "name": "close_agent",
            "description": "Kill an agent pane. Destructive — verbally confirm with the user first.",
            "parameters": {
                "type": "object",
                "properties": { "pane": { "type": "string" } },
                "required": ["pane"]
            }
        },
        {
            "type": "function",
            "name": "interrupt_agent",
            "description": "Interrupt an agent's current task (Esc/Ctrl-C) without closing the pane.",
            "parameters": {
                "type": "object",
                "properties": { "pane": { "type": "string" } },
                "required": ["pane"]
            }
        },
        {
            "type": "function",
            "name": "create_note",
            "description": "Create a markdown note pane on the canvas with the given content — plans, summaries, task lists, anything the user wants written down.",
            "parameters": {
                "type": "object",
                "properties": {
                    "title": { "type": "string", "description": "Optional heading for the note." },
                    "content": { "type": "string", "description": "Markdown body of the note." }
                },
                "required": ["content"]
            }
        },
        {
            "type": "function",
            "name": "open_browser",
            "description": "Open a live browser/preview pane on the canvas — e.g. the dev server at http://localhost:3000, or any URL.",
            "parameters": {
                "type": "object",
                "properties": { "url": { "type": "string" } },
                "required": ["url"]
            }
        },
        {
            "type": "function",
            "name": "watch_output",
            "description": "Watch a pane's output and notify the user out loud when the given text appears (15-minute limit). Use for 'tell me when…' requests, e.g. 'tell me when pane 3 says server started'.",
            "parameters": {
                "type": "object",
                "properties": {
                    "pane": { "type": "string" },
                    "pattern": { "type": "string", "description": "Case-insensitive text to watch for." }
                },
                "required": ["pane", "pattern"]
            }
        },
        {
            "type": "function",
            "name": "workspace_digest",
            "description": "Read every pane's status and recent output in ONE call — use for 'what's the status of everything' / standup-style summaries instead of reading panes one by one.",
            "parameters": { "type": "object", "properties": {} }
        },
        {
            "type": "function",
            "name": "git",
            "description": "Run a git action on the workspace repo. 'commit' stages ALL changes and commits with the message. Confirm verbally with the user before 'push'.",
            "parameters": {
                "type": "object",
                "properties": {
                    "action": { "type": "string", "enum": ["status", "commit", "push", "pull", "create_branch", "switch_branch", "log"] },
                    "message": { "type": "string", "description": "Commit message (required for 'commit')." },
                    "branch": { "type": "string", "description": "Branch name (for 'create_branch' / 'switch_branch')." },
                    "count": { "type": "integer", "description": "How many log entries (default 10)." }
                },
                "required": ["action"]
            }
        }
    ])
}

// ─────────────────────────────────────────────────────────────── tools ──

fn agent_kind(command: &str) -> &'static str {
    let c = command.to_lowercase();
    if c.contains("claude") {
        "claude"
    } else if c.contains("codex") {
        "codex"
    } else if c.contains("gemini") {
        "gemini"
    } else if c.contains("cursor") || c.contains("agent") {
        "cursor"
    } else if c.contains("grok") {
        "grok"
    } else if c.contains("venice") || c.contains("aider") {
        "venice"
    } else {
        "shell"
    }
}

/// Resolve "3" / "pane 3" / "codex" / "the claude pane" → session id, scoped
/// to the bound workspace (same isolation discipline as the agent bus).
async fn resolve_pane(
    state: &Arc<AppState>,
    workspace_id: &str,
    pane: &str,
) -> Result<(String, String, u32), String> {
    let sessions = state.sessions.lock().await;
    let in_ws: Vec<_> = sessions
        .iter()
        .filter(|s| s.workspace_id == workspace_id)
        .collect();

    let needle = pane.trim().to_lowercase();
    let digits: String = needle.chars().filter(|c| c.is_ascii_digit()).collect();

    // Ambiguity is an error on purpose: the model is instructed to ask the
    // user which pane number they mean instead of guessing.
    let ambiguous = |candidates: &[&crate::session::Session]| -> String {
        let list = candidates
            .iter()
            .map(|s| {
                let name = s.name.as_deref().map(|n| format!(" \"{n}\"")).unwrap_or_default();
                format!("pane {} ({}{name})", s.pane_number, agent_kind(&s.command))
            })
            .collect::<Vec<_>>()
            .join(", ");
        format!("Multiple panes match '{pane}': {list}. Ask the user which pane number they mean.")
    };

    // 1) Pane number (possibly embedded: "pane 3") — always unique.
    if let Ok(n) = digits.parse::<u32>() {
        if !digits.is_empty() {
            if let Some(s) = in_ws.iter().find(|s| s.pane_number == n) {
                return Ok((s.id.clone(), s.command.clone(), s.pane_number));
            }
        }
    }
    // A dead pane shouldn't make "the claude pane" ambiguous against a live
    // one — prefer live matches, but fall back to dead ones so close_agent
    // can still clean them up by name.
    fn prefer_live<'a>(
        matches: Vec<&'a crate::session::Session>,
    ) -> Vec<&'a crate::session::Session> {
        let live: Vec<_> = matches
            .iter()
            .filter(|s| !matches!(s.status, crate::session::SessionStatus::Dead))
            .copied()
            .collect();
        if live.is_empty() { matches } else { live }
    }

    // 2) User-assigned name.
    let by_name = prefer_live(
        in_ws
            .iter()
            .copied()
            .filter(|s| {
                s.name
                    .as_deref()
                    .map(|n| needle.contains(&n.to_lowercase()) || n.to_lowercase().contains(&needle))
                    .unwrap_or(false)
            })
            .collect(),
    );
    match by_name.len() {
        1 => return Ok((by_name[0].id.clone(), by_name[0].command.clone(), by_name[0].pane_number)),
        n if n > 1 => return Err(ambiguous(&by_name)),
        _ => {}
    }
    // 3) Agent kind ("codex", "the claude pane").
    let by_kind = prefer_live(
        in_ws
            .iter()
            .copied()
            .filter(|s| needle.contains(agent_kind(&s.command)))
            .collect(),
    );
    match by_kind.len() {
        1 => return Ok((by_kind[0].id.clone(), by_kind[0].command.clone(), by_kind[0].pane_number)),
        n if n > 1 => return Err(ambiguous(&by_kind)),
        _ => {}
    }

    Err(format!(
        "No pane matching '{pane}' in this workspace. Use list_agents to see what's running."
    ))
}

/// Drop ANSI escape sequences and control chars so the model summarizes text,
/// not cursor-positioning noise. (Also used by the agent-event hooks in
/// commands.rs to build announce-able output tails.)
pub(crate) fn strip_ansi(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        let b = bytes[i];
        if b == 0x1b {
            i += 1;
            if i >= bytes.len() {
                break;
            }
            match bytes[i] {
                b'[' => {
                    // CSI: skip until final byte 0x40..=0x7E
                    i += 1;
                    while i < bytes.len() && !(0x40..=0x7e).contains(&bytes[i]) {
                        i += 1;
                    }
                    i += 1;
                }
                b']' => {
                    // OSC: skip until BEL or ESC \
                    i += 1;
                    while i < bytes.len() {
                        if bytes[i] == 0x07 {
                            i += 1;
                            break;
                        }
                        if bytes[i] == 0x1b && i + 1 < bytes.len() && bytes[i + 1] == b'\\' {
                            i += 2;
                            break;
                        }
                        i += 1;
                    }
                }
                _ => i += 1,
            }
            continue;
        }
        if b == b'\n' || b == b'\t' || (0x20..0x7f).contains(&b) || b >= 0x80 {
            out.push(b as char);
        }
        i += 1;
    }
    // Collapse blank-line runs left behind by TUI redraws.
    let mut compact = String::with_capacity(out.len());
    let mut blanks = 0;
    for line in out.lines() {
        if line.trim().is_empty() {
            blanks += 1;
            if blanks > 1 {
                continue;
            }
        } else {
            blanks = 0;
        }
        compact.push_str(line.trim_end());
        compact.push('\n');
    }
    compact
}

async fn execute_tool(
    app: &AppHandle,
    state: &Arc<AppState>,
    vm: &Arc<VoiceManager>,
    ws_id: &Arc<Mutex<String>>,
    name: &str,
    args: &Value,
) -> Result<Value, String> {
    let workspace_id = ws_id
        .lock()
        .map(|w| w.clone())
        .map_err(|_| "voice state poisoned".to_string())?;
    let str_arg = |key: &str| args.get(key).and_then(|v| v.as_str()).map(str::to_string);

    match name {
        "spawn_agent" => {
            let agent_type = str_arg("agent_type").ok_or("missing agent_type")?;
            let prompt = str_arg("prompt");
            let working_dir = str_arg("working_dir");

            // Pane layout lives in React — round-trip the spawn through the
            // frontend so the new pane lands on the canvas like any other.
            let request_id = uuid::Uuid::new_v4().to_string();
            let (tx, rx) = oneshot::channel::<Value>();
            vm.pending_tools
                .lock()
                .map_err(|_| "voice state poisoned".to_string())?
                .insert(request_id.clone(), tx);

            let _ = app.emit(
                "voice-spawn-agent",
                json!({
                    "requestId": request_id,
                    "workspaceId": workspace_id,
                    "agentType": agent_type,
                    "workingDir": working_dir,
                }),
            );

            let reply = match tokio::time::timeout(SPAWN_REPLY_TIMEOUT, rx).await {
                Ok(Ok(v)) => v,
                Ok(Err(_)) => return Err("spawn cancelled".into()),
                Err(_) => {
                    // Reap the dead sender so the map doesn't accumulate
                    // entries for replies that never came.
                    if let Ok(mut pending) = vm.pending_tools.lock() {
                        pending.remove(&request_id);
                    }
                    return Err("spawn timed out waiting for the app".into());
                }
            };

            if let Some(err) = reply.get("error").and_then(|v| v.as_str()) {
                return Err(err.to_string());
            }
            let session_id = reply
                .get("id")
                .and_then(|v| v.as_str())
                .ok_or("spawn returned no session id")?
                .to_string();
            let pane = reply.get("pane_number").and_then(|v| v.as_u64()).unwrap_or(0);

            // Deliver the prompt asynchronously once the agent's TUI is ready;
            // return now so the model can speak the confirmation immediately.
            if let Some(prompt) = prompt.filter(|p| !p.trim().is_empty()) {
                let state2 = state.clone();
                let app2 = app.clone();
                let sid = session_id.clone();
                tauri::async_runtime::spawn(async move {
                    let delivered = wait_ready_and_send(&state2, &sid, &prompt).await;
                    let _ = app2.emit(
                        "voice-tool-call",
                        json!({
                            "name": "spawn_agent.prompt",
                            "phase": "done",
                            "ok": delivered.is_ok(),
                            "error": delivered.err(),
                        }),
                    );
                });
                Ok(json!({
                    "status": "spawned",
                    "pane": pane,
                    "agent": agent_type,
                    "note": "Prompt will be typed in automatically once the agent finishes booting."
                }))
            } else {
                Ok(json!({ "status": "spawned", "pane": pane, "agent": agent_type }))
            }
        }

        "message_agent" => {
            let pane = str_arg("pane").ok_or("missing pane")?;
            let text = str_arg("text").ok_or("missing text")?;
            let submit = args.get("submit").and_then(|v| v.as_bool()).unwrap_or(true);
            let (sid, _, pane_no) = resolve_pane(state, &workspace_id, &pane).await?;

            state
                .pty_manager
                .write_to_pty(&sid, text.as_bytes())
                .map_err(|e| format!("write failed: {e}"))?;
            if submit {
                // Let the target CLI register the pasted text before Enter —
                // same pattern as agent_send on the RPC bus.
                tokio::time::sleep(Duration::from_millis(120)).await;
                let _ = state.pty_manager.write_to_pty(&sid, b"\r");
            }
            Ok(json!({ "status": "sent", "pane": pane_no }))
        }

        "read_pane" => {
            let pane = str_arg("pane").ok_or("missing pane")?;
            let max = args
                .get("max_bytes")
                .and_then(|v| v.as_u64())
                .unwrap_or(4000)
                .min(16_000) as usize;
            let (sid, command, pane_no) = resolve_pane(state, &workspace_id, &pane).await?;
            let bytes = state
                .pty_manager
                .read_output(&sid, max)
                .ok_or("no output available for that pane")?;
            Ok(json!({
                "pane": pane_no,
                "agent": agent_kind(&command),
                "output_tail": strip_ansi(&bytes),
            }))
        }

        "list_agents" => {
            let sessions = state.sessions.lock().await;
            let agents: Vec<Value> = sessions
                .iter()
                .filter(|s| s.workspace_id == workspace_id)
                .map(|s| {
                    json!({
                        "pane": s.pane_number,
                        "agent": agent_kind(&s.command),
                        "status": format!("{:?}", s.status).to_lowercase(),
                        "name": s.name,
                        "dir": s.working_dir,
                    })
                })
                .collect();
            Ok(json!({ "agents": agents }))
        }

        "focus_pane" => {
            let pane = str_arg("pane").ok_or("missing pane")?;
            let (sid, _, pane_no) = resolve_pane(state, &workspace_id, &pane).await?;
            let _ = app.emit("voice-focus-pane", json!({ "sessionId": sid }));
            Ok(json!({ "status": "focused", "pane": pane_no }))
        }

        "close_agent" => {
            let pane = str_arg("pane").ok_or("missing pane")?;
            let (sid, _, pane_no) = resolve_pane(state, &workspace_id, &pane).await?;
            crate::commands::kill_session_impl(state, &sid).await?;
            // The backend kill alone leaves a dead pane on the canvas — tell
            // the frontend to drop the session + its layout slot too.
            let _ = app.emit("voice-close-pane", json!({ "sessionId": sid }));
            Ok(json!({ "status": "closed", "pane": pane_no }))
        }

        "interrupt_agent" => {
            let pane = str_arg("pane").ok_or("missing pane")?;
            let (sid, command, pane_no) = resolve_pane(state, &workspace_id, &pane).await?;
            // TUI agents stop on Esc; a bare shell needs Ctrl-C.
            let byte: &[u8] = if agent_kind(&command) == "shell" { b"\x03" } else { b"\x1b" };
            state
                .pty_manager
                .write_to_pty(&sid, byte)
                .map_err(|e| format!("interrupt failed: {e}"))?;
            Ok(json!({ "status": "interrupted", "pane": pane_no }))
        }

        "create_note" => {
            let content = str_arg("content").ok_or("missing content")?;
            let seed = match str_arg("title").filter(|t| !t.trim().is_empty()) {
                Some(t) => format!("# {t}\n\n{content}"),
                None => content,
            };
            // Notes are synthetic panes owned by React — same fire-and-forget
            // path as the "+ New → Note" menu item.
            let _ = app.emit("voice-create-note", json!({ "seedText": seed }));
            Ok(json!({ "status": "note created on the canvas" }))
        }

        "open_browser" => {
            let raw = str_arg("url").ok_or("missing url")?;
            let url = if raw.starts_with("http://") || raw.starts_with("https://") {
                raw
            } else {
                format!("http://{raw}")
            };
            let _ = app.emit("voice-open-browser", json!({ "url": url }));
            Ok(json!({ "status": "browser pane opened", "url": url }))
        }

        "watch_output" => {
            let pane = str_arg("pane").ok_or("missing pane")?;
            let pattern = str_arg("pattern").ok_or("missing pattern")?;
            let (sid, command, pane_no) = resolve_pane(state, &workspace_id, &pane).await?;
            // Already on screen? Say so instead of arming a watch that would
            // fire instantly on old scrollback.
            if let Some(bytes) = state.pty_manager.read_output(&sid, 64 * 1024) {
                if strip_ansi(&bytes).to_lowercase().contains(&pattern.to_lowercase()) {
                    return Ok(json!({
                        "status": "already_present",
                        "pane": pane_no,
                        "note": "That text is already in the pane's output."
                    }));
                }
            }
            let announce = vm
                .active
                .lock()
                .map_err(|_| "voice state poisoned".to_string())?
                .as_ref()
                .map(|a| a.announce_tx.clone())
                .ok_or("voice session not active")?;
            let state2 = state.clone();
            let agent = agent_kind(&command);
            let pat_lc = pattern.to_lowercase();
            let pattern2 = pattern.clone();
            tauri::async_runtime::spawn(async move {
                let deadline = Instant::now() + Duration::from_secs(15 * 60);
                loop {
                    tokio::time::sleep(Duration::from_secs(2)).await;
                    if announce.is_closed() {
                        break; // session ended — watch dies with it
                    }
                    if Instant::now() > deadline {
                        let _ = announce.send(Announce::Event(format!(
                            "[event] The watch on pane {pane_no} for '{pattern2}' expired after 15 minutes without matching."
                        )));
                        break;
                    }
                    let Some(bytes) = state2.pty_manager.read_output(&sid, 64 * 1024) else {
                        let _ = announce.send(Announce::Event(format!(
                            "[event] Watch cancelled — pane {pane_no} is gone."
                        )));
                        break;
                    };
                    if strip_ansi(&bytes).to_lowercase().contains(&pat_lc) {
                        let _ = announce.send(Announce::Event(format!(
                            "[event] Watch matched: pane {pane_no} ({agent}) just printed '{pattern2}'."
                        )));
                        break;
                    }
                }
            });
            Ok(json!({
                "status": "watching",
                "pane": pane_no,
                "pattern": pattern,
                "note": "The user will be told out loud when it matches (15-minute limit)."
            }))
        }

        "workspace_digest" => {
            let snapshot: Vec<_> = {
                let sessions = state.sessions.lock().await;
                sessions
                    .iter()
                    .filter(|s| s.workspace_id == workspace_id)
                    .take(12)
                    .map(|s| (s.id.clone(), s.pane_number, s.command.clone(), format!("{:?}", s.status).to_lowercase(), s.name.clone()))
                    .collect()
            };
            let panes: Vec<Value> = snapshot
                .into_iter()
                .map(|(id, pane, command, status, name)| {
                    let tail = state
                        .pty_manager
                        .read_output(&id, 1200)
                        .map(|b| strip_ansi(&b))
                        .unwrap_or_default();
                    json!({
                        "pane": pane,
                        "agent": agent_kind(&command),
                        "status": status,
                        "name": name,
                        "tail": tail,
                    })
                })
                .collect();
            Ok(json!({ "panes": panes }))
        }

        "git" => {
            let action = str_arg("action").ok_or("missing action")?;
            let dir = workspace_repo_dir(state, &workspace_id).await?;
            match action.as_str() {
                "status" => crate::commands::git_status(dir)
                    .await
                    .map(|s| serde_json::to_value(s).unwrap_or_else(|_| json!({}))),
                "commit" => {
                    let message = str_arg("message").ok_or("missing commit message")?;
                    crate::commands::git_commit(dir, message, true)
                        .await
                        .map(|out| json!({ "result": out }))
                }
                "push" => crate::commands::git_push(dir, true)
                    .await
                    .map(|out| json!({ "result": out })),
                "pull" => crate::commands::git_pull(dir)
                    .await
                    .map(|out| json!({ "result": out })),
                "create_branch" => {
                    let branch = str_arg("branch").ok_or("missing branch name")?;
                    crate::commands::git_create_branch(dir, branch.clone(), true)
                        .await
                        .map(|_| json!({ "status": "created and switched", "branch": branch }))
                }
                "switch_branch" => {
                    let branch = str_arg("branch").ok_or("missing branch name")?;
                    crate::commands::git_switch_branch(dir, branch.clone())
                        .await
                        .map(|_| json!({ "status": "switched", "branch": branch }))
                }
                "log" => {
                    let count = args.get("count").and_then(|v| v.as_u64()).unwrap_or(10).min(50) as u32;
                    crate::commands::git_log(dir, count)
                        .await
                        .map(|entries| serde_json::to_value(entries).unwrap_or_else(|_| json!([])))
                }
                other => Err(format!("unknown git action: {other}")),
            }
        }

        other => Err(format!("unknown tool: {other}")),
    }
}

/// Resolve the directory git actions run in: the workspace's bound repo, else
/// the first session's working dir (covers folder-opened-but-not-bound cases).
async fn workspace_repo_dir(state: &Arc<AppState>, workspace_id: &str) -> Result<String, String> {
    if let Ok(all) = state.db.load_workspaces() {
        if let Some(w) = all.into_iter().find(|w| w.id == workspace_id) {
            if let Some(p) = w.repo_path.filter(|p| !p.is_empty()) {
                return Ok(p);
            }
        }
    }
    let sessions = state.sessions.lock().await;
    sessions
        .iter()
        .find(|s| s.workspace_id == workspace_id && !s.working_dir.is_empty())
        .map(|s| s.working_dir.clone())
        .ok_or_else(|| "No project folder in this workspace yet.".to_string())
}

/// Poll the pane's output buffer until the agent's TUI looks ready (output has
/// gone quiet after producing something), then type the prompt + Enter. TUIs
/// differ too much for marker matching — "stopped growing" is the robust v1.
async fn wait_ready_and_send(
    state: &Arc<AppState>,
    session_id: &str,
    prompt: &str,
) -> Result<(), String> {
    let deadline = Instant::now() + READY_TIMEOUT;
    let mut last_len = 0usize;
    let mut stable = 0u32;

    // Give the process a beat to even start drawing.
    tokio::time::sleep(Duration::from_secs(2)).await;

    loop {
        if Instant::now() > deadline {
            return Err("agent never became ready".into());
        }
        let len = state
            .pty_manager
            .read_output(session_id, 64 * 1024)
            .map(|b| b.len())
            .unwrap_or(0);
        if len > 0 && len == last_len {
            stable += 1;
            // ~1.5s of silence after the TUI drew something → input prompt is up.
            if stable >= 3 {
                break;
            }
        } else {
            stable = 0;
        }
        last_len = len;
        tokio::time::sleep(READY_POLL_INTERVAL).await;
    }

    state
        .pty_manager
        .write_to_pty(session_id, prompt.as_bytes())
        .map_err(|e| format!("prompt write failed: {e}"))?;
    tokio::time::sleep(Duration::from_millis(120)).await;
    state
        .pty_manager
        .write_to_pty(session_id, b"\r")
        .map_err(|e| format!("prompt submit failed: {e}"))?;
    Ok(())
}
