import type { Metadata } from "next";
import { SiteNav } from "@/components/site-nav";
import { SiteFooter } from "@/components/site-footer";

export const metadata: Metadata = {
  title: "Security",
  description:
    "How CodeGrid protects your code and data: local-first, no telemetry, fully open source under MIT, code-signed and notarized by Apple, with strict filesystem boundaries and Keychain-backed secrets. By ZipLyne LLC.",
  alternates: { canonical: "https://www.codegrid.app/security" },
};

const sections: { h: string; body: React.ReactNode }[] = [
  {
    h: "Local-first by design",
    body: (
      <>
        CodeGrid runs entirely on your machine. Your terminals, code, prompts, and project files
        never pass through ZipLyne servers — there are none. The desktop app ships with{" "}
        <strong className="text-text-primary">no telemetry, no analytics, and no crash reporting</strong>,
        and it requires no account, sign-up, or license key.
      </>
    ),
  },
  {
    h: "Open source and auditable",
    body: (
      <>
        The complete source code is published on{" "}
        <a href="https://github.com/ZipLyne-Agency/CodeGrid" target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">GitHub</a>{" "}
        under the MIT license. Anything we claim on this page can be verified by reading the code.
        There is no closed-source server component to trust.
      </>
    ),
  },
  {
    h: "Code-signed & notarized",
    body: (
      <>
        Release builds are signed with an Apple <strong className="text-text-primary">Developer ID</strong>{" "}
        certificate issued to ZipLyne LLC (Team ID DHGG5BA7J7), built with the macOS{" "}
        <strong className="text-text-primary">hardened runtime</strong>, and{" "}
        <strong className="text-text-primary">notarized by Apple</strong>. Auto-updates are delivered as
        signed artifacts and verified with a minisign public key before they are applied, so an
        update cannot be tampered with in transit.
      </>
    ),
  },
  {
    h: "Strict filesystem boundaries",
    body: (
      <>
        File and Git operations performed by the app are validated in the Rust backend: every path is
        canonicalized and constrained to your home directory or <code className="font-mono bg-bg-secondary border border-border px-1 text-text-primary">/tmp</code>,
        path-traversal (<code className="font-mono bg-bg-secondary border border-border px-1 text-text-primary">..</code>) and symlink escapes are rejected, and
        file-scoped Git commands run with literal pathspecs so a maliciously-named file cannot widen an
        operation. Precious config files (e.g. <code className="font-mono bg-bg-secondary border border-border px-1 text-text-primary">.claude.json</code>) are
        written atomically to avoid corruption.
      </>
    ),
  },
  {
    h: "Secure credential handling",
    body: (
      <>
        Agent CLIs authenticate with their own existing logins. If you enable CodeGrid&apos;s optional
        OpenAI-powered review, commit-message, terminal-summary, or voice features, the key you provide
        is stored in <strong className="text-text-primary">macOS Keychain</strong>. Venice keys are
        requested with hidden input and held only in that pane&apos;s process environment. GitHub
        authentication uses the GitHub CLI and your operating system keychain; CodeGrid refuses to
        write tokens to disk in plaintext (it rejects the insecure
        <code className="font-mono bg-bg-secondary border border-border px-1 text-text-primary">credential.helper=store</code> mode).
      </>
    ),
  },
  {
    h: "Where your AI prompts go",
    body: (
      <>
        Agent CLI requests flow directly to their providers under those providers&apos; terms. When you
        explicitly use CodeGrid&apos;s BYOK AI extras, the relevant diff, terminal text, or voice audio is
        sent directly from the desktop app to OpenAI using your key. ZipLyne does not proxy or store
        those requests. See{" "}
        <a href="/responsible-ai" className="text-accent hover:underline">Responsible AI</a> for details.
      </>
    ),
  },
  {
    h: "Reporting a vulnerability",
    body: (
      <>
        We welcome coordinated disclosure. Email{" "}
        <a href="mailto:admin@codegrid.dev" className="text-accent hover:underline">admin@codegrid.dev</a>{" "}
        with details and reproduction steps, or open a private advisory on the GitHub repository. Please
        give us a reasonable window to investigate and ship a fix before public disclosure. We aim to
        acknowledge reports within 3 business days.
      </>
    ),
  },
  {
    h: "What we don't claim",
    body: (
      <>
        CodeGrid is an independent, open-source desktop tool, not a SaaS platform — we hold no
        third-party compliance certifications (such as SOC 2), because we operate no servers and store
        none of your data. Our security model is transparency and minimalism: the less we collect, the
        less there is to protect. This page describes the current build and will be kept in step with
        the code.
      </>
    ),
  },
];

export default function SecurityPage() {
  return (
    <div className="min-h-screen bg-bg-primary text-text-primary">
      <SiteNav />
      <div className="max-w-3xl mx-auto px-4 sm:px-6 pt-28 pb-20">

        <h1 className="font-display text-3xl sm:text-4xl font-bold tracking-tight mb-2">Security</h1>
        <p className="font-mono text-xs text-text-secondary mb-10">Last updated: July 20, 2026</p>

        <p className="text-sm leading-relaxed text-text-primary mb-12">
          CodeGrid is built so there is very little to secure: it is local-first, collects nothing, and
          is fully open source. Below is exactly how the current build handles your code, credentials,
          and updates — all verifiable in the source.
        </p>

        <div className="space-y-8 text-sm leading-relaxed text-text-primary">
          {sections.map((s) => (
            <section key={s.h}>
              <h2 className="font-mono text-base font-semibold text-text-primary mb-3">{s.h}</h2>
              <p>{s.body}</p>
            </section>
          ))}
        </div>
      </div>
      <SiteFooter />
    </div>
  );
}
