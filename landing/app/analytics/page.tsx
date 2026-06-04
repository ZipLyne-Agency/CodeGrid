import type { Metadata } from "next";
import { FeaturePage } from "@/components/feature-page";

export const metadata: Metadata = {
  title: "Coding analytics — a local dashboard of your agent usage | CodeGrid Pro",
  description:
    "A local dashboard built from your agent-CLI logs: tokens, API value, sessions, active days, a daily chart, and your token mix. Nothing ever leaves your machine. A CodeGrid Pro feature, uncapped.",
  alternates: { canonical: "https://www.codegrid.app/analytics" },
};

export default function AnalyticsPage() {
  return (
    <FeaturePage
      eyebrow="Coding analytics"
      badge="Pro · "
      title={<>See where your <span className="text-accent">tokens go.</span></>}
      intro={
        <>
          A local dashboard built from your agent-CLI logs. Nothing ever leaves your machine — and
          unlike the other Pro features, analytics is completely uncapped.
        </>
      }
      docsHref="/pro"
      docsLabel="About Pro →"
      sections={[
        {
          title: "What you'll see",
          items: [
            { name: "Tokens", desc: "Total token usage across your agent sessions." },
            { name: "API value", desc: "The estimated dollar value of that usage." },
            { name: "Sessions", desc: "How many agent sessions you ran." },
            { name: "Active days", desc: "The days you actually shipped." },
            { name: "Tokens / day", desc: "A daily bar chart of your token usage over time." },
            { name: "Token mix", desc: "Input, output, cache-read, and cache-write tokens broken out." },
          ],
        },
        {
          title: "Local and private",
          cols: 2,
          items: [
            { name: "Range it", desc: "Look at the last 7, 30, or 90 days — or all of it." },
            { name: "Built from your logs", desc: "Computed from the logs your agent CLIs already write, on your machine." },
            { name: "Nothing leaves", desc: "Analytics is local-only. No telemetry, no upload, no account." },
            { name: "Uncapped", desc: "There's no monthly limit on analytics — look as often as you like." },
          ],
        },
      ]}
      closingTitle={<>Know your habits. On your machine.</>}
      closingBlurb="Powered by staking $GRID, and entirely local."
    />
  );
}
