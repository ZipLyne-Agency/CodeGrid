import type { Metadata } from "next";
import { FeaturePage } from "@/components/feature-page";

export const metadata: Metadata = {
  title: "Every feature is free | CodeGrid",
  description:
    "CodeGrid is free and open source. AI code review, coding analytics, AI commit messages, terminal naming, and voice control are all included. AI extras use your own API key.",
  alternates: { canonical: "https://www.codegrid.app/pro" },
};

export default function ProPage() {
  return (
    <FeaturePage
      eyebrow="Free forever"
      badge="Open source · "
      title={<>Every feature is <span className="text-accent">free.</span></>}
      intro={
        <>
          CodeGrid is free and open source under the MIT license. There is no paid tier, no wallet,
          and no crypto stake. AI extras that call a model use your own API key (bring your own key),
          billed to your provider account, never to CodeGrid.
        </>
      }
      docsHref="/pricing"
      docsLabel="See pricing →"
      sections={[
        {
          title: "Included for everyone",
          items: [
            { name: "AI code review", desc: "Review your git changes for bugs, security, and UX from the Git panel. Uses your OpenAI key." },
            { name: "Coding analytics", desc: "A local dashboard built from your agent-CLI logs. Nothing ever leaves your machine." },
            { name: "AI commit messages", desc: "One click turns your staged diff into a clear commit message. Uses your OpenAI key." },
            { name: "AI terminal naming", desc: "Name any terminal from what it is actually doing. Uses your OpenAI key." },
            { name: "Voice control", desc: "Talk to the canvas with OpenAI Realtime. Same key as the other AI extras." },
          ],
        },
        {
          title: "How AI extras work",
          cols: 2,
          items: [
            { name: "Bring your own key", desc: "Add an OpenAI API key in Settings → Voice. It stays in the macOS Keychain." },
            { name: "You pay the provider", desc: "Usage bills to your OpenAI account. CodeGrid never takes a cut or stores the key server-side." },
            { name: "Works offline without AI", desc: "Agents, canvas, Git, files, and analytics all work without any CodeGrid account or key." },
            { name: "No quotas from us", desc: "There is no monthly review cap from CodeGrid. Limits come only from your provider plan." },
          ],
        },
      ]}
      closingTitle={<>Free software. Your keys. Your agents.</>}
      closingBlurb="Download CodeGrid, open a project, and run every feature. No account, no license key, no stake."
    />
  );
}
