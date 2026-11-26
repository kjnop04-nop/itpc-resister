import { randomUUID } from "node:crypto";
import {
  getAdminClient,
  MAX_PHOTO_BYTES,
  readJson,
  sendJson,
  validUuid,
  withAuthenticatedStaff,
} from "./_lib/server.mjs";

const PHOTO_BUCKET = "checkin-photos";

export default async function handler(request, response) {
  if (!["GET", "POST", "PATCH"].includes(request.method)) {
    sendJson(response, 405, { error: "Method not allowed" }, { Allow: "GET, POST, PATCH" });
    return;
  }

  await withAuthenticatedStaff(request, response, async (staff) => {
    const client = getAdminClient();
    if (request.method === "GET") {
      const params = new URL(request.url, "http://localhost").searchParams;
      const photoCheckinId = params.get("photo_checkin_id");
      if (photoCheckinId) {
        if (!validUuid(photoCheckinId)) {
          sendJson(response, 400, { error: "รายการลงทะเบียนไม่ถูกต้อง" });
          return;
        }
        const { data: checkin, error } = await client
          .from("checkins")
          .select("photo_path")
          .eq("id", photoCheckinId)
          .is("voided_at", null)
          .maybeSingle();
        if (error) throw error;
        if (!checkin) {
          sendJson(response, 404, { error: "ไม่พบรูปยืนยันการลงทะเบียนนี้" });
          return;
        }
        const { data: photo, error: photoError } = await client.storage
          .from(PHOTO_BUCKET)
          .createSignedUrl(checkin.photo_path, 300);
        if (photoError) throw photoError;
        sendJson(response, 200, { photo_url: photo.signedUrl });
        return;
      }

      const registrationId = params.get("registration_id");
      if (registrationId) {
        if (!validUuid(registrationId)) {
          sendJson(response, 400, { error: "รหัสผู้สมัครไม่ถูกต้อง" });
          return;
        }
        const { data, error } = await client
          .from("checkins")
          .select("checked_in_at, staff_label")
          .eq("registration_id", registrationId)
          .is("voided_at", null)
          .maybeSingle();
        if (error) throw error;
        sendJson(response, 200, { checkin: data });
        return;
      }

      const search = (params.get("search") || "").trim().slice(0, 100);
      const requestedOffset = Number(params.get("offset") || 0);
      if (!Number.isSafeInteger(requestedOffset) || requestedOffset < 0) {
        sendJson(response, 400, { error: "ตำแหน่งรายการไม่ถูกต้อง" });
        return;
      }
      const { data, error } = await client.rpc("list_active_checkins", {
        p_search: search,
        p_limit: 50,
        p_offset: requestedOffset,
      });
      if (error) throw error;
      sendJson(response, 200, {
        checkins: data,
        has_more: data.length === 50,
      });
      return;
    }

    let body;
    try {
      body = await readJson(request);
    } catch (error) {
      sendJson(response, 400, {
        error: error instanceof Error ? error.message : "ข้อมูลคำขอไม่ถูกต้อง",
      });
      return;
    }
    if (request.method === "PATCH") {
      if (!validUuid(body?.checkin_id)) {
        sendJson(response, 400, { error: "รายการลงทะเบียนไม่ถูกต้อง" });
        return;
      }
      if (
        typeof body?.reason !== "string" ||
        body.reason.trim().length < 3 ||
        body.reason.trim().length > 300
      ) {
        sendJson(response, 400, { error: "กรุณาระบุเหตุผลอย่างน้อย 3 ตัวอักษร" });
        return;
      }
      const { data, error } = await client.rpc("void_checkin", {
        p_actor_id: staff.id,
        p_checkin_id: body.checkin_id,
        p_reason: body.reason.trim(),
      });
      if (error?.code === "22023") {
        sendJson(response, 400, { error: "กรุณาระบุเหตุผลอย่างน้อย 3 ตัวอักษร" });
        return;
      }
      if (error) throw error;
      if (!data) {
        sendJson(response, 409, { error: "รายการนี้ถูกยกเลิกไปแล้วหรือไม่พบรายการ" });
        return;
      }
      sendJson(response, 200, { success: true });
      return;
    }

    const registrationId = body?.registration_id;
    const photoBase64 = body?.photo_base64;
    if (!validUuid(registrationId) || typeof photoBase64 !== "string") {
      sendJson(response, 400, { error: "ข้อมูลการลงทะเบียนไม่ครบถ้วน" });
      return;
    }
    if (
      photoBase64.length > Math.ceil(MAX_PHOTO_BYTES * 4 / 3) + 4 ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(photoBase64)
    ) {
      sendJson(response, 413, { error: "ไฟล์ภาพมีขนาดใหญ่หรือรูปแบบไม่ถูกต้อง (สูงสุด 3 MB)" });
      return;
    }

    const photo = Buffer.from(photoBase64, "base64");
    if (
      photo.length === 0 ||
      photo.length > MAX_PHOTO_BYTES ||
      photo.toString("base64") !== photoBase64
    ) {
      sendJson(response, 413, { error: "ไฟล์ภาพมีขนาดใหญ่หรือรูปแบบไม่ถูกต้อง (สูงสุด 3 MB)" });
      return;
    }

    const path = `${staff.id}/${registrationId}/${randomUUID()}.jpg`;
    const { error: uploadError } = await client.storage
      .from(PHOTO_BUCKET)
      .upload(path, photo, { contentType: "image/jpeg", cacheControl: "3600", upsert: false });
    if (uploadError) throw uploadError;

    const { error: insertError } = await client.from("checkins").insert({
      registration_id: registrationId,
      checked_in_by: staff.id,
      staff_label: staff.display_name,
      photo_path: path,
    });
    if (insertError) {
      const { error: cleanupError } = await client.storage.from(PHOTO_BUCKET).remove([path]);
      if (cleanupError) {
        console.error("Could not remove a photo after failed check-in:", cleanupError);
      }
      if (insertError.code === "23505") {
        sendJson(response, 409, { error: "ผู้สมัครรายนี้ลงทะเบียนแล้ว" });
        return;
      }
      throw insertError;
    }

    const { data, error: lookupError } = await client
      .from("checkins")
      .select("checked_in_at, staff_label")
      .eq("registration_id", registrationId)
      .is("voided_at", null)
      .single();
    if (lookupError) throw lookupError;
    sendJson(response, 201, { checkin: data });
  });
}
