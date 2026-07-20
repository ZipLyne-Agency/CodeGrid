import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}));

import { POST } from "./route";

describe("MentionWell revalidation webhook", () => {
  afterEach(() => {
    delete process.env.MENTIONWELL_WEBHOOK_SECRET;
  });

  it("returns 503 when the signing secret is not configured", async () => {
    const response = await POST(
      new Request("https://codegrid.app/api/mentionwell-revalidate", {
        method: "POST",
        body: "{}",
      }),
    );

    expect(response.status).toBe(503);
  });

  it("returns 400 for a signed body that is not valid JSON", async () => {
    process.env.MENTIONWELL_WEBHOOK_SECRET = "test-secret";
    const { createHmac } = await import("node:crypto");
    const body = "not-json";
    const signature = createHmac("sha256", "test-secret").update(body).digest("hex");

    const response = await POST(
      new Request("https://codegrid.app/api/mentionwell-revalidate", {
        method: "POST",
        headers: { "x-mentionwell-signature": signature },
        body,
      }),
    );

    expect(response.status).toBe(400);
  });
});
