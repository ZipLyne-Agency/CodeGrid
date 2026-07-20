import type { Metadata } from "next";
import { DocTitle, Section, P, UL, C, PrevNext } from "@/components/docs-ui";

export const metadata: Metadata = {
  title: "Updates — CodeGrid Docs",
  description: "How CodeGrid keeps itself up to date — automatic background checks, signed updates, and one-click restart.",
  alternates: { canonical: "https://www.codegrid.app/docs/updates" },
};

export default function Page() {
  return (
    <>
      <DocTitle title="Updates" intro="CodeGrid keeps itself current — quietly and securely." />

      <Section title="How it works">
        <UL items={[
          "Shortly after launch and periodically thereafter, CodeGrid checks for a new release.",
          "If one exists, it downloads in the background and shows an unobtrusive “Update ready” banner.",
          "Click Restart to Update — it installs and relaunches into the new version.",
        ]} />
      </Section>

      <Section title="On your terms">
        <UL items={[
          <>Check anytime: <b className="text-text-primary">Settings → Check for Updates</b>, or the <b className="text-text-primary">App</b> menu.</>,
          <>The current version is always visible in the top bar (e.g. <C>v0.1.x</C>); hover to see when you last updated.</>,
          <>Choose <b className="text-text-primary">Later</b> and the prompt steps aside until you&apos;re ready.</>,
        ]} />
      </Section>

      <Section title="Security">
        <P>Every update is cryptographically signed and verified before it&apos;s applied, and the app itself is notarized by Apple. See <a href="/docs/security" className="text-accent hover:underline">Privacy &amp; security</a>.</P>
      </Section>

      <PrevNext current="/docs/updates" />
    </>
  );
}
