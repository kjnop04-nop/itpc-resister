import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { currentBangkokMinutes, DEFAULT_SCHEDULE, getGroupSchedule, isWithinSlot, type ScheduleRound } from "./lib/schedule";
import { apiRequest, jsonBody } from "./lib/api";
import { parseStudentCsv, type StudentImportRow } from "./lib/studentCsv";
import { formatAcademicYear } from "./lib/academicYear";

type StaffSession = {
  id: string;
  email: string | null;
  display_name: string;
  role: "superadmin" | "admin" | "staff";
};

type StaffAccount = {
  id: string;
  login_id: string;
  email: string | null;
  display_name: string;
  role: "superadmin" | "admin" | "staff";
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
  checked_in?: boolean;
};

type ExistingCheckin = {
  id: string;
  checked_in_at: string;
  staff_label: string;
  note: string | null;
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
  note: string | null;
};

type CheckinPhoto = {
  url: string;
  row: CheckinRow;
};

type GroupCheckinSummary = {
  total: number;
  checked_in: number;
};

type DashboardGroupSummary = GroupCheckinSummary & {
  group_number: number;
};

type DashboardSummary = GroupCheckinSummary & {
  groups: DashboardGroupSummary[];
};

type AcademicYearSetting = {
  application_year: string;
  is_active: boolean;
  schedule: ScheduleRound[];
};

type DashboardPage = "overview" | "checkin" | "group" | "applicant" | "checked-in";

const GROUP_COUNT = 30;
const GROUPS_PER_ROUND = 6;
const ROUND_COUNT = GROUP_COUNT / GROUPS_PER_ROUND;
const GROUP_NUMBERS = Array.from({ length: GROUP_COUNT }, (_, index) => index + 1);

const SYSTEM_NAME_PREFIX = "ระบบลงทะเบียนเพื่อคัดเลือกนักเรียนระดับอนุบาล";

function SystemTitle({ applicationYear }: { applicationYear: string }) {
  return (
    <>
      {SYSTEM_NAME_PREFIX}{" "}
      {applicationYear && (
        <span className="system-title-year">
          ปีการศึกษา {formatAcademicYear(applicationYear)}
        </span>
      )}
    </>
  );
}

type IconName = "school" | "search" | "check" | "chevron-right" | "camera" | "alert" | "arrow-left";

function Icon({ name, className }: { name: IconName; className?: string }) {
  return (
    <svg
      className={className}
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {name === "school" && (
        <>
          <path d="m2 9 10-5 10 5-10 5L2 9Z" />
          <path d="M6 11v5c3.4 2.7 8.6 2.7 12 0v-5" />
          <path d="M22 9v6" />
        </>
      )}
      {name === "search" && (
        <>
          <circle cx="10.8" cy="10.8" r="6.8" />
          <path d="m16 16 4.5 4.5" />
        </>
      )}
      {name === "check" && <path d="m5 12 4 4L19 6" />}
      {name === "chevron-right" && <path d="m9 18 6-6-6-6" />}
      {name === "camera" && (
        <>
          <path d="M14 5h-4L8 8H5a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-3l-2-3Z" />
          <circle cx="12" cy="13" r="3" />
        </>
      )}
      {name === "alert" && (
        <>
          <path d="M10.3 4.3 2.2 18.2A1.8 1.8 0 0 0 3.8 21h16.4a1.8 1.8 0 0 0 1.6-2.8L13.7 4.3a2 2 0 0 0-3.4 0Z" />
          <path d="M12 9v4" />
          <path d="M12 17h.01" />
        </>
      )}
      {name === "arrow-left" && (
        <>
          <path d="m12 19-7-7 7-7" />
          <path d="M19 12H5" />
        </>
      )}
    </svg>
  );
}

function groupNumberFromHash(): number | null {
  const match = window.location.hash.match(/^#group-(\d+)$/);
  if (!match) return null;
  const groupNumber = Number(match[1]);
  return Number.isInteger(groupNumber) && groupNumber >= 1 && groupNumber <= GROUP_COUNT
    ? groupNumber
    : null;
}

function dashboardPageFromHash(): DashboardPage {
  if (window.location.hash === "#checked-in") return "checked-in";
  if (window.location.hash === "#applicant") return "applicant";
  if (window.location.hash === "#checkin") return "checkin";
  if (groupNumberFromHash() !== null) return "group";
  return "overview";
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
  const [loginId, setLoginId] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [adminOpen, setAdminOpen] = useState(false);
  const [studentDataOpen, setStudentDataOpen] = useState(false);
  const [yearSettingsOpen, setYearSettingsOpen] = useState(false);
  const [studentDataBusy, setStudentDataBusy] = useState<"import" | "export" | null>(null);
  const [academicYears, setAcademicYears] = useState<AcademicYearSetting[]>([]);
  const [academicYearsLoading, setAcademicYearsLoading] = useState(false);
  const [activeAcademicYear, setActiveAcademicYear] = useState("");
  const [selectedAcademicYear, setSelectedAcademicYear] = useState("");
  const [newAcademicYear, setNewAcademicYear] = useState("");
  const [scheduleDraft, setScheduleDraft] = useState<ScheduleRound[]>(
    DEFAULT_SCHEDULE.map((round) => ({ ...round })),
  );
  const [academicYearBusy, setAcademicYearBusy] = useState(false);
  const [members, setMembers] = useState<StaffAccount[]>([]);
  const [adminLoading, setAdminLoading] = useState(false);
  const [adminBusyId, setAdminBusyId] = useState<string | null>(null);
  const [newMemberName, setNewMemberName] = useState("");
  const [newMemberId, setNewMemberId] = useState("");
  const [newMemberEmail, setNewMemberEmail] = useState("");
  const [newMemberPassword, setNewMemberPassword] = useState("");
  const [newMemberRole, setNewMemberRole] = useState<"admin" | "staff">("staff");
  const [dashboardPage, setDashboardPage] = useState<DashboardPage>(dashboardPageFromHash);
  const [dashboardSummary, setDashboardSummary] = useState<DashboardSummary | null>(null);
  const [dashboardLoading, setDashboardLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [candidates, setCandidates] = useState<Registration[]>([]);
  const [searching, setSearching] = useState(false);
  const [browseApplicants, setBrowseApplicants] = useState<Registration[]>([]);
  const [selectedGroup, setSelectedGroup] = useState<number | null>(groupNumberFromHash);
  const [groupReturnPage, setGroupReturnPage] = useState<"overview" | "checkin">("overview");
  const [applicantReturnPage, setApplicantReturnPage] = useState<"group" | "checkin">("checkin");
  const [groupCheckinSummary, setGroupCheckinSummary] = useState<GroupCheckinSummary | null>(null);
  const [applicantsLoading, setApplicantsLoading] = useState(false);
  const [applicantsLoadingMore, setApplicantsLoadingMore] = useState(false);
  const [applicantsHasMore, setApplicantsHasMore] = useState(false);
  const [checkinSearch, setCheckinSearch] = useState("");
  const [checkinRows, setCheckinRows] = useState<CheckinRow[]>([]);
  const [checkinsLoading, setCheckinsLoading] = useState(false);
  const [checkinsLoadingMore, setCheckinsLoadingMore] = useState(false);
  const [checkinsHasMore, setCheckinsHasMore] = useState(false);
  const [checkinsRefresh, setCheckinsRefresh] = useState(0);
  const [checkinBusyId, setCheckinBusyId] = useState<string | null>(null);
  const [checkinPhotoLoadingId, setCheckinPhotoLoadingId] = useState<string | null>(null);
  const [checkinPhoto, setCheckinPhoto] = useState<CheckinPhoto | null>(null);
  const [selected, setSelected] = useState<Registration | null>(null);
  const [checkin, setCheckin] = useState<ExistingCheckin | null>(null);
  const [checkinLoading, setCheckinLoading] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [photo, setPhoto] = useState<Blob | null>(null);
  const [checkinNote, setCheckinNote] = useState("");
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [photoUrl, setPhotoUrl] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [clock, setClock] = useState(Date.now());
  const videoRef = useRef<HTMLVideoElement>(null);
  const captureCanvasRef = useRef<HTMLCanvasElement>(null);
  const cameraPanelRef = useRef<HTMLDivElement>(null);
  const checkinSearchRef = useRef(checkinSearch);
  const selectedGroupRef = useRef(selectedGroup);
  const studentFileRef = useRef<HTMLInputElement>(null);

  const selectedAcademicYearSettings = academicYears.find(
    ({ application_year }) => application_year === selectedAcademicYear,
  );
  const selectedYearSchedule = selectedAcademicYearSettings?.schedule || DEFAULT_SCHEDULE;
  const isActiveAcademicYear = selectedAcademicYear === activeAcademicYear;

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
        if (active) setError(`เชื่อมต่อระบบไม่สำเร็จ: ${sessionError.message}`);
      })
      .finally(() => {
        if (active) setAuthLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    setAcademicYearsLoading(true);
    void apiRequest<{
      years: AcademicYearSetting[];
      active_year: string;
    }>("/api/academic-years")
      .then(({ years, active_year: activeYear }) => {
        if (cancelled) return;
        setAcademicYears(years);
        setActiveAcademicYear(activeYear);
        setSelectedAcademicYear((current) =>
          years.some(({ application_year }) => application_year === current)
            ? current
            : activeYear,
        );
        setNewAcademicYear(String(Number(activeYear) + 1));
      })
      .catch((yearError) => {
        if (!cancelled) {
          setError(`โหลดปีการศึกษาไม่สำเร็จ: ${yearError instanceof Error ? yearError.message : "เกิดข้อผิดพลาด"}`);
        }
      })
      .finally(() => {
        if (!cancelled) setAcademicYearsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [session]);

  useEffect(() => {
    if (!selectedAcademicYearSettings) return;
    setScheduleDraft(selectedAcademicYearSettings.schedule.map((round) => ({ ...round })));
  }, [selectedAcademicYear, selectedAcademicYearSettings]);

  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 15_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const syncPage = () => {
      const page = dashboardPageFromHash();
      setDashboardPage(page);
      if (page === "group") {
        const groupNumber = groupNumberFromHash();
        if (groupNumber !== null) {
          selectedGroupRef.current = groupNumber;
          setSelectedGroup(groupNumber);
        }
      }
    };
    if (!window.location.hash) {
      window.history.replaceState(
        null,
        "",
        `${window.location.pathname}${window.location.search}#overview`,
      );
    }
    window.addEventListener("hashchange", syncPage);
    return () => window.removeEventListener("hashchange", syncPage);
  }, []);

  useEffect(() => {
    if (dashboardPage !== "applicant" || selected) return;
    setDashboardPage("checkin");
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${window.location.search}#checkin`,
    );
  }, [dashboardPage, selected]);

  useEffect(() => {
    if (!session || !selectedAcademicYear || dashboardPage !== "checkin") {
      setSearching(false);
      return;
    }
    const searchTerm = query.trim();
    if (!searchTerm) {
      setCandidates([]);
      setSearching(false);
      return;
    }

    let cancelled = false;
    setSearching(true);
    const timer = window.setTimeout(async () => {
      try {
        const { registrations } = await apiRequest<{ registrations: Registration[] }>(
          `/api/registrations?q=${encodeURIComponent(searchTerm)}&application_year=${selectedAcademicYear}`,
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
  }, [query, session, dashboardPage, selectedAcademicYear, checkinsRefresh]);

  useEffect(() => {
    if (
      !session ||
      !selectedAcademicYear ||
      adminOpen ||
      dashboardPage !== "group" ||
      selectedGroup === null
    ) {
      setApplicantsLoading(false);
      return;
    }

    let cancelled = false;
    setApplicantsLoading(true);
    setGroupCheckinSummary(null);
    setError("");

    void apiRequest<{
      registrations: Registration[];
      has_more: boolean;
      checkin_summary: GroupCheckinSummary;
    }>(`/api/registrations?group_number=${selectedGroup}&offset=0&application_year=${selectedAcademicYear}`)
      .then(({ registrations, has_more: hasMore, checkin_summary: summary }) => {
        if (cancelled) return;
        setBrowseApplicants(registrations);
        setApplicantsHasMore(hasMore);
        setGroupCheckinSummary(summary);
      })
      .catch((listError) => {
        if (cancelled) return;
        setBrowseApplicants([]);
        setError(`โหลดรายชื่อผู้สมัครไม่สำเร็จ: ${listError instanceof Error ? listError.message : "เกิดข้อผิดพลาด"}`);
      })
      .finally(() => {
        if (!cancelled) setApplicantsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [session, adminOpen, dashboardPage, selectedGroup, selectedAcademicYear, checkinsRefresh]);

  useEffect(() => {
    if (!session || !selectedAcademicYear || adminOpen || dashboardPage !== "checked-in") return;
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
        }>(`/api/checkins?search=${encodeURIComponent(checkinSearch)}&offset=0&application_year=${selectedAcademicYear}`);
        if (cancelled) return;
        setCheckinRows(checkins);
        setCheckinsHasMore(hasMore);
      } catch (listError) {
        if (cancelled) return;
        setError(`โหลดรายการลงทะเบียนไม่สำเร็จ: ${listError instanceof Error ? listError.message : "เกิดข้อผิดพลาด"}`);
      } finally {
        if (!cancelled) setCheckinsLoading(false);
      }
    }, 200);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [session, adminOpen, dashboardPage, checkinSearch, selectedAcademicYear, checkinsRefresh]);

  useEffect(() => {
    if (!session || !selectedAcademicYear || adminOpen || dashboardPage !== "overview") return;

    let cancelled = false;
    setDashboardLoading(true);
    setDashboardSummary(null);
    setError("");

    void apiRequest<{ summary: DashboardSummary }>(
      `/api/dashboard?application_year=${selectedAcademicYear}`,
    )
      .then(({ summary }) => {
        if (!cancelled) setDashboardSummary(summary);
      })
      .catch((summaryError) => {
        if (cancelled) return;
        setError(`โหลดภาพรวมไม่สำเร็จ: ${summaryError instanceof Error ? summaryError.message : "เกิดข้อผิดพลาด"}`);
      })
      .finally(() => {
        if (!cancelled) setDashboardLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [session, adminOpen, dashboardPage, selectedAcademicYear, checkinsRefresh]);

  useEffect(() => {
    if (!cameraOpen) {
      stream?.getTracks().forEach((track) => track.stop());
      setStream(null);
      return;
    }

    let cancelled = false;
    let openedStream: MediaStream | null = null;
    const scrollFrame = window.requestAnimationFrame(() => {
      cameraPanelRef.current?.scrollIntoView({
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "auto"
          : "smooth",
        block: "center",
      });
    });

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
      window.cancelAnimationFrame(scrollFrame);
      openedStream?.getTracks().forEach((track) => track.stop());
    };
  }, [cameraOpen]);

  async function submitAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const { session: newSession } = await apiRequest<{ session: StaffSession }>(
        "/api/auth/login",
        {
          method: "POST",
          body: jsonBody({ login_id: loginId.trim(), password }),
        },
      );
      setSession(newSession);
      setPassword("");
    } catch (signInError) {
      setError(`เข้าสู่ระบบไม่สำเร็จ: ${signInError instanceof Error ? signInError.message : "เกิดข้อผิดพลาด"}`);
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
      setError(`โหลดรายชื่อบัญชีไม่สำเร็จ: ${memberError instanceof Error ? memberError.message : "เกิดข้อผิดพลาด"}`);
    } finally {
      setAdminLoading(false);
    }
  }

  async function createMember(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAdminBusyId("create");
    setError("");
    setNotice("");
    const role = newMemberRole;
    try {
      await apiRequest<{ success: boolean }>("/api/admin/members", {
        method: "POST",
        body: jsonBody({
          login_id: newMemberId.trim(),
          email: newMemberEmail.trim(),
          display_name: newMemberName.trim(),
          password: newMemberPassword,
          role,
        }),
      });
      setNewMemberName("");
      setNewMemberId("");
      setNewMemberEmail("");
      setNewMemberPassword("");
      setNewMemberRole("staff");
      setNotice(`เพิ่มบัญชี${role === "admin" ? "แอดมิน" : "เจ้าหน้าที่"}แล้ว`);
      await loadMembers();
    } catch (memberError) {
      setError(`เพิ่มบัญชีไม่สำเร็จ: ${memberError instanceof Error ? memberError.message : "เกิดข้อผิดพลาด"}`);
    } finally {
      setAdminBusyId(null);
    }
  }

  async function reloadAcademicYears(preferredYear?: string) {
    const { years, active_year: activeYear } = await apiRequest<{
      years: AcademicYearSetting[];
      active_year: string;
    }>("/api/academic-years");
    setAcademicYears(years);
    setActiveAcademicYear(activeYear);
    const nextYear = preferredYear && years.some(({ application_year }) => application_year === preferredYear)
      ? preferredYear
      : years.some(({ application_year }) => application_year === selectedAcademicYear)
        ? selectedAcademicYear
        : activeYear;
    setSelectedAcademicYear(nextYear);
    setNewAcademicYear(String(Number(activeYear) + 1));
  }

  async function saveAcademicYearSettings(
    applicationYear: string,
    schedule: ScheduleRound[],
    activate: boolean,
  ) {
    setAcademicYearBusy(true);
    setError("");
    setNotice("");
    try {
      await apiRequest<{ success: boolean }>("/api/academic-years", {
        method: "PUT",
        body: jsonBody({
          application_year: applicationYear,
          schedule,
          activate,
        }),
      });
      await reloadAcademicYears(applicationYear);
      setCheckinsRefresh((current) => current + 1);
      setNotice(
        activate
          ? `ตั้งปีการศึกษา พ.ศ. ${formatAcademicYear(applicationYear)} เป็นปีที่ใช้งานแล้ว`
          : `บันทึกตารางเวลาปีการศึกษา พ.ศ. ${formatAcademicYear(applicationYear)} แล้ว`,
      );
    } catch (settingsError) {
      setError(`บันทึกการตั้งค่าปีการศึกษาไม่สำเร็จ: ${settingsError instanceof Error ? settingsError.message : "เกิดข้อผิดพลาด"}`);
    } finally {
      setAcademicYearBusy(false);
    }
  }

  async function createAcademicYear() {
    const applicationYear = newAcademicYear.trim();
    if (!/^[1-9]\d{3}$/.test(applicationYear)) {
      setError("กรุณากรอกปีการศึกษาเป็น ค.ศ. 4 หลัก");
      return;
    }
    if (academicYears.some(({ application_year }) => application_year === applicationYear)) {
      setError("ปีการศึกษานี้มีอยู่แล้ว เลือกปีจากรายการแล้วกดตั้งเป็นปีที่ใช้งานได้");
      return;
    }
    const activeSchedule = academicYears.find(({ is_active }) => is_active)?.schedule
      || DEFAULT_SCHEDULE.map((round) => ({ ...round }));
    await saveAcademicYearSettings(applicationYear, activeSchedule, true);
  }

  function changeSelectedAcademicYear(applicationYear: string) {
    if (applicationYear === selectedAcademicYear) return;
    setSelectedAcademicYear(applicationYear);
    setSelected(null);
    setCheckin(null);
    setPhoto(null);
    setCheckinNote("");
    setCameraOpen(false);
    setQuery("");
    setCandidates([]);
    setCheckinSearch("");
    checkinSearchRef.current = "";
    setCheckinRows([]);
    setCheckinsHasMore(false);
    setError("");
    setNotice("");
    navigateDashboard("overview");
  }

  function updateScheduleDraft(
    roundIndex: number,
    field: keyof ScheduleRound,
    value: string,
  ) {
    setScheduleDraft((current) => current.map((round, index) =>
      index === roundIndex ? { ...round, [field]: value } : round,
    ));
  }

  async function exportStudents() {
    setStudentDataBusy("export");
    setError("");
    setNotice("");
    try {
      const response = await fetch(
        `/api/registrations/export?application_year=${selectedAcademicYear}`,
        {
        credentials: "same-origin",
        },
      );
      if (!response.ok) {
        let message = `ส่งออกข้อมูลไม่สำเร็จ (HTTP ${response.status})`;
        try {
          const result = await response.json() as { error?: string };
          if (result.error) message = result.error;
        } catch {
          // Keep the HTTP error when the response is not JSON.
        }
        throw new Error(message);
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `students-${selectedAcademicYear}.csv`;
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice("ส่งออกข้อมูลนักเรียนเป็นไฟล์ CSV แล้ว");
    } catch (exportError) {
      setError(`ส่งออกข้อมูลนักเรียนไม่สำเร็จ: ${exportError instanceof Error ? exportError.message : "เกิดข้อผิดพลาด"}`);
    } finally {
      setStudentDataBusy(null);
    }
  }

  async function importStudents(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setStudentDataBusy("import");
    setError("");
    setNotice("");
    let imported = 0;
    try {
      if (file.size > 5 * 1024 * 1024) {
        throw new Error("ไฟล์มีขนาดเกิน 5 MB");
      }
      const rows = parseStudentCsv(await file.text());
      if (rows.length === 0) throw new Error("ไม่พบข้อมูลนักเรียนในไฟล์");
      if (!isActiveAcademicYear) {
        throw new Error("เลือกนำเข้าได้เฉพาะปีการศึกษาที่กำลังใช้งาน");
      }
      if (rows.some(({ application_year }) => application_year !== selectedAcademicYear)) {
        throw new Error(`ข้อมูลในไฟล์ต้องเป็นปี ค.ศ. ${selectedAcademicYear} เท่านั้น`);
      }
      if (!window.confirm(`ยืนยันนำเข้านักเรียน ${rows.length} รายการ? รายการที่มีรหัสรับสมัครซ้ำกับข้อมูลเดิมจะถูกอัปเดต`)) {
        return;
      }
      for (let offset = 0; offset < rows.length; offset += 500) {
        const batch: StudentImportRow[] = rows.slice(offset, offset + 500);
        const result = await apiRequest<{ imported: number }>("/api/registrations/import", {
          method: "POST",
          body: jsonBody({ rows: batch }),
        });
        imported += result.imported;
      }
      setNotice(`นำเข้าข้อมูลนักเรียน ${imported} รายการเรียบร้อย`);
      setCheckinsRefresh((current) => current + 1);
    } catch (importError) {
      const detail = importError instanceof Error ? importError.message : "เกิดข้อผิดพลาด";
      setError(
        imported > 0
          ? `นำเข้าได้ ${imported} รายการก่อนพบข้อผิดพลาด: ${detail}`
          : `นำเข้าข้อมูลนักเรียนไม่สำเร็จ: ${detail}`,
      );
    } finally {
      setStudentDataBusy(null);
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
        `/api/checkins?search=${encodeURIComponent(search)}&offset=${checkinRows.length}&application_year=${selectedAcademicYear}`,
      );
      if (checkinSearchRef.current !== search) return;
      setCheckinRows((current) => [...current, ...checkins]);
      setCheckinsHasMore(hasMore);
    } catch (listError) {
      setError(`โหลดรายการลงทะเบียนเพิ่มเติมไม่สำเร็จ: ${listError instanceof Error ? listError.message : "เกิดข้อผิดพลาด"}`);
    } finally {
      setCheckinsLoadingMore(false);
    }
  }

  async function loadMoreApplicants() {
    const groupNumber = selectedGroup;
    if (
      applicantsLoadingMore ||
      !applicantsHasMore ||
      groupNumber === null
    ) return;

    setApplicantsLoadingMore(true);
    setError("");
    try {
      const { registrations, has_more: hasMore } = await apiRequest<{
        registrations: Registration[];
        has_more: boolean;
      }>(
        `/api/registrations?group_number=${groupNumber}&offset=${browseApplicants.length}&application_year=${selectedAcademicYear}`,
      );
      if (selectedGroupRef.current !== groupNumber) return;
      setBrowseApplicants((current) => [...current, ...registrations]);
      setApplicantsHasMore(hasMore);
    } catch (listError) {
      if (selectedGroupRef.current !== groupNumber) return;
      setError(`โหลดรายชื่อผู้สมัครเพิ่มเติมไม่สำเร็จ: ${listError instanceof Error ? listError.message : "เกิดข้อผิดพลาด"}`);
    } finally {
      if (selectedGroupRef.current === groupNumber) {
        setApplicantsLoadingMore(false);
      }
    }
  }

  function chooseGroup(groupNumber: number | null) {
    selectedGroupRef.current = groupNumber;
    setSelectedGroup(groupNumber);
    setGroupCheckinSummary(null);
    setApplicantsLoading(groupNumber !== null);
    setBrowseApplicants([]);
    setApplicantsHasMore(false);
    setApplicantsLoadingMore(false);
    setError("");
  }

  async function undoCheckin(checkin: CheckinRow) {
    await cancelCheckin(checkin.checkin_id, checkin.application_code);
  }

  async function cancelCheckin(checkinId: string, applicationCode: string) {
    const reason = window.prompt(
      `ยกเลิกการลงทะเบียน ${applicationCode} ใช่หรือไม่?\nโปรดระบุเหตุผล (อย่างน้อย 3 ตัวอักษร):`,
    );
    if (reason === null) return;
    if (reason.trim().length < 3) {
      setError("กรุณาระบุเหตุผลการยกเลิกอย่างน้อย 3 ตัวอักษร");
      return;
    }

    setCheckinBusyId(checkinId);
    setError("");
    try {
      await apiRequest<{ success: boolean }>("/api/checkins", {
        method: "PATCH",
        body: jsonBody({ checkin_id: checkinId, reason: reason.trim() }),
      });
      setNotice(`ยกเลิกการลงทะเบียน ${applicationCode} แล้ว`);
      if (selected?.application_code === applicationCode) setCheckin(null);
      setCheckinsRefresh((current) => current + 1);
      window.setTimeout(() => setNotice(""), 3000);
    } catch (undoError) {
      setError(`ยกเลิกการลงทะเบียนไม่สำเร็จ: ${undoError instanceof Error ? undoError.message : "เกิดข้อผิดพลาด"}`);
    } finally {
      setCheckinBusyId(null);
    }
  }

  async function viewCheckinPhoto(row: CheckinRow) {
    setCheckinPhotoLoadingId(row.checkin_id);
    setError("");
    try {
      const { photo_url: url } = await apiRequest<{ photo_url: string }>(
        `/api/checkins?photo_checkin_id=${encodeURIComponent(row.checkin_id)}`,
      );
      setCheckinPhoto({ url, row });
    } catch (photoError) {
      setError(`เปิดรูปไม่สำเร็จ: ${photoError instanceof Error ? photoError.message : "เกิดข้อผิดพลาด"}`);
    } finally {
      setCheckinPhotoLoadingId(null);
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
    if (!window.confirm(`ยืนยันลบบัญชี ${member.login_id}?`)) return;
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

  async function chooseRegistration(
    registration: Registration,
    returnPage: "group" | "checkin",
  ) {
    setApplicantReturnPage(returnPage);
    setSelected(registration);
    setCheckin(null);
    setPhoto(null);
    setCheckinNote("");
    setCameraOpen(false);
    setError("");
    navigateDashboard("applicant");
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
          note: checkinNote.trim(),
        }),
      });
      setNotice("ลงทะเบียนแล้ว");
      setSelected(null);
      setCheckin(null);
      setPhoto(null);
      setCheckinNote("");
      setCameraOpen(false);
      setQuery("");
      setCandidates([]);
      setCheckinsRefresh((current) => current + 1);
      navigateDashboard(applicantReturnPage);
      window.setTimeout(() => setNotice(""), 2500);
    } catch (submitError) {
      const message = submitError instanceof Error ? submitError.message : "เกิดข้อผิดพลาด";
      if (message === "ผู้สมัครรายนี้ลงทะเบียนแล้ว") {
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
      setCheckinNote("");
      setCameraOpen(false);
      setAdminOpen(false);
      setStudentDataOpen(false);
      setYearSettingsOpen(false);
      setError("");
    } catch (signOutError) {
      setError(`ออกจากระบบไม่สำเร็จ: ${signOutError instanceof Error ? signOutError.message : "เกิดข้อผิดพลาด"}`);
    }
  }

  function navigateDashboard(
    page: DashboardPage,
    groupNumber = selectedGroup ?? undefined,
  ) {
    setDashboardPage(page);
    setAdminOpen(false);
    setStudentDataOpen(false);
    setYearSettingsOpen(false);
    setError("");
    if (page === "checkin") {
      setSelected(null);
      setCheckin(null);
      setPhoto(null);
      setCheckinNote("");
    }
    if (cameraOpen) setCameraOpen(false);
    const hash = page === "group" ? `#group-${groupNumber}` : `#${page}`;
    if (window.location.hash !== hash) window.location.hash = hash;
  }

  function openGroup(groupNumber: number, returnPage: "overview" | "checkin") {
    setGroupReturnPage(returnPage);
    setSelected(null);
    setCheckin(null);
    setPhoto(null);
    setQuery("");
    setCandidates([]);
    chooseGroup(groupNumber);
    navigateDashboard("group", groupNumber);
  }

  if (authLoading) {
    return <main className="screen"><div className="loading" role="status" aria-live="polite">กำลังเชื่อมต่อระบบ…</div></main>;
  }

  if (!session) {
    return (
      <main className="screen login-screen">
        <section className="card login-card">
          <img className="brand-logo" src="/CMUDS-ITPC_6.png" alt="โลโก้ CMUDS-ITPC" />
          <h1 className="system-title"><SystemTitle applicationYear="" /></h1>
          <p className="muted">เข้าสู่ระบบสำหรับเจ้าหน้าที่</p>
          <form onSubmit={submitAuth} className="login-form">
            <label htmlFor="login-id">ID เจ้าหน้าที่</label>
            <input id="login-id" type="text" autoComplete="username" maxLength={254} value={loginId} onChange={(event) => setLoginId(event.target.value)} required />
            <label htmlFor="password">รหัสผ่าน</label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
            {error && <p className="error-message" role="alert"><Icon name="alert" className="toast-icon" />{error}</p>}
            <button className="button button-primary full-width" type="submit" disabled={busy}>
              {busy ? "กำลังเข้าสู่ระบบ…" : "เข้าสู่ระบบ"}
            </button>
          </form>
        </section>
      </main>
    );
  }

  const isSuperadmin = session.role === "superadmin";
  const onTime = selected
    ? isWithinSlot(selected.slot_start, selected.slot_end, currentBangkokMinutes(new Date(clock)))
    : false;
  const checkedInPercentage = groupCheckinSummary && groupCheckinSummary.total > 0
    ? (groupCheckinSummary.checked_in / groupCheckinSummary.total) * 100
    : 0;
  const overallCheckinPercentage = dashboardSummary && dashboardSummary.total > 0
    ? (dashboardSummary.checked_in / dashboardSummary.total) * 100
    : 0;
  const selectedGroupSchedule = selectedGroup === null
    ? null
    : getGroupSchedule(selectedGroup, selectedYearSchedule);
  const parentDashboardPage = dashboardPage === "group"
    ? groupReturnPage
    : dashboardPage === "applicant"
      ? applicantReturnPage === "group"
        ? groupReturnPage
        : "checkin"
      : dashboardPage;
  return (
    <main className="screen">
      <div className="app-shell">
        <header className="topbar">
          <div className="brand">
            <img className="brand-logo" src="/CMUDS-ITPC_6.png" alt="โลโก้ CMUDS-ITPC" />
            <div>
              <h1 className="system-title"><SystemTitle applicationYear={selectedAcademicYear} /></h1>
            </div>
          </div>
          <div className="staff-menu">
            <span className="staff-email">{session.display_name || session.email}</span>
            {session.role === "admin" || isSuperadmin ? (
              <>
                <button
                  className="button button-quiet"
                  disabled={academicYearsLoading}
                  onClick={() => {
                    const opening = !yearSettingsOpen;
                    setYearSettingsOpen(opening);
                    setAdminOpen(false);
                    setStudentDataOpen(false);
                    setError("");
                    setNotice("");
                  }}
                >
                  {yearSettingsOpen ? "ปิดตั้งค่าปี" : "ตั้งค่าปี/รอบ"}
                </button>
                <button
                  className="button button-quiet"
                  disabled={academicYearsLoading}
                  onClick={() => {
                    const opening = !studentDataOpen;
                    setStudentDataOpen(opening);
                    setAdminOpen(false);
                    setYearSettingsOpen(false);
                    setError("");
                    setNotice("");
                  }}
                >
                  {studentDataOpen ? "ปิดจัดการข้อมูลนักเรียน" : "จัดการข้อมูลนักเรียน"}
                </button>
                <button
                  className="button button-quiet"
                  onClick={() => {
                    const opening = !adminOpen;
                    setAdminOpen(opening);
                    setStudentDataOpen(false);
                    setYearSettingsOpen(false);
                    setError("");
                    if (opening) void loadMembers();
                  }}
                >
                  {adminOpen ? "ปิดจัดการระบบ" : "จัดการระบบ"}
                </button>
              </>
            ) : null}
            <button className="button button-quiet" onClick={() => void signOut()}>ออกจากระบบ</button>
          </div>
        </header>

        <section className="academic-year-bar" aria-label="เลือกปีการศึกษา">
          <div className="academic-year-description">
            <strong>ปีการศึกษา</strong>
            <span>
              {academicYearsLoading
                ? "กำลังโหลดรายการปีการศึกษา…"
                : !selectedAcademicYear
                  ? "ยังไม่มีปีการศึกษาให้เลือก"
                  : isActiveAcademicYear
                    ? "กำลังดูปีปัจจุบัน"
                    : "กำลังดูข้อมูลย้อนหลัง"}
            </span>
          </div>
          <label className="academic-year-picker">
            <span>เลือกปีที่ต้องการดู</span>
            <select
              aria-label="เลือกปีการศึกษาที่ต้องการดู"
              value={selectedAcademicYear}
              onChange={(event) => changeSelectedAcademicYear(event.target.value)}
              disabled={academicYearsLoading || academicYears.length === 0}
            >
              {academicYears.map(({ application_year, is_active }) => (
                <option value={application_year} key={application_year}>
                  พ.ศ. {formatAcademicYear(application_year)}{is_active ? " · ปีปัจจุบัน" : " · ดูย้อนหลัง"}
                </option>
              ))}
            </select>
          </label>
        </section>

        {!adminOpen && !studentDataOpen && !yearSettingsOpen && (
          <nav className="dashboard-nav" aria-label="หน้าระบบเช็กชื่อ">
            <button
              className={`dashboard-tab ${parentDashboardPage === "overview" ? "dashboard-tab-active" : ""}`}
              type="button"
              aria-current={parentDashboardPage === "overview" ? "page" : undefined}
              onClick={() => navigateDashboard("overview")}
            >
              ภาพรวม
            </button>
            <button
              className={`dashboard-tab ${parentDashboardPage === "checkin" ? "dashboard-tab-active" : ""}`}
              type="button"
              aria-current={parentDashboardPage === "checkin" ? "page" : undefined}
              onClick={() => navigateDashboard("checkin")}
            >
              ค้นหา
            </button>
            <button
              className={`dashboard-tab ${dashboardPage === "checked-in" ? "dashboard-tab-active" : ""}`}
              type="button"
              aria-current={dashboardPage === "checked-in" ? "page" : undefined}
              onClick={() => navigateDashboard("checked-in")}
            >
              ผู้ที่ลงทะเบียนแล้ว
            </button>
          </nav>
        )}

        {notice && <div className="success-toast" role="status"><Icon name="check" className="toast-icon" />{notice}</div>}
        {error && <div className="error-banner" role="alert"><Icon name="alert" className="toast-icon" />{error}</div>}
        {academicYearsLoading && (
          <div className="status status-pending" role="status" aria-live="polite">
            กำลังโหลดข้อมูลปีการศึกษา…
          </div>
        )}

        {adminOpen ? (
          <section className="card members-card">
            <div className="members-heading">
              <div>
                <h2>จัดการระบบ</h2>
                <p className="muted">
                  {isSuperadmin
                    ? "แอดมินใหญ่จัดการบัญชีแอดมินและเจ้าหน้าที่"
                    : "แอดมินสร้างบัญชีแอดมินหรือเจ้าหน้าที่ได้ และจัดการบัญชีเจ้าหน้าที่"}
                </p>
              </div>
              <button
                className="button button-quiet"
                onClick={() => void loadMembers()}
                disabled={adminLoading || adminBusyId !== null}
              >
                {adminLoading ? "กำลังโหลด…" : "รีเฟรช"}
              </button>
            </div>
            <form className="member-create-form" onSubmit={createMember}>
              <div className="member-create-fields">
                <label>
                  ชื่อที่แสดง
                  <input
                    autoComplete="name"
                    maxLength={100}
                    value={newMemberName}
                    onChange={(event) => setNewMemberName(event.target.value)}
                    required
                  />
                </label>
                <label>
                  ID สำหรับเข้าสู่ระบบ
                  <input
                    autoComplete="username"
                    maxLength={254}
                    value={newMemberId}
                    onChange={(event) => setNewMemberId(event.target.value)}
                    required
                  />
                </label>
                <label>
                  อีเมล (ไม่บังคับ)
                  <input
                    type="email"
                    maxLength={254}
                    value={newMemberEmail}
                    onChange={(event) => setNewMemberEmail(event.target.value)}
                  />
                </label>
                <label>
                  รหัสผ่าน
                  <input
                    type="password"
                    autoComplete="new-password"
                    value={newMemberPassword}
                    onChange={(event) => setNewMemberPassword(event.target.value)}
                    required
                  />
                </label>
                <label>
                  ระดับสิทธิ์
                  <select
                    value={newMemberRole}
                    onChange={(event) => setNewMemberRole(event.target.value === "admin" ? "admin" : "staff")}
                  >
                    <option value="staff">เจ้าหน้าที่</option>
                    <option value="admin">แอดมิน</option>
                  </select>
                </label>
              </div>
              <button className="button button-primary" type="submit" disabled={adminBusyId !== null}>
                {adminBusyId === "create" ? "กำลังเพิ่มบัญชี…" : "เพิ่มบัญชี"}
              </button>
            </form>
            {adminLoading ? (
              <div className="status status-pending" role="status" aria-live="polite">กำลังโหลดรายชื่อบัญชี…</div>
            ) : members.length === 0 && !error ? (
              <div className="not-found">
                <Icon name="school" className="empty-icon" />
                <strong>ยังไม่มีบัญชีให้จัดการ</strong>
              </div>
            ) : members.length > 0 ? (
              <div className="member-list">
                {members.map((member) => (
                  <article className="member-row" key={member.id}>
                    <div className="member-details">
                      <strong>{member.display_name}</strong>
                      <span>ID: {member.login_id}</span>
                      {member.email && <span>อีเมล: {member.email}</span>}
                      <span className="muted">
                        {member.role === "superadmin" ? "แอดมินใหญ่" : member.role === "admin" ? "แอดมิน" : "เจ้าหน้าที่"} · {
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
                      {member.role === "admin" && !isSuperadmin ? null : (
                        <>
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
                      ) : !isActiveAcademicYear ? (
                        <div className="status status-pending" role="status">
                          <span>ข้อมูลปีการศึกษาย้อนหลัง แสดงผลได้แต่ไม่สามารถลงทะเบียนเพิ่ม</span>
                        </div>
                      ) : (
                        <button
                          className="button button-primary"
                          onClick={() => void updateMember(member, { role: member.role, status: "active" })}
                          disabled={adminBusyId !== null}
                        >
                          เปิดใช้บัญชี
                        </button>
                      )}
                      {isSuperadmin && member.role !== "superadmin" && (
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
                      )}
                      <button
                        className="button button-danger"
                        onClick={() => void deleteMember(member)}
                        disabled={adminBusyId !== null || member.id === session.id}
                      >
                        ลบบัญชี
                      </button>
                        </>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            ) : null}
          </section>
        ) : studentDataOpen ? (
          <section className="card members-card student-data-card">
            <div className="members-heading">
              <div>
                <h2>จัดการข้อมูลนักเรียน</h2>
                <p className="muted">
                  นำเข้าหรือส่งออกเฉพาะรายชื่อนักเรียน ไม่รวมประวัติการลงทะเบียนและบัญชีผู้ใช้
                </p>
              </div>
            </div>
            <div className="student-data-actions">
              <button
                className="button button-primary"
                type="button"
                onClick={() => void exportStudents()}
                disabled={studentDataBusy !== null || !selectedAcademicYear}
              >
                {studentDataBusy === "export" ? "กำลังส่งออก…" : "ส่งออก CSV"}
              </button>
              <button
                className="button button-quiet"
                type="button"
                onClick={() => studentFileRef.current?.click()}
                disabled={studentDataBusy !== null || !isActiveAcademicYear || !selectedAcademicYear}
              >
                {studentDataBusy === "import" ? "กำลังนำเข้า…" : "เลือกไฟล์ CSV เพื่อนำเข้า"}
              </button>
              <input
                ref={studentFileRef}
                className="visually-hidden"
                type="file"
                accept=".csv,text/csv"
                aria-label="เลือกไฟล์ CSV ข้อมูลนักเรียน"
                onChange={(event) => void importStudents(event)}
              />
            </div>
            <ul className="student-data-notes">
              <li>ไฟล์ CSV ต้องมีคอลัมน์: application_code, application_year, title, first_name, last_name, group_number, slot_text, slot_start และ slot_end</li>
              <li>นำเข้าปี ค.ศ. {selectedAcademicYear} เท่านั้น; รหัสรับสมัครที่ตรงกับข้อมูลเดิมในปีเดียวกันจะถูกอัปเดต</li>
              <li>ส่งออกข้อมูลได้ทุกปี แต่การนำเข้าทำได้เฉพาะปีปัจจุบัน ({isActiveAcademicYear ? "ปีนี้" : "เลือกปีปัจจุบันก่อน"})</li>
              <li>รองรับไฟล์ CSV ขนาดไม่เกิน 5 MB; หากมีไฟล์ Excel ให้แปลงเป็น CSV ก่อนนำเข้า</li>
            </ul>
          </section>
        ) : yearSettingsOpen ? (
          <section className="card members-card year-settings-card">
            <div className="members-heading">
              <div>
                <h2>ตั้งค่าปีการศึกษาและรอบเวลา</h2>
                <p className="muted">
                  ข้อมูลแต่ละปีจะแยกจากกัน ปีที่กำลังใช้งานคือ พ.ศ. {activeAcademicYear ? formatAcademicYear(activeAcademicYear) : "—"}
                </p>
              </div>
            </div>
            <form
              className="year-create-form"
              onSubmit={(event) => {
                event.preventDefault();
                void createAcademicYear();
              }}
            >
              <label>
                เพิ่มปีการศึกษาใหม่ (ค.ศ.)
                <input
                  type="number"
                  min="1900"
                  max="9999"
                  step="1"
                  value={newAcademicYear}
                  onChange={(event) => setNewAcademicYear(event.target.value)}
                  required
                />
              </label>
              <button
                className="button button-primary"
                type="submit"
                disabled={academicYearBusy || academicYearsLoading}
              >
                {academicYearBusy ? "กำลังบันทึก…" : "เพิ่มและตั้งเป็นปีปัจจุบัน"}
              </button>
            </form>

            {selectedAcademicYearSettings ? (
              <>
                <div className="year-settings-actions">
                  <strong>
                    ตารางเวลา พ.ศ. {formatAcademicYear(selectedAcademicYear)}
                    {isActiveAcademicYear ? " · ปีปัจจุบัน" : " · ปีย้อนหลัง"}
                  </strong>
                  <div>
                    <button
                      className="button button-primary"
                      type="button"
                      onClick={() => void saveAcademicYearSettings(
                        selectedAcademicYear,
                        scheduleDraft,
                        false,
                      )}
                      disabled={academicYearBusy || academicYearsLoading}
                    >
                      บันทึกตารางเวลา
                    </button>
                    {!isActiveAcademicYear && (
                      <button
                        className="button button-quiet"
                        type="button"
                        onClick={() => void saveAcademicYearSettings(
                          selectedAcademicYear,
                          scheduleDraft,
                          true,
                        )}
                        disabled={academicYearBusy || academicYearsLoading}
                      >
                        ตั้งเป็นปีปัจจุบัน
                      </button>
                    )}
                  </div>
                </div>
                <div className="year-round-list">
                  {scheduleDraft.map((round, roundIndex) => (
                    <fieldset className="year-round-card" key={roundIndex} disabled={academicYearBusy}>
                      <legend>รอบที่ {roundIndex + 1} · กลุ่ม {roundIndex * 6 + 1}–{roundIndex * 6 + 6}</legend>
                      <label>
                        เริ่มลงทะเบียน
                        <input
                          type="time"
                          value={round.registration_start}
                          onChange={(event) => updateScheduleDraft(roundIndex, "registration_start", event.target.value)}
                          required
                        />
                      </label>
                      <label>
                        สิ้นสุดลงทะเบียน
                        <input
                          type="time"
                          value={round.registration_end}
                          onChange={(event) => updateScheduleDraft(roundIndex, "registration_end", event.target.value)}
                          required
                        />
                      </label>
                      <label>
                        เริ่มทำกิจกรรม
                        <input
                          type="time"
                          value={round.activity_start}
                          onChange={(event) => updateScheduleDraft(roundIndex, "activity_start", event.target.value)}
                          required
                        />
                      </label>
                      <label>
                        สิ้นสุดกิจกรรม
                        <input
                          type="time"
                          value={round.activity_end}
                          onChange={(event) => updateScheduleDraft(roundIndex, "activity_end", event.target.value)}
                          required
                        />
                      </label>
                    </fieldset>
                  ))}
                </div>
              </>
            ) : (
              <div className="not-found">
                <strong>ยังไม่มีข้อมูลปีการศึกษาให้ตั้งค่า</strong>
              </div>
            )}
          </section>
        ) : (
          <>
        {dashboardPage === "overview" && (
          <section className="card overview-card">
            <header className="overview-heading">
              <div>
                <h2>ภาพรวมการลงทะเบียน</h2>
                <p className="muted">สรุปผู้สมัครทั้งหมดและความคืบหน้าของแต่ละรอบ</p>
              </div>
              <button
                className="button button-quiet"
                type="button"
                onClick={() => setCheckinsRefresh((current) => current + 1)}
                disabled={dashboardLoading}
              >
                {dashboardLoading ? "กำลังโหลด…" : "รีเฟรช"}
              </button>
            </header>

            {dashboardLoading ? (
              <div className="status status-pending" role="status" aria-live="polite">
                กำลังโหลดข้อมูลภาพรวม…
              </div>
            ) : dashboardSummary ? (
              <>
                <div className="overview-stats">
                  <article className="overview-stat">
                    <span>ผู้สมัครทั้งหมด</span>
                    <strong>{dashboardSummary.total}</strong>
                    <small>คน</small>
                  </article>
                  <article className="overview-stat overview-stat-checked">
                    <span>ลงทะเบียนแล้ว</span>
                    <strong>{dashboardSummary.checked_in}</strong>
                    <small>คน</small>
                  </article>
                  <article className="overview-stat overview-stat-pending">
                    <span>ยังไม่ลงทะเบียน</span>
                    <strong>{dashboardSummary.total - dashboardSummary.checked_in}</strong>
                    <small>คน</small>
                  </article>
                  <article className="overview-stat">
                    <span>ลงทะเบียนแล้ว</span>
                    <strong>{Math.round(overallCheckinPercentage)}%</strong>
                    <small>ของผู้สมัครทั้งหมด</small>
                  </article>
                </div>

                <div className="group-attendance overview-attendance">
                  <div
                    className="attendance-pie"
                    role="img"
                    aria-label={`ลงทะเบียนแล้ว ${dashboardSummary.checked_in} จาก ${dashboardSummary.total} คน`}
                    style={{
                      background: `conic-gradient(#38b34a 0% ${overallCheckinPercentage}%, #e8e3dc ${overallCheckinPercentage}% 100%)`,
                    }}
                  >
                    <div className="attendance-pie-center">
                      <strong>{dashboardSummary.checked_in}</strong>
                      <span>จาก {dashboardSummary.total} คน</span>
                    </div>
                  </div>
                  <div className="attendance-legend">
                    <h4>สรุปการลงทะเบียนทั้งหมด</h4>
                    <div className="attendance-legend-item">
                      <span className="attendance-swatch attendance-swatch-checked" />
                      <span>ลงทะเบียนแล้ว</span>
                      <strong>{dashboardSummary.checked_in} คน</strong>
                    </div>
                    <div className="attendance-legend-item">
                      <span className="attendance-swatch attendance-swatch-pending" />
                      <span>ยังไม่ลงทะเบียน</span>
                      <strong>{dashboardSummary.total - dashboardSummary.checked_in} คน</strong>
                    </div>
                  </div>
                </div>

                <div className="overview-rounds">
                  {Array.from({ length: ROUND_COUNT }, (_, roundIndex) => {
                    const firstGroup = roundIndex * GROUPS_PER_ROUND + 1;
                    const roundGroups = dashboardSummary.groups.filter(
                      ({ group_number }) =>
                        group_number >= firstGroup &&
                        group_number < firstGroup + GROUPS_PER_ROUND,
                    );
                    const schedule = getGroupSchedule(firstGroup, selectedYearSchedule);

                    return (
                      <section className="overview-round" key={firstGroup}>
                        <header className="overview-round-heading">
                          <h3>รอบที่ {roundIndex + 1}</h3>
                          <p>
                            ลงทะเบียน {schedule.registrationTime}
                            <span> · </span>
                            ทำกิจกรรม {schedule.activityTime}
                          </p>
                        </header>
                        <div className="overview-group-grid">
                          {roundGroups.map((group) => {
                            const percentage = group.total > 0
                              ? (group.checked_in / group.total) * 100
                              : 0;
                            return (
                              <button
                                className={`overview-group-tile group-button-color-${(group.group_number - 1) % GROUPS_PER_ROUND + 1}`}
                                key={group.group_number}
                                type="button"
                                aria-label={`กลุ่ม ${group.group_number}: ลงทะเบียนแล้ว ${group.checked_in} จาก ${group.total} คน`}
                                onClick={() => {
                                  openGroup(group.group_number, "overview");
                                }}
                              >
                                <span>กลุ่ม {group.group_number}</span>
                                <strong>{group.checked_in} / {group.total} คน</strong>
                                <span className="overview-group-progress">
                                  <span style={{ width: `${percentage}%` }} />
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      </section>
                    );
                  })}
                </div>
              </>
            ) : null}
          </section>
        )}
        {dashboardPage === "checkin" && (
          <>
            <section className="card search-card">
              <div className="section-heading">
                <div>
                  <h2>ค้นหาผู้สมัคร</h2>
                  <p className="muted">ค้นหาด้วยรหัส ชื่อ หรือนามสกุล</p>
                </div>
              </div>
              <div className="search-control">
                <span className="search-icon"><Icon name="search" /></span>
                <input
                  aria-label="ค้นหาด้วยรหัส ชื่อ หรือนามสกุล"
                  autoComplete="off"
                  placeholder="พิมพ์รหัส ชื่อ หรือนามสกุล"
                  value={query}
                  onChange={(event) => {
                    setQuery(event.target.value);
                    setError("");
                  }}
                />
                {searching && <span className="searching-label" role="status" aria-live="polite">กำลังค้นหา…</span>}
              </div>
              {candidates.length > 0 && (
                <div className="candidate-list" aria-label="ผลการค้นหา">
                  {candidates.map((candidate) => (
                    <button
                      className="candidate-row"
                      key={candidate.id}
                      onClick={() => void chooseRegistration(candidate, "checkin")}
                    >
                      <span className="candidate-code">{candidate.application_code}</span>
                      <span className="candidate-name">{candidate.title}{candidate.first_name} {candidate.last_name}</span>
                      <span className="candidate-group">กลุ่ม {candidate.group_number}</span>
                      <span className="candidate-arrow"><Icon name="chevron-right" /></span>
                    </button>
                  ))}
                </div>
              )}
              {!searching && query.trim().length > 0 && candidates.length === 0 && !error && (
                <div className="not-found">
                  <Icon name="search" className="empty-icon" />
                  <strong>ไม่พบข้อมูลผู้สมัคร ลองตรวจสอบคำค้นอีกครั้ง</strong>
                </div>
              )}
            </section>

            {!query.trim() && (
              <section className="card applicants-card" aria-label="เลือกกลุ่มผู้สมัคร">
                <header className="applicants-heading">
                  <div>
                    <h2>เลือกกลุ่มผู้สมัคร</h2>
                    <p className="muted">เลือกกลุ่มเพื่อดูรายชื่อและดำเนินการลงทะเบียน</p>
                  </div>
                </header>
                <div className="group-button-grid" aria-label="เลือกกลุ่ม 1 ถึง 30">
                  {GROUP_NUMBERS.map((groupNumber) => (
                    <button
                      className={`group-button group-button-color-${(groupNumber - 1) % 6 + 1}`}
                      key={groupNumber}
                      type="button"
                      onClick={() => openGroup(groupNumber, "checkin")}
                    >
                      กลุ่ม {groupNumber}
                    </button>
                  ))}
                </div>
              </section>
            )}
          </>
        )}
        {dashboardPage === "group" && selectedGroup !== null && (
          <section className="card applicants-card group-page-card" aria-label={`รายชื่อผู้สมัครกลุ่ม ${selectedGroup}`}>
            <button
              className="back-button group-back-button"
              type="button"
              onClick={() => navigateDashboard("checkin")}
            >
              <Icon name="arrow-left" className="back-icon" />
              <span>กลับไปหน้าค้นหา</span>
            </button>
            <section className="applicant-group selected-applicant-group">
              <header className="applicant-group-heading">
                <h3>รายชื่อกลุ่ม {selectedGroup}</h3>
                {!applicantsLoading && browseApplicants.length > 0 && (
                  <span className="group-applicant-count">
                    {browseApplicants.length}{applicantsHasMore ? "+" : ""} รายชื่อ
                  </span>
                )}
              </header>
              {selectedGroupSchedule && (
                <div className="group-schedule">
                  <div className="group-schedule-item">
                    <span>เวลาลงทะเบียน</span>
                    <strong>{selectedGroupSchedule.registrationTime}</strong>
                  </div>
                  <div className="group-schedule-item">
                    <span>เวลาทำกิจกรรม</span>
                    <strong>{selectedGroupSchedule.activityTime}</strong>
                  </div>
                </div>
              )}
              {applicantsLoading ? (
                <div className="status status-pending group-loading" role="status" aria-live="polite">
                  กำลังโหลดรายชื่อกลุ่ม {selectedGroup}…
                </div>
              ) : (
                <>
                  {groupCheckinSummary && (
                    <div className="group-attendance">
                      <div
                        className="attendance-pie"
                        role="img"
                        aria-label={`ลงทะเบียนแล้ว ${groupCheckinSummary.checked_in} จาก ${groupCheckinSummary.total} คน`}
                        style={{
                          background: `conic-gradient(#38b34a 0% ${checkedInPercentage}%, #e8e3dc ${checkedInPercentage}% 100%)`,
                        }}
                      >
                        <div className="attendance-pie-center">
                          <strong>{groupCheckinSummary.checked_in}</strong>
                          <span>จาก {groupCheckinSummary.total} คน</span>
                        </div>
                      </div>
                      <div className="attendance-legend">
                        <h4>สรุปการลงทะเบียน</h4>
                        <div className="attendance-legend-item">
                          <span className="attendance-swatch attendance-swatch-checked" />
                          <span>ลงทะเบียนแล้ว</span>
                          <strong>{groupCheckinSummary.checked_in} คน</strong>
                        </div>
                        <div className="attendance-legend-item">
                          <span className="attendance-swatch attendance-swatch-pending" />
                          <span>ยังไม่ลงทะเบียน</span>
                          <strong>{groupCheckinSummary.total - groupCheckinSummary.checked_in} คน</strong>
                        </div>
                      </div>
                    </div>
                  )}
                  {browseApplicants.length > 0 ? (
                    <div className="applicant-list">
                      {browseApplicants.map((applicant) => (
                        <button
                          className={`applicant-row ${applicant.checked_in ? "applicant-row-checked-in" : ""}`}
                          key={applicant.id}
                          type="button"
                          onClick={() => void chooseRegistration(applicant, "group")}
                        >
                          <span className="candidate-code">{applicant.application_code}</span>
                          <span className="applicant-name">
                            {applicant.title}{applicant.first_name} {applicant.last_name}
                          </span>
                          {applicant.checked_in && (
                            <span className="applicant-checkin-status applicant-checkin-done">
                              ลงทะเบียนแล้ว
                            </span>
                          )}
                          <span className="applicant-slot">รอบ {applicant.slot_text}</span>
                          <span className="candidate-arrow"><Icon name="chevron-right" /></span>
                        </button>
                      ))}
                    </div>
                  ) : !error ? (
                    <div className="not-found group-empty">
                      <Icon name="search" className="empty-icon" />
                      <strong>ไม่พบรายชื่อในกลุ่มนี้</strong>
                    </div>
                  ) : null}
                </>
              )}
            </section>
            {applicantsHasMore && !applicantsLoading && (
              <button
                className="button button-quiet load-more-button"
                type="button"
                onClick={() => void loadMoreApplicants()}
                disabled={applicantsLoadingMore}
              >
                {applicantsLoadingMore ? "กำลังโหลด…" : "โหลดรายชื่อเพิ่มเติม"}
              </button>
            )}
          </section>
        )}
        {dashboardPage === "checked-in" && (
        <section className="card checked-in-card">
          <div className="checked-in-heading">
            <div className="section-heading">
              <span className="step-number"><Icon name="check" /></span>
              <div>
                <h2>ผู้สมัครที่ลงทะเบียนแล้ว</h2>
                <p className="muted">ค้นหารายการ ดูรูป และยกเลิกได้หากบันทึกผิด</p>
              </div>
            </div>
            <span className="checked-in-count">{checkinRows.length}{checkinsHasMore ? "+" : ""} รายการ</span>
          </div>
          <div className="search-control checked-in-search">
            <span className="search-icon"><Icon name="search" /></span>
            <input
              aria-label="ค้นหารายการลงทะเบียนด้วยรหัสหรือชื่อ"
              autoComplete="off"
              placeholder="ค้นหาด้วยรหัสหรือชื่อผู้สมัคร"
              value={checkinSearch}
              onChange={(event) => {
                checkinSearchRef.current = event.target.value;
                setCheckinSearch(event.target.value);
              }}
            />
            {checkinsLoading && <span className="searching-label" role="status" aria-live="polite">กำลังค้นหา…</span>}
          </div>

          {!checkinsLoading && !error && checkinRows.length === 0 ? (
            <div className="not-found checked-in-empty">
              <Icon name="check" className="empty-icon" />
              <strong>{checkinSearch ? "ไม่พบรายการลงทะเบียน" : "ยังไม่มีผู้สมัครลงทะเบียน"}</strong>
            </div>
          ) : checkinRows.length > 0 ? (
            <div className="checked-in-list">
              {checkinRows.map((row) => (
                <article className="checked-in-row" key={row.checkin_id}>
                  <div className="checked-in-person">
                    <strong className="candidate-code">{row.application_code}</strong>
                    <span className="checked-in-name">{row.title}{row.first_name} {row.last_name}</span>
                    <span className="candidate-group">กลุ่ม {row.group_number} · รอบ {row.slot_text}</span>
                    <span className="checked-in-meta">
                      {formatCheckinTime(row.checked_in_at)} · ลงทะเบียนโดย {row.staff_label}
                    </span>
                    {row.note && <span className="checked-in-note">หมายเหตุ: {row.note}</span>}
                  </div>
                  <div className="checked-in-actions">
                    <button
                      className="button button-quiet"
                      onClick={() => void viewCheckinPhoto(row)}
                      disabled={checkinPhotoLoadingId !== null}
                    >
                      {checkinPhotoLoadingId === row.checkin_id ? "กำลังเปิดรูป…" : "ดูรูป"}
                    </button>
                    <button
                      className="button button-danger"
                      onClick={() => void undoCheckin(row)}
                      disabled={checkinBusyId !== null}
                    >
                      {checkinBusyId === row.checkin_id ? "กำลังยกเลิก…" : "ยกเลิกการลงทะเบียน"}
                    </button>
                  </div>
                </article>
              ))}
            </div>
          ) : null}
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
        )}

        {dashboardPage === "applicant" && selected && (
          <>
          <section className="card registration-card">
            <div className="applicant-detail-top">
              <button
                className="back-button group-back-button"
                type="button"
                onClick={() => {
                  setSelected(null);
                  setCheckin(null);
                  setPhoto(null);
                  setCheckinNote("");
                  setCameraOpen(false);
                  navigateDashboard(applicantReturnPage);
                }}
              >
                <Icon name="arrow-left" className="back-icon" />
                <span>{applicantReturnPage === "group" ? "กลับไปหน้ารายชื่อกลุ่ม" : "กลับไปหน้าค้นหา"}</span>
              </button>
              <div className="registration-details">
                <div className="registration-code">{selected.application_code}</div>
                <div className="registration-name">{selected.title}{selected.first_name} {selected.last_name}</div>
                <div className="registration-session">
                  กลุ่ม {selected.group_number}
                  <span className="session-divider">|</span>
                  รอบ {selected.slot_text}
                </div>
              </div>
            </div>
            <div className="section-heading">
              <div>
                <h2>ข้อมูลผู้สมัคร</h2>
                <p className="muted">ตรวจสอบข้อมูลก่อนลงทะเบียน</p>
              </div>
            </div>

            {checkinLoading ? (
              <div className="status status-pending" role="status" aria-live="polite">กำลังตรวจสอบสถานะ…</div>
            ) : checkin ? (
              <div className="status status-checked">
                <span className="status-icon"><Icon name="check" /></span>
                <div>
                  <strong>ลงทะเบียนแล้ว</strong>
                  <span>เวลา {formatCheckinTime(checkin.checked_in_at)}</span>
                  <span>เจ้าหน้าที่ {checkin.staff_label}</span>
                  {checkin.note && <span>หมายเหตุ: {checkin.note}</span>}
                </div>
                <button
                  className="button button-danger applicant-cancel-checkin"
                  type="button"
                  onClick={() => void cancelCheckin(checkin.id, selected.application_code)}
                  disabled={checkinBusyId !== null}
                >
                  {checkinBusyId === checkin.id ? "กำลังยกเลิก…" : "ยกเลิกการลงทะเบียน"}
                </button>
              </div>
            ) : (
              <>
                <div className="photo-section">
                  <div className="section-heading compact-heading photo-heading">
                    <h2>ถ่ายรูปคู่กับรหัส</h2>
                    <p className="muted">ให้ผู้ปกครองถือบัตรที่มีรหัสให้เห็นในภาพ</p>
                  </div>

                  {cameraOpen ? (
                    <div className="camera-panel" ref={cameraPanelRef}>
                      <video ref={videoRef} className="camera-preview" playsInline muted aria-label="ภาพจากกล้องหลัง" />
                      <div className="camera-actions">
                        <button className="button button-quiet" onClick={() => setCameraOpen(false)}>ยกเลิก</button>
                        <button className="button button-primary" onClick={capturePhoto}>ถ่ายภาพ</button>
                      </div>
                    </div>
                  ) : photo ? (
                    <div className="photo-preview-wrap">
                      <img className="photo-preview" src={photoUrl} alt="ภาพถ่ายคู่กับรหัส" />
                      <label className="checkin-note-field">
                        หมายเหตุ (ไม่บังคับ)
                        <textarea
                          value={checkinNote}
                          onChange={(event) => setCheckinNote(event.target.value)}
                          maxLength={500}
                          rows={3}
                          placeholder="เพิ่มหมายเหตุสำหรับรายการนี้"
                        />
                      </label>
                      <div className="photo-actions">
                        <button className="button button-quiet" onClick={() => { setPhoto(null); setCameraOpen(true); }}>ถ่ายใหม่</button>
                        <button className="button button-primary" onClick={() => void submitCheckin()} disabled={busy}>
                          {busy ? "กำลังบันทึก…" : "บันทึกการลงทะเบียน"}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button className="camera-start" onClick={() => { setError(""); setCameraOpen(true); }}>
                      <Icon name="camera" className="camera-symbol" />
                      <span>เปิดกล้องถ่ายรูป</span>
                    </button>
                  )}
                  <canvas ref={captureCanvasRef} className="visually-hidden" />
                </div>
                <div className={`status ${onTime ? "status-ready" : "status-late"}`}>
                  <span className="status-icon"><Icon name={onTime ? "check" : "alert"} /></span>
                  <div>
                    <strong>{onTime ? "มาถูกรอบ" : "มานอกรอบ"}</strong>
                    <span>{onTime ? "ยังไม่ลงทะเบียน สามารถดำเนินการต่อได้" : `รอบจริงคือ ${selected.slot_text} — แจ้งผู้ปกครองก่อนดำเนินการต่อ`}</span>
                  </div>
                </div>
              </>
            )}
          </section>
          </>
        )}
          </>
        )}
        {checkinPhoto && (
          <div
            className="photo-viewer-backdrop"
            role="presentation"
            onClick={(event) => {
              if (event.target === event.currentTarget) setCheckinPhoto(null);
            }}
          >
            <section
              className="photo-viewer"
              role="dialog"
              aria-modal="true"
              aria-labelledby="checkin-photo-title"
            >
              <div className="photo-viewer-heading">
                <div>
                  <h2 id="checkin-photo-title">รูปยืนยันการลงทะเบียน {checkinPhoto.row.application_code}</h2>
                  <p>{checkinPhoto.row.title}{checkinPhoto.row.first_name} {checkinPhoto.row.last_name}</p>
                </div>
                <button
                  className="button button-quiet"
                  onClick={() => setCheckinPhoto(null)}
                  aria-label="ปิดรูป"
                >
                  ปิด
                </button>
              </div>
              <img
                className="photo-viewer-image"
                src={checkinPhoto.url}
                alt={`รูปยืนยันการลงทะเบียน ${checkinPhoto.row.application_code}`}
              />
            </section>
          </div>
        )}
      </div>
    </main>
  );
}
