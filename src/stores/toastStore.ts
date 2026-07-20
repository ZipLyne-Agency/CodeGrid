import { create } from "zustand";

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface Toast {
  id: string;
  message: string;
  type: "success" | "error" | "info" | "warning";
  duration?: number;
  action?: ToastAction;
}

interface ToastState {
  toasts: Toast[];
  addToast: (
    message: string,
    type?: Toast["type"],
    duration?: number,
    action?: ToastAction,
  ) => void;
  removeToast: (id: string) => void;
}

let toastCounter = 0;

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],

  addToast: (message, type = "info", duration, action) => {
    const id = `toast-${++toastCounter}`;
    // Errors are the app's main failure channel — give them longer to be read
    // (8s) than transient success/info toasts (3s) unless an explicit duration is
    // passed. Action toasts also linger so the action stays clickable.
    const ttl = duration ?? (type === "error" ? 8000 : action ? 6000 : 3000);
    set((state) => ({
      toasts: [...state.toasts, { id, message, type, duration: ttl, action }],
    }));
    if (ttl > 0) {
      setTimeout(() => {
        set((state) => ({
          toasts: state.toasts.filter((t) => t.id !== id),
        }));
      }, ttl);
    }
  },

  removeToast: (id) =>
    set((state) => ({
      toasts: state.toasts.filter((t) => t.id !== id),
    })),
}));
