import { NextRequest, NextResponse } from "next/server";

// Public download repo — where signed release DMGs are published.
const REPO = "ZipLyne-Agency/CodeGrid-Claude-Code-Terminal";
const GITHUB_API = `https://api.github.com/repos/${REPO}/releases/latest`;

export async function GET(_req: NextRequest) {
  // No request logging here — we promise no telemetry, so we don't quietly
  // record visitor IPs/user-agents on the download path either.
  try {
    const res = await fetch(GITHUB_API, {
      headers: { Accept: "application/vnd.github+json" },
      next: { revalidate: 300 },
    });

    if (res.ok) {
      const release = await res.json();
      const dmgs =
        release.assets?.filter((a: { name: string }) => a.name.endsWith(".dmg")) ?? [];
      // Prefer the Apple-Silicon build if a release ever ships multiple DMGs.
      const dmg =
        dmgs.find((a: { name: string }) => /arm64|silicon|aarch64/i.test(a.name)) ?? dmgs[0];
      if (dmg?.browser_download_url) {
        return NextResponse.redirect(dmg.browser_download_url, 302);
      }
    }
  } catch {
    // Fall through to the releases page.
  }

  return NextResponse.redirect(`https://github.com/${REPO}/releases/latest`, 302);
}
