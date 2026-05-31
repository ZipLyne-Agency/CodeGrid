import type { Metadata } from "next";
import { DocTitle, Section, P, UL, C, PrevNext } from "@/components/docs-ui";

export const metadata: Metadata = {
  title: "Privacy & security — CodeGrid Docs",
  description: "CodeGrid is local-first: your code stays on your machine, no API keys are stored, and the app is signed and notarized.",
  alternates: { canonical: "https://www.codegrid.app/docs/security" },
};

export default function Page() {
  return (
    <>
      <DocTitle title="Privacy & security" intro="Local-first by design. Your code and keys stay yours." />

      <Section title="Local-first">
        <UL items={[
          "CodeGrid is a native desktop app — there's no CodeGrid cloud, account, or server in the loop.",
          "Your source never leaves your machine except through the agents' own providers (the same as running their CLIs in a terminal).",
          "Sessions, workspaces, layouts, and settings live in a local database on your machine.",
        ]} />
      </Section>

      <Section title="Credentials">
        <P>CodeGrid stores no API keys. Each agent authenticates with its own account exactly as it does on the command line. CodeGrid just launches the CLIs.</P>
      </Section>

      <Section title="Code signing & updates">
        <UL items={[
          "The app is signed with an Apple Developer ID and notarized by Apple — it opens without Gatekeeper warnings.",
          "Auto-updates are cryptographically signed and verified before they're applied.",
        ]} />
      </Section>

      <Section title="The .env guardrail">
        <P>
          Agents don&apos;t get to read or modify <C>.env</C> files unless you explicitly allow it per workspace
          (<b className="text-text-primary">Settings → .env editing</b>), so secrets aren&apos;t exposed by default.
        </P>
      </Section>

      <Section title="The agent bus is local">
        <P>The <a href="/docs/agent-bus" className="text-accent hover:underline">Agent Bus</a> talks to CodeGrid over a local Unix socket in your home directory — no network, no remote endpoint.</P>
      </Section>

      <Section title="Reporting issues">
        <P>Found a security issue? Email <a href="mailto:admin@codegrid.dev" className="text-accent hover:underline">admin@codegrid.dev</a> or open a private report on <a href="https://github.com/ZipLyne-Agency/CodeGrid-Claude-Code-Terminal" target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">GitHub</a>.</P>
      </Section>

      <PrevNext current="/docs/security" />
    </>
  );
}
