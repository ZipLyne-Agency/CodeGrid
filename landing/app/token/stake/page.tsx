import type {Metadata} from "next";
import {StakeProviders} from "./providers";
import {StakeClient} from "./StakeClient";

export const metadata: Metadata = {
  title: "Stake $GRID — unlock CodeGrid Pro",
  description:
    "Stake $GRID on Base to reach Pro and switch on AI code review + coding analytics in the CodeGrid desktop app. You always keep your principal — no yield, no custody. Exit anytime with a short cooldown.",
  alternates: {canonical: "https://www.codegrid.app/token/stake"},
};

// Full-screen terminal — no SiteNav/SiteFooter; the shell owns the viewport
// (100dvh, page-locked) just like the treasury terminal.
export default function StakePage() {
  return (
    <StakeProviders>
      <StakeClient />
    </StakeProviders>
  );
}
