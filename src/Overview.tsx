import { useState } from "react";
import { useSession } from "./session";
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
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  CalendarDays,
  ChartNoAxesCombined,
  CheckCheck,
  CircleHelp,
  Clock3,
  ScanLine,
  Sparkles,
  Target,
  TrendingUp,
  Users,
} from "lucide-react";
import type { Exam, Page, Result, Workspace } from "./data";
import { formatDate, getDistribution, getStats, questionStats } from "./data";
import {
  EmptyState,
  ExportButton,
  PageHeading,
  ResultsTable,
  SectionLink,
  Select,
} from "./components";

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
export function ExamBar({
  workspace,
  exam,
  setExamId,
}: Pick<Props, "workspace" | "exam" | "setExamId">) {
  const session = useSession();
  const sections = [
    ...new Set(
      workspace.results
        .filter((r) => r.examId === exam.id)
        .map((r) => r.section),
    ),
  ];
  const classLabel =
    sections.length === 1
      ? `Class ${sections[0]}`
      : sections.every((s) => /^12 [A-D]$/.test(s))
        ? "Class 12"
        : `${sections.length} classes`;
  return (
    <div className="exam-bar">
      <div className="exam-bar-left">
        <span className="exam-icon">
          <ChartNoAxesCombined size={17} />
        </span>
        <Select
          className="exam-select"
          aria-label="Current assessment"
          value={exam.id}
          onChange={(e) => setExamId(e.target.value)}
        >
          {[...workspace.exams].reverse().map((e) => (
            <option key={e.id} value={e.id}>
              {e.subject} · {e.title}
            </option>
          ))}
        </Select>
        <span className="soft-tag">
          {sections.length ? classLabel : "New assessment"}
        </span>
      </div>
      <div className="exam-bar-right">
        <span className="exam-date">
          <CalendarDays size={14} />
          {formatDate(exam.date)}
        </span>
        <span className="vertical-rule" />
        <span className="sync-status">
          <span />
          {session.phase === "authenticated"
            ? "Shared server workspace"
            : "Device workspace"}
        </span>
      </div>
    </div>
  );
}
export default function Overview({
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
  const [chartRange, setChartRange] = useState("6");
  const stats = getStats(results, exam);
  const priorIndex = workspace.exams.findIndex((e) => e.id === exam.id) - 1;
  const prior = workspace.exams[priorIndex];
  const prevStats = prior
    ? getStats(
        workspace.results.filter((r) => r.examId === prior.id),
        prior,
      )
    : null;
  const averageDelta = prevStats ? stats.average - prevStats.average : 0;
  const passDelta = prevStats ? stats.passRate - prevStats.passRate : 0;
  const distribution = getDistribution(results, exam);
  const hardest = questionStats(results, exam).sort(
    (a, b) => a.percentage - b.percentage,
  )[0];
  const chartData = workspace.exams
    .filter((e) => e.published)
    .slice(0, workspace.exams.findIndex((e) => e.id === exam.id) + 1)
    .slice(-Number(chartRange))
    .map((e, i) => {
      const students = workspace.results.filter((r) => r.examId === e.id);
      const overall = getStats(students, e),
        section = getStats(
          students.filter((r) => r.section === "12 A"),
          e,
        );
      return {
        name: e.title
          .replace("assessment", "")
          .replace("Mid-term ", "Mid-term")
          .replace("Unit test ", "Test ")
          .trim(),
        label: e.title,
        average: +overall.average.toFixed(1),
        section: +(
          metric === "average" ? section.average : section.passRate
        ).toFixed(1),
        passRate: +overall.passRate.toFixed(1),
        index: i,
      };
    });
  const cardData = [
    {
      label: "Total students",
      value: stats.total.toLocaleString(),
      icon: Users,
      color: "green",
      delta: prevStats
        ? `+${Math.max(0, stats.total - prevStats.total)}`
        : null,
      caption: prevStats ? "students since last exam" : "in this assessment",
    },
    {
      label: "Sheets evaluated",
      value: stats.evaluated.toLocaleString(),
      icon: CheckCheck,
      color: "lavender",
      delta: null,
      caption: stats.review
        ? `${stats.review} sheets need a quick review`
        : "All caught up. Nice work!",
      review: stats.review > 0,
    },
    {
      label: "Average score",
      value: `${stats.average.toFixed(1)}`,
      suffix: "%",
      icon: ChartNoAxesCombined,
      color: "peach",
      delta: prevStats
        ? `${averageDelta >= 0 ? "+" : ""}${averageDelta.toFixed(1)}%`
        : null,
      caption: prevStats
        ? "vs. previous assessment"
        : "across evaluated sheets",
      negative: averageDelta < 0,
    },
    {
      label: "Pass rate",
      value: `${stats.passRate.toFixed(1)}`,
      suffix: "%",
      icon: Target,
      color: "yellow",
      delta: prevStats
        ? `${passDelta >= 0 ? "+" : ""}${passDelta.toFixed(1)}%`
        : null,
      caption: prevStats ? "vs. previous assessment" : "of evaluated students",
      negative: passDelta < 0,
    },
  ];
  return (
    <>
      <PageHeading
        eyebrow={`YOUR WORKSPACE, IN FOCUS`}
        title="A clearer picture of progress."
        description="Less time grading. More time making a difference."
        actions={
          <>
            <ExportButton onClick={onExport} />
            <button
              className="button button-primary"
              onClick={() => navigate("scanner")}
            >
              <ScanLine size={17} />
              Scan sheets
            </button>
          </>
        }
      />
      <ExamBar workspace={workspace} exam={exam} setExamId={setExamId} />
      <div className="stat-grid">
        {cardData.map((card) => (
          <div className="stat-card" key={card.label}>
            <div className="stat-top">
              <span>{card.label}</span>
              <span className={`stat-icon ${card.color}`}>
                <card.icon size={17} strokeWidth={1.8} />
              </span>
            </div>
            <div className="stat-value">
              {card.value}
              <span className="stat-suffix">{card.suffix}</span>
            </div>
            <div className="stat-bottom">
              {card.delta && (
                <span
                  className={`trend-badge ${card.negative ? "trend-negative" : ""}`}
                >
                  {card.negative ? (
                    <ArrowDownRight size={12} />
                  ) : (
                    <ArrowUpRight size={12} />
                  )}{" "}
                  {card.delta}
                </span>
              )}
              {card.review ? (
                <button
                  className="review-link"
                  onClick={() => navigate("students")}
                >
                  <span className="amber-dot" />
                  {card.caption}
                  <ArrowRight size={12} />
                </button>
              ) : (
                <span>{card.caption}</span>
              )}
            </div>
          </div>
        ))}
      </div>
      <div className="dashboard-grid chart-grid">
        <section className="card performance-card">
          <div className="card-heading">
            <div>
              <h2>Performance overview</h2>
              <p>A little progress, assessment by assessment.</p>
            </div>
            <Select
              aria-label="Chart assessment range"
              className="small-select"
              value={chartRange}
              onChange={(e) => setChartRange(e.target.value)}
            >
              <option value="6">Last 6 exams</option>
              <option value="3">Last 3 exams</option>
            </Select>
          </div>
          <div className="chart-controls">
            <div className="segmented-control">
              <button
                onClick={() => setMetric("average")}
                className={metric === "average" ? "active" : ""}
              >
                Average score
              </button>
              <button
                onClick={() => setMetric("passRate")}
                className={metric === "passRate" ? "active" : ""}
              >
                Pass rate
              </button>
            </div>
            <div className="chart-legend">
              <span>
                <i className="legend-dot" />
                Class average
              </span>
              <span>
                <i className="legend-dot muted-dot" />
                Section A
              </span>
            </div>
          </div>
          <div className="performance-chart">
            {chartData.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart
                  data={chartData}
                  margin={{ top: 16, right: 13, bottom: 0, left: -22 }}
                  accessibilityLayer
                >
                  <defs>
                    <linearGradient id="chartGreen" x1="0" y1="0" x2="0" y2="1">
                      <stop
                        offset="0%"
                        stopColor="#bbdf91"
                        stopOpacity={0.38}
                      />
                      <stop
                        offset="100%"
                        stopColor="#d5e9bc"
                        stopOpacity={0.03}
                      />
                    </linearGradient>
                  </defs>
                  <CartesianGrid
                    strokeDasharray="3 5"
                    vertical={false}
                    stroke="#e9ece5"
                  />
                  <XAxis
                    dataKey="name"
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: "#92968d", fontSize: 10.5 }}
                    dy={8}
                    height={35}
                    interval="preserveStartEnd"
                  />
                  <YAxis
                    domain={[40, 100]}
                    ticks={[40, 60, 80, 100]}
                    tickFormatter={(v) => `${v}%`}
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: "#999d95", fontSize: 10.5 }}
                  />
                  <Tooltip<number, string>
                    contentStyle={{
                      borderRadius: 12,
                      border: "1px solid #e7eae3",
                      fontSize: 12,
                      boxShadow: "0 6px 24px #25392b10",
                    }}
                    formatter={(v: number, name: string) => [
                      `${v}%`,
                      name === "section" ? "Section A" : "Class average",
                    ]}
                    labelFormatter={(_, data) => data[0]?.payload.label}
                  />
                  <Area
                    isAnimationActive={false}
                    type="monotone"
                    dataKey="section"
                    stroke="#bdc9b9"
                    strokeWidth={2}
                    strokeDasharray="5 5"
                    fill="transparent"
                    dot={false}
                    activeDot={{ r: 4 }}
                  />
                  <Area
                    isAnimationActive={false}
                    type="monotone"
                    dataKey={metric}
                    stroke="#43714f"
                    strokeWidth={2.6}
                    fill="url(#chartGreen)"
                    dot={{
                      r: 3.5,
                      stroke: "#fff",
                      strokeWidth: 2,
                      fill: "#43714f",
                    }}
                    activeDot={{ r: 6, stroke: "#fff", strokeWidth: 3 }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <EmptyState
                title="A fresh beginning"
                description="Scan your first set of sheets to start seeing progress."
              />
            )}
          </div>
          <div className="chart-note">
            <TrendingUp size={13} />
            <span>
              {prevStats && averageDelta > 0
                ? `Class average is up ${averageDelta.toFixed(1)}% from the previous assessment. Keep it growing.`
                : "Every assessment is another opportunity to help your class grow."}
            </span>
          </div>
        </section>
        <section className="card distribution-card">
          <div className="card-heading">
            <div>
              <h2>Score distribution</h2>
              <p>Every learner has a place to grow.</p>
            </div>
            <span
              className="info-tip"
              tabIndex={0}
              aria-label="Excludes sheets awaiting review"
              data-tooltip="Excludes sheets awaiting review"
            >
              <CircleHelp size={15} />
            </span>
          </div>
          <div className="donut-wrap">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  isAnimationActive={false}
                  data={
                    stats.evaluated
                      ? distribution
                      : [{ value: 1, color: "#edf0e8" }]
                  }
                  dataKey="value"
                  innerRadius={62}
                  outerRadius={85}
                  startAngle={90}
                  endAngle={-270}
                  paddingAngle={4}
                  cornerRadius={4}
                  stroke="none"
                >
                  {(stats.evaluated
                    ? distribution
                    : [{ color: "#edf0e8" }]
                  ).map((d, i) => (
                    <Cell key={i} fill={d.color} />
                  ))}
                </Pie>
                {stats.evaluated > 0 && (
                  <Tooltip
                    formatter={(v: number) => [`${v} students`]}
                    contentStyle={{
                      borderRadius: 10,
                      border: "1px solid #e7eae3",
                      fontSize: 12,
                    }}
                  />
                )}
              </PieChart>
            </ResponsiveContainer>
            <div className="donut-label">
              <strong>{stats.evaluated}</strong>
              <span>students graded</span>
            </div>
            <span className="donut-spark spark-one">✳</span>
          </div>
          <div className="distribution-legend">
            {distribution.map((d) => (
              <div key={d.name}>
                <span
                  className="distribution-dot"
                  style={{ background: d.color }}
                />
                <span className="distribution-name">
                  {d.name}
                  <small>{d.range}</small>
                </span>
                <strong>{d.value}</strong>
              </div>
            ))}
          </div>
        </section>
      </div>
      <div className="dashboard-grid bottom-grid">
        <section className="card recent-card">
          <div className="card-heading">
            <div>
              <h2>
                Recent results
                <span className="count-badge">{results.length}</span>
              </h2>
              <p>Fresh off the scanner. Ready for a closer look.</p>
            </div>
            <SectionLink onClick={() => navigate("students")}>
              View all students
            </SectionLink>
          </div>
          {results.length ? (
            <ResultsTable
              compact
              results={[...results]
                .sort(
                  (a, b) =>
                    Number(b.source === "scan") - Number(a.source === "scan") ||
                    (a.source === "scan"
                      ? b.createdAt.localeCompare(a.createdAt)
                      : 0),
                )
                .slice(0, 5)}
              exam={exam}
              onOpen={onOpen}
            />
          ) : (
            <EmptyState
              icon={<Users size={25} />}
              title="Your next success story starts here"
              description="Scan some answer sheets to meet your students’ results."
              action={
                <button
                  className="button button-secondary"
                  onClick={() => navigate("scanner")}
                >
                  Scan your first sheets
                  <ArrowRight size={15} />
                </button>
              }
            />
          )}
          <div className="table-card-footer">
            <span>
              <Clock3 size={12} /> All results are automatically saved
            </span>
            <button onClick={() => navigate("students")}>
              See the full picture
              <ArrowRight size={13} />
            </button>
          </div>
        </section>
        <section className="spotlight-card">
          <div className="spotlight-top">
            <span className="spotlight-icon">
              <Sparkles size={18} />
            </span>
            <span>THE QUESTION SPOTLIGHT</span>
          </div>
          <h2>
            A chance for an
            <br />
            “aha!” moment.
          </h2>
          <p>The trickiest question is often the best place to start.</p>
          {results.length && hardest ? (
            <>
              <div className="spotlight-question">
                <div>
                  <strong>
                    Question {hardest.number.toString().padStart(2, "0")}
                  </strong>
                  <span className="difficulty-badge">Most challenging</span>
                </div>
                <span>
                  <strong>{hardest.percentage.toFixed(0)}%</strong> answered
                  correctly
                </span>
                <div className="spotlight-options">
                  {hardest.counts.map((c) => (
                    <div
                      className={
                        c.option === hardest.answer ? "is-correct" : ""
                      }
                      key={c.option}
                    >
                      <span>
                        {c.option}
                        {c.option === hardest.answer && (
                          <CheckCheck size={11} />
                        )}
                      </span>
                      <div className="option-track">
                        <i
                          style={{
                            width: `${hardest.total ? (c.count / hardest.total) * 100 : 0}%`,
                          }}
                        />
                      </div>
                      <small>
                        {hardest.total
                          ? ((c.count / hardest.total) * 100).toFixed(0)
                          : 0}
                        %
                      </small>
                    </div>
                  ))}
                </div>
              </div>
              <button
                className="spotlight-link"
                onClick={() => onQuestion(hardest.number)}
              >
                Explore question analysis
                <ArrowUpRight size={16} />
              </button>
            </>
          ) : (
            <div className="spotlight-empty">
              <Target size={35} />
              <p>
                Your question insights will appear here after your first scan.
              </p>
              <button className="text-link" onClick={() => navigate("scanner")}>
                Let’s get started
                <ArrowRight size={15} />
              </button>
            </div>
          )}
          <span className="spotlight-decoration">✳</span>
        </section>
      </div>
      <div className="workspace-footnote">
        <span className="tiny-brand">✳</span> Made for the moments that move
        learning forward.
        <span>
          {workspace.results.some((r) => r.source === "demo")
            ? "Sample workspace"
            : "Your local workspace"}{" "}
          · Data stays on your device
        </span>
      </div>
    </>
  );
}
