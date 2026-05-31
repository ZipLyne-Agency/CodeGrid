import type {Metadata} from "next";
import {StakeProviders} from "../token/stake/providers";
import {LinkClient} from "./LinkClient";

export const metadata: Metadata = {
  title: "Link your wallet — CodeGrid",
  description: "Prove you control your staked wallet to unlock Pro in the CodeGrid desktop app.",
  robots: {index: false, follow: false},
};

export default function LinkPage() {
  return (
    <div className="min-h-screen bg-bg-primary text-text-primary">
      <StakeProviders>
        <LinkClient />
      </StakeProviders>
    </div>
  );
}
