//! Native macOS chrome: the application menu bar and the menu-bar (tray) extra.
//!
//! Menu/tray clicks are forwarded to the web frontend as a single `codegrid://menu`
//! event carrying the action id (e.g. "new_session"). The frontend's
//! `useNativeMenu` hook maps each id to the same action its keyboard shortcut
//! triggers, so there is one source of truth for behaviour.

use std::sync::Mutex;
use tauri::{
    menu::{
        AboutMetadata, Menu, MenuItem, PredefinedMenuItem, Submenu,
    },
    tray::{TrayIconBuilder, TrayIconEvent},
    App, AppHandle, Emitter, Manager, Wry,
};

/// Event channel the frontend listens on. Payload is the action id string.
pub const MENU_EVENT: &str = "codegrid://menu";

/// Handle to the tray "Talk to Max" item so its label can track voice state.
static TALK_ITEM: Mutex<Option<MenuItem<Wry>>> = Mutex::new(None);

/// Update the tray to reflect Max's live voice state — the menu-bar glyph next
/// to the icon plus the "Talk to Max" item label. Called from voice::emit_status.
pub fn set_max_tray(app: &AppHandle, status: &str) {
    let (glyph, label) = match status {
        "connecting" => ("🎙…", "■  Stop Max"),
        "listening" => ("🎙", "■  Stop Max"),
        "speaking" => ("🔊", "■  Stop Max"),
        "tool" => ("⚙", "■  Stop Max"),
        "sleeping" => ("🌙", "■  Stop Max"),
        _ => ("", "🎙  Talk to Max"), // off / error
    };
    if let Ok(slot) = TALK_ITEM.lock() {
        if let Some(item) = slot.as_ref() {
            let _ = item.set_text(label);
        }
    }
    // Prefix the fleet-status title (set_tray_status) with Max's glyph so both
    // are visible: e.g. "🎙 ● 2". We store Max's glyph and re-render.
    if let Ok(mut g) = MAX_GLYPH.lock() {
        *g = glyph.to_string();
    }
    rerender_tray_title(app);
}

/// Current Max glyph + last fleet counts, combined into the tray title.
static MAX_GLYPH: Mutex<String> = Mutex::new(String::new());
static FLEET_TITLE: Mutex<String> = Mutex::new(String::new());

fn rerender_tray_title(app: &AppHandle) {
    if let Some(tray) = app.tray_by_id("codegrid-tray") {
        let glyph = MAX_GLYPH.lock().map(|g| g.clone()).unwrap_or_default();
        let fleet = FLEET_TITLE.lock().map(|f| f.clone()).unwrap_or_default();
        let title = match (glyph.is_empty(), fleet.is_empty()) {
            (true, true) => String::new(),
            (false, true) => glyph,
            (true, false) => fleet,
            (false, false) => format!("{glyph} {fleet}"),
        };
        let _ = tray.set_title(if title.is_empty() { None } else { Some(title) });
    }
}

/// Build the full application menu bar (App / File / Edit / View / Agents / Window / Help).
pub fn build_menu(app: &App) -> tauri::Result<Menu<Wry>> {
    let h = app.handle();

    // Helper to make a custom (app-handled) item with an accelerator.
    let item = |id: &str, label: &str, accel: Option<&str>| -> tauri::Result<MenuItem<Wry>> {
        MenuItem::with_id(h, id, label, true, accel)
    };

    // ---- App menu (bold, app name) ----
    let app_menu = Submenu::with_items(
        h,
        "CodeGrid",
        true,
        &[
            &PredefinedMenuItem::about(h, Some("About CodeGrid"), Some(AboutMetadata::default()))?,
            &PredefinedMenuItem::separator(h)?,
            &item("check_updates", "Check for Updates…", None)?,
            &item("settings", "Settings…", Some("CmdOrCtrl+,"))?,
            &PredefinedMenuItem::separator(h)?,
            &PredefinedMenuItem::services(h, Some("Services"))?,
            &PredefinedMenuItem::separator(h)?,
            &PredefinedMenuItem::hide(h, Some("Hide CodeGrid"))?,
            &PredefinedMenuItem::hide_others(h, Some("Hide Others"))?,
            &PredefinedMenuItem::show_all(h, Some("Show All"))?,
            &PredefinedMenuItem::separator(h)?,
            &PredefinedMenuItem::quit(h, Some("Quit CodeGrid"))?,
        ],
    )?;

    // ---- File ----
    // Note: accelerators are intentionally limited to combos the app does not
    // already handle context-sensitively in the webview. Cmd+S (sidebar / editor
    // save) and Cmd+Tab (reserved) are deliberately left to the web layer.
    let file_menu = Submenu::with_items(
        h,
        "File",
        true,
        &[
            &item("new_session", "New Session…", Some("CmdOrCtrl+N"))?,
            &item("new_workspace", "New Workspace", Some("CmdOrCtrl+Shift+N"))?,
            &PredefinedMenuItem::separator(h)?,
            &item("close_session", "Close Session", Some("CmdOrCtrl+W"))?,
        ],
    )?;

    // ---- Edit (predefined — wired to the webview's native editing) ----
    let edit_menu = Submenu::with_items(
        h,
        "Edit",
        true,
        &[
            &PredefinedMenuItem::undo(h, Some("Undo"))?,
            &PredefinedMenuItem::redo(h, Some("Redo"))?,
            &PredefinedMenuItem::separator(h)?,
            &PredefinedMenuItem::cut(h, Some("Cut"))?,
            &PredefinedMenuItem::copy(h, Some("Copy"))?,
            &PredefinedMenuItem::paste(h, Some("Paste"))?,
            &PredefinedMenuItem::select_all(h, Some("Select All"))?,
            &PredefinedMenuItem::separator(h)?,
            &item("find_in_files", "Find in Files…", Some("CmdOrCtrl+Shift+F"))?,
        ],
    )?;

    // ---- View ----
    let view_menu = Submenu::with_items(
        h,
        "View",
        true,
        &[
            &item("command_palette", "Command Palette…", Some("CmdOrCtrl+K"))?,
            // Cmd+S is left to the web layer (sidebar toggle / editor save are context-sensitive).
            &item("toggle_sidebar", "Toggle Sidebar", None)?,
            &PredefinedMenuItem::separator(h)?,
            &item("maximize_pane", "Maximize / Restore Pane", None)?,
            &PredefinedMenuItem::separator(h)?,
            &PredefinedMenuItem::fullscreen(h, Some("Toggle Full Screen"))?,
        ],
    )?;

    // ---- Agents (app-specific) ----
    let agents_menu = Submenu::with_items(
        h,
        "Agents",
        true,
        &[
            // No accelerator here (File → New Session already owns Cmd+N).
            &item("new_session", "New Agent…", None)?,
            &item("toggle_broadcast", "Toggle Broadcast Mode", Some("CmdOrCtrl+B"))?,
            &PredefinedMenuItem::separator(h)?,
            &item("next_attention", "Go to Next Agent Needing Attention", Some("CmdOrCtrl+Shift+A"))?,
            &PredefinedMenuItem::separator(h)?,
            // Cmd+Tab is reserved by macOS; workspace switching stays in the web layer.
            &item("next_workspace", "Next Workspace", None)?,
            &item("prev_workspace", "Previous Workspace", None)?,
        ],
    )?;

    // ---- Window (predefined) ----
    let window_menu = Submenu::with_items(
        h,
        "Window",
        true,
        &[
            &PredefinedMenuItem::minimize(h, Some("Minimize"))?,
            &PredefinedMenuItem::maximize(h, Some("Zoom"))?,
        ],
    )?;

    // ---- Help ----
    let help_menu = Submenu::with_items(
        h,
        "Help",
        true,
        &[
            &item("getting_started", "Getting Started", None)?,
            &PredefinedMenuItem::separator(h)?,
            &item("docs", "CodeGrid Documentation", None)?,
            &item("github", "GitHub Repository", None)?,
            &item("report_issue", "Report an Issue…", None)?,
        ],
    )?;

    Menu::with_items(
        h,
        &[
            &app_menu,
            &file_menu,
            &edit_menu,
            &view_menu,
            &agents_menu,
            &window_menu,
            &help_menu,
        ],
    )
}

/// Build the menu-bar (tray) extra: a quick-status icon with common actions.
pub fn build_tray(app: &App) -> tauri::Result<()> {
    let h = app.handle();

    let show = MenuItem::with_id(h, "tray_show", "Show CodeGrid", true, None::<&str>)?;
    let new_session = MenuItem::with_id(h, "new_session", "New Session…", true, None::<&str>)?;
    let new_workspace = MenuItem::with_id(h, "new_workspace", "New Workspace", true, None::<&str>)?;
    let quit = PredefinedMenuItem::quit(h, Some("Quit CodeGrid"))?;
    let sep = PredefinedMenuItem::separator(h)?;

    let tray_menu = Menu::with_items(h, &[&show, &sep, &new_session, &new_workspace, &sep, &quit])?;

    let mut builder = TrayIconBuilder::with_id("codegrid-tray")
        .tooltip("CodeGrid")
        .menu(&tray_menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| handle_action(app, event.id().as_ref()))
        .on_tray_icon_event(|tray, event| {
            // Left-click the icon → bring the main window forward.
            if let TrayIconEvent::Click { .. } = event {
                if let Some(win) = tray.app_handle().get_webview_window("main") {
                    let _ = win.show();
                    let _ = win.set_focus();
                }
            }
        });

    // Reuse the app's window icon as the tray icon when available.
    if let Some(icon) = app.default_window_icon().cloned() {
        builder = builder.icon(icon).icon_as_template(true);
    }

    builder.build(app)?;
    Ok(())
}

/// Update the menu-bar (tray) extra with live fleet status: shows the count of
/// agents needing attention (or running) next to the icon, plus a tooltip.
#[tauri::command]
pub fn set_tray_status(app: AppHandle, running: u32, needs: u32) {
    let fleet = if needs > 0 {
        format!("● {needs}")
    } else if running > 0 {
        format!("▶ {running}")
    } else {
        String::new()
    };
    if let Ok(mut f) = FLEET_TITLE.lock() {
        *f = fleet;
    }
    // Combined Max-glyph + fleet-count title is rendered in one place.
    rerender_tray_title(&app);
    if let Some(tray) = app.tray_by_id("codegrid-tray") {
        let tooltip = if running == 0 && needs == 0 {
            "CodeGrid".to_string()
        } else {
            format!("CodeGrid — {running} running · {needs} need you")
        };
        let _ = tray.set_tooltip(Some(tooltip));
    }
}

/// Map a menu/tray action id to behaviour. Native-only actions (show window) are
/// handled here; everything else is forwarded to the frontend.
pub fn handle_action(app: &AppHandle, id: &str) {
    match id {
        "tray_show" => {
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.show();
                let _ = win.set_focus();
            }
        }
        // Talk to Max from the menu bar — toggle the voice session without
        // bringing the window forward (the whole point is talking from anywhere).
        "tray_talk_max" => {
            crate::voice::toggle_from_tray(app);
        }
        // Forward every app-level action to the frontend.
        other => {
            // Make sure the window is visible for actions that open UI.
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.show();
                let _ = win.set_focus();
            }
            let _ = app.emit(MENU_EVENT, other.to_string());
        }
    }
}
