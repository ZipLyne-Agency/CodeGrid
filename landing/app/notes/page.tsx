import type { Metadata } from "next";
import { FeaturePage } from "@/components/feature-page";

export const metadata: Metadata = {
  title: "Notes — a markdown scratchpad on your canvas | CodeGrid",
  description:
    "Pin markdown notes to your canvas for plans, to-dos, and snippets. Color-code them, pin one to a specific pane, and keep everything as plain markdown your agents can read too.",
  alternates: { canonical: "https://www.codegrid.app/notes" },
};

export default function NotesPage() {
  return (
    <FeaturePage
      eyebrow="Notes"
      title={<>A scratchpad <span className="text-accent">on your canvas.</span></>}
      intro={
        <>
          Drop a markdown note onto the canvas for plans, to-dos, and snippets — right beside the
          agents doing the work, instead of in some other app.
        </>
      }
      sections={[
        {
          title: "Keep context where the work is",
          cols: 2,
          items: [
            { name: "Markdown notes", desc: "Each note is a markdown scratchpad — jot plans, to-dos, and snippets as you go." },
            { name: "Color-code them", desc: "Give notes different colors to organize what's what at a glance." },
            { name: "Pin to a pane", desc: "Anchor a note to a specific session so its context stays next to the agent it belongs to." },
            { name: "Plain markdown on disk", desc: "Notes are saved as plain markdown per workspace — readable by you, and by your agents." },
          ],
        },
      ]}
      closingTitle={<>Stop losing your train of thought.</>}
      closingBlurb="Plans and snippets live on the canvas, not in another window."
    />
  );
}
