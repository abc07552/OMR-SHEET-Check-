import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  ArrowDownToLine,
  BookOpen,
  CheckCheck,
  GraduationCap,
  LoaderCircle,
  LockKeyhole,
  LogOut,
  RefreshCw,
  ShieldCheck,
  Target,
  TrendingUp,
  UserRound,
  WifiOff,
} from "lucide-react";
import { Avatar, EmptyState, Logo, Modal, Select } from "./components";
import { api, apiDownload, useSession } from "./session";
import {
  cachePortal,
  cachedPortal,
  enablePortalVault,
  vaultEnabled,
} from "./offline";
import { downloadFile, formatDate } from "./data";
import { makePDF } from "./documents";
import { queryClient } from "./query";
interface PersonalResult {
  id: string;
  examId: string;
  title: string;
  subject: string;
  date: string;
  rank: number;
  percentile: number;
  cohort: number;
  evaluation: {
    score: number;
    maximum: number;
    percentage: number;
    grade: string;
    status: string;
    correct: number;
    wrong: number;
    blank: number;
    subjects: {
      name: string;
      score: number;
      maximum: number;
      percentage: number;
    }[];
    questions: {
      question: number;
      selected: string[];
      expected: string[];
      status: string;
      marks: number;
    }[];
  };
}
interface Portal {
  student: {
    id: string;
    name: string;
    roll: string;
    section: string;
    email?: string;
    phone?: string;
    guardian?: string;
  };
  school: { name: string; code: string; address: string };
  user: { name: string; email: string };
  results: PersonalResult[];
}
export default function StudentPortal() {
  const session = useSession(),
    school = session.activeSchool;
  const [tab, setTab] = useState<"results" | "progress" | "profile">("results"),
    [selected, setSelected] = useState<PersonalResult | null>(null),
    [busy, setBusy] = useState(""),
    [notice, setNotice] = useState(""),
    [passphrase, setPassphrase] = useState(""),
    [phone, setPhone] = useState(""),
    [guardian, setGuardian] = useState("");
  const query = useQuery<Portal>({
    queryKey: ["private-portal", session.user?.id, school, session.offline],
    queryFn: async () => {
      if (session.offline) {
        const cached = cachedPortal<Portal>(school);
        if (!cached)
          throw new Error(
            "Your private results have not been saved to this device. Reconnect first.",
          );
        return cached;
      }
      return api(`/schools/${school}/portal`);
    },
    retry: false,
  });
  const data = query.data;
  useEffect(() => {
    if (!data) return;
    setPhone(data.student.phone || "");
    setGuardian(data.student.guardian || "");
    if (!session.offline && vaultEnabled(session.user?.id))
      void cachePortal(school, data).catch((e) => setNotice(String(e)));
  }, [data, school]);
  const profile = useMutation({
    mutationFn: () =>
      api(`/schools/${school}/portal/profile`, {
        method: "PATCH",
        body: JSON.stringify({ phone, guardian }),
      }),
    onSuccess: async () => {
      setNotice(
        "Your contact profile was updated. Registration identity remains administrator-managed.",
      );
      await queryClient.invalidateQueries({
        queryKey: ["private-portal", session.user?.id, school],
      });
    },
    onError: (e) => setNotice(e.message),
  });
  const download = async (
    r: PersonalResult,
    format: "pdf" | "xlsx" | "csv",
  ) => {
    setBusy(r.id + format);
    setNotice("");
    try {
      if (!session.offline)
        await apiDownload(
          `/schools/${school}/reports/student?examId=${encodeURIComponent(r.examId)}&resultId=${encodeURIComponent(r.id)}&format=${format}`,
          `report-card-${formatDate(r.date).replace(/\s+/g, "-")}.${format}`,
        );
      else if (format === "pdf") {
        const doc = await makePDF(),
          { default: autoTable } = await import("jspdf-autotable");
        doc.setFontSize(18);
        doc.text(data!.school.name, 15, 20);
        doc.setFontSize(10);
        doc.text(
          `${data!.student.name} · Roll ${data!.student.roll} · ${data!.student.section}`,
          15,
          31,
        );
        doc.text(r.title, 15, 40);
        doc.text(
          `${r.evaluation.score}/${r.evaluation.maximum} · ${r.evaluation.percentage.toFixed(2)}% · Grade ${r.evaluation.grade} · ${r.evaluation.status}`,
          15,
          49,
        );
        doc.text(
          `Rank ${r.rank}/${r.cohort} · Percentile ${r.percentile.toFixed(2)} · Offline authorized copy`,
          15,
          58,
        );
        autoTable(doc, {
          startY: 67,
          head: [["Question", "Selected", "Correct", "Status", "Marks"]],
          body: r.evaluation.questions.map((q) => [
            q.question,
            q.selected.join(", ") || "—",
            q.expected.join(", "),
            q.status,
            q.marks,
          ]),
          styles: { font: doc.getFont().fontName, fontSize: 8 },
          headStyles: { fillColor: [27, 58, 110] },
        });
        await downloadFile("my-report-card.pdf", doc.output("blob"));
      } else {
        const rows = [
          ["Question", "Selected", "Correct", "Status", "Marks"],
          ...r.evaluation.questions.map((q) => [
            q.question,
            q.selected.join(" "),
            q.expected.join(" "),
            q.status,
            q.marks,
          ]),
        ];
        if (format === "xlsx") {
          const { default: ExcelJS } = await import("exceljs");
          const book = new ExcelJS.Workbook();
          const sheet = book.addWorksheet("My result");
          sheet.addRows(rows);
          sheet.getRow(1).font = { bold: true };
          await downloadFile(
            "my-report-card.xlsx",
            new Blob([(await book.xlsx.writeBuffer()) as BlobPart]),
          );
        } else
          await downloadFile(
            "my-report-card.csv",
            "\ufeff" +
              rows
                .map((row) =>
                  row
                    .map((c) => `"${String(c).replaceAll('"', '""')}"`)
                    .join(","),
                )
                .join("\r\n"),
            "text/csv",
          );
      }
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Report download failed.");
    } finally {
      setBusy("");
    }
  };
  if (query.isPending)
    return (
      <div className="initial-loader">
        <Logo />
        <LoaderCircle className="spinning" />
        <p>Opening your private learning space…</p>
      </div>
    );
  if (!data)
    return (
      <div className="initial-loader">
        <Logo />
        <p role="alert">
          {query.error?.message || "Your portal is unavailable."}
        </p>
        <button
          className="button button-primary"
          onClick={() => void query.refetch()}
        >
          Retry
        </button>
        <button
          className="text-button"
          onClick={() => session.logout().catch((e) => setNotice(e.message))}
        >
          Sign out
        </button>
        {notice && <p>{notice}</p>}
      </div>
    );
  const average = data.results.length
    ? data.results.reduce((sum, r) => sum + r.evaluation.percentage, 0) /
      data.results.length
    : 0;
  const trend = data.results.map((r) => ({
    name: r.title,
    score: r.evaluation.percentage,
  }));
  return (
    <div className="portal-shell">
      <header className="portal-topbar">
        <Logo />
        <span className="portal-private">
          <ShieldCheck size={14} />
          PRIVATE STUDENT SPACE
        </span>
        <div className="row-actions">
          <Select
            aria-label="Student institution"
            value={school}
            onChange={(e) => session.setSchool(e.target.value)}
          >
            {session.user?.memberships
              .filter((m) => m.role === "student")
              .map((m) => (
                <option value={m.schoolId} key={m.schoolId}>
                  {m.name}
                </option>
              ))}
          </Select>
          <button
            className="icon-button"
            aria-label="Sign out"
            onClick={() => session.logout().catch((e) => setNotice(e.message))}
          >
            <LogOut size={18} />
          </button>
        </div>
      </header>
      <main className="portal-content">
        <div className="portal-welcome">
          <div>
            <span className="eyebrow">YOUR EFFORT. YOUR PROGRESS.</span>
            <h1>Keep moving forward, {data.student.name.split(" ")[0]}.</h1>
            <p>
              {data.school.name} <span>·</span> Roll {data.student.roll}{" "}
              <span>·</span> {data.student.section}
            </p>
          </div>
          <Avatar name={data.student.name} large />
        </div>
        {session.offline && (
          <div className="v2-notice warning">
            <WifiOff size={18} />
            <p>
              Encrypted offline copy · new results and profile changes require a
              connection.
            </p>
            <button
              className="text-button"
              onClick={() =>
                session.reconnect().catch((e) => setNotice(e.message))
              }
            >
              Reconnect
            </button>
          </div>
        )}
        {notice && (
          <div className="v2-notice" role="status">
            {notice}
            <button
              className="icon-button"
              aria-label="Dismiss message"
              onClick={() => setNotice("")}
            >
              ×
            </button>
          </div>
        )}
        <div className="v2-tabs">
          {(
            [
              { id: "results", text: "My results", icon: BookOpen },
              { id: "progress", text: "My progress", icon: TrendingUp },
              { id: "profile", text: "My profile", icon: UserRound },
            ] as const
          ).map((t) => (
            <button
              key={t.id}
              className={tab === t.id ? "active" : ""}
              onClick={() => setTab(t.id)}
            >
              <t.icon size={16} />
              {t.text}
            </button>
          ))}
        </div>
        <div className="portal-stat-grid">
          {[
            {
              label: "Published results",
              value: data.results.length,
              icon: CheckCheck,
            },
            {
              label: "Average performance",
              value: average.toFixed(1) + "%",
              icon: Target,
            },
            {
              label: "Assessments passed",
              value: data.results.filter(
                (r) => r.evaluation.status === "Passed",
              ).length,
              icon: GraduationCap,
            },
          ].map((s) => (
            <section className="card" key={s.label}>
              <s.icon size={20} />
              <span>{s.label}</span>
              <strong>{s.value}</strong>
            </section>
          ))}
        </div>
        {tab === "results" && (
          <section className="card">
            <div className="card-heading">
              <div>
                <h2>Your work, recognized.</h2>
                <p>
                  Only your administrator-published, evaluated records appear
                  here.
                </p>
              </div>
              <button
                className="icon-button"
                aria-label="Refresh my results"
                onClick={() => void query.refetch()}
              >
                <RefreshCw size={17} />
              </button>
            </div>
            {data.results.length ? (
              <div className="table-scroll">
                <table className="results-table">
                  <thead>
                    <tr>
                      <th>Assessment</th>
                      <th>Date</th>
                      <th>Score</th>
                      <th>Grade</th>
                      <th>Rank</th>
                      <th>Report card</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...data.results].reverse().map((r) => (
                      <tr key={r.id}>
                        <td>
                          <button
                            className="text-button"
                            onClick={() => setSelected(r)}
                          >
                            {r.title}
                          </button>
                          <small className="table-secondary">{r.subject}</small>
                        </td>
                        <td>{formatDate(r.date)}</td>
                        <td>
                          <strong>
                            {r.evaluation.score}/{r.evaluation.maximum}
                          </strong>
                          <small className="table-secondary">
                            {r.evaluation.percentage.toFixed(1)}%
                          </small>
                        </td>
                        <td>
                          <span
                            className={`status-badge ${r.evaluation.status === "Passed" ? "status-passed" : "status-failed"}`}
                          >
                            {r.evaluation.grade} · {r.evaluation.status}
                          </span>
                        </td>
                        <td>
                          #{r.rank}
                          <small className="table-secondary">
                            of {r.cohort} evaluated
                          </small>
                        </td>
                        <td>
                          <button
                            className="text-button"
                            disabled={!!busy}
                            onClick={() => void download(r, "pdf")}
                          >
                            <ArrowDownToLine size={14} />
                            {busy === r.id + "pdf" ? "Preparing…" : "PDF"}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState
                icon={<BookOpen size={28} />}
                title="Your next chapter is on its way."
                description="There are no published results yet. Private drafts and unverified scans stay with your teachers."
              />
            )}
          </section>
        )}
        {tab === "progress" && (
          <section className="card">
            <div className="card-heading">
              <div>
                <h2>Small steps. Measurable progress.</h2>
                <p>
                  Your score percentage across published assessments. No other
                  student's record is downloaded.
                </p>
              </div>
            </div>
            {trend.length ? (
              <div className="portal-chart">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={trend} margin={{ left: -15, right: 20 }}>
                    <CartesianGrid strokeDasharray="3 5" stroke="#263956" />
                    <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                    <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} />
                    <Tooltip />
                    <Area
                      dataKey="score"
                      stroke="#5f91ff"
                      fill="#3776ef"
                      fillOpacity={0.15}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <EmptyState
                title="A trend starts with a first result."
                description="Come back after your assessment is published."
              />
            )}
          </section>
        )}
        {tab === "profile" && (
          <div className="enterprise-two-columns">
            <section className="card">
              <div className="card-heading">
                <div>
                  <h2>Your profile</h2>
                  <p>
                    Identity and class assignments are managed by your
                    institution.
                  </p>
                </div>
                <UserRound size={19} />
              </div>
              <form
                className="form-fields"
                onSubmit={(e) => {
                  e.preventDefault();
                  profile.mutate();
                }}
              >
                <label>
                  Registered name
                  <input value={data.student.name} readOnly />
                </label>
                <label>
                  Account email
                  <input value={data.user.email} readOnly />
                </label>
                <label>
                  Contact phone
                  <input
                    value={phone}
                    maxLength={40}
                    onChange={(e) => setPhone(e.target.value)}
                  />
                </label>
                <label>
                  Guardian contact
                  <input
                    value={guardian}
                    maxLength={120}
                    onChange={(e) => setGuardian(e.target.value)}
                  />
                </label>
                <button
                  className="button button-primary"
                  disabled={session.offline || profile.isPending}
                >
                  Save contact profile
                </button>
              </form>
            </section>
            <section className="card">
              <div className="card-heading">
                <div>
                  <h2>Private, even offline.</h2>
                  <p>
                    Opt in only on a device you trust. Unlocking expires after
                    24 hours without server verification.
                  </p>
                </div>
                <LockKeyhole size={19} />
              </div>
              <form
                className="form-fields"
                onSubmit={async (e) => {
                  e.preventDefault();
                  setBusy("vault");
                  try {
                    await enablePortalVault(
                      session.user!,
                      school,
                      data,
                      passphrase,
                    );
                    setPassphrase("");
                    setNotice(
                      "Your own published results are encrypted on this device. Use Unlock offline workspace after reloading offline.",
                    );
                  } catch (e) {
                    setNotice(
                      e instanceof Error
                        ? e.message
                        : "The offline cache could not be created.",
                    );
                  } finally {
                    setBusy("");
                  }
                }}
              >
                <label>
                  Separate offline passphrase
                  <input
                    type="password"
                    autoComplete="off"
                    minLength={12}
                    value={passphrase}
                    onChange={(e) => setPassphrase(e.target.value)}
                    required={!vaultEnabled(session.user?.id)}
                  />
                </label>
                <button
                  className="button button-primary"
                  disabled={session.offline || !!busy}
                >
                  <LockKeyhole size={15} />
                  {vaultEnabled(session.user?.id)
                    ? "Refresh private offline copy"
                    : "Enable encrypted offline results"}
                </button>
                <p className="small muted">
                  No classmates’ records are cached. A lost offline passphrase
                  cannot be recovered.
                </p>
              </form>
            </section>
          </div>
        )}
      </main>
      <nav
        className="mobile-bottom-nav portal-bottom-nav"
        aria-label="Student navigation"
      >
        <button
          className={tab === "results" ? "active" : ""}
          onClick={() => setTab("results")}
        >
          <BookOpen size={19} />
          <span>Results</span>
        </button>
        <button
          className={tab === "progress" ? "active" : ""}
          onClick={() => setTab("progress")}
        >
          <TrendingUp size={19} />
          <span>Progress</span>
        </button>
        <button
          className={tab === "profile" ? "active" : ""}
          onClick={() => setTab("profile")}
        >
          <UserRound size={19} />
          <span>Profile</span>
        </button>
      </nav>
      {selected && (
        <Modal
          title={selected.title}
          onClose={() => setSelected(null)}
          className="student-modal"
        >
          <div className="modal-body">
            <div className="student-ranking-strip">
              <span>
                Score{" "}
                <strong>
                  {selected.evaluation.score}/{selected.evaluation.maximum}
                </strong>
              </span>
              <span>
                Grade <strong>{selected.evaluation.grade}</strong>
              </span>
              <span>
                Percentile <strong>{selected.percentile.toFixed(2)}</strong>
              </span>
            </div>
            <div className="table-scroll">
              <table className="results-table">
                <thead>
                  <tr>
                    <th>Question</th>
                    <th>Your response</th>
                    <th>Correct</th>
                    <th>Marks</th>
                  </tr>
                </thead>
                <tbody>
                  {selected.evaluation.questions.map((q) => (
                    <tr key={q.question}>
                      <td>{q.question}</td>
                      <td>{q.selected.join(", ") || "Blank"}</td>
                      <td>{q.expected.join(", ")}</td>
                      <td>{q.marks}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div className="modal-footer">
            {(["csv", "xlsx", "pdf"] as const).map((format) => (
              <button
                key={format}
                className="button button-secondary"
                disabled={!!busy}
                onClick={() => void download(selected, format)}
              >
                <ArrowDownToLine size={14} />
                {format.toUpperCase()}
              </button>
            ))}
          </div>
        </Modal>
      )}
    </div>
  );
}
