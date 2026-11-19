import { useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  Activity,
  ArrowDownToLine,
  ArrowRight,
  ArrowUpRight,
  CheckCheck,
  CircleDot,
  ScanLine,
  Sparkles,
  Target,
  TrendingUp,
  Users,
} from "lucide-react";
import type { Exam, Page, Result, Workspace } from "./data";
import {
  getDistribution,
  getStats,
  gradeResult,
  questionStats,
  rankings,
  subjectStats,
} from "./data";
import {
  Avatar,
  EmptyState,
  PageHeading,
  ResultsTable,
  SectionLink,
  Select,
} from "./components";
import { ExamBar } from "./Overview";
interface Props {
  workspace: Workspace;
  exam: Exam;
  results: Result[];
  setExamId: (id: string) => void;
  navigate: (p: Page) => void;
  onOpen: (r: Result) => void;
  onExport: () => void;
  onQuestion: (q: number) => void;
}
const palette = ["#b9f287", "#8a9fff", "#f4c681", "#f18c91"];
export default function Dashboard({
  workspace,
  exam,
  results,
  setExamId,
  navigate,
  onOpen,
  onExport,
  onQuestion,
}: Props) {
  const [metric, setMetric] = useState<"average" | "passRate">("average");
  const stats = getStats(results, exam),
    distribution = getDistribution(results, exam),
    subjects = subjectStats(results, exam),
    ranked = rankings(results, exam),
    hardest = [...questionStats(results, exam)].sort(
      (a, b) => a.percentage - b.percentage,
    )[0];
  const trend = workspace.exams
    .filter((e) => e.published)
    .map((e) => {
      const s = getStats(
        workspace.results.filter((r) => r.examId === e.id),
        e,
      );
      return {
        name: e.title.length > 17 ? `${e.title.slice(0, 14)}…` : e.title,
        average: +s.average.toFixed(1),
        passRate: +s.passRate.toFixed(1),
      };
    })
    .slice(-8);
  const recent = [...results]
    .sort(
      (a, b) =>
        (b.source === "scan" ? 1 : 0) - (a.source === "scan" ? 1 : 0) ||
        b.createdAt.localeCompare(a.createdAt),
    )
    .slice(0, 5);
  const review = results.filter((r) => gradeResult(r, exam).needsReview);
  return (
    <>
      <PageHeading
        eyebrow="YOUR CLASSROOM, CONNECTED"
        title={`A clearer view. A brighter next step.`}
        description={`Welcome back, ${workspace.teacher.split(" ")[0] || "educator"}. Here’s the story behind your students’ progress.`}
        actions={
          <>
            <button className="button button-secondary" onClick={onExport}>
              <ArrowDownToLine size={16} />
              Export results
            </button>
            <button
              className="button button-primary"
              onClick={() => navigate("scanner")}
            >
              <ScanLine size={17} />
              Scan answer sheets
              <ArrowUpRight size={15} />
            </button>
          </>
        }
      />
      <ExamBar workspace={workspace} exam={exam} setExamId={setExamId} />
      <div className="v2-stat-grid">
        {[
          {
            label: "Registered students",
            value: String(workspace.students?.length || 0),
            icon: Users,
            note: `${workspace.classes?.length || 0} classes in your school`,
            className: "mint",
          },
          {
            label: "Sheets evaluated",
            value: String(stats.evaluated),
            icon: CheckCheck,
            note: stats.review
              ? `${stats.review} sheets awaiting review`
              : "All submitted sheets evaluated",
            className: "violet",
          },
          {
            label: "Average score",
            value: `${stats.average.toFixed(1)}%`,
            icon: Activity,
            note: "Across evaluated answer sheets",
            className: "peach",
          },
          {
            label: "Pass rate",
            value: `${stats.passRate.toFixed(1)}%`,
            icon: Target,
            note: `Passing threshold · ${exam.passPercentage}%`,
            className: "blue",
          },
        ].map((s, i) => (
          <section className={`v2-stat ${s.className}`} key={s.label}>
            <div>
              <span>{s.label}</span>
              <span className="v2-stat-icon">
                <s.icon size={18} />
              </span>
            </div>
            <strong>
              {s.value}
              <svg viewBox="0 0 100 30" aria-hidden="true">
                <path
                  d={
                    [
                      "M0 25L15 19L28 23L43 10L58 16L72 6L86 10L100 2",
                      "M0 25L14 24L30 12L43 15L57 7L70 14L85 8L100 4",
                      "M0 25L16 15L31 19L44 12L59 19L72 9L85 12L100 2",
                      "M0 25L15 22L30 15L45 17L59 8L73 11L87 4L100 2",
                    ][i]
                  }
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                />
              </svg>
            </strong>
            <small>
              <i />
              {s.note}
            </small>
          </section>
        ))}
      </div>
      <div className="v2-chart-grid">
        <section className="card v2-performance">
          <div className="card-heading">
            <div>
              <span className="micro-label">THE BIGGER PICTURE</span>
              <h2>Progress has a pattern.</h2>
              <p>Performance across your latest assessments.</p>
            </div>
            <Select
              aria-label="Trend metric"
              value={metric}
              onChange={(e) => setMetric(e.target.value as typeof metric)}
            >
              <option value="average">Average score</option>
              <option value="passRate">Pass rate</option>
            </Select>
          </div>
          <div className="v2-chart-legend">
            <span>
              <i /> {metric === "average" ? "Class average" : "Pass rate"}
            </span>
            <span>Score percentage</span>
          </div>
          <div className="v2-area-chart">
            {trend.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart
                  data={trend}
                  margin={{ top: 15, left: -28, right: 15, bottom: 0 }}
                >
                  <defs>
                    <linearGradient id="mint-area" x1="0" y1="0" x2="0" y2="1">
                      <stop
                        offset="0%"
                        stopColor="#b9f287"
                        stopOpacity={0.22}
                      />
                      <stop offset="100%" stopColor="#b9f287" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid
                    vertical={false}
                    stroke="#29312f"
                    strokeDasharray="3 5"
                  />
                  <XAxis
                    dataKey="name"
                    tick={{ fill: "#86938e", fontSize: 10 }}
                    axisLine={false}
                    tickLine={false}
                    dy={8}
                  />
                  <YAxis
                    domain={[0, 100]}
                    tick={{ fill: "#86938e", fontSize: 10 }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(v) => `${v}%`}
                  />
                  <Tooltip
                    contentStyle={{
                      background: "#242c29",
                      border: "1px solid #3d4a43",
                      borderRadius: 10,
                      color: "#eef6e8",
                    }}
                    formatter={(v) => [
                      `${v}%`,
                      metric === "average" ? "Average" : "Pass rate",
                    ]}
                  />
                  <Area
                    isAnimationActive={false}
                    type="monotone"
                    dataKey={metric}
                    stroke="#b9f287"
                    strokeWidth={2.5}
                    fill="url(#mint-area)"
                    dot={{
                      r: 3,
                      stroke: "#b9f287",
                      fill: "#18201d",
                      strokeWidth: 2,
                    }}
                    activeDot={{ r: 5 }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <EmptyState
                title="Your progress story starts here."
                description="Complete an answer key and scan sheets to reveal performance trends."
              />
            )}
          </div>
          <div className="v2-chart-footer">
            <TrendingUp size={15} />
            <span>{trend.length} assessments. One evolving story.</span>
            <button className="text-link" onClick={() => navigate("analytics")}>
              Explore analytics
              <ArrowUpRight size={14} />
            </button>
          </div>
        </section>
        <section className="card v2-distribution">
          <div className="card-heading">
            <div>
              <span className="micro-label">EVERY LEARNER COUNTS</span>
              <h2>A class of possibilities.</h2>
              <p>Score distribution</p>
            </div>
            <CircleDot size={18} className="muted" />
          </div>
          <div className="v2-donut">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  isAnimationActive={false}
                  data={distribution}
                  dataKey="value"
                  innerRadius="69%"
                  outerRadius="92%"
                  paddingAngle={4}
                  stroke="none"
                  cornerRadius={5}
                >
                  {distribution.map((d, i) => (
                    <Cell key={d.name} fill={palette[i]} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{
                    background: "#242c29",
                    border: "1px solid #3d4a43",
                    borderRadius: 10,
                    color: "#eef6e8",
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
            <div>
              <strong>{stats.evaluated}</strong>
              <span>evaluated students</span>
            </div>
          </div>
          <div className="v2-distribution-legend">
            {distribution.map((d, i) => (
              <div key={d.name}>
                <i style={{ background: palette[i] }} />
                <span>
                  {d.name}
                  <small>{d.range}</small>
                </span>
                <strong>{d.value}</strong>
              </div>
            ))}
          </div>
        </section>
      </div>
      <div className="v2-insight-grid">
        <section className="v2-insight">
          <span className="insight-icon">
            <Sparkles size={20} />
          </span>
          <div>
            <span className="micro-label">
              A LITTLE INSIGHT, A BIG DIFFERENCE
            </span>
            <h3>
              {stats.evaluated
                ? `Question ${hardest.number} could use a second look.`
                : "Your next teaching moment is waiting."}
            </h3>
            <p>
              {stats.evaluated
                ? `${hardest.percentage.toFixed(0)}% answered correctly. A quick revisit could make all the difference.`
                : "Scan your first batch to discover the questions worth revisiting."}
            </p>
          </div>
          <button
            className="button button-secondary button-small"
            onClick={() =>
              stats.evaluated ? onQuestion(hardest.number) : navigate("scanner")
            }
          >
            {stats.evaluated ? "Explore question" : "Start scanning"}
            <ArrowRight size={14} />
          </button>
        </section>
        <button
          className="v2-review-card"
          onClick={() => (review[0] ? onOpen(review[0]) : navigate("scanner"))}
        >
          <span className="live-dot" />
          <div>
            <strong>
              {review.length
                ? `${review.length} sheets need a human touch.`
                : "You’re all caught up."}
            </strong>
            <p>
              {review.length
                ? "Review uncertain marks and identities."
                : "Ready for your next batch of possibilities."}
            </p>
          </div>
          <ArrowUpRight size={19} />
        </button>
      </div>
      <div className="v2-lower-grid">
        <section className="card">
          <div className="card-heading">
            <div>
              <h2>
                Recent results{" "}
                <span className="count-badge">{results.length}</span>
              </h2>
              <p>The latest steps in their learning journey.</p>
            </div>
            <SectionLink onClick={() => navigate("students")}>
              View all
            </SectionLink>
          </div>
          {recent.length ? (
            <ResultsTable
              compact
              results={recent}
              exam={exam}
              onOpen={onOpen}
            />
          ) : (
            <EmptyState
              title="Every great story has a first page."
              description="Upload or capture a sheet to get started."
              action={
                <button
                  className="button button-primary"
                  onClick={() => navigate("scanner")}
                >
                  Scan your first sheet
                  <ArrowRight size={15} />
                </button>
              }
            />
          )}
        </section>
        <section className="card v2-top-students">
          <div className="card-heading">
            <div>
              <h2>Leading the way</h2>
              <p>Effort worth celebrating.</p>
            </div>
            <SectionLink onClick={() => navigate("leaderboard")}>
              Rankings
            </SectionLink>
          </div>
          {ranked.slice(0, 4).map((r, i) => (
            <button
              key={r.result.id}
              className="v2-leader-row"
              onClick={() => onOpen(r.result)}
            >
              <span className="rank-number">
                {String(r.rank).padStart(2, "0")}
              </span>
              <Avatar name={r.result.name} index={i} />
              <span>
                <strong>{r.result.name}</strong>
                <small>
                  Class {r.result.section} · {r.result.roll}
                </small>
              </span>
              <b>
                {r.percentage.toFixed(0)}
                <small>%</small>
              </b>
            </button>
          ))}
          {!ranked.length && (
            <EmptyState
              title="A fresh leaderboard."
              description="Reviewed results will appear here."
            />
          )}
          <div className="v2-subject-mini">
            {subjects.slice(0, 4).map((s) => (
              <div key={s.name}>
                <span>
                  {s.name}
                  <b>{s.average.toFixed(0)}%</b>
                </span>
                <div className="v2-track">
                  <i style={{ width: `${s.average}%` }} />
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
      <p className="page-bottom-note">
        <ShieldIcon />
        Real insights. Thoughtful decisions. A little more possibility.
      </p>
    </>
  );
}
function ShieldIcon() {
  return <CheckCheck size={13} />;
}
