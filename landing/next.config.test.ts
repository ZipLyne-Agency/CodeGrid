import { describe, expect, it } from "vitest";

import nextConfig from "./next.config";

describe("site security headers", () => {
  it("prevents third-party framing", async () => {
    const rules = await nextConfig.headers?.();
    expect(rules).toBeDefined();

    const headers = rules?.[0]?.headers ?? [];
    expect(headers).toContainEqual({
      key: "Content-Security-Policy",
      value: "frame-ancestors 'none'",
    });
    expect(headers).toContainEqual({ key: "X-Frame-Options", value: "DENY" });
  });
});
