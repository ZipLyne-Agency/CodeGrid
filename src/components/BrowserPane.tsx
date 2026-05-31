import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLayoutStore } from "../stores/layoutStore";
import { useSessionStore } from "../stores/sessionStore";

interface BrowserPaneProps {
  sessionId: string;
  url: string;
  onClose: (sessionId: string) => void;
  onDragStart?: (e: React.MouseEvent) => void;
}

const UI_FONT = "var(--font-ui)";
const MONO_FONT = "var(--font-code)";

function normalizeUrl(u: string): string {
  const t = u.trim();
  if (!t) return "";
  if (/^https?:\/\//i.test(t)) return t;
  const local = /^(localhost|127\.0\.0\.1|0\.0\.0\.0|::1)(:\d+)?(\/|$)/i.test(t);
  return (local ? "http://" : "https://") + t;
}

function isLocalhostUrl(u: string): boolean {
  try {
    const host = new URL(u).hostname;
    return (
      host === "localhost" ||
      host === "127.0.0.1" ||
      host === "0.0.0.0" ||
      host === "::1" ||
      host.endsWith(".localhost")
    );
  } catch {
    return false;
  }
}

/**
 * Browser pane — pure React iframe.
 *
 * Previous attempts used a native Tauri WKWebView positioned over a React
 * placeholder. That approach is structurally broken on macOS: native webviews
 * draw above the React DOM, so chrome bars get covered and z-order is wrong,
 * and Tauri 2 has no equivalent of Electron's `<webview>` / `BrowserView`
 * (cmux solves this in Swift; vmux solves it in Electron — neither is Tauri).
 *
 * Iframes are the right tool here because the #1 use case is "preview my
 * localhost dev server next to a Claude pane." Localhost servers never set
 * `X-Frame-Options: DENY` so iframes load them fine. For URLs that do block
 * embedding, we detect the block and offer "Open in external browser."
 */
export const BrowserPane = memo(function BrowserPane({
  sessionId,
  url: initialUrl,
  onClose,
  onDragStart,
}: BrowserPaneProps) {
  const focusedSessionId = useSessionStore((s) => s.focusedSessionId);
  const setFocusedSession = useSessionStore((s) => s.setFocusedSession);
  const updateSession = useSessionStore((s) => s.updateSession);
  const toggleMaximize = useLayoutStore((s) => s.toggleMaximize);
  const minimizePane = useLayoutStore((s) => s.minimizePane);
  const maximizedPane = useLayoutStore((s) => s.maximizedPane);
  const isFocused = focusedSessionId === sessionId;
  const isMaximized = maximizedPane === sessionId;

  const [committedUrl, setCommittedUrl] = useState(initialUrl);
  const [inputUrl, setInputUrl] = useState(initialUrl);
  const [iframeKey, setIframeKey] = useState(0);
  const [blocked, setBlocked] = useState(false);
  const [loading, setLoading] = useState(true);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const urlInputRef = useRef<HTMLInputElement>(null);
  const loadWatchdog = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isLocal = useMemo(() => isLocalhostUrl(committedUrl), [committedUrl]);
  const host = useMemo(() => {
    try {
      return new URL(committedUrl).host;
    } catch {
      return committedUrl;
    }
  }, [committedUrl]);

  // This pane is intentionally scoped to localhost dev servers. The web's
  // X-Frame-Options / CSP frame-ancestors story makes "embed arbitrary URL"
  // a losing battle (and any in-app browser would need to be native WKWebView,
  // not an iframe — which Tauri 2 doesn't expose cleanly). For everything
  // non-localhost we surface a quick "Open externally" affordance.
  useEffect(() => {
    if (!committedUrl) return;
    setLoading(true);
    if (loadWatchdog.current) clearTimeout(loadWatchdog.current);
    if (!isLocalhostUrl(committedUrl)) {
      setBlocked(true);
      setLoading(false);
      return;
    }
    setBlocked(false);
    loadWatchdog.current = setTimeout(() => {
      setLoading(false);
    }, 8000);
    return () => {
      if (loadWatchdog.current) clearTimeout(loadWatchdog.current);
    };
  }, [committedUrl, iframeKey]);

  // Persist the latest URL back to the session.
  useEffect(() => {
    updateSession(sessionId, { browserUrl: committedUrl });
  }, [sessionId, committedUrl, updateSession]);

  const handleNavigate = useCallback(() => {
    const next = normalizeUrl(inputUrl);
    if (!next) return;
    setCommittedUrl(next);
    setInputUrl(next);
    setIframeKey((k) => k + 1);
  }, [inputUrl]);

  const handleReload = useCallback(() => {
    setIframeKey((k) => k + 1);
  }, []);

  const handleOpenExternal = useCallback(async () => {
    try {
      const { open } = await import("@tauri-apps/plugin-shell");
      await open(committedUrl);
    } catch (e) {
      console.warn("[BrowserPane] open external failed:", e);
      window.open(committedUrl, "_blank");
    }
  }, [committedUrl]);

  const handleIframeLoad = useCallback(() => {
    setLoading(false);
    if (loadWatchdog.current) clearTimeout(loadWatchdog.current);
    // For same-origin pages we could read document.title here, but most
    // useful targets (localhost + cross-origin sites) will throw on access.
    // Host name is shown in the title bar — that's enough.
  }, []);

  // Keyboard shortcuts when this pane is focused.
  useEffect(() => {
    if (!isFocused) return;
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      const target = e.target as HTMLElement | null;
      const inUrlBar = target === urlInputRef.current;
      if (e.key === "l" || e.key === "L") {
        e.preventDefault();
        urlInputRef.current?.focus();
        urlInputRef.current?.select();
      } else if (e.key === "r" || e.key === "R") {
        if (inUrlBar) return;
        e.preventDefault();
        handleReload();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isFocused, handleReload]);

  // Listen for outside requests to focus the URL bar (used by `+ BROWSER` toolbar).
  useEffect(() => {
    const onFocus = (e: Event) => {
      const detail = (e as CustomEvent<{ sessionId?: string }>).detail;
      if (detail?.sessionId !== sessionId) return;
      urlInputRef.current?.focus();
      urlInputRef.current?.select();
    };
    window.addEventListener("codegrid:focus-browser-url", onFocus);
    return () => window.removeEventListener("codegrid:focus-browser-url", onFocus);
  }, [sessionId]);

  const handleHeaderMouseDown = useCallback(
    (e: React.MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest("input, button")) return;
      onDragStart?.(e);
    },
    [onDragStart],
  );

  return (
    <div
      onClick={() => setFocusedSession(sessionId)}
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        width: "100%",
        minHeight: 0,
        background: "#0d0d0d",
        border: `1px solid ${isFocused ? "#4a9eff" : "#2a2a2a"}`,
        borderRadius: isFocused ? "4px" : "2px",
        boxShadow: isFocused ? "0 0 14px rgba(74,158,255,0.35)" : "none",
        overflow: "hidden",
        position: "relative",
      }}
    >
      {/* Chrome bar */}
      <div
        onMouseDown={handleHeaderMouseDown}
        onDoubleClick={(e) => {
          // Only maximize when double-clicking empty chrome bar area —
          // never when interacting with the URL bar or chrome buttons.
          if ((e.target as HTMLElement).closest("input, button")) return;
          toggleMaximize(sessionId);
        }}
        style={{
          display: "flex",
          flexDirection: "column",
          background: isFocused ? "#1c2535" : "#161b22",
          borderBottom: `2px solid ${isFocused ? "#4a9eff" : "#2a3140"}`,
          cursor: "grab",
          userSelect: "none",
          fontFamily: UI_FONT,
          fontSize: "11px",
          flexShrink: 0,
          height: 64,
          boxSizing: "border-box",
          color: "#e0e0e0",
        }}
      >
        {/* Top row: tag + title + window buttons */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "6px 8px 0 8px",
            height: 28,
            boxSizing: "border-box",
            flexShrink: 0,
          }}
        >
          <span
            style={{
              fontSize: 9,
              fontWeight: 800,
              letterSpacing: "1px",
              color: "#4a9eff",
              background: "rgba(74,158,255,0.15)",
              border: "1px solid rgba(74,158,255,0.4)",
              padding: "1px 5px",
              borderRadius: 2,
              flexShrink: 0,
            }}
            title="Localhost preview"
          >
            PREVIEW
          </span>
          <span
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: "#e0e0e0",
              flex: 1,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              minWidth: 0,
            }}
            title={host}
          >
            {host || "browser"}
          </span>
          {loading && (
            <span
              style={{
                width: 10,
                height: 10,
                borderRadius: "50%",
                border: "1.5px solid #4a9eff",
                borderTopColor: "transparent",
                animation: "codegridSpin 0.7s linear infinite",
                flexShrink: 0,
              }}
            />
          )}
          <button
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              minimizePane(sessionId);
            }}
            title="Minimize"
            style={{
              background: "none",
              border: "none",
              color: "#888",
              cursor: "pointer",
              fontSize: 13,
              padding: "0 4px",
              lineHeight: 1,
              fontFamily: UI_FONT,
            }}
            onMouseEnter={(e) => (e.currentTarget.style.color = "#fff")}
            onMouseLeave={(e) => (e.currentTarget.style.color = "#888")}
          >
            −
          </button>
          <button
            onMouseDown={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              toggleMaximize(sessionId);
            }}
            title={isMaximized ? "Restore pane" : "Maximize pane"}
            style={{
              background: "none",
              border: "none",
              color: "#888",
              cursor: "pointer",
              fontSize: 11,
              padding: "0 4px",
              lineHeight: 1,
              fontFamily: UI_FONT,
            }}
            onMouseEnter={(e) => (e.currentTarget.style.color = "#fff")}
            onMouseLeave={(e) => (e.currentTarget.style.color = "#888")}
          >
            {isMaximized ? "⊡" : "⊞"}
          </button>
          <button
            onMouseDown={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onClose(sessionId);
            }}
            title="Close pane"
            style={{
              background: "none",
              border: "none",
              color: "#888",
              cursor: "pointer",
              fontSize: 15,
              padding: "0 4px",
              lineHeight: 1,
              fontFamily: UI_FONT,
            }}
            onMouseEnter={(e) => (e.currentTarget.style.color = "#ff3d00")}
            onMouseLeave={(e) => (e.currentTarget.style.color = "#888")}
          >
            ×
          </button>
        </div>

        {/* Bottom row: reload + URL + open-external */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 5,
            padding: "6px 8px 8px 8px",
            height: 36,
            boxSizing: "border-box",
            flexShrink: 0,
          }}
        >
          <button
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              handleReload();
            }}
            title="Reload  ⌘R"
            style={navBtnStyle}
            onMouseEnter={(e) => navBtnHover(e, true)}
            onMouseLeave={(e) => navBtnHover(e, false)}
          >
            ↻
          </button>
          <input
            ref={urlInputRef}
            value={inputUrl}
            onChange={(e) => setInputUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleNavigate();
              e.stopPropagation();
            }}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
            onFocus={(e) => e.currentTarget.select()}
            placeholder="localhost:3000  ·  press Enter"
            spellCheck={false}
            autoCorrect="off"
            autoCapitalize="off"
            style={{
              flex: 1,
              background: "#0d1117",
              border: "1px solid #2a3140",
              color: "#fff",
              fontSize: 12,
              fontFamily: MONO_FONT,
              padding: "6px 10px",
              height: 28,
              outline: "none",
              minWidth: 0,
              boxSizing: "border-box",
            }}
            onFocusCapture={(e) => (e.currentTarget.style.borderColor = "var(--border-focus)")}
            onBlurCapture={(e) => (e.currentTarget.style.borderColor = "#2a3140")}
          />
          <button
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              handleOpenExternal();
            }}
            title="Open in default browser"
            style={{
              ...navBtnStyle,
              width: "auto",
              padding: "0 8px",
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: "0.5px",
            }}
            onMouseEnter={(e) => navBtnHover(e, true)}
            onMouseLeave={(e) => navBtnHover(e, false)}
          >
            ↗ OPEN
          </button>
        </div>
      </div>

      {/* Content area: start screen, iframe, OR blocked fallback */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          background: "#0a0a0a",
          position: "relative",
        }}
      >
        {!committedUrl ? (
          <StartScreen
            onPick={(url) => {
              setInputUrl(url);
              setCommittedUrl(url);
              setIframeKey((k) => k + 1);
            }}
            onFocusUrlBar={() => {
              urlInputRef.current?.focus();
              urlInputRef.current?.select();
            }}
          />
        ) : blocked ? (
          <BlockedFallback url={committedUrl} onOpenExternal={handleOpenExternal} onReload={handleReload} />
        ) : (
          <iframe
            ref={iframeRef}
            key={iframeKey}
            src={committedUrl}
            onLoad={handleIframeLoad}
            // Sandbox is intentionally permissive for localhost — restrict
            // only the actually dangerous things. We don't `allow-top-navigation`
            // so an embedded page can't navigate the host CodeGrid window.
            sandbox="allow-forms allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-downloads allow-modals allow-presentation"
            referrerPolicy="no-referrer-when-downgrade"
            style={{
              width: "100%",
              height: "100%",
              border: "none",
              background: "#fff",
              display: "block",
            }}
            title={`Browser pane ${host}`}
          />
        )}
      </div>

      <style>{`
        @keyframes codegridSpin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
});

const navBtnStyle: React.CSSProperties = {
  background: "#0d1117",
  border: "1px solid #2a3140",
  color: "#cccccc",
  cursor: "pointer",
  fontSize: 13,
  lineHeight: 1,
  width: 28,
  height: 28,
  padding: 0,
  borderRadius: 3,
  fontFamily: UI_FONT,
  fontWeight: 700,
  flexShrink: 0,
};
function navBtnHover(e: React.MouseEvent<HTMLButtonElement>, hover: boolean) {
  e.currentTarget.style.borderColor = hover ? "#4a9eff" : "#2a3140";
  e.currentTarget.style.color = hover ? "#4a9eff" : "#cccccc";
}

interface BlockedProps {
  url: string;
  onOpenExternal: () => void;
  onReload: () => void;
}

interface StartScreenProps {
  onPick: (url: string) => void;
  onFocusUrlBar: () => void;
}

const COMMON_DEV_URLS = [
  { label: "Vite",    url: "http://localhost:5173" },
  { label: "Next.js", url: "http://localhost:3000" },
  { label: "Astro",   url: "http://localhost:4321" },
  { label: "Express", url: "http://localhost:8080" },
  { label: "Storybook", url: "http://localhost:6006" },
];

const StartScreen = memo(function StartScreen({ onPick, onFocusUrlBar }: StartScreenProps) {
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 18,
        padding: 32,
        background: "#0a0a0a",
        fontFamily: UI_FONT,
        textAlign: "center",
      }}
    >
      <div style={{ fontSize: 34, color: "#4a9eff", fontWeight: 700, letterSpacing: "1px" }}>◧</div>
      <div style={{ color: "#e0e0e0", fontSize: 13, fontWeight: 600 }}>
        Localhost preview
      </div>
      <div style={{ color: "#888", fontSize: 11, maxWidth: 380, lineHeight: 1.55 }}>
        Preview a dev server next to your terminals. Pick a common port below,
        or type your own.
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, justifyContent: "center", maxWidth: 440 }}>
        {COMMON_DEV_URLS.map((p) => (
          <button
            key={p.url}
            onClick={() => onPick(p.url)}
            style={{
              background: "#0d1117",
              border: "1px solid #2a3140",
              color: "#cccccc",
              cursor: "pointer",
              fontFamily: UI_FONT,
              fontSize: 10,
              fontWeight: 700,
              padding: "5px 9px",
              borderRadius: 3,
              letterSpacing: "0.3px",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.borderColor = "#4a9eff"; e.currentTarget.style.color = "#4a9eff"; }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = "#2a3140"; e.currentTarget.style.color = "#cccccc"; }}
          >
            {p.label} · {p.url.replace("http://", "")}
          </button>
        ))}
      </div>
      <button
        onClick={onFocusUrlBar}
        style={{
          background: "transparent",
          border: "none",
          color: "#555",
          cursor: "pointer",
          fontFamily: UI_FONT,
          fontSize: 10,
          marginTop: 4,
        }}
        onMouseEnter={(e) => (e.currentTarget.style.color = "#888")}
        onMouseLeave={(e) => (e.currentTarget.style.color = "#555")}
      >
        ⌘L  to focus URL bar
      </button>
    </div>
  );
});

const BlockedFallback = memo(function BlockedFallback({ url, onOpenExternal, onReload }: BlockedProps) {
  let host = url;
  try {
    host = new URL(url).host;
  } catch {}
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 14,
        padding: 32,
        background: "#0a0a0a",
        fontFamily: UI_FONT,
        textAlign: "center",
      }}
    >
      <div style={{ fontSize: 28, color: "#4a9eff", fontWeight: 700 }}>↗</div>
      <div style={{ color: "#e0e0e0", fontSize: 13, maxWidth: 420, lineHeight: 1.5 }}>
        This pane only previews <strong>localhost</strong> dev servers.
      </div>
      <div style={{ color: "#777", fontSize: 11, maxWidth: 420, lineHeight: 1.5 }}>
        <strong>{host}</strong> is a production site — open it in your default
        browser to keep cookies and sessions intact.
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
        <button
          onClick={onOpenExternal}
          style={{
            background: "#4a9eff",
            border: "1px solid #4a9eff",
            color: "#0a0a0a",
            cursor: "pointer",
            fontFamily: UI_FONT,
            fontSize: 11,
            fontWeight: 700,
            padding: "8px 14px",
            borderRadius: 3,
            letterSpacing: "0.5px",
          }}
        >
          OPEN IN DEFAULT BROWSER ↗
        </button>
        <button
          onClick={onReload}
          style={{
            background: "transparent",
            border: "1px solid #2a3140",
            color: "#888",
            cursor: "pointer",
            fontFamily: UI_FONT,
            fontSize: 11,
            fontWeight: 700,
            padding: "8px 14px",
            borderRadius: 3,
            letterSpacing: "0.5px",
          }}
          onMouseEnter={(e) => { e.currentTarget.style.color = "#fff"; e.currentTarget.style.borderColor = "#4a9eff"; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = "#888"; e.currentTarget.style.borderColor = "#2a3140"; }}
        >
          RETRY
        </button>
      </div>
    </div>
  );
});
