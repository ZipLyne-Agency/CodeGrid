import type { Metadata } from "next";
import { FeaturePage } from "@/components/feature-page";

export const metadata: Metadata = {
  title: "Coding analytics — a local dashboard of your agent usage | CodeGrid",
  description:
    "A local dashboard built from your agent-CLI logs: tokens, API value, sessions, active days, a daily chart, and your token mix. Nothing ever leaves your machine. Free and uncapped.",
  alternates: { canonical: "https://www.codegrid.app/analytics" },
};

export default function AnalyticsPage() {
  return (
    <FeaturePage
      eyebrow="Coding analytics"
      badge="Free · local · "
      title={<>See where your <span className="text-accent">tokens go.</span></>}
      intro={
        <>
          A local dashboard built from your agent-CLI logs. Nothing ever leaves your machine.
          Free for everyone, with no usage cap.
        </>
      }
      docsHref="/pro"
      docsLabel="Every feature is free →"
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
            { name: "On your machine", desc: "Reads agent CLI logs already on disk. No CodeGrid account." },
            { name: "No network", desc: "Analytics never phones home. Fully offline." },
          ],
        },
      ]}
      closingTitle={<>Included in free CodeGrid.</>}
      closingBlurb="Open the Analytics panel in the sidebar. No key required."
    />
  );
}
