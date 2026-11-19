import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  BookOpen,
  CheckCheck,
  CircleAlert,
  GraduationCap,
  Layers3,
  ScanLine,
  Sigma,
  Target,
  TrendingDown,
  TrendingUp,
  Users,
} from "lucide-react";
import type { Workspace } from "./data";
import { gradeResult } from "./data";
import { api, useSession } from "./session";

type Metrics = Record<string, number>;
export function localDashboardMetrics(workspace: Workspace): Metrics {
  const exams = new Map(workspace.exams.map((e) => [e.id, e]));
  const scored = workspace.results
    .map((r) => gradeResult(r, exams.get(r.examId)!))
    .filter((g) => !g.needsReview);
  const scores = scored.map((g) => g.percentage).sort((a, b) => a - b);
  const avg = scores.length
    ? scores.reduce((a, b) => a + b, 0) / scores.length
    : 0;
  const mid = Math.floor(scores.length / 2);
  return {
    students: workspace.students?.length || 0,
    classes: workspace.classes?.length || 0,
    examinations: workspace.exams.length,
    subjects: new Set(workspace.exams.map((e) => e.subject)).size,
    submitted: workspace.results.length,
    evaluated: scored.length,
    review: workspace.results.length - scored.length,
    average: avg,
    median: scores.length
      ? scores.length % 2
        ? scores[mid]
        : (scores[mid - 1] + scores[mid]) / 2
      : 0,
    standardDeviation: scores.length
      ? Math.sqrt(
          scores.reduce((n, v) => n + (v - avg) ** 2, 0) / scores.length,
        )
      : 0,
    highest: scores.at(-1) || 0,
    lowest: scores[0] || 0,
    passRate: scored.length
      ? (scored.filter((g) => g.status === "Passed").length / scored.length) *
        100
      : 0,
    publishedExaminations: workspace.exams.filter((e) => e.resultsPublished)
      .length,
    originalImages: new Set(workspace.results.flatMap((r) => r.scanIds || []))
      .size,
  };
}
const definitions = [
  {
    key: "students",
    label: "Registered students",
    icon: Users,
    note: "Your authorized student register",
  },
  {
    key: "evaluated",
    label: "Sheets evaluated",
    icon: CheckCheck,
    note: "Verified, keyed response records",
  },
  {
    key: "average",
    label: "Average score",
    icon: Activity,
    note: "Across evaluated assessments",
    percent: true,
  },
  {
    key: "passRate",
    label: "Pass rate",
    icon: Target,
    note: "Each exam’s configured pass threshold",
    percent: true,
  },
  { key: "examinations", label: "Examinations", icon: BookOpen },
  { key: "classes", label: "Classes / batches", icon: GraduationCap },
  { key: "subjects", label: "Subjects assessed", icon: Layers3 },
  { key: "submitted", label: "Submitted sheets", icon: ScanLine },
  { key: "review", label: "Needs verification", icon: CircleAlert },
  { key: "median", label: "Median score", icon: Activity, percent: true },
  {
    key: "standardDeviation",
    label: "Score std. deviation",
    icon: Sigma,
    percent: true,
  },
  { key: "highest", label: "Highest score", icon: TrendingUp, percent: true },
  { key: "lowest", label: "Lowest score", icon: TrendingDown, percent: true },
  {
    key: "publishedExaminations",
    label: "Results published",
    icon: CheckCheck,
  },
  { key: "originalImages", label: "Original images stored", icon: ScanLine },
];
export default function DashboardMetrics({
  workspace,
}: {
  workspace: Workspace;
}) {
  const session = useSession();
  const server =
    session.phase === "authenticated" &&
    session.backend === "fastapi" &&
    !session.offline;
  const query = useQuery<{ metrics: Metrics }>({
    queryKey: [
      "dashboard-metrics",
      session.user?.id,
      workspace.activeSchoolId,
      workspace.results.length,
      workspace.exams.map((e) => `${e.id}:${e.keyVersion}`).join(","),
    ],
    queryFn: () => api(`/schools/${workspace.activeSchoolId}/dashboard`),
    enabled: server,
  });
  const metrics =
    server && query.data
      ? query.data.metrics
      : localDashboardMetrics(workspace);
  return (
    <>
      <div className="metrics-source">
        <span className="live-dot" />
        {server && query.data
          ? "LIVE DATABASE METRICS"
          : session.offline
            ? "AUTHORIZED OFFLINE RECORDS"
            : "WORKSPACE RECORDS"}
        <small>
          All authorized assessments · under-review sheets excluded from score
          aggregates
        </small>
      </div>
      <div className="enterprise-metric-grid">
        {definitions.map((d, i) => (
          <section
            className={`card enterprise-metric ${i < 4 ? "metric-primary" : ""}`}
            key={d.key}
          >
            <div>
              <span>{d.label}</span>
              <d.icon size={i < 4 ? 18 : 15} />
            </div>
            <strong>
              {d.percent
                ? `${(metrics[d.key] || 0).toFixed(1)}${d.key === "standardDeviation" ? " pp" : "%"}`
                : (metrics[d.key] || 0).toLocaleString("en-IN")}
            </strong>
            {d.note && <small>{d.note}</small>}
          </section>
        ))}
      </div>
      {query.error && (
        <p className="small form-error">
          Live metrics could not refresh: {query.error.message}. Showing the
          authorized records already loaded.
        </p>
      )}
    </>
  );
}
