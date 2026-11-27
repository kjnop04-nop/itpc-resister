import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { createSupabaseAccessToken, getStaffClient } from "./server.mjs";

const originalJwtSecret = process.env.SUPABASE_JWT_SECRET;
const originalSupabaseUrl = process.env.SUPABASE_URL;
const originalAnonKey = process.env.SUPABASE_ANON_KEY;

afterEach(() => {
  if (originalJwtSecret === undefined) {
    delete process.env.SUPABASE_JWT_SECRET;
  } else {
    process.env.SUPABASE_JWT_SECRET = originalJwtSecret;
  }
  if (originalSupabaseUrl === undefined) {
    delete process.env.SUPABASE_URL;
  } else {
    process.env.SUPABASE_URL = originalSupabaseUrl;
  }
  if (originalAnonKey === undefined) {
    delete process.env.SUPABASE_ANON_KEY;
  } else {
    process.env.SUPABASE_ANON_KEY = originalAnonKey;
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

  it("uses a signed staff token for Supabase requests", () => {
    process.env.SUPABASE_JWT_SECRET = "test-jwt-secret-that-is-at-least-32-chars";
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_ANON_KEY = "test-anon-key";

    const staff = { id: "dd6c94a7-6a5e-47e3-aada-ff672845941e" };
    const client = getStaffClient(staff);

    const authHeader = client.rest.headers.get?.("Authorization") ?? client.rest.headers.Authorization;
    expect(authHeader).toBe(
      `Bearer ${createSupabaseAccessToken(staff)}`,
    );
  });

  it("does not fall back to an anonymous client without a signing secret", () => {
    delete process.env.SUPABASE_JWT_SECRET;
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_ANON_KEY = "test-anon-key";

    expect(() => getStaffClient({ id: "dd6c94a7-6a5e-47e3-aada-ff672845941e" }))
      .toThrow("SUPABASE_JWT_SECRET must contain at least 32 characters");
  });
});
