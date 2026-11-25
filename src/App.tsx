import { useEffect, useRef, useState, type FormEvent } from "react";
import { currentBangkokMinutes, isWithinSlot } from "./lib/schedule";
import { apiRequest, jsonBody } from "./lib/api";

type StaffSession = {
  id: string;
  email: string;
  display_name: string;
  role: "admin" | "staff";
};

type StaffAccount = {
  id: string;
  email: string;
  display_name: string;
  role: "admin" | "staff";
  status: "pending" | "active" | "rejected" | "suspended";
  created_at: string;
  last_login_at: string | null;
};

type Registration = {
  id: string;
  application_code: string;
  application_year: string;
  title: string;
  first_name: string;
  last_name: string;
  group_number: number;
  slot_text: string;
  slot_start: string;
  slot_end: string;
};

type ExistingCheckin = {
  checked_in_at: string;
  staff_label: string;
};

type CheckinRow = {
  checkin_id: string;
  registration_id: string;
  application_code: string;
  title: string;
  first_name: string;
  last_name: string;
  group_number: number;
  slot_text: string;
  checked_in_at: string;
  staff_label: string;
};

function normalizeCode(value: string) {
  return value.replace(/[^a-z0-9]/gi, "").toUpperCase();
}

function formatCheckinTime(value: string) {
  return new Intl.DateTimeFormat("th-TH", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Bangkok",
  }).format(new Date(value));
}

async function blobToBase64(blob: Blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

export default function App() {
  const [session, setSession] = useState<StaffSession | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [authNotice, setAuthNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [adminOpen, setAdminOpen] = useState(false);
  const [members, setMembers] = useState<StaffAccount[]>([]);
  const [adminLoading, setAdminLoading] = useState(false);
  const [adminBusyId, setAdminBusyId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [candidates, setCandidates] = useState<Registration[]>([]);
  const [searching, setSearching] = useState(false);
  const [checkinSearch, setCheckinSearch] = useState("");
  const [checkinRows, setCheckinRows] = useState<CheckinRow[]>([]);
  const [checkinsLoading, setCheckinsLoading] = useState(false);
  const [checkinsLoadingMore, setCheckinsLoadingMore] = useState(false);
  const [checkinsHasMore, setCheckinsHasMore] = useState(false);
  const [checkinsRefresh, setCheckinsRefresh] = useState(0);
  const [checkinBusyId, setCheckinBusyId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Registration | null>(null);
  const [checkin, setCheckin] = useState<ExistingCheckin | null>(null);
  const [checkinLoading, setCheckinLoading] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [photo, setPhoto] = useState<Blob | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [photoUrl, setPhotoUrl] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [clock, setClock] = useState(Date.now());
  const videoRef = useRef<HTMLVideoElement>(null);
  const captureCanvasRef = useRef<HTMLCanvasElement>(null);
  const checkinSearchRef = useRef(checkinSearch);

  useEffect(() => {
    if (!photo) {
      setPhotoUrl("");
      return;
    }

    const url = URL.createObjectURL(photo);
    setPhotoUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [photo]);

  useEffect(() => {
    let active = true;
    void apiRequest<{ session: StaffSession | null }>("/api/auth/session")
      .then(({ session: currentSession }) => {
        if (active) setSession(currentSession);
      })
      .catch((sessionError: Error) => {
        if (active) setError(sessionError.message);
      })
      .finally(() => {
        if (active) setAuthLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 15_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!session) return;
    const code = normalizeCode(query);
    if (code.length < 3) {
      setCandidates([]);
      setSearching(false);
      return;
    }

    let cancelled = false;
    setSearching(true);
    const timer = window.setTimeout(async () => {
      try {
        const { registrations } = await apiRequest<{ registrations: Registration[] }>(
          `/api/registrations?code=${encodeURIComponent(code)}`,
        );
        if (cancelled) return;
        setError("");
        setCandidates(registrations);
      } catch (searchError) {
        if (cancelled) return;
        setError(`ค้นหารหัสไม่สำเร็จ: ${searchError instanceof Error ? searchError.message : "เกิดข้อผิดพลาด"}`);
        setCandidates([]);
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 250);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query, session]);

  useEffect(() => {
    if (!session || adminOpen) return;
    let cancelled = false;
    setCheckinsLoading(true);
    setCheckinsLoadingMore(false);
    setCheckinRows([]);
    setCheckinsHasMore(false);

    const timer = window.setTimeout(async () => {
      try {
        const { checkins, has_more: hasMore } = await apiRequest<{
          checkins: CheckinRow[];
          has_more: boolean;
        }>(`/api/checkins?search=${encodeURIComponent(checkinSearch)}&offset=0`);
        if (cancelled) return;
        setCheckinRows(checkins);
        setCheckinsHasMore(hasMore);
      } catch (listError) {
        if (cancelled) return;
        setError(`โหลดรายการเช็กอินไม่สำเร็จ: ${listError instanceof Error ? listError.message : "เกิดข้อผิดพลาด"}`);
      } finally {
        if (!cancelled) setCheckinsLoading(false);
      }
    }, 200);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [session, adminOpen, checkinSearch, checkinsRefresh]);

  useEffect(() => {
    if (!cameraOpen) {
      stream?.getTracks().forEach((track) => track.stop());
      setStream(null);
      return;
    }

    let cancelled = false;
    let openedStream: MediaStream | null = null;

    async function openCamera() {
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error("อุปกรณ์นี้ไม่รองรับการเปิดกล้อง");
        }
        openedStream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: { ideal: "environment" } },
        });
        if (cancelled) {
          openedStream.getTracks().forEach((track) => track.stop());
          return;
        }
        setStream(openedStream);
        if (videoRef.current) {
          videoRef.current.srcObject = openedStream;
          await videoRef.current.play();
        }
      } catch (cameraError) {
        if (!cancelled) {
          setError(
            cameraError instanceof Error
              ? cameraError.message
              : "เปิดกล้องไม่สำเร็จ",
          );
          setCameraOpen(false);
        }
      }
    }

    void openCamera();
    return () => {
      cancelled = true;
      openedStream?.getTracks().forEach((track) => track.stop());
    };
  }, [cameraOpen]);

  async function submitAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setAuthNotice("");
    try {
      if (authMode === "register") {
        const { message } = await apiRequest<{ message: string }>("/api/auth/register", {
          method: "POST",
          body: jsonBody({
            email: email.trim(),
            display_name: displayName.trim(),
            password,
          }),
        });
        setPassword("");
        setAuthMode("login");
        setAuthNotice(message);
        return;
      }

      const { session: newSession } = await apiRequest<{ session: StaffSession }>(
        "/api/auth/login",
        {
          method: "POST",
          body: jsonBody({ email: email.trim(), password }),
        },
      );
      setSession(newSession);
      setPassword("");
    } catch (signInError) {
      setError(`${authMode === "register" ? "สมัครสมาชิก" : "เข้าสู่ระบบ"}ไม่สำเร็จ: ${signInError instanceof Error ? signInError.message : "เกิดข้อผิดพลาด"}`);
    } finally {
      setBusy(false);
    }
  }

  async function loadMembers() {
    setAdminLoading(true);
    setError("");
    try {
      const { members: nextMembers } = await apiRequest<{ members: StaffAccount[] }>(
        "/api/admin/members",
      );
      setMembers(nextMembers);
    } catch (memberError) {
      setError(`โหลดรายชื่อสมาชิกไม่สำเร็จ: ${memberError instanceof Error ? memberError.message : "เกิดข้อผิดพลาด"}`);
    } finally {
      setAdminLoading(false);
    }
  }

  async function loadMoreCheckins() {
    const search = checkinSearch;
    setCheckinsLoadingMore(true);
    try {
      const { checkins, has_more: hasMore } = await apiRequest<{
        checkins: CheckinRow[];
        has_more: boolean;
      }>(
        `/api/checkins?search=${encodeURIComponent(search)}&offset=${checkinRows.length}`,
      );
      if (checkinSearchRef.current !== search) return;
      setCheckinRows((current) => [...current, ...checkins]);
      setCheckinsHasMore(hasMore);
    } catch (listError) {
      setError(`โหลดรายการเช็กอินเพิ่มเติมไม่สำเร็จ: ${listError instanceof Error ? listError.message : "เกิดข้อผิดพลาด"}`);
    } finally {
      setCheckinsLoadingMore(false);
    }
  }

  async function undoCheckin(checkin: CheckinRow) {
    const reason = window.prompt(
      `ยกเลิกการเช็กอิน ${checkin.application_code} ใช่หรือไม่?\nโปรดระบุเหตุผล (อย่างน้อย 3 ตัวอักษร):`,
    );
    if (reason === null) return;
    if (reason.trim().length < 3) {
      setError("กรุณาระบุเหตุผลการยกเลิกอย่างน้อย 3 ตัวอักษร");
      return;
    }

    setCheckinBusyId(checkin.checkin_id);
    setError("");
    try {
      await apiRequest<{ success: boolean }>("/api/checkins", {
        method: "PATCH",
        body: jsonBody({ checkin_id: checkin.checkin_id, reason: reason.trim() }),
      });
      setNotice(`ยกเลิกเช็กอิน ${checkin.application_code} แล้ว`);
      setCheckinsRefresh((current) => current + 1);
      window.setTimeout(() => setNotice(""), 3000);
    } catch (undoError) {
      setError(`ยกเลิกเช็กอินไม่สำเร็จ: ${undoError instanceof Error ? undoError.message : "เกิดข้อผิดพลาด"}`);
    } finally {
      setCheckinBusyId(null);
    }
  }

  async function updateMember(
    member: StaffAccount,
    changes: Pick<StaffAccount, "role" | "status">,
  ) {
    setAdminBusyId(member.id);
    setError("");
    try {
      await apiRequest<{ success: boolean }>("/api/admin/members", {
        method: "PATCH",
        body: jsonBody({ id: member.id, ...changes }),
      });
      await loadMembers();
    } catch (memberError) {
      setError(`แก้ไขบัญชีไม่สำเร็จ: ${memberError instanceof Error ? memberError.message : "เกิดข้อผิดพลาด"}`);
    } finally {
      setAdminBusyId(null);
    }
  }

  async function deleteMember(member: StaffAccount) {
    if (!window.confirm(`ยืนยันลบบัญชี ${member.email}?`)) return;
    setAdminBusyId(member.id);
    setError("");
    try {
      await apiRequest<{ success: boolean }>(
        `/api/admin/members?id=${encodeURIComponent(member.id)}`,
        { method: "DELETE" },
      );
      await loadMembers();
    } catch (memberError) {
      setError(`ลบบัญชีไม่สำเร็จ: ${memberError instanceof Error ? memberError.message : "เกิดข้อผิดพลาด"}`);
    } finally {
      setAdminBusyId(null);
    }
  }

  async function chooseRegistration(registration: Registration) {
    setSelected(registration);
    setCheckin(null);
    setPhoto(null);
    setCameraOpen(false);
    setError("");
    setCheckinLoading(true);
    try {
      const { checkin: existingCheckin } = await apiRequest<{
        checkin: ExistingCheckin | null;
      }>(`/api/checkins?registration_id=${encodeURIComponent(registration.id)}`);
      setCheckin(existingCheckin);
    } catch (lookupError) {
      setError(`ตรวจสอบสถานะไม่สำเร็จ: ${lookupError instanceof Error ? lookupError.message : "เกิดข้อผิดพลาด"}`);
    } finally {
      setCheckinLoading(false);
    }
  }

  function capturePhoto() {
    const video = videoRef.current;
    const canvas = captureCanvasRef.current;
    if (!video || !canvas || !video.videoWidth || !video.videoHeight) {
      setError("กล้องยังไม่พร้อม กรุณารอสักครู่แล้วลองใหม่");
      return;
    }

    const scale = Math.min(1, 1280 / Math.max(video.videoWidth, video.videoHeight));
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    const context = canvas.getContext("2d");
    if (!context) {
      setError("เตรียมภาพไม่สำเร็จ");
      return;
    }
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(
      (captured) => {
        if (!captured) {
          setError("บันทึกภาพจากกล้องไม่สำเร็จ");
          return;
        }
        setPhoto(captured);
        setCameraOpen(false);
        setError("");
      },
      "image/jpeg",
      0.78,
    );
  }

  async function submitCheckin() {
    if (!session || !selected || !photo || checkin) return;
    setBusy(true);
    setError("");

    try {
      await apiRequest<{ checkin: ExistingCheckin }>("/api/checkins", {
        method: "POST",
        body: jsonBody({
          registration_id: selected.id,
          photo_base64: await blobToBase64(photo),
        }),
      });
      setNotice("เช็กอินแล้ว");
      setSelected(null);
      setCheckin(null);
      setPhoto(null);
      setCameraOpen(false);
      setQuery("");
      setCandidates([]);
      setCheckinsRefresh((current) => current + 1);
      window.setTimeout(() => setNotice(""), 2500);
    } catch (submitError) {
      const message = submitError instanceof Error ? submitError.message : "เกิดข้อผิดพลาด";
      if (message === "ผู้สมัครรายนี้เช็กอินไปแล้ว") {
        try {
          const { checkin: existingCheckin } = await apiRequest<{
            checkin: ExistingCheckin | null;
          }>(`/api/checkins?registration_id=${encodeURIComponent(selected.id)}`);
          setCheckin(existingCheckin);
          setPhoto(null);
        } catch (lookupError) {
          setError(`บันทึกไม่สำเร็จและตรวจสอบสถานะไม่ได้: ${lookupError instanceof Error ? lookupError.message : "เกิดข้อผิดพลาด"}`);
          return;
        }
      }
      setError(`บันทึกไม่สำเร็จ: ${message}`);
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    try {
      await apiRequest<{ success: boolean }>("/api/auth/logout", { method: "POST" });
      setSession(null);
      setSelected(null);
      setQuery("");
      setCandidates([]);
      setCheckin(null);
      setPhoto(null);
      setCameraOpen(false);
      setAdminOpen(false);
      setError("");
    } catch (signOutError) {
      setError(`ออกจากระบบไม่สำเร็จ: ${signOutError instanceof Error ? signOutError.message : "เกิดข้อผิดพลาด"}`);
    }
  }

  if (authLoading) {
    return <main className="screen"><div className="loading">กำลังเชื่อมต่อระบบ…</div></main>;
  }

  if (!session) {
    return (
      <main className="screen login-screen">
        <section className="card login-card">
          <div className="brand-mark" aria-hidden="true">✓</div>
          <p className="eyebrow">EVENT CHECK-IN</p>
          <h1>เช็กชื่อหน้างาน</h1>
          <p className="muted">
            {authMode === "login" ? "เข้าสู่ระบบสำหรับเจ้าหน้าที่" : "สมัครบัญชีเจ้าหน้าที่ใหม่"}
          </p>
          {authNotice && <div className="success-toast" role="status">{authNotice}</div>}
          <form onSubmit={submitAuth} className="login-form">
            {authMode === "register" && (
              <>
                <label htmlFor="display-name">ชื่อที่แสดง</label>
                <input
                  id="display-name"
                  autoComplete="name"
                  maxLength={100}
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                  required
                />
              </>
            )}
            <label htmlFor="email">อีเมลเจ้าหน้าที่</label>
            <input id="email" type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} required />
            <label htmlFor="password">รหัสผ่าน</label>
            <input
              id="password"
              type="password"
              autoComplete={authMode === "login" ? "current-password" : "new-password"}
              minLength={authMode === "register" ? 10 : undefined}
              maxLength={128}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
            {error && <p className="error-message" role="alert">{error}</p>}
            <button className="button button-primary full-width" type="submit" disabled={busy}>
              {busy
                ? (authMode === "login" ? "กำลังเข้าสู่ระบบ…" : "กำลังสมัครสมาชิก…")
                : (authMode === "login" ? "เข้าสู่ระบบ" : "สมัครสมาชิก")}
            </button>
            <button
              className="button button-quiet full-width"
              type="button"
              onClick={() => {
                setAuthMode(authMode === "login" ? "register" : "login");
                setPassword("");
                setError("");
                setAuthNotice("");
              }}
            >
              {authMode === "login" ? "ยังไม่มีบัญชี? สมัครสมาชิก" : "มีบัญชีแล้ว? เข้าสู่ระบบ"}
            </button>
          </form>
        </section>
      </main>
    );
  }

  const onTime = selected
    ? isWithinSlot(selected.slot_start, selected.slot_end, currentBangkokMinutes(new Date(clock)))
    : false;

  return (
    <main className="screen">
      <div className="app-shell">
        <header className="topbar">
          <div className="brand">
            <div className="brand-mark" aria-hidden="true">✓</div>
            <div>
              <p className="eyebrow">EVENT CHECK-IN</p>
              <h1>เช็กชื่อหน้างาน</h1>
            </div>
          </div>
          <div className="staff-menu">
            <span className="staff-email">{session.display_name || session.email}</span>
            {session.role === "admin" && (
              <button
                className="button button-quiet"
                onClick={() => {
                  const opening = !adminOpen;
                  setAdminOpen(opening);
                  setError("");
                  if (opening) void loadMembers();
                }}
              >
                {adminOpen ? "กลับหน้าเช็กชื่อ" : "จัดการสมาชิก"}
              </button>
            )}
            <button className="button button-quiet" onClick={() => void signOut()}>ออกจากระบบ</button>
          </div>
        </header>

        {notice && <div className="success-toast" role="status">✓ {notice}</div>}
        {error && <div className="error-banner" role="alert">{error}</div>}

        {adminOpen ? (
          <section className="card members-card">
            <div className="members-heading">
              <div>
                <h2>จัดการสมาชิก</h2>
                <p className="muted">บัญชีใหม่เปิดใช้งานได้ทันที สิทธิ์เริ่มต้นเป็นเจ้าหน้าที่</p>
              </div>
              <button className="button button-quiet" onClick={() => void loadMembers()} disabled={adminLoading}>
                {adminLoading ? "กำลังโหลด…" : "รีเฟรช"}
              </button>
            </div>
            {adminLoading ? (
              <div className="status status-pending">กำลังโหลดรายชื่อสมาชิก…</div>
            ) : members.length === 0 ? (
              <div className="not-found"><strong>ยังไม่มีสมาชิก</strong></div>
            ) : (
              <div className="member-list">
                {members.map((member) => (
                  <article className="member-row" key={member.id}>
                    <div className="member-details">
                      <strong>{member.display_name}</strong>
                      <span>{member.email}</span>
                      <span className="muted">
                        {member.role === "admin" ? "แอดมิน" : "เจ้าหน้าที่"} · {
                          {
                            pending: "รออนุมัติ",
                            active: "ใช้งานได้",
                            rejected: "ไม่อนุมัติ",
                            suspended: "ระงับ",
                          }[member.status]
                        }
                      </span>
                    </div>
                    <div className="member-actions">
                      {member.status === "pending" ? (
                        <>
                          <button
                            className="button button-primary"
                            onClick={() => void updateMember(member, { role: member.role, status: "active" })}
                            disabled={adminBusyId !== null}
                          >
                            อนุมัติ
                          </button>
                          <button
                            className="button button-quiet"
                            onClick={() => void updateMember(member, { role: member.role, status: "rejected" })}
                            disabled={adminBusyId !== null}
                          >
                            ปฏิเสธ
                          </button>
                        </>
                      ) : member.status === "active" ? (
                        <button
                          className="button button-quiet"
                          onClick={() => void updateMember(member, { role: member.role, status: "suspended" })}
                          disabled={adminBusyId !== null || member.id === session.id}
                        >
                          ระงับบัญชี
                        </button>
                      ) : (
                        <button
                          className="button button-primary"
                          onClick={() => void updateMember(member, { role: member.role, status: "active" })}
                          disabled={adminBusyId !== null}
                        >
                          เปิดใช้บัญชี
                        </button>
                      )}
                      <button
                        className="button button-quiet"
                        onClick={() => void updateMember(member, {
                          role: member.role === "admin" ? "staff" : "admin",
                          status: member.status,
                        })}
                        disabled={adminBusyId !== null || member.id === session.id}
                      >
                        {member.role === "admin" ? "ลดเป็นเจ้าหน้าที่" : "ตั้งเป็นแอดมิน"}
                      </button>
                      <button
                        className="button button-danger"
                        onClick={() => void deleteMember(member)}
                        disabled={adminBusyId !== null || member.id === session.id}
                      >
                        ลบบัญชี
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        ) : (
          <>
        <section className="card search-card">
          <div className="section-heading">
            <span className="step-number">1</span>
            <div>
              <h2>ค้นหารหัสผู้สมัคร</h2>
              <p className="muted">พิมพ์รหัสรับสมัคร เช่น 70KE032</p>
            </div>
          </div>
          <div className="search-control">
            <span className="search-icon" aria-hidden="true">⌕</span>
            <input
              aria-label="ค้นหาด้วยรหัสรับสมัคร"
              autoComplete="off"
              autoFocus
              placeholder="พิมพ์รหัสรับสมัคร"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setSelected(null);
                setCheckin(null);
                setPhoto(null);
                setCameraOpen(false);
                setError("");
              }}
            />
            {searching && <span className="searching-label">กำลังค้นหา…</span>}
          </div>
          {!selected && candidates.length > 0 && (
            <div className="candidate-list" aria-label="ผลการค้นหา">
              {candidates.map((candidate) => (
                <button className="candidate-row" key={candidate.id} onClick={() => void chooseRegistration(candidate)}>
                  <span className="candidate-code">{candidate.application_code}</span>
                  <span className="candidate-name">{candidate.title}{candidate.first_name} {candidate.last_name}</span>
                  <span className="candidate-group">กลุ่ม {candidate.group_number}</span>
                  <span className="candidate-arrow" aria-hidden="true">›</span>
                </button>
              ))}
            </div>
          )}
          {!selected && !searching && normalizeCode(query).length >= 3 && candidates.length === 0 && !error && (
            <div className="not-found"><span aria-hidden="true">○</span><strong>ไม่พบรหัสนี้ในระบบ</strong></div>
          )}
        </section>

        <section className="card checked-in-card">
          <div className="checked-in-heading">
            <div className="section-heading">
              <span className="step-number">✓</span>
              <div>
                <h2>ผู้สมัครที่เช็กอินแล้ว</h2>
                <p className="muted">ค้นหารายการและยกเลิกได้หากบันทึกผิด</p>
              </div>
            </div>
            <span className="checked-in-count">{checkinRows.length}{checkinsHasMore ? "+" : ""} รายการ</span>
          </div>
          <div className="search-control checked-in-search">
            <span className="search-icon" aria-hidden="true">⌕</span>
            <input
              aria-label="ค้นหารายการเช็กอินด้วยรหัสหรือชื่อ"
              autoComplete="off"
              placeholder="ค้นหาด้วยรหัสหรือชื่อผู้สมัคร"
              value={checkinSearch}
              onChange={(event) => {
                checkinSearchRef.current = event.target.value;
                setCheckinSearch(event.target.value);
              }}
            />
            {checkinsLoading && <span className="searching-label">กำลังค้นหา…</span>}
          </div>

          {!checkinsLoading && checkinRows.length === 0 ? (
            <div className="not-found checked-in-empty">
              <strong>{checkinSearch ? "ไม่พบรายการเช็กอิน" : "ยังไม่มีผู้สมัครเช็กอิน"}</strong>
            </div>
          ) : (
            <div className="checked-in-list">
              {checkinRows.map((row) => (
                <article className="checked-in-row" key={row.checkin_id}>
                  <div className="checked-in-person">
                    <strong className="candidate-code">{row.application_code}</strong>
                    <span className="checked-in-name">{row.title}{row.first_name} {row.last_name}</span>
                    <span className="candidate-group">กลุ่ม {row.group_number} · รอบ {row.slot_text}</span>
                    <span className="checked-in-meta">
                      {formatCheckinTime(row.checked_in_at)} · เช็กอินโดย {row.staff_label}
                    </span>
                  </div>
                  <button
                    className="button button-danger"
                    onClick={() => void undoCheckin(row)}
                    disabled={checkinBusyId !== null}
                  >
                    {checkinBusyId === row.checkin_id ? "กำลังยกเลิก…" : "ยกเลิกเช็กอิน"}
                  </button>
                </article>
              ))}
            </div>
          )}
          {checkinsHasMore && !checkinsLoading && (
            <button
              className="button button-quiet load-more-button"
              onClick={() => void loadMoreCheckins()}
              disabled={checkinsLoadingMore}
            >
              {checkinsLoadingMore ? "กำลังโหลด…" : "โหลดรายการเพิ่มเติม"}
            </button>
          )}
        </section>

        {selected && (
          <section className="card registration-card">
            <div className="section-heading">
              <span className="step-number">2</span>
              <div>
                <h2>ข้อมูลผู้สมัคร</h2>
                <p className="muted">ตรวจสอบข้อมูลก่อนเช็กอิน</p>
              </div>
            </div>

            <div className="registration-details">
              <div className="registration-code">{selected.application_code}</div>
              <div className="registration-name">{selected.title}{selected.first_name} {selected.last_name}</div>
              <div className="registration-session">
                กลุ่ม {selected.group_number}
                <span className="session-divider">|</span>
                รอบ {selected.slot_text}
              </div>
            </div>

            {checkinLoading ? (
              <div className="status status-pending">กำลังตรวจสอบสถานะ…</div>
            ) : checkin ? (
              <div className="status status-checked">
                <span className="status-icon" aria-hidden="true">✓</span>
                <div>
                  <strong>เช็กอินไปแล้ว</strong>
                  <span>เวลา {formatCheckinTime(checkin.checked_in_at)}</span>
                  <span>เจ้าหน้าที่ {checkin.staff_label}</span>
                </div>
              </div>
            ) : (
              <>
                <div className={`status ${onTime ? "status-ready" : "status-late"}`}>
                  <span className="status-icon" aria-hidden="true">{onTime ? "✓" : "!"}</span>
                  <div>
                    <strong>{onTime ? "มาถูกรอบ" : "มานอกรอบ"}</strong>
                    <span>{onTime ? "ยังไม่เช็กอิน สามารถดำเนินการต่อได้" : `รอบจริงคือ ${selected.slot_text} — แจ้งผู้ปกครองก่อนดำเนินการต่อ`}</span>
                  </div>
                </div>

                <div className="photo-section">
                  <div className="section-heading compact-heading">
                    <span className="step-number">3</span>
                    <div>
                      <h2>ถ่ายรูปคู่กับรหัส</h2>
                      <p className="muted">ให้ผู้ปกครองถือบัตรที่มีรหัสให้เห็นในภาพ</p>
                    </div>
                  </div>

                  {cameraOpen ? (
                    <div className="camera-panel">
                      <video ref={videoRef} className="camera-preview" playsInline muted aria-label="ภาพจากกล้องหลัง" />
                      <div className="camera-actions">
                        <button className="button button-quiet" onClick={() => setCameraOpen(false)}>ยกเลิก</button>
                        <button className="button button-primary" onClick={capturePhoto}>ถ่ายภาพ</button>
                      </div>
                    </div>
                  ) : photo ? (
                    <div className="photo-preview-wrap">
                      <img className="photo-preview" src={photoUrl} alt="ภาพถ่ายคู่กับรหัส" />
                      <div className="photo-actions">
                        <button className="button button-quiet" onClick={() => { setPhoto(null); setCameraOpen(true); }}>ถ่ายใหม่</button>
                        <button className="button button-primary" onClick={() => void submitCheckin()} disabled={busy}>
                          {busy ? "กำลังบันทึก…" : "บันทึกเช็กอิน"}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button className="camera-start" onClick={() => { setError(""); setCameraOpen(true); }}>
                      <span className="camera-symbol" aria-hidden="true">◎</span>
                      <span>เปิดกล้องถ่ายรูป</span>
                    </button>
                  )}
                  <canvas ref={captureCanvasRef} className="visually-hidden" />
                </div>
              </>
            )}

            <button className="back-button" onClick={() => { setSelected(null); setCheckin(null); setPhoto(null); setCameraOpen(false); }}>
              ← กลับไปผลการค้นหา
            </button>
          </section>
        )}
        {!selected && (
          <div className="waiting-hint">
            <span className="waiting-icon" aria-hidden="true">⌕</span>
            <p>ค้นหารหัสเพื่อเริ่มเช็กอินผู้สมัครคนถัดไป</p>
          </div>
        )}
          </>
        )}
      </div>
    </main>
  );
}
