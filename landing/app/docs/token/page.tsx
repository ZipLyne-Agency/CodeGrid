import type { Metadata } from "next";
import { DocTitle, Section, P, UL, C, Code, Callout, PrevNext } from "@/components/docs-ui";
import { GRID_TOKEN_ADDRESS as ADDRESS, GRID_DEXSCREENER as DEX } from "@/lib/token";

export const metadata: Metadata = {
  title: "$GRID token — CodeGrid Docs",
  description: "About the $GRID token on Base: the contract address and where to view it.",
  alternates: { canonical: "https://www.codegrid.app/docs/token" },
};

export default function Page() {
  return (
    <>
      <DocTitle title="$GRID token" intro="CodeGrid is crypto-native. $GRID is the project's token on Base." />

      <Section title="The token">
        <UL items={[
          <><b className="text-text-primary">Ticker</b> — <C>$GRID</C></>,
          <><b className="text-text-primary">Network</b> — Base</>,
          <><b className="text-text-primary">Contract</b> — view the chart on <a href={DEX} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">DexScreener</a>, or see every listing on the <a href="/token" className="text-accent hover:underline">$GRID token page</a></>,
        ]} />
        <Code label="contract address (Base)">{ADDRESS}</Code>
        <Callout kind="warn">Always verify the contract address against the official site and this page before interacting. Never trust an address from DMs or unofficial sources.</Callout>
      </Section>

      <Section title="Honest note">
        <P>
          $GRID is a utility token — it isn&apos;t investment advice, and crypto assets are volatile. The
          premium feature set is evolving; this page is the source of truth for the official contract address.
        </P>
      </Section>

      <PrevNext current="/docs/token" />
    </>
  );
}
