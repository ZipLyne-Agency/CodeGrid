import type { Metadata } from "next";
import { DocTitle, Section, P, UL, Kbd, PrevNext } from "@/components/docs-ui";

export const metadata: Metadata = {
  title: "Notifications & attention — CodeGrid Docs",
  description: "Never miss an agent that finished or needs you. Native notifications, a global attention bar, dock badge, and jump-to-next.",
  alternates: { canonical: "https://www.codegrid.app/docs/notifications" },
};

export default function Page() {
  return (
    <>
      <DocTitle title="Notifications & attention" intro="With many agents running, CodeGrid makes sure you never miss the one that needs you." />

      <Section title="Native notifications">
        <P>CodeGrid sends a macOS notification when an agent (that you&apos;re not currently watching):</P>
        <UL items={[
          <><b className="text-text-primary">needs your input</b> — a prompt was detected (e.g. a permission or y/n).</>,
          <><b className="text-text-primary">finished a run</b> — it went quiet after working.</>,
          <><b className="text-text-primary">errored or ended</b> unexpectedly.</>,
        ]} />
        <P>Notifications are suppressed for the pane you&apos;re actively viewing, so they&apos;re signal, not noise.</P>
      </Section>

      <Section title="The attention bar">
        <P>The top bar always shows a live fleet summary across every workspace — how many agents are <span style={{ color: "#00c853" }}>running</span>, <span style={{ color: "#ff8c00" }}>need you</span>, <span style={{ color: "#ff3d00" }}>errored</span>, or <span style={{ color: "#888" }}>finished</span>. When something needs you it glows and becomes clickable.</P>
      </Section>

      <Section title="Jump to the next agent">
        <P>Click the attention bar, press <Kbd>⌘⇧A</Kbd>, or use <b className="text-text-primary">Agents → Go to Next Agent Needing Attention</b> in the menu bar. CodeGrid switches to the right workspace, focuses that pane, and zooms to it.</P>
      </Section>

      <Section title="Dock badge & tray">
        <P>The Dock icon shows a badge with the number of agents waiting on you, and the menu-bar (tray) icon mirrors the live count — so you stay aware even when CodeGrid is in the background.</P>
      </Section>

      <PrevNext current="/docs/notifications" />
    </>
  );
}
