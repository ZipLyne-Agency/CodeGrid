import { revalidatePath, revalidateTag } from "next/cache";
import { createHmac, timingSafeEqual } from "node:crypto";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const raw = await req.text();
  const signature = req.headers.get("x-mentionwell-signature") ?? "";
  const isTestHeader = req.headers.get("x-mentionwell-test") === "1";

  const expected = createHmac("sha256", process.env.MENTIONWELL_WEBHOOK_SECRET!)
    .update(raw)
    .digest("hex");
  const ok =
    expected.length === signature.length &&
    timingSafeEqual(Buffer.from(expected, "utf8"), Buffer.from(signature, "utf8"));
  if (!ok) return new Response("Unauthorized", { status: 401 });

  const payload = JSON.parse(raw) as {
    event?: string;
    post?: { slug?: string };
    paths?: string[];
  };

  if (isTestHeader || payload.event === "post.test") {
    return Response.json({ ok: true, test: true });
  }

  revalidateTag("mentionwell:posts", "max");
  revalidatePath("/blog");
  if (payload.post?.slug) revalidatePath(`/blog/${payload.post.slug}`);
  if (Array.isArray(payload.paths)) {
    for (const p of payload.paths) {
      if (typeof p === "string" && p.startsWith("/")) revalidatePath(p);
    }
  }
  return Response.json({ ok: true });
}
