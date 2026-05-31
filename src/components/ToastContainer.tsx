import { memo } from "react";
import { useToastStore } from "../stores/toastStore";

const TYPE_COLORS: Record<string, { bg: string; border: string; text: string }> = {
  success: { bg: "#00c85322", border: "#00c853", text: "#00c853" },
  error: { bg: "#ff3d0022", border: "#ff3d00", text: "#ff3d00" },
  info: { bg: "#4a9eff22", border: "#4a9eff", text: "#4a9eff" },
  warning: { bg: "#ffab0022", border: "#ffab00", text: "#ffab00" },
};

export const ToastContainer = memo(function ToastContainer() {
  const toasts = useToastStore((s) => s.toasts);
  const removeToast = useToastStore((s) => s.removeToast);

  if (toasts.length === 0) return null;

  return (
    <div
      // Announce toasts to assistive tech — errors assertively, the rest politely.
      role="region"
      aria-label="Notifications"
      style={{
        position: "fixed",
        top: "48px",
        right: "16px",
        zIndex: 9999,
        display: "flex",
        flexDirection: "column",
        gap: "4px",
        maxWidth: "400px",
      }}
    >
      {toasts.map((toast) => {
        const colors = TYPE_COLORS[toast.type] ?? TYPE_COLORS.info;
        return (
          <div
            key={toast.id}
            role={toast.type === "error" ? "alert" : "status"}
            aria-live={toast.type === "error" ? "assertive" : "polite"}
            onClick={() => removeToast(toast.id)}
            style={{
              background: colors.bg,
              border: `1px solid ${colors.border}`,
              color: colors.text,
              padding: "8px 12px",
              fontSize: 12,
              fontFamily: "var(--font-ui)",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: "8px",
            }}
          >
            <span style={{ fontWeight: "bold", fontSize: "12px" }}>
              {toast.type === "success" ? "OK" : toast.type === "error" ? "ERR" : toast.type === "warning" ? "WARN" : "INFO"}
            </span>
            <span style={{ flex: 1 }}>{toast.message}</span>
            {toast.action && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  toast.action!.onClick();
                  removeToast(toast.id);
                }}
                style={{
                  background: colors.border,
                  border: `1px solid ${colors.border}`,
                  color: "#0a0a0a",
                  fontSize: 12,
                  fontFamily: "inherit",
                  fontWeight: 700,
                  padding: "2px 8px",
                  borderRadius: 2,
                  cursor: "pointer",
                  letterSpacing: "0.5px",
                }}
              >
                {toast.action.label}
              </button>
            )}
            <span style={{ color: "var(--text-muted)", fontSize: 11 }}>x</span>
          </div>
        );
      })}
    </div>
  );
});
