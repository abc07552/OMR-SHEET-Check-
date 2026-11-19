import { useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  ArrowDownToLine,
  ArrowUpRight,
  Check,
  ChevronLeft,
  ChevronRight,
  Lightbulb,
  Sparkles,
  Target,
  Users,
} from "lucide-react";
import type { Exam, Result, Workspace } from "./data";
import { downloadFile, getStats, questionStats, subjectStats } from "./data";
import { EmptyState, PageHeading, Select } from "./components";
import { ExamBar } from "./Overview";
interface Props {
  workspace: Workspace;
  exam: Exam;
  results: Result[];
  setExamId: (id: string) => void;
  question: number;
  setQuestion: (q: number) => void;
  toast: (text: string) => void;
}
import { questionCSV } from "./reportData";
export default function Analytics({
  workspace,
  exam,
  results,
  setExamId,
  question,
  setQuestion,
  toast,
}: Props) {
  const [section, setSection] = useState("all");
  const [sort, setSort] = useState("difficulty");
  const filtered = useMemo(
    () => results.filter((r) => section === "all" || r.section === section),
    [results, section],
  );
  const stats = getStats(filtered, exam),
    questions = questionStats(filtered, exam);
  const hardest = [...questions].sort((a, b) => a.percentage - b.percentage)[0];
  const easiest = [...questions].sort((a, b) => b.percentage - a.percentage)[0];
  const current =
    questions[Math.min(question - 1, exam.questions - 1)] || questions[0];
  const sorted = [...questions].sort((a, b) =>
    sort === "difficulty"
      ? a.percentage - b.percentage
      : sort === "easiest"
        ? b.percentage - a.percentage
        : a.number - b.number,
  );
  const classification = (pct: number) =>
    pct >= 80 ? "Easy" : pct >= 60 ? "Moderate" : "Challenging";
  return (
    <>
      <PageHeading
        eyebrow="TURN ANSWERS INTO UNDERSTANDING"
        title="Go beyond the grade."
        description="Find what clicked, what didn’t, and where to go next."
        actions={
          <button
            className="button button-secondary"
            onClick={() => {
              void downloadFile(
                `markly-question-analysis-${exam.id}.csv`,
                questionCSV(filtered, exam),
              )
                .then(() => toast("Question analysis exported."))
                .catch((error) =>
                  toast(
                    error instanceof Error ? error.message : "Export failed.",
                  ),
                );
            }}
          >
            <ArrowDownToLine size={16} />
            Export analysis
          </button>
        }
      />
      <ExamBar
        workspace={workspace}
        exam={exam}
        setExamId={(id) => {
          setQuestion(1);
          setExamId(id);
        }}
      />
      <section className="card subject-performance">
        <div className="card-heading">
          <div>
            <h2>Understanding, subject by subject.</h2>
            <p>
              Weighted score and correct-answer accuracy tell different parts of
              the story.
            </p>
          </div>
        </div>
        <div className="subject-performance-grid">
          {subjectStats(filtered, exam).map((s) => (
            <div key={s.name}>
              <span className="micro-label">
                Q{s.from}–{s.to}
              </span>
              <h3>{s.name}</h3>
              <strong>
                {s.average.toFixed(1)}
                <small>%</small>
              </strong>
              <span>Average score</span>
              <div className="v2-track">
                <i style={{ width: `${s.average}%` }} />
              </div>
              <p>
                {s.accuracy.toFixed(1)}% correct-answer accuracy ·{" "}
                {s.students.length} evaluated
              </p>
            </div>
          ))}
        </div>
      </section>
      <div className="analytics-stat-grid">
        <div className="card analytics-stat">
          <span className="stat-icon green">
            <Target size={19} />
          </span>
          <div>
            <span>Class average</span>
            <strong>
              {stats.average.toFixed(1)}
              <small>%</small>
            </strong>
            <p>Across {stats.evaluated} evaluated sheets</p>
          </div>
        </div>
        <div className="card analytics-stat">
          <span className="stat-icon peach">
            <Lightbulb size={19} />
          </span>
          <div>
            <span>A chance to revisit</span>
            <strong>
              Question {hardest?.number.toString().padStart(2, "0")}
            </strong>
            <p>{hardest?.percentage.toFixed(0)}% answered correctly</p>
          </div>
          <button
            className="icon-button"
            aria-label="View most challenging question"
            onClick={() => setQuestion(hardest.number)}
          >
            <ArrowUpRight size={18} />
          </button>
        </div>
        <div className="card analytics-stat">
          <span className="stat-icon lavender">
            <Sparkles size={19} />
          </span>
          <div>
            <span>A classroom win</span>
            <strong>
              Question {easiest?.number.toString().padStart(2, "0")}
            </strong>
            <p>{easiest?.percentage.toFixed(0)}% answered correctly</p>
          </div>
          <button
            className="icon-button"
            aria-label="View easiest question"
            onClick={() => setQuestion(easiest.number)}
          >
            <ArrowUpRight size={18} />
          </button>
        </div>
      </div>
      <section className="card question-chart-card">
        <div className="card-heading">
          <div>
            <h2>The question-by-question picture</h2>
            <p>
              A clear view of understanding. Click a bar to explore its answers.
            </p>
          </div>
          <Select
            className="small-select"
            aria-label="Analytics class filter"
            value={section}
            onChange={(e) => setSection(e.target.value)}
          >
            <option value="all">All classes</option>
            {[...new Set(results.map((r) => r.section))].sort().map((s) => (
              <option key={s} value={s}>
                Class {s}
              </option>
            ))}
          </Select>
        </div>
        <div className="question-chart">
          {stats.evaluated ? (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={questions}
                margin={{ top: 10, right: 24, left: -12, bottom: 2 }}
                accessibilityLayer
              >
                <CartesianGrid
                  strokeDasharray="3 5"
                  vertical={false}
                  stroke="#e9ece5"
                />
                <XAxis
                  dataKey="number"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fontSize: 10, fill: "#93998d" }}
                  tickFormatter={(n) => `Q${n}`}
                  interval={Math.max(0, Math.floor(exam.questions / 16) - 1)}
                />
                <YAxis
                  domain={[0, 100]}
                  ticks={[0, 25, 50, 75, 100]}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(n) => `${n}%`}
                  tick={{ fontSize: 10, fill: "#93998d" }}
                />
                <Tooltip
                  cursor={{ fill: "#f1f4ec" }}
                  contentStyle={{
                    borderRadius: 10,
                    border: "1px solid #e6eae2",
                    fontSize: 12,
                  }}
                  formatter={(v: number) => [
                    `${v.toFixed(1)}% correct`,
                    "Accuracy",
                  ]}
                  labelFormatter={(v) => `Question ${v}`}
                />
                <ReferenceLine y={60} stroke="#bfc6b5" strokeDasharray="5 4" />
                <Bar
                  isAnimationActive={false}
                  dataKey="percentage"
                  radius={[4, 4, 0, 0]}
                  maxBarSize={24}
                  onClick={(data) => setQuestion(data.number)}
                  style={{ cursor: "pointer" }}
                >
                  {questions.map((q) => (
                    <Cell
                      key={q.number}
                      fill={
                        q.number === current.number
                          ? "#294e38"
                          : q.percentage >= 80
                            ? "#6f9572"
                            : q.percentage >= 60
                              ? "#bddb8f"
                              : "#e1b79d"
                      }
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <EmptyState
              title="Insight starts with a single sheet."
              description="Scan your answer sheets to unlock a question-by-question analysis."
            />
          )}
        </div>
        <div className="question-chart-legend">
          <span>
            <i style={{ background: "#6f9572" }} />
            Easy · 80%+
          </span>
          <span>
            <i style={{ background: "#bddb8f" }} />
            Moderate · 60–79%
          </span>
          <span>
            <i style={{ background: "#e1b79d" }} />
            Challenging · Below 60%
          </span>
          <small>Accuracy = correct responses ÷ evaluated sheets</small>
        </div>
      </section>
      <div className="analytics-detail-grid">
        <section className="card question-table-card">
          <div className="card-heading">
            <div>
              <h2>Where to focus next</h2>
              <p>Small discoveries. Meaningful next steps.</p>
            </div>
            <Select
              className="small-select"
              value={sort}
              aria-label="Sort question analysis"
              onChange={(e) => setSort(e.target.value)}
            >
              <option value="difficulty">Most challenging</option>
              <option value="easiest">Easiest first</option>
              <option value="number">Question order</option>
            </Select>
          </div>
          <div className="question-table-scroll">
            <table className="question-table">
              <thead>
                <tr>
                  <th>Question</th>
                  <th>Answer</th>
                  <th>Accuracy</th>
                  <th>Difficulty</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {sorted.map((q) => (
                  <tr
                    key={q.number}
                    className={
                      q.number === current.number ? "selected-question-row" : ""
                    }
                    onClick={() => setQuestion(q.number)}
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") setQuestion(q.number);
                    }}
                  >
                    <td>Question {q.number.toString().padStart(2, "0")}</td>
                    <td>
                      <span className="correct-option">{q.answer || "–"}</span>
                    </td>
                    <td>
                      <div className="accuracy-cell">
                        <strong>{q.percentage.toFixed(0)}%</strong>
                        <span className="mini-track">
                          <span
                            style={{
                              width: `${q.percentage}%`,
                              backgroundColor:
                                q.percentage < 60 ? "#d7a88c" : "#8eab7b",
                            }}
                          />
                        </span>
                      </div>
                    </td>
                    <td>
                      <span
                        className={`question-difficulty difficulty-${classification(q.percentage).toLowerCase()}`}
                      >
                        {classification(q.percentage)}
                      </span>
                    </td>
                    <td>
                      <ArrowUpRight size={15} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        <aside className="card answer-breakdown">
          <div className="card-heading">
            <div>
              <h2>A closer look</h2>
              <p>Every choice has a little to tell us.</p>
            </div>
            <span className="stat-icon green">
              <Target size={16} />
            </span>
          </div>
          <div className="question-pager">
            <button
              className="icon-button"
              disabled={current.number <= 1}
              onClick={() => setQuestion(current.number - 1)}
              aria-label="Previous question"
            >
              <ChevronLeft size={18} />
            </button>
            <Select
              aria-label="Question to inspect"
              value={current.number}
              onChange={(e) => setQuestion(Number(e.target.value))}
            >
              {questions.map((q) => (
                <option key={q.number} value={q.number}>
                  Question {q.number.toString().padStart(2, "0")}
                </option>
              ))}
            </Select>
            <button
              className="icon-button"
              disabled={current.number >= exam.questions}
              onClick={() => setQuestion(current.number + 1)}
              aria-label="Next question"
            >
              <ChevronRight size={18} />
            </button>
          </div>
          <div className="question-accuracy">
            <strong>
              {current.percentage.toFixed(0)}
              <span>%</span>
            </strong>
            <p>answered correctly</p>
            <span
              className={`question-difficulty difficulty-${classification(current.percentage).toLowerCase()}`}
            >
              {classification(current.percentage)}
            </span>
          </div>
          <div className="answer-breakdown-bars">
            {current.counts.map((c) => (
              <div
                key={c.option}
                className={
                  c.option === current.answer ? "right-answer-bar" : ""
                }
              >
                <span className="breakdown-option">{c.option}</span>
                <span className="breakdown-track">
                  <span
                    style={{
                      width: `${current.total ? (c.count / current.total) * 100 : 0}%`,
                    }}
                  />
                </span>
                <strong>
                  {current.total
                    ? ((c.count / current.total) * 100).toFixed(0)
                    : 0}
                  %
                </strong>
                {c.option === current.answer ? (
                  <Check size={13} />
                ) : (
                  <span className="check-placeholder" />
                )}
              </div>
            ))}
          </div>
          <div className="breakdown-summary">
            <span>
              <span className="green-text">●</span> Correct option{" "}
              <strong>{current.answer || "Not set"}</strong>
            </span>
            <span>{current.blank} unanswered</span>
          </div>
          <div className="teaching-tip">
            <Lightbulb size={17} />
            <div>
              <strong>
                {current.percentage < 60
                  ? "A little reinforcement can go a long way."
                  : current.percentage >= 80
                    ? "Something is really clicking here."
                    : "Understanding is taking shape."}
              </strong>
              <p>
                {current.percentage < 60
                  ? "Try revisiting this concept with a worked example, then check understanding with a quick follow-up."
                  : current.percentage >= 80
                    ? "Build on this confidence. A more challenging follow-up could help your learners stretch a little further."
                    : "A short classroom discussion about the incorrect choices can help turn partial understanding into confidence."}
              </p>
            </div>
          </div>
        </aside>
      </div>
      <section className="card section-comparison">
        <div className="card-heading">
          <div>
            <h2>Different classrooms. Shared potential.</h2>
            <p>See how each section is finding its feet.</p>
          </div>
          <Users size={18} className="muted" />
        </div>
        <div className="section-grid">
          {[...new Set(results.map((r) => r.section))].sort().map((s) => {
            const values = getStats(
              results.filter((r) => r.section === s),
              exam,
            );
            return (
              <button
                key={s}
                onClick={() => setSection(s)}
                className={section === s ? "selected-section" : ""}
              >
                <div>
                  <span>Class {s}</span>
                  <ArrowUpRight size={15} />
                </div>
                <strong>
                  {values.average.toFixed(1)}
                  <small>%</small>
                </strong>
                <div className="section-progress">
                  <i style={{ width: `${values.average}%` }} />
                </div>
                <p>
                  {values.evaluated} evaluated · {values.passRate.toFixed(0)}%
                  pass rate
                </p>
              </button>
            );
          })}
        </div>
      </section>
    </>
  );
}
