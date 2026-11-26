import { createHmac, timingSafeEqual } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

export const SESSION_COOKIE = "event_staff_session";
export const MAX_PHOTO_BYTES = 3 * 1024 * 1024;
const SESSION_TTL_SECONDS = 8 * 60 * 60;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function sendJson(response, status, body, headers = {}) {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  for (const [name, value] of Object.entries(headers)) response.setHeader(name, value);
  response.end(JSON.stringify(body));
}

export function readJson(request) {
  if (request.body !== undefined) {
    if (typeof request.body === "string") return JSON.parse(request.body);
    return request.body;
  }

  return new Promise((resolve, reject) => {
    let body = "";
    let size = 0;
    let oversized = false;
    request.on("data", (chunk) => {
      if (oversized) return;
      size += chunk.length;
      if (size > MAX_PHOTO_BYTES * 2) {
        oversized = true;
        reject(new Error("Request body is too large"));
        request.resume();
        return;
      }
      body += chunk.toString();
    });
    request.on("end", () => {
      if (oversized) return;
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error("Request body must be valid JSON"));
      }
    });
    request.on("error", reject);
  });
}

export function getAdminClient() {
  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be configured");
  }
  return createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function signPayload(payload, secret) {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function createSessionToken(staffId, secret, now = Date.now()) {
  const payload = Buffer.from(
    JSON.stringify({ sub: staffId, exp: Math.floor(now / 1000) + SESSION_TTL_SECONDS }),
  ).toString("base64url");
  return `${payload}.${signPayload(payload, secret)}`;
}

export function verifySessionToken(token, secret, now = Date.now()) {
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra) return null;

  const expected = signPayload(payload, secret);
  const actualBytes = Buffer.from(signature);
  const expectedBytes = Buffer.from(expected);
  if (
    actualBytes.length !== expectedBytes.length ||
    !timingSafeEqual(actualBytes, expectedBytes)
  ) return null;

  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (
      typeof data.sub !== "string" ||
      !UUID_PATTERN.test(data.sub) ||
      !Number.isInteger(data.exp) ||
      data.exp <= Math.floor(now / 1000)
    ) return null;
    return { id: data.sub };
  } catch {
    return null;
  }
}

function readCookie(request, name) {
  const cookieHeader = request.headers.cookie;
  if (!cookieHeader) return null;
  const cookie = cookieHeader.split(";").map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`));
  if (!cookie) return null;
  try {
    return decodeURIComponent(cookie.slice(name.length + 1));
  } catch {
    return null;
  }
}

function secureCookie(request) {
  return process.env.NODE_ENV === "production" ||
    request.headers["x-forwarded-proto"] === "https";
}

export function sessionCookie(request, token) {
  return [
    `${SESSION_COOKIE}=${token}`,
    "Path=/",
    `Max-Age=${SESSION_TTL_SECONDS}`,
    "HttpOnly",
    "SameSite=Strict",
    ...(secureCookie(request) ? ["Secure"] : []),
  ].join("; ");
}

export function clearSessionCookie(request) {
  return [
    `${SESSION_COOKIE}=`,
    "Path=/",
    "Max-Age=0",
    "HttpOnly",
    "SameSite=Strict",
    ...(secureCookie(request) ? ["Secure"] : []),
  ].join("; ");
}

export async function authenticatedStaff(request) {
  const token = readCookie(request, SESSION_COOKIE);
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("SESSION_SECRET must contain at least 32 characters");
  }
  if (!token) return null;
  const session = verifySessionToken(token, secret);
  if (!session) return null;

  const { data, error } = await getAdminClient()
    .from("staff_accounts")
    .select("id, email, display_name, role, status")
    .eq("id", session.id)
    .eq("status", "active")
    .maybeSingle();
  if (error) throw error;
  return data;
}

function apiFailureMessage(error) {
  const code = error && typeof error === "object" && "code" in error
    ? error.code
    : undefined;

  if (code === "PGRST202") {
    return "ฐานข้อมูลยังไม่มีฟังก์ชัน API ที่ต้องใช้ กรุณารัน migrations ล่าสุดตาม README.md";
  }
  if (code === "PGRST205" || code === "42P01") {
    return "ไม่พบตารางข้อมูลใน Supabase กรุณาตรวจ migrations และการนำเข้ารายชื่อผู้สมัคร";
  }
  if (code === "PGRST204" || code === "42703") {
    return "โครงสร้างตาราง Supabase ยังไม่ตรงกับแอป กรุณารัน migrations ล่าสุด";
  }
  if (code === "42501") {
    return "Supabase ปฏิเสธสิทธิ์เข้าถึง กรุณาตรวจสอบ service-role key และสิทธิ์ฐานข้อมูล";
  }
  if (process.env.NODE_ENV !== "production" && error instanceof Error) {
    return `เกิดข้อผิดพลาดในการเชื่อมต่อระบบ: ${error.message}`;
  }
  return "เกิดข้อผิดพลาดในการเชื่อมต่อระบบ";
}

export function sendApiFailure(response, error, context) {
  console.error(`${context}:`, error);
  sendJson(response, 500, { error: apiFailureMessage(error) });
}

export async function withAuthenticatedStaff(request, response, action) {
  try {
    const staff = await authenticatedStaff(request);
    if (!staff) {
      sendJson(response, 401, { error: "กรุณาเข้าสู่ระบบใหม่" });
      return;
    }
    await action(staff);
  } catch (error) {
    sendApiFailure(response, error, "Authenticated API request failed");
  }
}

export function validUuid(value) {
  return typeof value === "string" && UUID_PATTERN.test(value);
}
