import type { ITheme } from "@xterm/xterm";

export interface CodeGridTheme {
  name: string;
  terminal: ITheme;
  ui: {
    bgPrimary: string;
    bgSecondary: string;
    bgTertiary: string;
    bgHover: string;
    textPrimary: string;
    textSecondary: string;
    textAccent: string;
    borderDefault: string;
    borderFocus: string;
    statusIdle: string;
    statusRunning: string;
    statusError: string;
    statusWaiting: string;
  };
}

export const CODEGRID_DARK: CodeGridTheme = {
  name: "Code Grid Dark",
  terminal: {
    background: "#0a0a0a",
    foreground: "#d4d4d4",
    cursor: "#ff8c00",
    cursorAccent: "#0a0a0a",
    selectionBackground: "rgba(255, 140, 0, 0.3)",
    selectionForeground: "#ffffff",
    black: "#1e1e1e",
    red: "#ff3d00",
    green: "#00c853",
    yellow: "#ffab00",
    blue: "#4a9eff",
    magenta: "#d500f9",
    cyan: "#00e5ff",
    white: "#d4d4d4",
    brightBlack: "#555555",
    brightRed: "#ff6e40",
    brightGreen: "#69f0ae",
    brightYellow: "#ffd740",
    brightBlue: "#82b1ff",
    brightMagenta: "#ea80fc",
    brightCyan: "#84ffff",
    brightWhite: "#ffffff",
  },
  ui: {
    bgPrimary: "#0a0a0a",
    bgSecondary: "#141414",
    bgTertiary: "#1e1e1e",
    bgHover: "#252525",
    textPrimary: "#e0e0e0",
    textSecondary: "#888888",
    textAccent: "#ff8c00",
    borderDefault: "#2a2a2a",
    borderFocus: "#ff8c00",
    statusIdle: "#4a9eff",
    statusRunning: "#00c853",
    statusError: "#ff3d00",
    statusWaiting: "#ffab00",
  },
};

export const THEMES: Record<string, CodeGridTheme> = {
  "codegrid-dark": CODEGRID_DARK,
};

export function getTheme(name: string): CodeGridTheme {
  return THEMES[name] ?? CODEGRID_DARK;
}
