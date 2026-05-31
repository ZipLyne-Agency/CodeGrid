import type { Metadata } from "next";
import { SiteNav } from "@/components/site-nav";
import { SiteFooter } from "@/components/site-footer";

export const metadata: Metadata = {
  title: "Changelog",
  description: "CodeGrid release history — every version, pulled live from GitHub Releases.",
  alternates: { canonical: "https://www.codegrid.app/changelog" },
};

const REPO = "ZipLyne-Agency/CodeGrid-Claude-Code-Terminal";
const RELEASES_URL = `https://github.com/${REPO}/releases`;

type Release = {
  tag_name: string;
  name: string | null;
  published_at: string | null;
  html_url: string;
  body: string | null;
  prerelease: boolean;
  draft: boolean;
};

async function getReleases(): Promise<Release[] | null> {
  try {
    const res = await fetch(
      `https://api.github.com/repos/${REPO}/releases?per_page=40`,
      {
        headers: { "User-Agent": "codegrid-site", Accept: "application/vnd.github+json" },
        next: { revalidate: 3600 },
      },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as Release[];
    return data.filter((r) => !r.draft);
  } catch {
    return null;
  }
}

function fmtDate(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

function summarize(body: string | null): string {
  if (!body) return "";
  const lines = body
    .replace(/```[\s\S]*?```/g, "")
    .replace(/\r/g, "")
    .split("\n")
    .map((line) =>
      line
        // strip leading markdown markers per line: headers, blockquotes, list bullets.
        .replace(/^\s*(?:#{1,6}\s+|>\s?|[-*+]\s+|\d+\.\s+)/, "")
        // strip surrounding emphasis markers without touching in-word - or _.
        .replace(/(\*\*|\*|__|_)(?=\S)([\s\S]*?\S)\1/g, "$2")
        .replace(/`([^`]+)`/g, "$1")
        .trim(),
    )
    .filter(Boolean);
  // Prefer the first meaningful line/paragraph rather than joining everything.
  const text = lines[0] ?? "";
  return text.length > 220 ? text.slice(0, 217) + "…" : text;
}

export default async function ChangelogPage() {
  const releases = await getReleases();

  return (
    <div className="min-h-screen bg-bg-primary text-text-primary">
      <SiteNav />
      <main className="pt-28 pb-24">
        <div className="max-w-3xl mx-auto px-4 sm:px-6">
          <h1 className="font-display text-3xl sm:text-4xl font-bold tracking-tight mb-2">Changelog</h1>
          <p className="text-text-secondary text-sm mb-12">
            Every CodeGrid release, pulled live from{" "}
            <a href={RELEASES_URL} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">GitHub Releases</a>.
          </p>

          {!releases || releases.length === 0 ? (
            <div className="border border-border bg-bg-secondary p-8 text-center">
              <p className="text-text-secondary text-sm mb-4">
                Release history is published on GitHub.
              </p>
              <a href={RELEASES_URL} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 border border-border hover:border-text-secondary font-mono text-sm px-5 py-2.5 transition-colors">
                View releases on GitHub →
              </a>
            </div>
          ) : (
            <div className="flex flex-col gap-px bg-border border border-border">
              {releases.map((r) => {
                const summary = summarize(r.body);
                return (
                  <a
                    key={r.tag_name}
                    href={r.html_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="bg-bg-secondary p-5 sm:p-6 hover:bg-bg-tertiary transition-colors group block"
                  >
                    <div className="flex flex-wrap items-center gap-3 mb-1">
                      <span className="font-mono text-sm font-bold text-accent">{r.tag_name}</span>
                      {r.prerelease && (
                        <span className="font-mono text-[9px] font-bold tracking-widest px-2 py-0.5 border border-border text-text-secondary uppercase">Pre-release</span>
                      )}
                      <span className="font-mono text-[11px] text-text-secondary">{fmtDate(r.published_at)}</span>
                    </div>
                    {summary && (
                      <p className="text-text-secondary text-xs leading-relaxed mt-2">{summary}</p>
                    )}
                    <span className="font-mono text-[11px] text-text-secondary group-hover:text-accent transition-colors mt-2 inline-block">
                      Release notes →
                    </span>
                  </a>
                );
              })}
            </div>
          )}
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
