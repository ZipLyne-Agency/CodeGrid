export interface Keybinding {
  key: string;
  meta?: boolean;  // Cmd on Mac, Ctrl on Windows
  shift?: boolean;
  alt?: boolean;
  action: string;
  label: string;
}

export const KEYBINDINGS: Keybinding[] = [
  { key: "n", meta: true, action: "new-session", label: "New Pane" },
  { key: "w", meta: true, action: "close-session", label: "Close Pane" },
  { key: "ArrowUp", meta: true, action: "focus-up", label: "Focus Up" },
  { key: "ArrowDown", meta: true, action: "focus-down", label: "Focus Down" },
  { key: "ArrowLeft", meta: true, action: "focus-left", label: "Focus Left" },
  { key: "ArrowRight", meta: true, action: "focus-right", label: "Focus Right" },
  { key: "ArrowUp", meta: true, shift: true, action: "swap-up", label: "Swap Up" },
  { key: "ArrowDown", meta: true, shift: true, action: "swap-down", label: "Swap Down" },
  { key: "ArrowLeft", meta: true, shift: true, action: "swap-left", label: "Swap Left" },
  { key: "ArrowRight", meta: true, shift: true, action: "swap-right", label: "Swap Right" },
  { key: "Enter", meta: true, action: "maximize-pane", label: "Maximize / Restore" },
  { key: "Enter", meta: true, shift: true, action: "fit-all", label: "Fit All Panes" },
  { key: "J", meta: true, shift: true, action: "new-scratch-pane", label: "New Scratch Terminal" },
  { key: "k", meta: true, action: "command-palette", label: "Command Palette" },
  { key: "b", meta: true, action: "toggle-broadcast", label: "Toggle Broadcast" },
  { key: "s", meta: true, action: "toggle-sidebar", label: "Toggle Sidebar" },
  { key: "g", meta: true, action: "git-manager", label: "Open Git Manager" },
  { key: "Tab", meta: true, action: "next-workspace", label: "Next Workspace" },
  { key: "Tab", meta: true, shift: true, action: "prev-workspace", label: "Previous Workspace" },
  { key: "N", meta: true, shift: true, action: "new-workspace", label: "New Workspace" },
  { key: ",", meta: true, action: "settings", label: "Settings" },
  { key: "1", meta: true, action: "focus-pane-1", label: "Focus Pane 1" },
  { key: "2", meta: true, action: "focus-pane-2", label: "Focus Pane 2" },
  { key: "3", meta: true, action: "focus-pane-3", label: "Focus Pane 3" },
  { key: "4", meta: true, action: "focus-pane-4", label: "Focus Pane 4" },
  { key: "5", meta: true, action: "focus-pane-5", label: "Focus Pane 5" },
  { key: "6", meta: true, action: "focus-pane-6", label: "Focus Pane 6" },
  { key: "7", meta: true, action: "focus-pane-7", label: "Focus Pane 7" },
  { key: "8", meta: true, action: "focus-pane-8", label: "Focus Pane 8" },
  { key: "9", meta: true, action: "focus-pane-9", label: "Focus Pane 9" },
  { key: "F", meta: true, shift: true, action: "project-search", label: "Search in Files" },
  { key: "p", meta: true, action: "pane-switcher", label: "Switch Pane" },
  { key: "=", meta: true, action: "terminal-font-increase", label: "Zoom Terminal In" },
  { key: "+", meta: true, shift: true, action: "terminal-font-increase", label: "Zoom Terminal In" },
  { key: "-", meta: true, action: "terminal-font-decrease", label: "Zoom Terminal Out" },
  { key: "0", meta: true, action: "terminal-font-reset", label: "Reset Terminal Zoom" },
];

export function matchKeybinding(e: KeyboardEvent): string | null {
  const meta = e.metaKey || e.ctrlKey;

  for (const kb of KEYBINDINGS) {
    if (kb.key === e.key && !!kb.meta === meta && !!kb.shift === e.shiftKey && !!kb.alt === e.altKey) {
      return kb.action;
    }
  }
  return null;
}
