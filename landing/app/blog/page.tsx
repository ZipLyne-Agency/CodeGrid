import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { listPosts } from "@/lib/mentionwell";

export const revalidate = 300;

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.codegrid.app";
const API_URL = process.env.MENTIONWELL_API_URL;
const SITE_SLUG = process.env.MENTIONWELL_SITE_SLUG;

export const metadata: Metadata = {
  title: "Blog",
  description:
    "Guides and field notes on orchestrating many AI coding agents in parallel — Claude Code, Codex, Gemini, Cursor — from a single workspace.",
  alternates: {
    canonical: `${SITE_URL}/blog`,
    types: {
      "application/rss+xml": `${API_URL}/api/sites/${SITE_SLUG}/feed.xml`,
      "application/feed+json": `${API_URL}/api/sites/${SITE_SLUG}/feed.json`,
    },
  },
  openGraph: {
    title: "CodeGrid Blog",
    description:
      "Guides and field notes on orchestrating many AI coding agents in parallel.",
    type: "website",
    url: `${SITE_URL}/blog`,
  },
};

function formatDate(value: string | null): string {
  if (!value) return "";
  return new Date(value).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export default async function BlogIndex() {
  const posts = await listPosts(30);

  return (
    <main className="max-w-6xl mx-auto px-4 sm:px-6 py-16 sm:py-20">
      <header className="max-w-2xl mb-12 sm:mb-16">
        <span className="font-mono text-[11px] uppercase tracking-widest text-accent">
          The CodeGrid blog
        </span>
        <h1 className="font-display text-3xl sm:text-4xl font-bold mt-3 mb-4 tracking-tight">
          Field notes for agent-driven development
        </h1>
        <p className="text-text-secondary text-base leading-relaxed">
          Practical guides on running Claude Code, Codex, Gemini, Cursor, and shells in
          parallel — without losing track of which agent needs you.
        </p>
      </header>

      {posts.length === 0 ? (
        <p className="font-mono text-sm text-text-secondary border border-border bg-bg-secondary p-6">
          No posts published yet. Check back soon.
        </p>
      ) : (
        <section className="grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
          {posts.map((post, idx) => (
            <article
              key={post.slug}
              className="group flex flex-col border border-border bg-bg-secondary hover:border-accent/60 transition-colors"
            >
              <Link
                href={`/blog/${post.slug}`}
                prefetch
                className="block relative aspect-[16/9] overflow-hidden bg-bg-tertiary border-b border-border"
              >
                {post.featuredImage ? (
                  <Image
                    src={post.featuredImage}
                    alt={post.title}
                    fill
                    sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 360px"
                    priority={idx === 0}
                    className="object-cover"
                  />
                ) : (
                  <div className="dot-grid w-full h-full" aria-hidden="true" />
                )}
              </Link>
              <div className="flex flex-col flex-1 p-5">
                {post.category ? (
                  <span className="font-mono text-[10px] uppercase tracking-widest text-accent mb-2">
                    {post.category.title}
                  </span>
                ) : null}
                <h2 className="font-display text-base font-bold leading-snug mb-2">
                  <Link href={`/blog/${post.slug}`} prefetch className="hover:text-accent transition-colors">
                    {post.title}
                  </Link>
                </h2>
                <p className="text-sm text-text-secondary leading-relaxed line-clamp-3 mb-4">
                  {post.excerpt}
                </p>
                <footer className="mt-auto flex items-center gap-3 font-mono text-[11px] text-text-secondary">
                  {post.author ? <span className="truncate">{post.author.name}</span> : null}
                  {post.publishedAt ? (
                    <time dateTime={post.publishedAt}>{formatDate(post.publishedAt)}</time>
                  ) : null}
                  <span className="ml-auto whitespace-nowrap">{post.readingTime} min</span>
                </footer>
              </div>
            </article>
          ))}
        </section>
      )}
    </main>
  );
}
