import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";

let permissionChecked = false;
let permissionGranted = false;

/** Ask for notification permission once, lazily. Safe to call repeatedly. */
export async function ensureNotificationPermission(): Promise<boolean> {
  if (permissionChecked) return permissionGranted;
  permissionChecked = true;
  try {
    permissionGranted = await isPermissionGranted();
    if (!permissionGranted) {
      const result = await requestPermission();
      permissionGranted = result === "granted";
    }
  } catch {
    permissionGranted = false;
  }
  return permissionGranted;
}

/**
 * Send a native OS notification. No-ops (without throwing) if permission is
 * denied or the runtime isn't Tauri.
 */
export async function notify(title: string, body: string): Promise<void> {
  try {
    const ok = await ensureNotificationPermission();
    if (!ok) return;
    sendNotification({ title, body });
  } catch (err) {
    console.warn("notify failed:", err);
  }
}

/**
 * Set (or clear) the dock badge count. Pass 0 to clear.
 * Uses the window-level API available in @tauri-apps/api ≥ 2.1.
 */
export async function setDockBadge(count: number): Promise<void> {
  try {
    await getCurrentWindow().setBadgeCount(count > 0 ? count : undefined);
  } catch (err) {
    // Older runtimes / non-macOS may not support this — ignore.
    console.debug("setBadgeCount unavailable:", err);
  }
}

/** Update the menu-bar (tray) extra with live fleet status. */
export async function setTrayStatus(running: number, needs: number): Promise<void> {
  try {
    await invoke("set_tray_status", { running, needs });
  } catch (err) {
    console.debug("set_tray_status unavailable:", err);
  }
}
