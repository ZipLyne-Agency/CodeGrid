import type { Metadata } from "next";
import { FeaturePage } from "@/components/feature-page";

export const metadata: Metadata = {
  title: "CodeGrid Pro — a subscription you don't pay for | CodeGrid",
  description:
    "CodeGrid Pro is powered by staking $GRID, not a monthly bill — you stake instead of subscribing, with no yield and your principal always kept. Pro unlocks AI code review, coding analytics, AI commit messages, and AI terminal naming.",
  alternates: { canonical: "https://www.codegrid.app/pro" },
};

export default function ProPage() {
  return (
    <FeaturePage
      eyebrow="CodeGrid Pro"
      badge="Pro · "
      title={<>A subscription <span className="text-accent">you don&apos;t pay for.</span></>}
      intro={
        <>
          CodeGrid is free and open source. Pro is powered by staking <b className="text-text-primary">$GRID</b> —
          you stake instead of subscribing. No yield, and your principal is always kept; unstake and the
          features simply turn off.
        </>
      }
      docsHref="/token/stake"
      docsLabel="Stake $GRID →"
      sections={[
        {
          title: "What Pro unlocks",
          items: [
            { name: "AI code review", desc: "Review your git changes — bugs, security & UX — straight from the Git panel, before you push. Powered by Claude Sonnet 4.6." },
            { name: "Coding analytics", desc: "A local dashboard built from your agent-CLI logs. Nothing ever leaves your machine." },
            { name: "AI commit messages", desc: "One click turns your staged diff into a clear, conventional commit message." },
            { name: "AI terminal naming", desc: "Name any terminal from what it's actually doing — a real tab title, not just “zsh.”" },
          ],
        },
        {
          title: "How it works",
          cols: 2,
          items: [
            { name: "Stake to unlock", desc: "Pro unlocks at 50,000,000 $GRID of staking power. The real gate is your on-chain tier." },
            { name: "Link your wallet", desc: "Sign in with your wallet to prove ownership. The entitlement is signed and verified offline — it can't be forged." },
            { name: "Tiers", desc: "Free, Pro, Team, and Founder. Higher tiers carry everything below them." },
            { name: "Keep your principal", desc: "Staking isn't a payment. There's no yield, and you can unstake at any time — Pro just switches off." },
          ],
        },
        {
          title: "Fair use",
          cols: 2,
          items: [
            { name: "AI reviews & assists", desc: "30 AI reviews and 300 AI assists (commit & terminal names) per month." },
            { name: "Analytics is uncapped", desc: "Coding analytics runs entirely on your machine and has no limit." },
          ],
        },
      ]}
      closingTitle={<>Support the project. Unlock the extras.</>}
      closingBlurb="Stake $GRID, link your wallet, and Pro turns on — no recurring bill."
    />
  );
}
