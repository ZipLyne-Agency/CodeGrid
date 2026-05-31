interface WebviewBounds {
  x: number;
  y: number;
  w: number;
  h: number;
}

function roundBounds(rect: DOMRect): WebviewBounds {
  return {
    x: Math.round(rect.left),
    y: Math.round(rect.top),
    w: Math.max(0, Math.round(rect.width)),
    h: Math.max(0, Math.round(rect.height)),
  };
}

/**
 * Reads the on-screen rectangle where the native browser webview should render.
 * We use the actual browser content container rect, so sizing tracks real UI
 * (borders, header height, zoom transforms, and layout changes) precisely.
 */
export function getBrowserPaneWebviewBounds(sessionId: string): WebviewBounds | null {
  const paneEl = document.querySelector(`[data-pane-id="${sessionId}"]`) as HTMLElement | null;
  if (!paneEl) return null;
  return getBrowserPaneWebviewBoundsFromElement(paneEl);
}

export function getBrowserPaneWebviewBoundsFromElement(
  paneEl: HTMLElement,
): WebviewBounds | null {
  const contentEl = paneEl.querySelector("[data-browser-content]") as HTMLElement | null;
  if (!contentEl) return null;
  return roundBounds(contentEl.getBoundingClientRect());
}
