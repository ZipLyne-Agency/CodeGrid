import type { Metadata } from "next";
import { FeaturePage } from "@/components/feature-page";

export const metadata: Metadata = {
  title: "Live preview panes — your dev server beside the code | CodeGrid",
  description:
    "Open an in-app browser pane for your local dev server right on the canvas. CodeGrid watches your terminals for localhost URLs and offers to open them beside your agents.",
  alternates: { canonical: "https://www.codegrid.app/preview" },
};

export default function PreviewPage() {
  return (
    <FeaturePage
      eyebrow="Live preview"
      title={<>Your dev server, <span className="text-accent">beside the code.</span></>}
      intro={
        <>
          Open an in-app browser pane on the canvas and watch your app render as your agents build it.
          Preview panes are scoped to your local dev server, right next to the terminals.
        </>
      }
      sections={[
        {
          title: "Preview without leaving CodeGrid",
          cols: 2,
          items: [
            { name: "A pane for localhost", desc: "Open a live in-app browser for your dev server and place it anywhere on the canvas." },
            { name: "Type a URL", desc: "Point a preview pane at the local address your server is running on." },
            { name: "Auto-detected URLs", desc: "CodeGrid watches your terminal output for localhost URLs and offers to open them in a preview pane with one click." },
            { name: "No toast spam", desc: "Each detected URL is offered once, then held back for a few minutes so recurring output doesn't nag you." },
            { name: "Scoped to your dev server", desc: "Preview panes are intentionally for localhost dev servers, kept right beside the code that produces them." },
            { name: "External links open out", desc: "Non-localhost links get a quick “open externally” affordance instead, in your real browser." },
          ],
        },
      ]}
      closingTitle={<>Build and preview, side by side.</>}
      closingBlurb="See the change the moment your agent makes it."
    />
  );
}
