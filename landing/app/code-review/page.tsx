import type { Metadata } from "next";
import { FeaturePage } from "@/components/feature-page";

export const metadata: Metadata = {
  title: "AI code review — catch issues before you push | CodeGrid",
  description:
    "Review your git changes for correctness, security, and UX straight from the Git panel, before you push. Severity-ranked findings, runs in the background, and a history per repo. Free with your own OpenAI key.",
  alternates: { canonical: "https://www.codegrid.app/code-review" },
};

export default function CodeReviewPage() {
  return (
    <FeaturePage
      eyebrow="AI code review"
      badge="Free · BYOK · "
      title={<>Catch it <span className="text-accent">before you push.</span></>}
      intro={
        <>
          Review your git changes for bugs, security, and UX straight from the Git panel, before
          you push. Free for everyone. Uses your own OpenAI API key (Settings → Voice).
        </>
      }
      docsHref="/pro"
      docsLabel="How free AI extras work →"
      sections={[
        {
          title: "Three dimensions",
          items: [
            { name: "Security", desc: "Injection, auth, secrets, and validation." },
            { name: "Correctness", desc: "Logic bugs, edge cases, and leaks." },
            { name: "UX / UI", desc: "States, accessibility, copy, and hierarchy." },
          ],
        },
        {
          title: "Findings you can act on",
          cols: 2,
          items: [
            { name: "Severity-ranked", desc: "Every finding is tagged CRIT, HIGH, MED, LOW, or NIT so you know what to fix first." },
            { name: "Runs in the background", desc: "Start a review, close the panel, keep working, and come back to it." },
            { name: "History per repo", desc: "Past reviews are kept and browsable by repository." },
            { name: "Send to an agent", desc: "Copy findings as a prompt or send them straight to the focused agent." },
          ],
        },
      ]}
      closingTitle={<>Free. Local. Your key.</>}
      closingBlurb="Add an OpenAI key once and run unlimited reviews billed only to your provider."
    />
  );
}
