import { useEffect, useRef, useCallback } from "react";
import { writeToPty, resizePty, connectPty, onPtyOutput, onSessionEnded } from "../lib/ipc";
import type { PtyOutput } from "../lib/ipc";
import { useToastStore } from "../stores/toastStore";

interface UsePtyOptions {
  sessionId: string;
  onOutput: (data: Uint8Array) => void;
  onEnded: () => void;
}

// Reuse a single TextEncoder instance across all usePty hooks
const textEncoder = new TextEncoder();

interface PtySubscriber {
  onOutput: (data: Uint8Array) => void;
  onEnded: () => void;
}

const sessionSubscribers = new Map<string, Set<PtySubscriber>>();
let globalListenerInitPromise: Promise<void> | null = null;
let ptyOutputUnlisten: (() => void) | null = null;
let sessionEndedUnlisten: (() => void) | null = null;

function addSubscriber(sessionId: string, subscriber: PtySubscriber) {
  const existing = sessionSubscribers.get(sessionId);
  if (existing) {
    existing.add(subscriber);
    return;
  }
  sessionSubscribers.set(sessionId, new Set([subscriber]));
}

function removeSubscriber(sessionId: string, subscriber: PtySubscriber) {
  const existing = sessionSubscribers.get(sessionId);
  if (!existing) return;
  existing.delete(subscriber);
  if (existing.size === 0) {
    sessionSubscribers.delete(sessionId);
  }
}

async function ensureGlobalListeners() {
  if (ptyOutputUnlisten && sessionEndedUnlisten) return;
  if (globalListenerInitPromise) {
    await globalListenerInitPromise;
    return;
  }

  globalListenerInitPromise = (async () => {
    if (!ptyOutputUnlisten) {
      ptyOutputUnlisten = await onPtyOutput((data: PtyOutput) => {
        const subscribers = sessionSubscribers.get(data.session_id);
        if (!subscribers || subscribers.size === 0) return;

        const bytes = new Uint8Array(data.data);
        for (const subscriber of subscribers) {
          subscriber.onOutput(bytes);
        }
      });
    }

    if (!sessionEndedUnlisten) {
      sessionEndedUnlisten = await onSessionEnded((data) => {
        const subscribers = sessionSubscribers.get(data.session_id);
        if (!subscribers || subscribers.size === 0) return;

        for (const subscriber of subscribers) {
          subscriber.onEnded();
        }
      });
    }
  })().finally(() => {
    globalListenerInitPromise = null;
  });

  await globalListenerInitPromise;
}

export function usePty(options: UsePtyOptions) {
  const addToast = useToastStore((s) => s.addToast);
  const { sessionId, onOutput, onEnded } = options;
  // Use refs to avoid stale closures in event listeners
  const onOutputRef = useRef(onOutput);
  const onEndedRef = useRef(onEnded);
  onOutputRef.current = onOutput;
  onEndedRef.current = onEnded;

  useEffect(() => {
    let mounted = true;

    const subscriber: PtySubscriber = {
      onOutput: (data) => {
        if (mounted) onOutputRef.current(data);
      },
      onEnded: () => {
        if (mounted) onEndedRef.current();
      },
    };

    addSubscriber(sessionId, subscriber);

    ensureGlobalListeners()
      .then(() => {
        if (!mounted) return;
        // Signal backend that frontend listeners are ready, then flush any buffered output.
        connectPty(sessionId).catch((err) => {
          console.error(`[usePty] connectPty failed for ${sessionId}:`, err);
          addToast(`Terminal ${sessionId.slice(0, 6)} could not attach listeners`, "warning", 5000);
        });
      })
      .catch((err) => {
        console.error("[usePty] failed to initialize PTY listeners:", err);
      });

    return () => {
      mounted = false;
      removeSubscriber(sessionId, subscriber);
    };
  }, [sessionId, addToast]);

  const write = useCallback(
    (data: string) => {
      writeToPty(sessionId, textEncoder.encode(data)).catch((err) => {
        console.error("[usePty] write failed:", err);
        addToast?.(`Terminal write failed — session may have ended`, "warning");
      });
    },
    [sessionId, addToast],
  );

  const resize = useCallback(
    (cols: number, rows: number) => {
      resizePty(sessionId, cols, rows).catch(console.error);
    },
    [sessionId],
  );

  return { write, resize };
}
