import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import Script from "next/script";
import { notFound } from "next/navigation";
import { getPost, listPosts } from "@/lib/mentionwell";
import { BlogShare } from "@/components/blog-share";

export const revalidate = 300;

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.codegrid.app";
const CTA_TEXT = "Download CodeGrid for macOS";
const CTA_URL = "https://www.codegrid.app/";

export async function generateStaticParams() {
  const posts = await listPosts(50);
  return posts.map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const post = await getPost(slug);
  if (!post) return {};
  const url = post.canonicalUrl ?? `${SITE_URL}/blog/${slug}`;
  return {
    title: post.metaTitle || post.title,
    description: post.metaDescription,
    alternates: { canonical: url },
    openGraph: {
      type: "article",
      title: post.metaTitle || post.title,
      description: post.metaDescription,
      url,
      images: post.featuredImage ? [post.featuredImage] : undefined,
      publishedTime: post.publishedAt ?? undefined,
      modifiedTime: post.updatedAt ?? undefined,
      authors: post.author?.name ? [post.author.name] : undefined,
    },
    twitter: {
      card: "summary_large_image",
      title: post.metaTitle || post.title,
      description: post.metaDescription,
      images: post.featuredImage ? [post.featuredImage] : undefined,
    },
  };
}

function formatDate(value: string | null): string {
  if (!value) return "";
  return new Date(value).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export default async function PostPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const post = await getPost(slug);
  if (!post) notFound();

  const related = (await listPosts(4)).filter((p) => p.slug !== slug).slice(0, 3);
  const shareUrl = post.canonicalUrl ?? `${SITE_URL}/blog/${slug}`;

  return (
    <main className="wb-fade-in">
      {post.jsonLd ? (
        <Script
          id={`ld-${slug}`}
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: post.jsonLd.replace(/^<script[^>]*>|<\/script>$/g, ""),
          }}
        />
      ) : null}

      <div className="max-w-3xl mx-auto px-4 sm:px-6 pt-10 pb-20">
        <nav aria-label="Breadcrumb" className="mb-8">
          <ol className="flex items-center gap-2 font-mono text-[11px] text-text-secondary">
            <li>
              <Link href="/" className="hover:text-accent transition-colors">
                Home
              </Link>
            </li>
            <li aria-hidden="true">/</li>
            <li>
              <Link href="/blog" className="hover:text-accent transition-colors">
                Blog
              </Link>
            </li>
            {post.category ? (
              <>
                <li aria-hidden="true">/</li>
                <li className="text-text-primary truncate">{post.category.title}</li>
              </>
            ) : null}
          </ol>
        </nav>

        <article
          className="wb-article-host"
          dangerouslySetInnerHTML={{ __html: post.html }}
        />

        <div className="mt-10 pt-6 border-t border-border flex flex-wrap items-center justify-between gap-4">
          <BlogShare url={shareUrl} title={post.title} />
          <span className="font-mono text-[11px] text-text-secondary">
            {post.readingTime} min read
            {post.publishedAt ? ` · ${formatDate(post.publishedAt)}` : ""}
          </span>
        </div>

        <aside className="mt-10 border border-border bg-bg-secondary p-6 sm:p-8 text-center">
          <p className="font-mono text-base font-bold text-text-primary mb-1">
            Run every agent on one canvas
          </p>
          <p className="text-sm text-text-secondary mb-5 max-w-md mx-auto">
            CodeGrid is a ~10&nbsp;MB native macOS workspace for Claude Code, Codex, Gemini,
            Cursor, and shells. Free, open source, local-first.
          </p>
          <a
            href={CTA_URL}
            className="inline-block bg-accent text-black font-bold px-5 py-2.5 font-mono text-sm hover:bg-accent-hover transition-colors"
          >
            {CTA_TEXT}
          </a>
        </aside>
      </div>

      {related.length > 0 ? (
        <section
          aria-label="Related posts"
          className="border-t border-border bg-bg-secondary"
        >
          <div className="max-w-6xl mx-auto px-4 sm:px-6 py-14">
            <h2 className="font-display text-base font-bold mb-6">Keep reading</h2>
            <div className="grid gap-6 sm:grid-cols-3">
              {related.map((p) => (
                <Link
                  key={p.slug}
                  href={`/blog/${p.slug}`}
                  prefetch
                  className="group flex flex-col border border-border bg-bg-primary hover:border-accent/60 transition-colors"
                >
                  <div className="relative aspect-[16/9] overflow-hidden bg-bg-tertiary border-b border-border">
                    {p.featuredImage ? (
                      <Image
                        src={p.featuredImage}
                        alt={p.title}
                        fill
                        sizes="(max-width: 640px) 100vw, 320px"
                        className="object-cover"
                      />
                    ) : (
                      <div className="dot-grid w-full h-full" aria-hidden="true" />
                    )}
                  </div>
                  <div className="p-4">
                    <strong className="block font-mono text-sm leading-snug group-hover:text-accent transition-colors">
                      {p.title}
                    </strong>
                    <p className="mt-2 text-xs text-text-secondary leading-relaxed line-clamp-2">
                      {p.excerpt}
                    </p>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        </section>
      ) : null}
    </main>
  );
}
