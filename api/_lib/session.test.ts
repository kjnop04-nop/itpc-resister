import { describe, expect, it } from "vitest";
import { createSessionToken, verifySessionToken } from "./server.mjs";

const staffId = "9a7b3b64-393e-4d15-9c44-12d999ee4258";
const secret = "test-secret-with-more-than-thirty-two-characters";

describe("staff session tokens", () => {
  it("verifies a signed, unexpired staff session", () => {
    const now = 1_800_000_000_000;
    const token = createSessionToken(staffId, secret, now);
    const [payload, signature] = token.split(".");
    const tampered = `${payload.slice(0, -1)}${payload.endsWith("a") ? "b" : "a"}.${signature}`;

    expect(verifySessionToken(token, secret, now)).toEqual({ id: staffId });
    expect(verifySessionToken(tampered, secret, now)).toBeNull();
  });

  it("rejects expired, modified, and malformed tokens", () => {
    const now = 1_800_000_000_000;
    const token = createSessionToken(staffId, secret, now);

    expect(verifySessionToken(token, secret, now + 8 * 60 * 60 * 1000)).toBeNull();
    expect(verifySessionToken(`${token}x`, secret, now)).toBeNull();
    expect(verifySessionToken("not-a-session", secret, now)).toBeNull();
  });
});
