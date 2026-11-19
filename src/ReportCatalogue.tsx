import { useState } from "react";
import { ArrowDownToLine, FileChartColumn } from "lucide-react";
import type { Exam, Result, Workspace } from "./data";
import { apiDownload, useSession } from "./session";
import { downloadTable, reportDefinitions, reportRows } from "./reportTables";
export default function ReportCatalogue({
  workspace,
  exam,
  results,
  section,
  toast,
}: {
  workspace: Workspace;
  exam: Exam;
  results: Result[];
  section: string;
  toast: (s: string) => void;
}) {
  const session = useSession(),
    server =
      session.phase === "authenticated" &&
      session.backend === "fastapi" &&
      !session.offline;
  const [busy, setBusy] = useState("");
  return (
    <section className="card report-catalogue">
      <div className="card-heading">
        <div>
          <h2>
            <FileChartColumn size={18} />
            Reports for every conversation.
          </h2>
          <p>
            {server
              ? "Server-authorized, institution-branded exports from the database."
              : "Generated locally from your current authorized records. No connection required after report assets are cached."}{" "}
            All formats use your selected class filter.
          </p>
        </div>
      </div>
      <div className="report-catalogue-grid">
        {reportDefinitions.map((report) => (
          <article key={report.kind}>
            <h3>{report.name}</h3>
            <p>{report.note}</p>
            <div className="row-actions">
              {(["pdf", "xlsx", "csv"] as const).map((format) => (
                <button
                  key={format}
                  className="text-button"
                  aria-label={`${report.name} ${format.toUpperCase()}`}
                  disabled={!!busy}
                  onClick={async () => {
                    const id = `${report.kind}-${format}`;
                    setBusy(id);
                    try {
                      const file = `omr-${report.kind}-${exam.id}`;
                      if (server)
                        await apiDownload(
                          `/schools/${workspace.activeSchoolId}/reports/${report.kind}?examId=${encodeURIComponent(exam.id)}&format=${format}${section !== "all" ? `&section=${encodeURIComponent(section)}` : ""}`,
                          `${file}.${format}`,
                        );
                      else
                        await downloadTable(
                          reportRows(report.kind, exam, results),
                          `${exam.title} · ${report.name}`,
                          file,
                          format,
                          workspace,
                        );
                      toast(
                        `${report.name} downloaded as ${format.toUpperCase()}. Share private records only with authorized recipients.`,
                      );
                    } catch (e) {
                      toast(
                        e instanceof Error
                          ? e.message
                          : "This report could not be generated.",
                      );
                    } finally {
                      setBusy("");
                    }
                  }}
                >
                  <ArrowDownToLine size={13} />
                  {busy === `${report.kind}-${format}`
                    ? "Preparing…"
                    : format.toUpperCase()}
                </button>
              ))}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
