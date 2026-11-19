import { useState } from "react";
import {
  ArrowDownToLine,
  ArrowUpRight,
  Medal,
  Trophy,
  Users,
} from "lucide-react";
import type { Exam, Result, Workspace } from "./data";
import { downloadFile, rankings, resultsCSV, subjectStats } from "./data";
import { Avatar, EmptyState, PageHeading, Select } from "./components";
import { ExamBar } from "./Overview";
export default function Leaderboard({
  workspace,
  exam,
  results,
  setExamId,
  onOpen,
}: {
  workspace: Workspace;
  exam: Exam;
  results: Result[];
  setExamId: (id: string) => void;
  onOpen: (r: Result) => void;
}) {
  const [subject, setSubject] = useState("all"),
    [section, setSection] = useState("all"),
    [page, setPage] = useState(1);
  const validSubject =
      subject === "all" ||
      subjectStats(results, exam).some((s) => s.name === subject)
        ? subject
        : "all",
    filtered = results.filter(
      (r) => section === "all" || r.section === section,
    ),
    ranked = rankings(
      filtered,
      exam,
      validSubject === "all" ? undefined : validSubject,
    ),
    max = Math.max(1, Math.ceil(ranked.length / 20)),
    safe = Math.min(page, max);
  return (
    <>
      <PageHeading
        eyebrow="CELEBRATE THE CLIMB"
        title="Every effort. A place to shine."
        description="Overall and subject rankings, with a transparent view of percentile and performance."
        actions={
          <button
            className="button button-secondary"
            onClick={() =>
              downloadFile(
                `markly-leaderboard-${exam.id}.csv`,
                resultsCSV(
                  ranked.map((r) => r.result),
                  exam,
                ),
              )
            }
          >
            <ArrowDownToLine size={16} />
            Export ranked results
          </button>
        }
      />
      <ExamBar
        workspace={workspace}
        exam={exam}
        setExamId={(id) => {
          setSubject("all");
          setSection("all");
          setPage(1);
          setExamId(id);
        }}
      />
      <div className="leaderboard-filters">
        <div>
          <Trophy size={19} />
          <strong>
            {validSubject === "all"
              ? "Overall leaderboard"
              : `${validSubject} leaderboard`}
          </strong>
          <span>{ranked.length} evaluated students</span>
        </div>
        <div>
          <Select
            aria-label="Leaderboard subject"
            value={validSubject}
            onChange={(e) => {
              setSubject(e.target.value);
              setPage(1);
            }}
          >
            <option value="all">All subjects · overall</option>
            {subjectStats(results, exam).map((s) => (
              <option key={s.name}>{s.name}</option>
            ))}
          </Select>
          <Select
            aria-label="Leaderboard class"
            value={section}
            onChange={(e) => {
              setSection(e.target.value);
              setPage(1);
            }}
          >
            <option value="all">All classes</option>
            {[...new Set(results.map((r) => r.section))].sort().map((s) => (
              <option key={s}>{s}</option>
            ))}
          </Select>
        </div>
      </div>
      {ranked.length > 0 && (
        <div className="podium-grid">
          {ranked.slice(0, 3).map((r, i) => (
            <button
              className={`podium-card podium-${i}`}
              key={r.result.id}
              onClick={() => onOpen(r.result)}
            >
              <span className="podium-award">
                <Medal size={20} />#{r.rank}
              </span>
              <Avatar name={r.result.name} large index={i} />
              <h2>{r.result.name}</h2>
              <span>
                Roll {r.result.roll} · Class {r.result.section}
              </span>
              <strong>
                {r.percentage.toFixed(1)}
                <small>%</small>
              </strong>
              <p>
                {r.score} marks · {r.percentile.toFixed(2)} percentile
              </p>
            </button>
          ))}
        </div>
      )}
      <section className="card">
        <div className="card-heading">
          <div>
            <h2>The full picture</h2>
            <p>Ties share a rank. Only fully reviewed results are included.</p>
          </div>
          <Users size={19} className="muted" />
        </div>
        {ranked.length ? (
          <div className="table-scroll">
            <table className="results-table">
              <thead>
                <tr>
                  <th>Rank</th>
                  <th>Student</th>
                  <th>Class</th>
                  <th>Score</th>
                  <th>Score (%)</th>
                  <th>Percentile</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                {ranked.slice((safe - 1) * 20, safe * 20).map((r, i) => (
                  <tr key={r.result.id} onClick={() => onOpen(r.result)}>
                    <td>
                      <span
                        className={`table-rank ${r.rank <= 3 ? "top-rank" : ""}`}
                      >
                        #{r.rank}
                      </span>
                    </td>
                    <td>
                      <div className="student-cell">
                        <Avatar name={r.result.name} index={i} />
                        <span>
                          <strong>{r.result.name}</strong>
                          <small>{r.result.roll}</small>
                        </span>
                      </div>
                    </td>
                    <td>{r.result.section}</td>
                    <td>{r.score}</td>
                    <td>{r.percentage.toFixed(1)}%</td>
                    <td>{r.percentile.toFixed(2)}</td>
                    <td>
                      <button
                        className="icon-button"
                        aria-label={`View ${r.result.name}'s ranking details`}
                        onClick={(e) => {
                          e.stopPropagation();
                          onOpen(r.result);
                        }}
                      >
                        <ArrowUpRight size={17} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            icon={<Trophy size={27} />}
            title="A fresh starting line."
            description="Complete scanning and review to see your leaderboard."
          />
        )}
        <div className="pagination">
          <span>
            Page {safe} of {max}
          </span>
          <div>
            <button
              className="button button-secondary button-small"
              disabled={safe === 1}
              onClick={() => setPage(safe - 1)}
            >
              Previous
            </button>
            <button
              className="button button-secondary button-small"
              disabled={safe === max}
              onClick={() => setPage(safe + 1)}
            >
              Next
            </button>
          </div>
        </div>
      </section>
      <p className="page-bottom-note">
        Percentile = students with a strictly lower score ÷ evaluated students ×
        100. Rankings and percentiles use the selected class and subject.
      </p>
    </>
  );
}
