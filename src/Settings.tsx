import { useRef, useState } from "react";
import {
  ArrowDownToLine,
  ArrowRight,
  Building2,
  Check,
  Database,
  HardDrive,
  LockKeyhole,
  RotateCcw,
  Save,
  ShieldCheck,
  Sparkles,
  Upload,
} from "lucide-react";
import type { Exam, Workspace } from "./data";
import { createDemoData, downloadFile, isValidWorkspace } from "./data";
import { Modal, PageHeading } from "./components";
interface Props {
  workspace: Workspace;
  onUpdate: (data: Workspace) => void;
  toast: (text: string) => void;
}
export default function Settings({ workspace, onUpdate, toast }: Props) {
  const [school, setSchool] = useState(workspace.school);
  const [teacher, setTeacher] = useState(workspace.teacher);
  const [confirm, setConfirm] = useState<"demo" | "fresh" | "import" | null>(
    null,
  );
  const [pending, setPending] = useState<Workspace | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const dirty = school !== workspace.school || teacher !== workspace.teacher;
  const reset = () => {
    if (confirm === "import" && pending) {
      onUpdate(pending);
      setSchool(pending.school);
      setTeacher(pending.teacher);
      toast("Workspace restored from your backup.");
    } else if (confirm === "demo") {
      const demo = createDemoData();
      onUpdate(demo);
      setSchool(demo.school);
      setTeacher(demo.teacher);
      toast("The demo workspace is ready to explore again.");
    } else if (confirm === "fresh") {
      const exam: Exam = {
        id: `exam-${crypto.randomUUID().slice(0, 8)}`,
        title: "My first assessment",
        subject: "General",
        date: new Date().toISOString().slice(0, 10),
        questions: 20,
        marksCorrect: 1,
        negativeMarks: 0,
        passPercentage: 40,
        answers: Array(20).fill(null),
        published: false,
      };
      onUpdate({
        version: 1,
        school: school.trim() || workspace.school,
        teacher: teacher.trim() || workspace.teacher,
        exams: [exam],
        results: [],
      });
      toast("A fresh workspace. Start with your first answer key.");
    }
    setConfirm(null);
    setPending(null);
  };
  const importBackup = async (file?: File) => {
    if (!file) return;
    if (file.size > 15 * 1024 * 1024) {
      toast("That backup is too large. Please use a file under 15 MB.");
      return;
    }
    try {
      const data: unknown = JSON.parse(await file.text());
      if (!isValidWorkspace(data)) throw new Error("invalid");
      setPending(data);
      setConfirm("import");
    } catch {
      toast("That file isn’t a valid Markly workspace backup.");
    }
    if (input.current) input.current.value = "";
  };
  return (
    <>
      <PageHeading
        eyebrow="A SPACE THAT FEELS LIKE YOURS"
        title="Your workspace. Your way."
        description="A few thoughtful details to make Markly work better for you."
      />
      <div className="settings-layout">
        <div>
          <section className="card">
            <div className="card-heading">
              <div>
                <h2>Make yourself at home</h2>
                <p>The people and place behind the progress.</p>
              </div>
              <Building2 size={19} className="muted" />
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!school.trim() || !teacher.trim()) return;
                onUpdate({
                  ...workspace,
                  school: school.trim(),
                  teacher: teacher.trim(),
                });
                toast("Your workspace details are saved.");
              }}
            >
              <div className="form-fields">
                <label>
                  School or institution
                  <input
                    value={school}
                    required
                    maxLength={65}
                    onChange={(e) => setSchool(e.target.value)}
                  />
                </label>
                <label>
                  Your name
                  <input
                    value={teacher}
                    required
                    maxLength={55}
                    onChange={(e) => setTeacher(e.target.value)}
                  />
                </label>
                <p className="muted small">
                  Your school name appears on your print-ready assessment
                  reports.
                </p>
              </div>
              <div className="key-footer">
                <span className="saved-indicator">
                  <Check size={13} />
                  {dirty ? "A few unsaved changes" : "Everything looks good"}
                </span>
                <button className="button button-primary" disabled={!dirty}>
                  <Save size={15} />
                  Save details
                </button>
              </div>
            </form>
          </section>
          <section className="card settings-data-card">
            <div className="card-heading">
              <div>
                <h2>A safe place for your progress</h2>
                <p>Your data is yours. Keep an extra copy, just in case.</p>
              </div>
              <Database size={18} className="muted" />
            </div>
            <div className="settings-data-row">
              <span className="stat-icon green">
                <ArrowDownToLine size={19} />
              </span>
              <div>
                <h3>Back up your workspace</h3>
                <p>
                  All assessments, answer keys, and student results in one JSON
                  file.
                </p>
              </div>
              <button
                className="button button-secondary button-small"
                onClick={() => {
                  downloadFile(
                    "markly-workspace-backup.json",
                    JSON.stringify(workspace, null, 2),
                    "application/json",
                  );
                  toast("Backup downloaded. Your progress is worth keeping.");
                }}
              >
                Download
              </button>
            </div>
            <div className="settings-data-row">
              <span className="stat-icon lavender">
                <Upload size={19} />
              </span>
              <div>
                <h3>Restore a backup</h3>
                <p>
                  Bring back a workspace you previously exported from Markly.
                </p>
              </div>
              <button
                className="button button-secondary button-small"
                onClick={() => input.current?.click()}
              >
                Choose file
              </button>
              <input
                className="sr-only"
                type="file"
                accept=".json,application/json"
                ref={input}
                aria-label="Import workspace backup"
                onChange={(e) => importBackup(e.target.files?.[0])}
              />
            </div>
          </section>
          <section className="card settings-reset">
            <div className="card-heading">
              <div>
                <h2>A new chapter?</h2>
                <p>
                  Explore the sample workspace, or start making it your own.
                </p>
              </div>
              <RotateCcw size={18} className="muted" />
            </div>
            <div className="settings-reset-actions">
              <button
                className="button button-secondary"
                onClick={() => setConfirm("demo")}
              >
                <Sparkles size={15} />
                Restore demo data
              </button>
              <button
                className="button button-danger-outline"
                onClick={() => setConfirm("fresh")}
              >
                Start a fresh workspace
                <ArrowRight size={15} />
              </button>
            </div>
            <p className="small muted">
              These actions replace the current workspace. We recommend
              downloading a backup first.
            </p>
          </section>
        </div>
        <aside>
          <section className="privacy-card">
            <span className="privacy-shield">
              <ShieldCheck size={31} />
            </span>
            <span className="eyebrow">PRIVATE BY DESIGN</span>
            <h2>
              Big on insights.
              <br />
              Small on data sharing.
            </h2>
            <p>
              Markly works entirely in your browser. Your sheets and student
              records are never sent to a server.
            </p>
            <div>
              <LockKeyhole size={16} />
              <span>No accounts. No uploads to the cloud.</span>
            </div>
            <div>
              <HardDrive size={16} />
              <span>Saved locally on this browser.</span>
            </div>
            <div>
              <Database size={16} />
              <span>
                {workspace.exams.length} answer keys ·{" "}
                {workspace.results.length.toLocaleString()} results
              </span>
            </div>
            <p className="privacy-footnote">
              Clearing browser data also clears your workspace. Keep regular
              backups, especially on a shared device.
            </p>
          </section>
        </aside>
      </div>
      {confirm && (
        <Modal
          title={
            confirm === "fresh"
              ? "Ready for a fresh start?"
              : confirm === "import"
                ? "Restore this workspace?"
                : "Bring back the demo workspace?"
          }
          onClose={() => setConfirm(null)}
        >
          <div className="modal-body">
            <p>
              {confirm === "fresh"
                ? "This removes all current assessments and student results, and creates an empty answer key for you. Your school details stay."
                : confirm === "import"
                  ? `This replaces your current workspace with ${pending?.exams.length} assessments and ${pending?.results.length} results from your backup.`
                  : "This replaces your current workspace with the original sample assessments and results."}
            </p>
            <p className="muted">
              You can’t undo this. Download a backup first if there’s anything
              you’d like to keep.
            </p>
            <button
              className="text-link"
              onClick={() => {
                downloadFile(
                  "markly-workspace-backup.json",
                  JSON.stringify(workspace, null, 2),
                  "application/json",
                );
                toast("Current workspace backed up.");
              }}
            >
              <ArrowDownToLine size={14} />
              Back up before continuing
            </button>
          </div>
          <div className="modal-footer">
            <button
              className="button button-secondary"
              onClick={() => setConfirm(null)}
            >
              Keep my workspace
            </button>
            <button className="button button-primary" onClick={reset}>
              {confirm === "import"
                ? "Restore backup"
                : confirm === "demo"
                  ? "Restore demo"
                  : "Start fresh"}
              <ArrowRight size={15} />
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
