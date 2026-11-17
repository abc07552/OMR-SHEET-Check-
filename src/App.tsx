import { useCallback, useEffect, useRef, useState } from "react";
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
  ChevronsUpDown,
  CircleHelp,
  Command,
  FileChartColumn,
  GraduationCap,
  KeyRound,
  LayoutDashboard,
  LifeBuoy,
  Menu,
  Plus,
  ScanLine,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Users,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { Exam, Page, Result, Workspace } from "./data";
import { downloadFile, initials, loadWorkspace, resultsCSV } from "./data";
import { downloadTemplate } from "./omr";
import { Avatar, EmptyState, Logo, Modal, SearchInput } from "./components";
import Overview from "./Overview";
import AnswerKeys, { NewExamModal } from "./AnswerKeys";
import Scanner from "./Scanner";
import Students, { StudentDetail } from "./Students";
import Analytics from "./Analytics";
import Reports, { PrintReport } from "./Reports";
import Settings from "./Settings";

const pages: { id: Page; label: string; icon: LucideIcon }[] = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "scanner", label: "Scan sheets", icon: ScanLine },
  { id: "keys", label: "Answer keys", icon: KeyRound },
  { id: "students", label: "Students", icon: Users },
  { id: "analytics", label: "Analytics", icon: ChartNoAxesCombined },
  { id: "reports", label: "Reports", icon: FileChartColumn },
  { id: "settings", label: "Settings", icon: Settings2 },
];
function currentPage(): Page {
  const hash = window.location.hash.slice(1);
  return pages.some((p) => p.id === hash) ? (hash as Page) : "overview";
}
export default function App() {
  const [workspace, setWorkspace] = useState<Workspace>(loadWorkspace);
  const [page, setPage] = useState<Page>(currentPage);
  const [examId, setExamId] = useState(
    () => workspace.exams[workspace.exams.length - 1].id,
  );
  const [student, setStudent] = useState<Result | null>(null);
  const [question, setQuestion] = useState(1);
  const [searchOpen, setSearchOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [helpOpen, setHelpOpen] = useState(false);
  const [newExamOpen, setNewExamOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [unread, setUnread] = useState(true);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [toastMessage, setToastMessage] = useState<{
    text: string;
    id: number;
  } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const exam =
    workspace.exams.find((e) => e.id === examId) ||
    workspace.exams[workspace.exams.length - 1];
  const results = workspace.results.filter((r) => r.examId === exam.id);
  const isDemo = workspace.results.some((r) => r.source === "demo");
  const toast = useCallback((text: string) => {
    setToastMessage({ text, id: Date.now() });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastMessage(null), 5000);
  }, []);
  const navigate = (p: Page) => {
    setPage(p);
    window.location.hash = p;
    setMobileOpen(false);
    setProfileOpen(false);
    setNotificationsOpen(false);
    window.scrollTo({ top: 0, behavior: "instant" });
  };
  useEffect(() => {
    const listener = () => setPage(currentPage());
    window.addEventListener("hashchange", listener);
    return () => window.removeEventListener("hashchange", listener);
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem("markly-workspace-v1", JSON.stringify(workspace));
    } catch {
      toast(
        "This browser could not save your workspace. Download a backup from Settings to keep your changes.",
      );
    }
  }, [workspace, toast]);
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
    document.title = `${pages.find((p) => p.id === page)?.label || "Overview"} — Markly`;
  }, [page]);
  const updateExam = (updated: Exam) =>
    setWorkspace((w) => ({
      ...w,
      exams: w.exams.map((e) => (e.id === updated.id ? updated : e)),
    }));
  const createExam = (created: Exam) => {
    setWorkspace((w) => ({ ...w, exams: [...w.exams, created] }));
    setExamId(created.id);
    navigate("keys");
    toast("Your new answer key is ready. Let’s add the right answers.");
  };
  const exportResults = () => {
    downloadFile(`markly-report-${exam.id}.csv`, resultsCSV(results, exam));
    toast(
      `${results.length} student results exported. Find them in your downloads.`,
    );
  };
  const openQuestion = (q: number) => {
    setQuestion(q);
    navigate("analytics");
  };
  const searchResults = workspace.results
    .filter(
      (r) =>
        r.examId === exam.id &&
        (!search ||
          `${r.name} ${r.roll}`.toLowerCase().includes(search.toLowerCase())),
    )
    .slice(0, 6);
  const searchExams = workspace.exams
    .filter(
      (e) =>
        search &&
        `${e.title} ${e.subject}`.toLowerCase().includes(search.toLowerCase()),
    )
    .slice(0, 3);
  const reviewCount = results.filter(
    (r) => r.flagged.length && !r.confirmed,
  ).length;
  const sidebarNav = (p: (typeof pages)[number]) => (
    <button
      key={p.id}
      className={`nav-item ${page === p.id ? "active" : ""}`}
      onClick={() => navigate(p.id)}
      aria-current={page === p.id ? "page" : undefined}
      title={p.label}
    >
      <p.icon size={18} strokeWidth={1.7} />
      <span>{p.label}</span>
      {p.id === "scanner" && <small className="nav-new">NEW</small>}
      {page === p.id && <i className="nav-active-dot" />}
    </button>
  );
  return (
    <>
      <div className="app-shell">
        {mobileOpen && (
          <button
            aria-label="Close navigation"
            className="mobile-sidebar-backdrop"
            onClick={() => setMobileOpen(false)}
          />
        )}
        <aside className={`sidebar ${mobileOpen ? "sidebar-open" : ""}`}>
          <button
            className="logo-button"
            onClick={() => navigate("overview")}
            aria-label="Markly home"
          >
            <Logo />
          </button>
          <button
            className="workspace-switch"
            onClick={() => navigate("settings")}
          >
            <span className="workspace-icon">
              <GraduationCap size={18} />
            </span>
            <span>
              <strong>My workspace</strong>
              <small>Teacher workspace</small>
            </span>
            <ChevronsUpDown size={13} />
          </button>
          <div className="nav-section-label nav-label-with-action">
            <span>WORKSPACE</span>
            <button
              aria-label="Create a new answer key"
              title="New answer key"
              onClick={() => setNewExamOpen(true)}
            >
              <Plus size={12} />
            </button>
          </div>
          <nav aria-label="Main navigation">
            {pages.slice(0, 5).map(sidebarNav)}
          </nav>
          <div className="nav-section-label tools-label">ORGANISE</div>
          <nav aria-label="Workspace tools">
            {pages.slice(5).map(sidebarNav)}
          </nav>
          <div className="sidebar-bottom">
            <div className="sidebar-promo">
              <div className="promo-art">
                <span>✳</span>
                <i />
                <svg viewBox="0 0 120 54">
                  <path
                    d="M8 42C22 6 47 1 60 27s32 12 44-12"
                    fill="none"
                    stroke="#5e7f4f"
                    strokeWidth="1.3"
                    strokeDasharray="3 4"
                  />
                  <path
                    d="m96 15 10-3-1 11"
                    fill="none"
                    stroke="#5e7f4f"
                    strokeWidth="1.3"
                  />
                </svg>
              </div>
              <h3>
                A little less marking.
                <br />A lot more meaning.
              </h3>
              <p>
                Make room for your next
                <br />
                great teaching moment.
              </p>
              <button onClick={() => navigate("keys")}>
                Explore answer keys
                <ArrowUpRight size={14} />
              </button>
            </div>
            <button className="sidebar-help" onClick={() => setHelpOpen(true)}>
              <LifeBuoy size={17} />
              <span>A little help?</span>
              <ArrowUpRight size={14} />
            </button>
            <button
              className="school-profile"
              onClick={() => navigate("settings")}
            >
              <span className="school-avatar">
                G<span>✳</span>
              </span>
              <span>
                <strong>{workspace.school}</strong>
                <small>
                  <i />
                  {isDemo ? "Demo workspace" : "Local workspace"}
                </small>
              </span>
              <ChevronsUpDown size={13} />
            </button>
          </div>
        </aside>
        <div className="main-shell">
          <header className="topbar">
            <div className="breadcrumb">
              <button
                className="mobile-menu icon-button"
                aria-label="Open navigation"
                onClick={() => setMobileOpen(true)}
              >
                <Menu size={20} />
              </button>
              <span className="breadcrumb-workspace">
                <LayoutDashboard size={15} />
                <span>Workspace</span>
              </span>
              <span className="breadcrumb-slash">/</span>
              <strong>{pages.find((p) => p.id === page)?.label}</strong>
            </div>
            <div className="topbar-actions">
              <button
                className="global-search"
                onClick={() => {
                  setSearchOpen(true);
                  setSearch("");
                }}
              >
                <Search size={15} />
                <span>Search anything...</span>
                <kbd>⌘ K</kbd>
              </button>
              <span className="topbar-divider" />
              <div className="popover-anchor">
                <button
                  className={`icon-button notification-button ${notificationsOpen ? "is-open" : ""}`}
                  aria-label="Notifications"
                  aria-expanded={notificationsOpen}
                  onClick={() => {
                    setNotificationsOpen((v) => !v);
                    setProfileOpen(false);
                  }}
                >
                  <Bell size={18} />
                  {unread && <i />}
                </button>
                {notificationsOpen && (
                  <>
                    <button
                      className="popover-dismiss"
                      tabIndex={-1}
                      aria-label="Close notifications"
                      onClick={() => setNotificationsOpen(false)}
                    />
                    <div className="popover notifications-popover">
                      <div className="popover-title">
                        <strong>Your little updates</strong>
                        <button
                          className="text-button"
                          onClick={() => setUnread(false)}
                        >
                          {unread ? (
                            "Mark all read"
                          ) : (
                            <>
                              <CheckCheck size={13} />
                              All caught up
                            </>
                          )}
                        </button>
                      </div>
                      <button
                        className="notification-item"
                        onClick={() => {
                          navigate("students");
                          setUnread(false);
                        }}
                      >
                        <span className="stat-icon yellow">
                          <ScanLine size={17} />
                        </span>
                        <span>
                          <strong>
                            {reviewCount
                              ? `${reviewCount} sheets could use your eyes.`
                              : "Your classroom is all caught up."}
                          </strong>
                          <small>
                            {reviewCount
                              ? "A quick review turns uncertain marks into clear insights."
                              : "No answer sheets are waiting for review."}
                          </small>
                          <time>In this assessment</time>
                        </span>
                      </button>
                      <button
                        className="notification-item"
                        onClick={() => {
                          navigate("keys");
                          setUnread(false);
                        }}
                      >
                        <span className="stat-icon green">
                          <Sparkles size={17} />
                        </span>
                        <span>
                          <strong>A good day for a fresh perspective.</strong>
                          <small>
                            Your workspace is ready. Let’s make every answer
                            count.
                          </small>
                          <time>Welcome to Markly</time>
                        </span>
                      </button>
                      <div className="notification-footer">
                        A little nudge. Never a distraction.
                      </div>
                    </div>
                  </>
                )}
              </div>
              <button
                className="icon-button topbar-help"
                aria-label="Help and scanning instructions"
                onClick={() => setHelpOpen(true)}
              >
                <CircleHelp size={18} />
              </button>
              <div className="popover-anchor">
                <button
                  className="profile-button"
                  aria-label="Your profile"
                  aria-expanded={profileOpen}
                  onClick={() => {
                    setProfileOpen((v) => !v);
                    setNotificationsOpen(false);
                  }}
                >
                  <span className="teacher-avatar">
                    {initials(workspace.teacher)}
                  </span>
                  <ChevronDown size={12} />
                </button>
                {profileOpen && (
                  <>
                    <button
                      className="popover-dismiss"
                      tabIndex={-1}
                      aria-label="Close profile menu"
                      onClick={() => setProfileOpen(false)}
                    />
                    <div className="popover profile-popover">
                      <strong>{workspace.teacher}</strong>
                      <span>Educator · {workspace.school}</span>
                      <button onClick={() => navigate("settings")}>
                        <Settings2 size={15} />
                        Workspace settings
                      </button>
                      <button
                        onClick={() => {
                          setProfileOpen(false);
                          setHelpOpen(true);
                        }}
                      >
                        <CircleHelp size={15} />
                        Help & getting started
                      </button>
                      <small>
                        <ShieldCheck size={12} />
                        Private, local workspace
                      </small>
                    </div>
                  </>
                )}
              </div>
            </div>
          </header>
          <main className={`main-content page-${page}`} key={page}>
            {page === "overview" && (
              <Overview
                workspace={workspace}
                exam={exam}
                results={results}
                setExamId={setExamId}
                navigate={navigate}
                onOpen={setStudent}
                onExport={exportResults}
                onQuestion={openQuestion}
              />
            )}
            {page === "keys" && (
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
            {page === "scanner" && (
              <Scanner
                key={exam.id}
                workspace={workspace}
                exam={exam}
                results={results}
                setExamId={setExamId}
                navigate={navigate}
                onResults={(fresh) =>
                  setWorkspace((w) => ({
                    ...w,
                    results: [
                      ...w.results,
                      ...fresh.filter((r) =>
                        w.exams.some((e) => e.id === r.examId),
                      ),
                    ],
                  }))
                }
                onOpen={setStudent}
                toast={toast}
              />
            )}
            {page === "students" && (
              <Students
                workspace={workspace}
                exam={exam}
                results={results}
                setExamId={setExamId}
                navigate={navigate}
                onOpen={setStudent}
                toast={toast}
              />
            )}
            {page === "analytics" && (
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
            {page === "reports" && (
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
                workspace={workspace}
                onUpdate={(data) => {
                  setWorkspace(data);
                  if (!data.exams.some((e) => e.id === examId))
                    setExamId(data.exams[data.exams.length - 1].id);
                }}
                toast={toast}
              />
            )}
          </main>
        </div>
      </div>
      <PrintReport workspace={workspace} exam={exam} results={results} />
      {student && (
        <StudentDetail
          result={student}
          exam={workspace.exams.find((e) => e.id === student.examId)!}
          allResults={workspace.results.filter(
            (r) => r.examId === student.examId,
          )}
          onClose={() => setStudent(null)}
          onUpdate={(updated) =>
            setWorkspace((w) => ({
              ...w,
              results: w.results.map((r) =>
                r.id === updated.id ? updated : r,
              ),
            }))
          }
          toast={toast}
        />
      )}
      {newExamOpen && (
        <NewExamModal
          onClose={() => setNewExamOpen(false)}
          onCreate={(created) => {
            createExam(created);
            setNewExamOpen(false);
          }}
        />
      )}
      {searchOpen && (
        <Modal
          title="Find a little clarity"
          onClose={() => setSearchOpen(false)}
          className="search-modal"
        >
          <div className="modal-body">
            <SearchInput
              value={search}
              onChange={setSearch}
              placeholder="Find a student, roll number, or assessment..."
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
            <p className="search-label">
              {search ? "STUDENTS IN THIS ASSESSMENT" : "YOUR CLASSROOM"}
            </p>
            <div className="search-results">
              {searchResults.map((r, i) => (
                <button
                  key={r.id}
                  onClick={() => {
                    setSearchOpen(false);
                    setStudent(r);
                  }}
                >
                  <Avatar name={r.name} index={i} />
                  <span>
                    <strong>{r.name}</strong>
                    <small>
                      Roll {r.roll} · Class {r.section}
                    </small>
                  </span>
                  <ArrowUpRight size={16} />
                </button>
              ))}
            </div>
            {!searchResults.length && !searchExams.length && (
              <EmptyState
                icon={<Search size={25} />}
                title="Nothing here just yet."
                description="Try another name, roll number, or assessment."
              />
            )}
          </div>
          <div className="search-modal-footer">
            <span>
              <Command size={12} /> K to open search
            </span>
            <span>
              <kbd>esc</kbd> to close
            </span>
          </div>
        </Modal>
      )}
      {helpOpen && (
        <Modal
          title="A little help, a lot of clarity."
          onClose={() => setHelpOpen(false)}
          className="help-modal"
        >
          <div className="modal-body">
            <div className="help-intro">
              <span className="stat-icon green">
                <LifeBuoy size={24} />
              </span>
              <p>
                Less time figuring things out.
                <br />
                <strong>More time doing what you do best.</strong>
              </p>
            </div>
            <details open>
              <summary>How do I check my first OMR sheet?</summary>
              <p>
                1. Open Answer keys and create an assessment.
                <br />
                2. Set the correct option for every question and save.
                <br />
                3. Download and print the Markly OMR template.
                <br />
                4. Upload filled sheets in Scan sheets, then check the student
                names.
                <br />
                5. Select Check sheets. Your results and analysis are ready.
              </p>
            </details>
            <details>
              <summary>Can I scan any OMR format?</summary>
              <p>
                Currently, the scanner reads Markly templates only. Use an
                upright PNG, JPG, or WebP image with all four corner squares
                visible. Keep the page flat and evenly lit. Standardised sheets
                let us grade your answers without sending images to an external
                service.
              </p>
            </details>
            <details>
              <summary>How are unclear marks handled?</summary>
              <p>
                Multiple filled bubbles and lightly shaded marks are flagged for
                review. Open a student result, choose each highlighted question,
                confirm A, B, C, D or Unanswered, and save. Those sheets are
                excluded from averages until reviewed.
              </p>
            </details>
            <details>
              <summary>Is my student data private?</summary>
              <p>
                Yes. Sheet images are processed in your browser and are not
                stored or uploaded. Results and keys are saved in this browser’s
                local storage. Export a workspace backup in Settings before
                clearing browser data or moving devices.
              </p>
            </details>
            <details>
              <summary>Is this real student data?</summary>
              <p>
                The initial workspace contains clearly labelled, fictional
                sample data so you can explore. Choose Start a fresh workspace
                in Settings when you’re ready to use your own sheets.
              </p>
            </details>
            <button
              className="button button-secondary full-width"
              onClick={() => downloadTemplate(exam)}
            >
              <ArrowDownToLine size={15} />
              Download your OMR template
            </button>
          </div>
          <div className="modal-footer">
            <button
              className="button button-primary"
              onClick={() => setHelpOpen(false)}
            >
              Got it. Let’s grow.
              <ArrowRight size={15} />
            </button>
          </div>
        </Modal>
      )}
      {toastMessage && (
        <div key={toastMessage.id} className="toast" role="status">
          <span>
            <Check size={16} />
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
