import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ArrowDownToLine,
  ArrowRight,
  ArrowUpRight,
  Bell,
  BookOpen,
  ChartNoAxesCombined,
  Check,
  CheckCheck,
  ChevronDown,
  CircleAlert,
  CircleHelp,
  Cloud,
  Command,
  DatabaseBackup,
  FileChartColumn,
  GraduationCap,
  HardDrive,
  KeyRound,
  LayoutDashboard,
  LoaderCircle,
  LogOut,
  Menu,
  Plus,
  RefreshCw,
  ScanLine,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Trophy,
  Users,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import type { Exam, Page, Result, School, Workspace } from "./data";
import {
  blankWorkspace,
  downloadFile,
  enrichWorkspace,
  gradeResult,
  initials,
  mergeSchoolWorkspace,
  resultsCSV,
  scopeWorkspace,
} from "./data";
import {
  Avatar,
  EmptyState,
  Logo,
  Modal,
  SearchInput,
  Select,
} from "./components";
import { api, useSession, useWorkspaceStore } from "./session";
import Auth from "./Auth";
import Dashboard from "./Dashboard";
import AnswerKeys, { NewExamModal } from "./AnswerKeys";
import { StudentDetail } from "./Students";
import PrintReport from "./PrintReport";
import ResetAccount from "./AccountAccess";
const Scanner = lazy(() => import("./Scanner")),
  Roster = lazy(() => import("./Roster")),
  Analytics = lazy(() => import("./Analytics")),
  Reports = lazy(() => import("./Reports")),
  Templates = lazy(() => import("./Templates")),
  Leaderboard = lazy(() => import("./Leaderboard")),
  Settings = lazy(() => import("./Settings")),
  Backups = lazy(() => import("./Backups")),
  Administration = lazy(() => import("./Administration")),
  StudentPortal = lazy(() => import("./StudentPortal")),
  BatchCenter = lazy(() => import("./BatchCenter")),
  EvaluationCenter = lazy(() => import("./EvaluationCenter")),
  SystemCenter = lazy(() => import("./SystemCenter"));
const pages: { id: Page; label: string; icon: LucideIcon; group: number }[] = [
  { id: "overview", label: "Overview", icon: LayoutDashboard, group: 0 },
  { id: "scanner", label: "Scan sheets", icon: ScanLine, group: 0 },
  { id: "batches", label: "Bulk queue", icon: BookOpen, group: 0 },
  { id: "keys", label: "Answer keys", icon: KeyRound, group: 0 },
  { id: "evaluation", label: "Evaluation policy", icon: ShieldCheck, group: 0 },
  { id: "templates", label: "Layout studio", icon: ScanLine, group: 0 },
  { id: "students", label: "Students", icon: Users, group: 0 },
  {
    id: "analytics",
    label: "Deep analytics",
    icon: ChartNoAxesCombined,
    group: 1,
  },
  { id: "leaderboard", label: "Leaderboard", icon: Trophy, group: 1 },
  {
    id: "reports",
    label: "Reports & exports",
    icon: FileChartColumn,
    group: 1,
  },
  { id: "backups", label: "Backups", icon: DatabaseBackup, group: 2 },
  { id: "administration", label: "Team & access", icon: ShieldCheck, group: 2 },
  { id: "settings", label: "Settings", icon: Settings2, group: 2 },
  { id: "system", label: "Sync & system", icon: Cloud, group: 2 },
];
const hashPage = (): Page =>
  pages.find((p) => p.id === location.hash.replace(/^#\/?/, "").split("?")[0])
    ?.id || "overview";
export default function App() {
  const session = useSession(),
    route = useLocation();
  if (route.pathname === "/reset")
    return (
      <Suspense
        fallback={
          <div className="initial-loader">Opening secure recovery…</div>
        }
      >
        <ResetAccount />
      </Suspense>
    );
  if (session.phase === "checking")
    return (
      <div className="initial-loader">
        <Logo />
        <LoaderCircle className="spinning" size={25} />
        <p>Finding a little more possibility…</p>
      </div>
    );
  if (session.phase === "login" || session.phase === "setup") return <Auth />;
  if (session.phase === "authenticated" && !session.user?.memberships.length)
    return (
      <div className="initial-loader">
        <Logo />
        <h1>No active institution membership.</h1>
        <p>
          Your account has no authorized school workspace. Ask your
          administrator to restore access.
        </p>
        <button
          className="button button-primary"
          onClick={() => session.logout()}
        >
          Sign out
        </button>
      </div>
    );
  if (
    session.user?.memberships.find((m) => m.schoolId === session.activeSchool)
      ?.role === "student"
  )
    return (
      <Suspense
        fallback={
          <div className="initial-loader">
            <Logo />
            Opening private student space…
          </div>
        }
      >
        <StudentPortal key={`${session.user.id}-${session.activeSchool}`} />
      </Suspense>
    );
  return (
    <WorkspaceApp
      key={`${session.phase}-${session.user?.id || "device"}-${session.vaultEpoch}`}
    />
  );
}
function WorkspaceApp() {
  const routerNavigate = useNavigate(),
    route = useLocation();
  const session = useSession(),
    store = useWorkspaceStore(),
    { workspace: full, setWorkspace, cloud, status } = store;
  const schoolId = cloud
    ? session.activeSchool
    : full.activeSchoolId || full.schools?.[0]?.id || "school-greenwood";
  const workspace = useMemo(
    () => scopeWorkspace(enrichWorkspace(full), schoolId),
    [full, schoolId],
  );
  const assessmentSchool = useRef(schoolId);
  const [page, setPage] = useState<Page>(hashPage),
    [examId, setExamId] = useState(() => workspace.exams.at(-1)?.id || ""),
    [studentId, setStudentId] = useState<string | null>(null),
    [question, setQuestion] = useState(1),
    [mobile, setMobile] = useState(false),
    [searchOpen, setSearchOpen] = useState(false),
    [search, setSearch] = useState(""),
    [newExam, setNewExam] = useState(false),
    [help, setHelp] = useState(false),
    [notifications, setNotifications] = useState(false),
    [profile, setProfile] = useState(false),
    [scanBusy, setScanBusy] = useState(false),
    [toastMessage, setToastMessage] = useState<{
      text: string;
      id: number;
    } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
      undefined,
    ),
    exam =
      workspace.exams.find((e) => e.id === examId) || workspace.exams.at(-1)!,
    results = workspace.results.filter((r) => r.examId === exam?.id),
    review = results.filter((r) => gradeResult(r, exam).needsReview),
    student = workspace.results.find((r) => r.id === studentId),
    admin =
      !cloud ||
      session.user?.memberships.find((m) => m.schoolId === schoolId)?.role ===
        "admin";
  const toast = useCallback((text: string) => {
    setToastMessage({ text, id: Date.now() });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastMessage(null), 6000);
  }, []);
  useEffect(() => () => clearTimeout(toastTimer.current), []);
  const navigate = (p: Page) => {
    if (scanBusy) {
      toast("Finish or stop the current scan before leaving this page.");
      return;
    }
    setPage(p);
    routerNavigate(`/${p}`);
    setMobile(false);
    setProfile(false);
    setNotifications(false);
    window.scrollTo({ top: 0, behavior: "instant" });
  };
  useEffect(() => {
    const next =
      pages.find((p) => p.id === route.pathname.replace(/^\//, ""))?.id ||
      hashPage();
    if (scanBusy && next !== page) {
      routerNavigate(`/${page}`, { replace: true });
      return;
    }
    setPage(next);
  }, [route.pathname, scanBusy]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen((s) => !s);
      }
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, []);
  useEffect(() => {
    document.title = `${pages.find((p) => p.id === page)?.label || "Overview"} — ULTIMATE OMR CHECKER AI PRO`;
  }, [page]);
  useEffect(() => {
    if (!store.ready) return;
    const changedSchool = assessmentSchool.current !== schoolId;
    assessmentSchool.current = schoolId;
    if (changedSchool) setStudentId(null);
    setExamId((current) =>
      !changedSchool && workspace.exams.some((e) => e.id === current)
        ? current
        : workspace.exams.at(-1)?.id || "",
    );
  }, [schoolId, store.ready, workspace.exams]);
  const updateScoped = (changed: Workspace) =>
    setWorkspace((w) =>
      mergeSchoolWorkspace(
        enrichWorkspace(w),
        enrichWorkspace(changed),
        schoolId,
      ),
    );
  const member = session.user?.memberships.find((m) => m.schoolId === schoolId);
  const allowedPage = (p: Page) => {
    if (!cloud || admin) return true;
    if (p === "administration" || p === "backups") return false;
    if (
      ["scanner", "batches"].includes(p) &&
      member?.permissions?.scan === false
    )
      return false;
    if (
      ["keys", "templates", "evaluation"].includes(p) &&
      member?.permissions?.createExams === false
    )
      return false;
    if (
      ["analytics", "leaderboard", "reports"].includes(p) &&
      member?.permissions?.reports === false
    )
      return false;
    return true;
  };
  const updateExam = (e: Exam) => {
    if (!allowedPage("keys")) {
      toast("Your account cannot change examinations or answer keys.");
      return;
    }
    updateScoped({
      ...workspace,
      exams: workspace.exams.map((old) => (old.id === e.id ? e : old)),
    });
  };
  const createExam = (e: Exam) => {
    e = {
      ...e,
      negativeMarks:
        workspace.institutionSettings?.defaultNegativeMarks ?? e.negativeMarks,
      passPercentage:
        workspace.institutionSettings?.defaultPassPercentage ??
        e.passPercentage,
    };
    if (!allowedPage("keys")) {
      toast("Your account cannot create examinations.");
      return;
    }
    if (cloud && !admin && !e.classIds?.length)
      e = { ...e, classIds: member?.classIds || [] };
    updateScoped({
      ...workspace,
      exams: [...workspace.exams, { ...e, schoolId }],
    });
    setExamId(e.id);
    navigate("keys");
    toast("Your new assessment is ready. Add the correct answers to begin.");
  };
  const exportResults = () => {
    downloadFile(`markly-results-${exam.id}.csv`, resultsCSV(results, exam));
    toast(`${results.length} result records exported.`);
  };
  const switchSchool = (id: string) => {
    if (scanBusy || status === "saving" || status === "queued") {
      toast("Wait for scanning and saving to finish before switching schools.");
      return;
    }
    if (status === "error" || status === "conflict") {
      toast(
        "Resolve the save error or export a backup before switching schools.",
      );
      return;
    }
    if (cloud) session.setSchool(id);
    else setWorkspace((w) => ({ ...w, activeSchoolId: id }));
  };
  const addSchool = async (s: School) => {
    if (status !== "saved")
      throw new Error(
        "Wait for your current changes to save before adding a school.",
      );
    if (cloud) {
      const data = await api<{ school: School }>("/schools", {
        method: "POST",
        body: JSON.stringify(s),
      });
      await session.reloadUser();
      session.setSchool(data.school.id);
    } else {
      const fresh = blankWorkspace(s, workspace.teacher);
      setWorkspace((w) => ({
        ...w,
        schools: [...(w.schools || []), s],
        activeSchoolId: s.id,
        exams: [...w.exams, ...fresh.exams],
      }));
    }
    toast("A new school workspace is ready.");
  };
  const onScans = (fresh: Result[]) => {
    if (!allowedPage("scanner")) {
      toast("Your account cannot save scans.");
      return;
    }
    const ids = new Set(fresh.map((r) => r.id)),
      students = [...(workspace.students || [])];
    fresh.forEach((r) => {
      if (
        !r.identityReview &&
        !students.some(
          (s) =>
            s.id === r.studentId ||
            s.roll.toLowerCase() === r.roll.toLowerCase(),
        )
      )
        students.push({
          id: r.studentId,
          schoolId,
          name: r.name,
          roll: r.roll,
          section: r.section,
          classId: workspace.classes?.find((c) => c.name === r.section)?.id,
          registeredAt: r.createdAt,
        });
    });
    updateScoped({
      ...workspace,
      students,
      results: [
        ...workspace.results.filter((r) => !ids.has(r.id)),
        ...fresh.filter((r) => workspace.exams.some((e) => e.id === r.examId)),
      ],
    });
  };
  const updateResult = (r: Result) => {
    if (!allowedPage("scanner")) {
      toast("Your account cannot correct scan results.");
      return false;
    }
    const known = workspace.students?.find(
      (s) => s.roll.toLowerCase() === r.roll.toLowerCase(),
    );
    const linked = known ? { ...r, studentId: known.id } : r;
    if (
      workspace.results.some(
        (other) =>
          other.id !== r.id &&
          other.examId === r.examId &&
          other.studentId === linked.studentId,
      )
    ) {
      toast(
        "That student already has a result in this assessment. Use the scanner’s replace-page option to merge a rescan.",
      );
      return false;
    }
    onScans([linked]);
    return true;
  };
  const searchResults = workspace.results
      .filter(
        (r) =>
          (!search ||
            `${r.name} ${r.roll}`
              .toLowerCase()
              .includes(search.toLowerCase())) &&
          r.examId === exam?.id,
      )
      .slice(0, 6),
    searchExams = search
      ? workspace.exams
          .filter((e) =>
            `${e.title} ${e.subject}`
              .toLowerCase()
              .includes(search.toLowerCase()),
          )
          .slice(0, 4)
      : [];
  if (!store.ready)
    return (
      <div className="initial-loader">
        <Logo />
        {store.error ? (
          <>
            <p role="alert">{store.error}</p>
            <button
              className="button button-primary"
              onClick={() => {
                void store.reload();
              }}
            >
              Retry connection
            </button>
            <button
              className="button button-secondary"
              onClick={session.explore}
            >
              Open device demo instead
            </button>
          </>
        ) : (
          <>
            <LoaderCircle className="spinning" size={25} />
            <p>Opening your school workspace…</p>
          </>
        )}
      </div>
    );
  if (!workspace.exams.length)
    return (
      <div className="initial-loader">
        <Logo />
        <h1>No assigned assessments yet.</h1>
        <p>
          Your account can access only its assigned classes and examinations.
          Ask an administrator to assign a class or share an assessment.
        </p>
        <button
          className="button button-secondary"
          onClick={() => void store.reload()}
        >
          Refresh assignments
        </button>
        {member?.classIds?.length ? (
          <button
            className="button button-primary"
            onClick={() => setNewExam(true)}
          >
            Create an assigned assessment
          </button>
        ) : null}
        <button
          className="text-button"
          onClick={() => session.logout().catch((e) => toast(e.message))}
        >
          Sign out
        </button>
        {newExam && (
          <NewExamModal
            onClose={() => setNewExam(false)}
            onCreate={(e) => {
              createExam(e);
              setNewExam(false);
            }}
          />
        )}
      </div>
    );
  return (
    <>
      <div className="app-shell v2-shell">
        {mobile && (
          <button
            className="mobile-sidebar-backdrop"
            aria-label="Close navigation"
            onClick={() => setMobile(false)}
          />
        )}
        <aside className={`sidebar ${mobile ? "sidebar-open" : ""}`}>
          <button
            className="logo-button"
            aria-label="OMR Pro home"
            onClick={() => navigate("overview")}
          >
            <Logo />
            <span className="brand-edition">ULTIMATE OMR CHECKER · AI PRO</span>
          </button>
          <div className="v2-school-switch">
            <span className="workspace-icon">
              <GraduationCap size={19} />
            </span>
            <div>
              <small>YOUR INSTITUTION</small>
              <Select
                aria-label="Current school"
                value={schoolId}
                onChange={(e) => switchSchool(e.target.value)}
              >
                {cloud
                  ? session.user?.memberships.map((m) => (
                      <option key={m.schoolId} value={m.schoolId}>
                        {m.schoolId === schoolId ? workspace.school : m.name}
                      </option>
                    ))
                  : full.schools?.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
              </Select>
            </div>
          </div>
          {["WORKSPACE", "INSIGHTS", "MANAGE"].map((label, g) => (
            <div className="v2-nav-group" key={label}>
              <div className="nav-section-label">
                <span>{label}</span>
                {g === 0 && (
                  <button
                    aria-label="Create assessment"
                    onClick={() => setNewExam(true)}
                  >
                    <Plus size={13} />
                  </button>
                )}
              </div>
              <nav aria-label={label}>
                {pages
                  .filter((p) => p.group === g && allowedPage(p.id))
                  .map((p) => (
                    <button
                      key={p.id}
                      className={`nav-item ${page === p.id ? "active" : ""}`}
                      onClick={() => navigate(p.id)}
                      aria-current={page === p.id ? "page" : undefined}
                    >
                      <p.icon size={17} strokeWidth={1.7} />
                      <span>{p.label}</span>
                      {p.id === "scanner" && (
                        <small className="nav-new">CV</small>
                      )}
                      {page === p.id && <i className="nav-active-dot" />}
                    </button>
                  ))}
              </nav>
            </div>
          ))}
          <div className="sidebar-bottom">
            <div className="v2-sidebar-promo">
              <Sparkles size={21} />
              <h3>
                Less marking.
                <br />
                More meaning.
              </h3>
              <p>
                A little technology.
                <br />A lot more teaching.
              </p>
              <button onClick={() => navigate("scanner")}>
                Make every answer count
                <ArrowUpRight size={14} />
              </button>
            </div>
            <button className="sidebar-help" onClick={() => setHelp(true)}>
              <CircleHelp size={17} />A little help
              <ArrowUpRight size={14} />
            </button>
            <button
              className="sidebar-profile"
              onClick={() => navigate("settings")}
            >
              <span className="teacher-avatar">
                {initials(session.user?.name || workspace.teacher)}
              </span>
              <span>
                <strong>{session.user?.name || workspace.teacher}</strong>
                <small>
                  {cloud
                    ? admin
                      ? "School administrator"
                      : "Teacher"
                    : "Device workspace"}
                </small>
              </span>
              <Settings2 size={15} />
            </button>
          </div>
        </aside>
        <div className="main-area">
          <header className="topbar">
            <div className="topbar-left">
              <button
                className="icon-button mobile-menu-button"
                aria-label="Open navigation"
                onClick={() => setMobile(true)}
              >
                <Menu size={21} />
              </button>
              <span className="breadcrumb">
                Workspace <span>/</span>{" "}
                <strong>{pages.find((p) => p.id === page)?.label}</strong>
              </span>
            </div>
            <div className="topbar-right">
              <button
                className="topbar-search"
                onClick={() => setSearchOpen(true)}
              >
                <Search size={16} />
                <span>Find a little clarity…</span>
                <kbd>
                  <Command size={10} />K
                </kbd>
              </button>
              <button
                className={`v2-storage-pill ${status}`}
                onClick={() => navigate("backups")}
                title={
                  cloud
                    ? "Shared server storage"
                    : "Device-only storage. No secure accounts or cross-device sync."
                }
              >
                {cloud ? <Cloud size={13} /> : <HardDrive size={13} />}
                <span>
                  {status === "saving"
                    ? "Saving…"
                    : status === "queued"
                      ? "Offline queue"
                      : status === "error" || status === "conflict"
                        ? "Not saved"
                        : cloud
                          ? "Shared workspace"
                          : "Device mode"}
                </span>
                <i />
              </button>
              <div className="popover-anchor">
                <button
                  className="icon-button notification-button"
                  aria-label="Notifications"
                  aria-expanded={notifications}
                  onClick={() => {
                    setNotifications((v) => !v);
                    setProfile(false);
                  }}
                >
                  <Bell size={18} />
                  {workspace.institutionSettings?.notifications !== false &&
                    review.length > 0 && <i />}
                </button>
                {notifications && (
                  <div className="popover v2-notifications">
                    <div className="popover-heading">
                      <strong>A little heads-up.</strong>
                      <button
                        className="icon-button"
                        aria-label="Close notifications"
                        onClick={() => setNotifications(false)}
                      >
                        <X size={15} />
                      </button>
                    </div>
                    <button
                      onClick={() => {
                        setNotifications(false);
                        if (
                          workspace.institutionSettings?.notifications === false
                        )
                          navigate("system");
                        else if (review[0]) setStudentId(review[0].id);
                        else navigate("scanner");
                      }}
                    >
                      <span className="stat-icon lavender">
                        <CheckCheck size={17} />
                      </span>
                      <span>
                        <strong>
                          {workspace.institutionSettings?.notifications ===
                          false
                            ? "Review notifications are paused."
                            : review.length
                              ? `${review.length} results need review`
                              : "You’re all caught up."}
                        </strong>
                        <small>
                          {workspace.institutionSettings?.notifications ===
                          false
                            ? "Change your institution notification preference in Sync & system."
                            : review.length
                              ? "Uncertain marks, identities, or missing pages."
                              : "Ready for your next assessment."}
                        </small>
                      </span>
                      <ArrowRight size={14} />
                    </button>
                    <p>
                      {cloud
                        ? "Changes are saved to your school’s server."
                        : "Device mode is separate from shared school accounts."}
                    </p>
                  </div>
                )}
              </div>
              <div className="popover-anchor">
                <button
                  className="profile-button"
                  aria-label="Your profile"
                  aria-expanded={profile}
                  onClick={() => {
                    setProfile((v) => !v);
                    setNotifications(false);
                  }}
                >
                  <span className="teacher-avatar">
                    {initials(session.user?.name || workspace.teacher)}
                  </span>
                  <ChevronDown size={12} />
                </button>
                {profile && (
                  <div className="popover profile-popover">
                    <strong>{session.user?.name || workspace.teacher}</strong>
                    <span>
                      {cloud ? session.user?.email : "Device-only workspace"}
                    </span>
                    <button onClick={() => navigate("settings")}>
                      <Settings2 size={15} />
                      Workspace settings
                    </button>
                    <button onClick={() => navigate("administration")}>
                      <ShieldCheck size={15} />
                      Team & access
                    </button>
                    {cloud ? (
                      <button
                        onClick={async () => {
                          if (
                            status !== "saved" &&
                            !confirm(
                              "Some changes are not saved. Export an unsaved-workspace backup first if you need them. Sign out and discard these changes?",
                            )
                          )
                            return;
                          try {
                            await session.logout();
                          } catch (e) {
                            toast(
                              e instanceof Error
                                ? e.message
                                : "Sign-out failed.",
                            );
                          }
                        }}
                      >
                        <LogOut size={15} />
                        Sign out
                      </button>
                    ) : session.available ? (
                      <button onClick={session.openLogin}>
                        <LogOut size={15} />
                        Secure school sign-in
                      </button>
                    ) : (
                      <small>Accounts require the FastAPI backend.</small>
                    )}
                  </div>
                )}
              </div>
            </div>
          </header>
          <main className={`main-content page-${page}`}>
            {session.warning && (
              <div className="v2-notice warning" role="alert">
                {session.warning}
              </div>
            )}
            {session.offline && cloud && (
              <div className="v2-notice warning">
                <Cloud size={18} />
                <p>
                  Offline / locked connection. Changes need an unlocked
                  encrypted vault before they can be queued safely.
                </p>
                <button
                  className="text-button"
                  onClick={() =>
                    session.reconnect().catch((e) => toast(e.message))
                  }
                >
                  Verify connection
                </button>
              </div>
            )}
            {(store.error || status === "conflict") && (
              <div className="v2-notice warning" role="alert">
                <CircleAlert size={18} />
                <div>
                  <strong>
                    {status === "conflict"
                      ? "Another session changed this workspace."
                      : "Your data needs attention."}
                  </strong>
                  <p>{store.error}</p>
                </div>
                <button
                  className="button button-secondary button-small"
                  onClick={() =>
                    downloadFile(
                      "markly-unsaved-workspace.json",
                      JSON.stringify(full),
                      "application/json",
                    )
                  }
                >
                  <ArrowDownToLine size={14} />
                  Export unsaved data
                </button>
                {status === "conflict" ? (
                  <button
                    className="button button-secondary button-small"
                    onClick={() => {
                      if (
                        confirm(
                          "Reload the server version? Unsaved changes will be discarded. Export them first.",
                        )
                      )
                        void store.reload();
                    }}
                  >
                    <RefreshCw size={14} />
                    Reload
                  </button>
                ) : (
                  <button
                    className="button button-secondary button-small"
                    onClick={store.retry}
                  >
                    Retry save
                  </button>
                )}
              </div>
            )}
            {workspace.results.some((r) => r.source === "demo") && (
              <div className="v2-demo-note">
                <Sparkles size={12} />
                <span>This workspace includes fictional sample records.</span>
                <button onClick={() => navigate("settings")}>
                  Create your own school <ArrowUpRight size={12} />
                </button>
              </div>
            )}
            <Suspense
              key={schoolId}
              fallback={
                <div className="page-loader">
                  <LoaderCircle className="spinning" size={24} />
                  <span>Opening your next perspective…</span>
                </div>
              }
            >
              {!allowedPage(page) && (
                <section className="card">
                  <EmptyState
                    icon={<ShieldCheck size={28} />}
                    title="This feature is not assigned to your account."
                    description="Your administrator controls examination, scanning, reporting and school-management permissions."
                  />
                </section>
              )}
              {page === "overview" && (
                <Dashboard
                  workspace={workspace}
                  exam={exam}
                  results={results}
                  setExamId={setExamId}
                  navigate={navigate}
                  onOpen={(r) => setStudentId(r.id)}
                  onExport={exportResults}
                  onQuestion={(q) => {
                    setQuestion(q);
                    navigate("analytics");
                  }}
                />
              )}
              {page === "keys" && allowedPage("keys") && (
                <AnswerKeys
                  workspace={workspace}
                  exam={exam}
                  setExamId={setExamId}
                  onSave={updateExam}
                  onCreate={createExam}
                  navigate={navigate}
                  toast={toast}
                />
              )}
              {page === "templates" && allowedPage("templates") && (
                <Templates
                  workspace={workspace}
                  exam={exam}
                  setExamId={setExamId}
                  onSave={updateExam}
                  toast={toast}
                />
              )}
              {page === "scanner" && allowedPage("scanner") && (
                <Scanner
                  key={`${schoolId}-${exam.id}`}
                  workspace={workspace}
                  exam={exam}
                  results={results}
                  setExamId={setExamId}
                  navigate={navigate}
                  onResults={onScans}
                  onOpen={(r) => setStudentId(r.id)}
                  toast={toast}
                  onBusy={setScanBusy}
                />
              )}
              {page === "students" && (
                <Roster
                  workspace={workspace}
                  exam={exam}
                  results={results}
                  setExamId={setExamId}
                  navigate={navigate}
                  onOpen={(r) => setStudentId(r.id)}
                  onUpdate={updateScoped}
                  toast={toast}
                  reload={store.reload}
                  saveStatus={status}
                />
              )}
              {page === "analytics" && allowedPage("analytics") && (
                <Analytics
                  workspace={workspace}
                  exam={exam}
                  results={results}
                  setExamId={setExamId}
                  question={question}
                  setQuestion={setQuestion}
                  toast={toast}
                />
              )}
              {page === "leaderboard" && allowedPage("leaderboard") && (
                <Leaderboard
                  workspace={workspace}
                  exam={exam}
                  results={results}
                  setExamId={setExamId}
                  onOpen={(r) => setStudentId(r.id)}
                />
              )}
              {page === "reports" && allowedPage("reports") && (
                <Reports
                  workspace={workspace}
                  exam={exam}
                  results={results}
                  setExamId={setExamId}
                  toast={toast}
                />
              )}
              {page === "settings" && (
                <Settings
                  key={schoolId}
                  workspace={workspace}
                  onUpdate={updateScoped}
                  onAddSchool={addSchool}
                  navigate={navigate}
                  toast={toast}
                />
              )}
              {page === "backups" && allowedPage("backups") && (
                <Backups
                  workspace={cloud ? workspace : full}
                  onRestore={(data) => setWorkspace(enrichWorkspace(data))}
                  reload={store.reload}
                  toast={toast}
                  revision={store.revision}
                />
              )}
              {page === "administration" && allowedPage("administration") && (
                <Administration workspace={workspace} toast={toast} />
              )}
              {page === "batches" && allowedPage("batches") && (
                <BatchCenter
                  workspace={workspace}
                  exam={exam}
                  setExamId={setExamId}
                  revision={store.revision}
                  reload={store.reload}
                  saveStatus={status}
                  toast={toast}
                  onOpen={setStudentId}
                />
              )}
              {page === "evaluation" && allowedPage("evaluation") && (
                <EvaluationCenter
                  workspace={workspace}
                  exam={exam}
                  setExamId={setExamId}
                  onSave={updateExam}
                  toast={toast}
                  revision={store.revision}
                  reload={store.reload}
                  status={status}
                />
              )}
              {page === "system" && (
                <SystemCenter
                  workspace={workspace}
                  revision={store.revision}
                  reload={store.reload}
                  status={status}
                  toast={toast}
                />
              )}
            </Suspense>
            <footer className="v2-page-footer">
              <span>
                omr<span> PRO</span> <i /> Every answer, accounted for.
              </span>
              <span>
                <span className="live-dot" />
                {cloud
                  ? "CONNECTED TO SCHOOL SERVER"
                  : "PRIVATE DEVICE WORKSPACE"}
              </span>
            </footer>
          </main>
        </div>
      </div>
      <nav className="mobile-bottom-nav" aria-label="Quick navigation">
        {pages
          .filter(
            (p) =>
              [
                "overview",
                "scanner",
                "students",
                "analytics",
                "settings",
              ].includes(p.id) && allowedPage(p.id),
          )
          .map((p) => (
            <button
              key={p.id}
              className={page === p.id ? "active" : ""}
              aria-current={page === p.id ? "page" : undefined}
              onClick={() => navigate(p.id)}
            >
              <p.icon size={19} />
              <span>
                {p.id === "overview"
                  ? "Home"
                  : p.id === "scanner"
                    ? "Scan"
                    : p.id === "analytics"
                      ? "Insights"
                      : p.label}
              </span>
            </button>
          ))}
      </nav>
      <PrintReport workspace={workspace} exam={exam} results={results} />
      {student && (
        <StudentDetail
          key={student.id}
          workspace={workspace}
          result={student}
          exam={workspace.exams.find((e) => e.id === student.examId)!}
          allResults={workspace.results.filter(
            (r) => r.examId === student.examId,
          )}
          onClose={() => setStudentId(null)}
          onUpdate={updateResult}
          onDelete={() => {
            if (!allowedPage("scanner")) {
              toast("Your account cannot delete results.");
              return;
            }
            updateScoped({
              ...workspace,
              results: workspace.results.filter((r) => r.id !== student.id),
            });
            setStudentId(null);
            toast(
              "Assessment result deleted. The student register and other assessments are unchanged.",
            );
          }}
          toast={toast}
        />
      )}
      {newExam && (
        <NewExamModal
          onClose={() => setNewExam(false)}
          onCreate={(e) => {
            createExam(e);
            setNewExam(false);
          }}
        />
      )}
      {searchOpen && (
        <Modal
          title="Find a little clarity."
          className="search-modal"
          onClose={() => setSearchOpen(false)}
        >
          <div className="modal-body">
            <SearchInput
              value={search}
              onChange={setSearch}
              placeholder="Find a student, roll number, or assessment…"
            />
            {searchExams.length > 0 && (
              <>
                <p className="search-label">ASSESSMENTS</p>
                <div className="search-results">
                  {searchExams.map((e) => (
                    <button
                      key={e.id}
                      onClick={() => {
                        setExamId(e.id);
                        setSearchOpen(false);
                        navigate("keys");
                      }}
                    >
                      <span className="stat-icon green">
                        <BookOpen size={17} />
                      </span>
                      <span>
                        <strong>{e.title}</strong>
                        <small>
                          {e.subject} · {e.questions} questions
                        </small>
                      </span>
                      <ArrowUpRight size={16} />
                    </button>
                  ))}
                </div>
              </>
            )}
            <p className="search-label">STUDENTS IN THIS ASSESSMENT</p>
            <div className="search-results">
              {searchResults.map((r, i) => (
                <button
                  key={r.id}
                  onClick={() => {
                    setSearchOpen(false);
                    setStudentId(r.id);
                  }}
                >
                  <Avatar name={r.name} index={i} />
                  <span>
                    <strong>{r.name}</strong>
                    <small>
                      {r.roll} · Class {r.section}
                    </small>
                  </span>
                  <ArrowUpRight size={16} />
                </button>
              ))}
            </div>
            {!searchExams.length && !searchResults.length && (
              <EmptyState
                title="Nothing here just yet."
                description="Try another name, roll number, or assessment."
              />
            )}
          </div>
        </Modal>
      )}
      {help && (
        <Modal
          title="A little help. A lot of clarity."
          className="help-modal"
          onClose={() => setHelp(false)}
        >
          <div className="modal-body">
            <div className="v2-help-step">
              <span>01</span>
              <div>
                <h3>Register your classroom.</h3>
                <p>
                  Add a school and classes in Settings. Register students
                  individually or import CSV / XLSX. Roll numbers must be unique
                  within a school.
                </p>
              </div>
            </div>
            <div className="v2-help-step">
              <span>02</span>
              <div>
                <h3>Build the right key and layout.</h3>
                <p>
                  Create an exam with 1–500 questions and A–D or A–E options.
                  Add non-overlapping subject ranges. In Layout studio, adjust
                  fields, bubble spacing, registration points, and the OCR crop.
                  Print at 100% scale.
                </p>
              </div>
            </div>
            <div className="v2-help-step">
              <span>03</span>
              <div>
                <h3>Scan a sample. Then your whole batch.</h3>
                <p>
                  Use upright, evenly lit photos or multipage PDFs. OpenCV
                  aligns the page; OCR or a printed QR links identity. For
                  legacy PDFs without QR codes, check each page number and enter
                  a roll number or use OCR. Keep four markers visible, or
                  calibrate paper-edge mode.
                </p>
              </div>
            </div>
            <div className="v2-help-step">
              <span>04</span>
              <div>
                <h3>A human touch matters.</h3>
                <p>
                  Review uncertain marks, low-confidence identities, and missing
                  pages. Manually correct responses to rescore instantly. Only
                  complete, reviewed results enter averages, rankings, and
                  percentiles.
                </p>
              </div>
            </div>
            <div className="v2-help-step">
              <span>05</span>
              <div>
                <h3>Keep your progress protected.</h3>
                <p>
                  Device mode saves only to your browser. GitHub Pages cannot
                  run accounts or a database. The included FastAPI server
                  provides secure accounts and PostgreSQL data when separately
                  hosted. Download regular backups and keep an off-device copy.
                </p>
              </div>
            </div>
          </div>
          <div className="modal-footer">
            <button
              className="button button-primary"
              onClick={() => setHelp(false)}
            >
              A little clearer. Thank you.
              <Check size={15} />
            </button>
          </div>
        </Modal>
      )}
      {toastMessage && (
        <div key={toastMessage.id} className="toast" role="status">
          <span aria-hidden="true">
            <Check size={17} />
          </span>
          <p>{toastMessage.text}</p>
          <button
            aria-label="Dismiss notification"
            onClick={() => setToastMessage(null)}
          >
            <X size={15} />
          </button>
        </div>
      )}
    </>
  );
}
