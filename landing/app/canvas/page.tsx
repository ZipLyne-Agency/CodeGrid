import type { Metadata } from "next";
import { FeaturePage } from "@/components/feature-page";

export const metadata: Metadata = {
  title: "The canvas — an infinite 2D workspace for your terminals | CodeGrid",
  description:
    "Drag, resize, and zoom terminal panes on an infinite 2D canvas. Layout presets (auto, focus, columns, rows, grid), pane numbering, maximize, swap, a minimized dock, and live activity indicators on every pane.",
  alternates: { canonical: "https://www.codegrid.app/canvas" },
};

export default function CanvasPage() {
  return (
    <FeaturePage
      eyebrow="The canvas"
      title={<>An infinite canvas <span className="text-accent">for your terminals.</span></>}
      intro={
        <>
          Give every project its own 2D canvas. Drag panes anywhere, resize from any edge, and zoom
          out to see your whole fleet at once — no tabs, no splits, just space.
        </>
      }
      docsHref="/docs/canvas"
      sections={[
        {
          title: "Arrange panes any way you think",
          items: [
            { name: "Free-form placement", desc: "Pan and zoom the canvas, drag panes to reposition them, and resize from any edge." },
            { name: "Layout presets", desc: "Switch between Auto, Focus, Columns, Rows, and Grid to reorganize active panes instantly." },
            { name: "Fit to view", desc: "Snap every pane back into view in one action when things drift." },
            { name: "Maximize & restore", desc: "Blow a single pane up to fill the canvas, then drop it back into the layout." },
            { name: "Swap panes", desc: "Swap adjacent panes with a keystroke to rearrange without dragging." },
            { name: "Minimized dock", desc: "Collapse panes to a dock at the edge of the canvas without closing them." },
          ],
        },
        {
          title: "Always know what each pane is doing",
          cols: 2,
          items: [
            { name: "Pane numbers", desc: "Every pane gets a number so you can jump straight to it from the keyboard." },
            { name: "Live activity indicators", desc: "Each pane shows its status — idle, running, waiting, error, or dead — visible even when you're zoomed out." },
            { name: "Attention detection", desc: <>CodeGrid highlights panes waiting on you — Y/N prompts, approvals, confirmations — across any agent. <a href="/features" className="text-accent hover:underline">More features →</a></> },
            { name: "Pinned notes", desc: "Pin a markdown note to a specific pane to keep context right where you need it." },
          ],
        },
      ]}
      closingTitle={<>See your whole fleet at once.</>}
      closingBlurb="No more juggling a dozen windows, tabs, and desktops."
    />
  );
}
