import { revalidatePath, revalidateTag } from "next/cache";
import { createHmac, timingSafeEqual } from "node:crypto";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const raw = await req.text();
  const signature = req.headers.get("x-mentionwell-signature") ?? "";
  const isTestHeader = req.headers.get("x-mentionwell-test") === "1";
  const secret = process.env.MENTIONWELL_WEBHOOK_SECRET;

  if (!secret) {
    return new Response("Webhook is not configured", { status: 503 });
  }

  const expected = createHmac("sha256", secret)
    .update(raw)
    .digest("hex");
  const ok =
    expected.length === signature.length &&
    timingSafeEqual(Buffer.from(expected, "utf8"), Buffer.from(signature, "utf8"));
  if (!ok) return new Response("Unauthorized", { status: 401 });

  let payload: {
    event?: string;
    post?: { slug?: string };
    paths?: string[];
  };
  try {
    payload = JSON.parse(raw);
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

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
