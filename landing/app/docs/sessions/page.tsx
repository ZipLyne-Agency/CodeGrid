import type { Metadata } from "next";
import { DocTitle, Section, P, UL, C, Kbd, Callout, PrevNext } from "@/components/docs-ui";

export const metadata: Metadata = {
  title: "Sessions & agents — CodeGrid Docs",
  description: "Create agent sessions, choose agent types, isolate work with git worktrees, resume, rename, and restart.",
  alternates: { canonical: "https://www.codegrid.app/docs/sessions" },
};

export default function Page() {
  return (
    <>
      <DocTitle title="Sessions & agents" intro="Each pane runs one agent or shell, in its own working directory and process group." />

      <Section title="Creating a session">
        <P>Press <Kbd>⌘N</Kbd> (or <b className="text-text-primary">+ NEW</b>) to open the new-session dialog. Pick:</P>
        <UL items={[
          <><b className="text-text-primary">Agent</b> — Claude, Codex, Gemini, Cursor, or a shell.</>,
          <><b className="text-text-primary">Project folder</b> — the working directory. Browse local folders or clone a GitHub repo right from the dialog.</>,
        ]} />
        <P><b className="text-text-primary">+ SAME</b> opens another session of the focused agent type in the same project — one keystroke to fan out.</P>
      </Section>

      <Section title="Agent types">
        <UL items={[
          <><C>claude</C> — Claude Code. Supports <C>--resume</C> to continue a prior conversation.</>,
          <><C>codex</C> — OpenAI Codex.</>,
          <><C>gemini</C> — Gemini CLI.</>,
          <><C>cursor</C> — Cursor&apos;s <C>cursor-agent</C> (falls back to <C>cursor</C>).</>,
          <><b className="text-text-primary">Shell</b> — your <C>$SHELL</C>, for builds, tests, servers, git, anything.</>,
        ]} />
      </Section>

      <Section title="Git worktree isolation">
        <P>
          When you open a second agent in a repo another session is already using, CodeGrid can spin up a
          dedicated <b className="text-text-primary">git worktree</b> on its own branch — so parallel agents never
          step on each other&apos;s changes. The pane shows its branch in the status bar.
        </P>
        <Callout kind="tip">Worktrees make &quot;three agents on the same repo at once&quot; safe — each commits to its own branch, and you merge when ready.</Callout>
      </Section>

      <Section title="Status">
        <P>Every pane reports a live status, surfaced in its tab and the global attention bar:</P>
        <UL items={[
          <><span style={{ color: "#00c853" }}>running</span> — actively producing output.</>,
          <><span style={{ color: "#4a9eff" }}>idle</span> — quiet / waiting (a finished run goes idle).</>,
          <><span style={{ color: "#ffab00" }}>waiting</span> — needs your input (a prompt was detected).</>,
          <><span style={{ color: "#ff3d00" }}>error / dead</span> — errored or the process ended.</>,
        ]} />
        <P>See <a href="/docs/notifications" className="text-accent hover:underline">Notifications &amp; attention</a> for how CodeGrid pings you when an agent finishes or needs you.</P>
      </Section>

      <Section title="Rename, restart, close">
        <UL items={[
          <><b className="text-text-primary">Rename</b> — double-click a tab (or right-click → Rename). Names persist.</>,
          <><b className="text-text-primary">Restart</b> — a dead pane offers Restart to relaunch the agent in place.</>,
          <><b className="text-text-primary">Close</b> — <Kbd>⌘W</Kbd> terminates the session&apos;s whole process group (the agent plus anything it spawned, like dev servers), so nothing is orphaned.</>,
        ]} />
      </Section>

      <Section title="Persistence">
        <P>Sessions are saved per workspace and restored on next launch, with their layout positions intact.</P>
      </Section>

      <PrevNext current="/docs/sessions" />
    </>
  );
}
