const BASE = process.env.MENTIONWELL_API_URL;
const SLUG = process.env.MENTIONWELL_SITE_SLUG;
const KEY = process.env.MENTIONWELL_API_KEY;

/**
 * The blog is only wired up when all three MentionWell env vars are present
 * (e.g. set in Vercel). When they're missing — local checkouts, preview builds
 * without secrets — we degrade gracefully to an empty blog instead of throwing
 * during static generation and failing the whole deploy.
 */
const CONFIGURED = Boolean(BASE && SLUG && KEY);

export interface MentionWellPostSummary {
  slug: string;
  title: string;
  excerpt: string;
  metaDescription: string;
  featuredImage: string | null;
  readingTime: number;
  tags: string[];
  category: { title: string; slug: string } | null;
  publishedAt: string | null;
  updatedAt: string | null;
  author: { name: string; avatarUrl: string | null; url: string | null } | null;
  canonicalUrl: string | null;
}

export interface MentionWellPost extends Omit<MentionWellPostSummary, "author"> {
  metaTitle: string;
  html: string;
  markdown: string;
  tldr: { items: string[] } | null;
  toc: { title: string; id: string; level: 2 | 3 }[] | null;
  faqs: { question: string; answer: string }[] | null;
  jsonLd: string | null;
  author: {
    name: string;
    title?: string;
    bio?: string;
    avatarUrl?: string;
    url?: string;
  } | null;
}

async function call<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { Authorization: `Bearer ${KEY}` },
    next: { tags: ["mentionwell:posts"], revalidate: 300 },
  });
  if (!res.ok) throw new Error(`MentionWell ${path} failed (${res.status})`);
  return (await res.json()) as T;
}

export async function listPosts(limit = 30): Promise<MentionWellPostSummary[]> {
  if (!CONFIGURED) return [];
  try {
    const data = await call<{ posts: MentionWellPostSummary[] }>(
      `/api/public/${SLUG}/posts?limit=${limit}`,
    );
    return data.posts ?? [];
  } catch {
    return [];
  }
}

export async function getPost(slug: string): Promise<MentionWellPost | null> {
  if (!CONFIGURED) return null;
  try {
    const data = await call<{ post: MentionWellPost }>(
      `/api/public/${SLUG}/posts/${slug}`,
    );
    return data.post;
  } catch {
    return null;
  }
}
