import type { Metadata } from "next";
import { DocTitle, Section, P, UL, C, Callout, PrevNext } from "@/components/docs-ui";

export const metadata: Metadata = {
  title: "Git — CodeGrid Docs",
  description: "Status, diffs, hunk staging, branches, commit/push/pull, stashes, tags, and one-click publish — built in.",
  alternates: { canonical: "https://www.codegrid.app/docs/git" },
};

export default function Page() {
  return (
    <>
      <DocTitle title="Git" intro="A full git workflow built into the sidebar — no context-switching to a separate client." />

      <Section title="Git Manager">
        <P>Open the <b className="text-text-primary">Git</b> panel for the active workspace&apos;s repo. From one place you can:</P>
        <UL items={[
          "See working-tree status — staged, modified, added, deleted, untracked.",
          "Stage / unstage files or individual hunks; discard changes.",
          "Commit (and amend), push, pull, fetch.",
          "Create, switch, merge, and delete branches.",
          "Stash and pop; view, create, and list tags; cherry-pick and revert commits.",
          "Browse the log and inspect any commit's diff.",
        ]} />
      </Section>

      <Section title="Setup wizard">
        <P>
          New machine or fresh repo? The <b className="text-text-primary">Git Setup Wizard</b> checks your git
          identity and GitHub auth, can run <C>gh auth login</C> (including device-flow), set your
          <C> user.name</C>/<C>user.email</C>, and initialize a repo with <C>git init</C> — so you go from zero
          to pushing without leaving CodeGrid.
        </P>
      </Section>

      <Section title="Quick publish & save">
        <UL items={[
          <><b className="text-text-primary">Quick Save</b> — stage all + commit in one action.</>,
          <><b className="text-text-primary">Quick Publish</b> — commit and push, creating the remote/branch as needed.</>,
        ]} />
        <Callout kind="tip">Combined with git worktrees, each agent commits to its own branch — review and merge their work from the Git panel when you&apos;re ready.</Callout>
      </Section>

      <Section title="Diffs & hunk staging">
        <P>The <a href="/docs/editor" className="text-accent hover:underline">code viewer&apos;s DIFF mode</a> shows per-file changes with a <b className="text-text-primary">Stage Hunk</b> button, so you can craft precise commits.</P>
      </Section>

      <PrevNext current="/docs/git" />
    </>
  );
}
