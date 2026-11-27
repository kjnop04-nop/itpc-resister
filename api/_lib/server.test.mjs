import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { createSupabaseAccessToken } from "./server.mjs";

const originalJwtSecret = process.env.SUPABASE_JWT_SECRET;

afterEach(() => {
  if (originalJwtSecret === undefined) {
    delete process.env.SUPABASE_JWT_SECRET;
  } else {
    process.env.SUPABASE_JWT_SECRET = originalJwtSecret;
  }
});

describe("createSupabaseAccessToken", () => {
  it("creates a short-lived authenticated token for the staff account", () => {
    const secret = "test-jwt-secret-that-is-at-least-32-chars";
    process.env.SUPABASE_JWT_SECRET = secret;

    const token = createSupabaseAccessToken({
      id: "dd6c94a7-6a5e-47e3-aada-ff672845941e",
      email: "staff@example.com",
      display_name: "Test staff",
    });
    const [headerPart, payloadPart, signature] = token.split(".");
    const header = JSON.parse(Buffer.from(headerPart, "base64url").toString("utf8"));
    const payload = JSON.parse(Buffer.from(payloadPart, "base64url").toString("utf8"));
    const expectedSignature = createHmac("sha256", secret)
      .update(`${headerPart}.${payloadPart}`)
      .digest("base64url");

    expect(header).toEqual({ alg: "HS256", typ: "JWT" });
    expect(payload).toMatchObject({
      aud: "authenticated",
      sub: "dd6c94a7-6a5e-47e3-aada-ff672845941e",
      role: "authenticated",
      email: "staff@example.com",
      user_metadata: { display_name: "Test staff" },
    });
    expect(payload.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
    expect(payload.exp).toBeLessThanOrEqual(Math.floor(Date.now() / 1000) + 300);
    expect(signature).toBe(expectedSignature);
  });

  it("requires a configured signing secret", () => {
    delete process.env.SUPABASE_JWT_SECRET;
    expect(() => createSupabaseAccessToken({ id: "staff-id" })).toThrow(
      "SUPABASE_JWT_SECRET must contain at least 32 characters",
    );
  });
});
