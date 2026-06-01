/**
 * Keep an anchored popover/menu fully on-screen.
 *
 * Given the anchor's bounding rect and the menu's measured size, returns a
 * `{ top, left }` (viewport / `position: fixed` coordinates) that:
 *   - opens below the anchor when there's room, otherwise flips above it,
 *   - never lets the top/bottom run off the viewport,
 *   - nudges horizontally so neither side edge is clipped.
 *
 * Used by every floating menu so popovers near a screen edge (the bottom dock,
 * the left sidebar, a right-click near a corner) stay readable instead of
 * spilling off-screen.
 */
export function clampMenuPosition(
  anchor: { top: number; bottom: number; left: number; right: number },
  menu: { width: number; height: number },
  opts: { gap?: number; align?: "left" | "right"; margin?: number } = {},
): { top: number; left: number } {
  const gap = opts.gap ?? 4;
  const margin = opts.margin ?? 8;
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  // Vertical: prefer below; flip above only when below would clip and above has
  // more room.
  const spaceBelow = vh - anchor.bottom;
  const spaceAbove = anchor.top;
  let top: number;
  if (spaceBelow >= menu.height + gap + margin || spaceBelow >= spaceAbove) {
    top = anchor.bottom + gap;
  } else {
    top = anchor.top - menu.height - gap;
  }
  top = Math.max(margin, Math.min(top, vh - menu.height - margin));

  // Horizontal: align to the requested edge, then clamp into the viewport.
  let left = opts.align === "right" ? anchor.right - menu.width : anchor.left;
  left = Math.max(margin, Math.min(left, vw - menu.width - margin));

  return { top, left };
}
