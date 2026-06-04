import type { MetadataRoute } from 'next';
import { listPosts } from '@/lib/mentionwell';
import { DOCS_FLAT } from '@/lib/docs-nav';

export const revalidate = 300;

const BASE = 'https://www.codegrid.app';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();
  const page = (
    path: string,
    priority: number,
    changeFrequency: MetadataRoute.Sitemap[number]["changeFrequency"],
  ) => ({ url: `${BASE}${path}`, lastModified: now, changeFrequency, priority });

  let posts: Awaited<ReturnType<typeof listPosts>> = [];
  try {
    posts = await listPosts(200);
  } catch {
    posts = [];
  }

  return [
    page("", 1, "weekly"),
    page("/features", 0.9, "weekly"),
    page("/agents", 0.8, "monthly"),
    page("/agent-bus", 0.9, "weekly"),
    page("/canvas", 0.8, "monthly"),
    page("/git", 0.8, "monthly"),
    page("/mcp", 0.8, "monthly"),
    page("/editor", 0.8, "monthly"),
    page("/command-palette", 0.7, "monthly"),
    page("/preview", 0.7, "monthly"),
    page("/notes", 0.7, "monthly"),
    page("/pro", 0.8, "monthly"),
    page("/code-review", 0.7, "monthly"),
    page("/analytics", 0.7, "monthly"),
    page("/skills", 0.9, "weekly"),
    page("/blog", 0.8, "daily"),
    page("/docs", 0.8, "weekly"),
    ...DOCS_FLAT.filter((l) => l.href !== "/docs").map((l) => page(l.href, 0.6, "weekly")),
    page("/pricing", 0.7, "monthly"),
    page("/token", 0.7, "weekly"),
    page("/token/treasury", 0.8, "daily"),
    page("/compare/codegrid-vs-tmux", 0.7, "monthly"),
    page("/compare/codegrid-vs-iterm2", 0.7, "monthly"),
    page("/compare/codegrid-vs-vscode-terminals", 0.7, "monthly"),
    page("/changelog", 0.6, "weekly"),
    page("/security", 0.7, "monthly"),
    page("/responsible-ai", 0.7, "monthly"),
    page("/about", 0.6, "monthly"),
    page("/founder", 0.5, "monthly"),
    page("/careers", 0.5, "monthly"),
    page("/press", 0.4, "monthly"),
    page("/privacy", 0.5, "monthly"),
    page("/terms", 0.5, "monthly"),
    ...posts.map((p) => ({
      url: `${BASE}/blog/${p.slug}`,
      lastModified: p.updatedAt ?? p.publishedAt ?? now,
      changeFrequency: "weekly" as const,
      priority: 0.8,
    })),
  ];
}
