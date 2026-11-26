import { describe, expect, it } from "vitest";
import register from "./register.mjs";

function createResponse() {
  return {
    statusCode: 0,
    headers: {} as Record<string, string>,
    body: "",
    setHeader(name: string, value: string) {
      this.headers[name] = value;
    },
    end(body: string) {
      this.body = body;
    },
  };
}

describe("staff registration endpoint", () => {
  it("rejects public account creation", async () => {
    const response = createResponse();

    await register({ method: "POST" }, response);

    expect(response.statusCode).toBe(410);
    expect(JSON.parse(response.body).error).toContain("ปิดการสมัครสมาชิก");
  });
});
