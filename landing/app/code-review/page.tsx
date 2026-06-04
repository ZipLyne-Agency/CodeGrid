import type { Metadata } from "next";
import { FeaturePage } from "@/components/feature-page";

export const metadata: Metadata = {
  title: "AI code review — catch issues before you push | CodeGrid Pro",
  description:
    "Review your git changes for correctness, security, and UX straight from the Git panel, before you push. Severity-ranked findings, runs in the background, and a history per repo. A CodeGrid Pro feature powered by Claude Sonnet 4.6.",
  alternates: { canonical: "https://www.codegrid.app/code-review" },
};

export default function CodeReviewPage() {
  return (
    <FeaturePage
      eyebrow="AI code review"
      badge="Pro · "
      title={<>Catch it <span className="text-accent">before you push.</span></>}
      intro={
        <>
          Review your git changes — for bugs, security, and UX — straight from the Git panel, before
          you push. A CodeGrid Pro feature, powered by Claude Sonnet 4.6.
        </>
      }
      docsHref="/pro"
      docsLabel="About Pro →"
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
            { name: "Runs in the background", desc: "Start a review, close the panel, keep working, and come back to it — reviews run without blocking you." },
            { name: "History per repo", desc: "Past reviews are kept and browsable by repository." },
            { name: "Hand it to an agent", desc: "Export a review as a prompt and send it straight to the focused agent to make the fixes." },
          ],
        },
      ]}
      closingTitle={<>A second pair of eyes, on demand.</>}
      closingBlurb="Powered by staking $GRID — no monthly bill."
    />
  );
}
