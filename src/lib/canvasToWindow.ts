/**
 * Convert canvas-space coordinates to window-space pixel coordinates.
 *
 * Canvas panes are positioned inside a transformed surface (zoom + pan).
 * The native webview needs absolute window coordinates, so we apply:
 *   windowX = (canvasX + panX) * zoom + offsetX
 *   windowY = (canvasY + panY) * zoom + offsetY
 *   windowW = canvasW * zoom
 *   windowH = canvasH * zoom
 *
 * @param offsetX - The x offset of the canvas container in window space (from getBoundingClientRect)
 * @param offsetY - The y offset of the canvas container in window space (from getBoundingClientRect)
 */
export function canvasToWindow(
  canvasX: number,
  canvasY: number,
  canvasW: number,
  canvasH: number,
  zoom: number,
  panX: number,
  panY: number,
  offsetX: number,
  offsetY: number,
): { x: number; y: number; w: number; h: number } {
  return {
    x: Math.round((canvasX + panX) * zoom + offsetX),
    y: Math.round((canvasY + panY) * zoom + offsetY),
    w: Math.round(canvasW * zoom),
    h: Math.round(canvasH * zoom),
  };
}

/** Height of the BrowserPane header bar (URL bar) in CSS pixels */
export const BROWSER_HEADER_HEIGHT = 32;
