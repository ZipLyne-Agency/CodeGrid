import type { Metadata } from "next";
import { FeaturePage } from "@/components/feature-page";

export const metadata: Metadata = {
  title: "Git & GitHub — a full Git UI in the sidebar | CodeGrid",
  description:
    "Stage, commit, push, pull, branch, and stash without leaving CodeGrid. Inline diffs, commit history, GitHub repo browsing and cloning, and automatic worktree isolation when two sessions share a repo.",
  alternates: { canonical: "https://www.codegrid.app/git" },
};

export default function GitPage() {
  return (
    <FeaturePage
      eyebrow="Git & GitHub"
      title={<>A full Git UI, <span className="text-accent">in the sidebar.</span></>}
      intro={
        <>
          CodeGrid ships a complete Git interface in the sidebar — stage, commit, push, pull,
          branch, and stash without leaving the app, with inline diffs and commit history right
          beside your agents.
        </>
      }
      docsHref="/docs/git"
      sections={[
        {
          title: "Everyday Git, without the context switch",
          items: [
            { name: "Stage & commit", desc: "Stage files one at a time or all at once, then write your message and commit — all in the sidebar." },
            { name: "Push & pull", desc: "Push and pull to your remote with a click. The sidebar shows your branch and whether you're ahead of or behind the remote." },
            { name: "Branches", desc: "Create, switch, and delete branches inline. Quick-publish a local branch to the remote in one step." },
            { name: "Stash", desc: "Stash your working changes and pop them back when you're ready." },
            { name: "Inline diffs", desc: "Review staged and unstaged changes in a syntax-highlighted diff viewer before you commit." },
            { name: "Commit history", desc: "Browse the log with hash, author, date, and message. Hover a commit for its detail, and open it on GitHub, GitLab, or Bitbucket in one click." },
          ],
        },
        {
          title: "GitHub, built in",
          blurb: "CodeGrid uses your existing gh CLI auth — no extra login.",
          cols: 2,
          items: [
            { name: "Browse your repos", desc: "List your own GitHub repositories (including org repos) right from the new-session dialog." },
            { name: "Search & clone", desc: "Full-text search across GitHub and clone any repo straight into your projects folder — no terminal needed." },
            { name: "Git setup wizard", desc: "On first launch, CodeGrid helps you set up Git and GitHub authentication so you're ready to go." },
            { name: "Open commits on the web", desc: "CodeGrid detects GitHub, GitLab, and Bitbucket remotes and links each commit to its page on the host." },
          ],
        },
        {
          title: "Worktree isolation, automatically",
          cols: 2,
          items: [
            { name: "One repo, many sessions", desc: "If two sessions open the same repository, CodeGrid gives the second one its own git worktree on a codegrid/session branch — so agents don't trip over each other." },
            { name: "Auto cleanup", desc: "Worktrees are removed automatically when the session closes, if they're clean." },
          ],
        },
        {
          title: "AI commit messages",
          blurb: <>Free for everyone. Uses your OpenAI key (Settings → Voice). <a href="/pro" className="text-accent hover:underline">How free AI extras work →</a></>,
          cols: 2,
          items: [
            { name: "Clear messages, one click", desc: "Turn your staged diff into a clear commit message. No more “wip” or “fix stuff.”" },
            { name: "Right from the Git panel", desc: "Generate the message where you already are, then edit and commit. Bring your own OpenAI key." },
          ],
        },
      ]}
      closingTitle={<>Your Git workflow, beside your agents.</>}
      closingBlurb="Free, open source, and local-first. No account, no servers."
    />
  );
}
