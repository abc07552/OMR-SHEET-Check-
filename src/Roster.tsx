import { useRef, useState } from "react";
import {
  ArrowDownToLine,
  ArrowRight,
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Pencil,
  Plus,
  Trash2,
  Upload,
  Users,
} from "lucide-react";
import type { Exam, Page, Result, Student, Workspace } from "./data";
import { gradeResult, studentValidation } from "./data";
import {
  Avatar,
  EmptyState,
  Modal,
  PageHeading,
  SearchInput,
  Select,
} from "./components";
import Students from "./Students";
import { studentImportTemplate } from "./documents";
import StudentImport from "./StudentImport";
import type { SaveStatus } from "./session";
interface Props {
  workspace: Workspace;
  exam: Exam;
  results: Result[];
  setExamId: (id: string) => void;
  navigate: (p: Page) => void;
  onOpen: (r: Result) => void;
  onUpdate: (w: Workspace) => void;
  toast: (s: string) => void;
  reload?: () => Promise<void>;
  saveStatus?: SaveStatus;
}
export default function Roster(props: Props) {
  const { workspace, onUpdate, toast } = props;
  const [tab, setTab] = useState<"roster" | "results">("roster"),
    [search, setSearch] = useState(""),
    [section, setSection] = useState("all"),
    [page, setPage] = useState(1),
    [editing, setEditing] = useState<Student | null | undefined>(undefined),
    [deleting, setDeleting] = useState<Student | null>(null),
    [profile, setProfile] = useState<Student | null>(null),
    [importFile, setImportFile] = useState<File | null>(null),
    [issues, setIssues] = useState<string[] | null>(null);
  const importing = !!importFile;
  const input = useRef<HTMLInputElement>(null),
    students = workspace.students || [],
    filtered = students
      .filter(
        (s) =>
          (section === "all" || s.section === section) &&
          `${s.name} ${s.roll} ${s.email || ""}`
            .toLowerCase()
            .includes(search.toLowerCase()),
      )
      .sort((a, b) => a.name.localeCompare(b.name)),
    max = Math.max(1, Math.ceil(filtered.length / 12)),
    safe = Math.min(page, max);
  const updateStudent = (student: Student) => {
    onUpdate({
      ...workspace,
      students: editing
        ? [...students.map((s) => (s.id === student.id ? student : s))]
        : [...students, student],
      results: workspace.results.map((r) =>
        r.studentId === student.id
          ? {
              ...r,
              name: student.name,
              roll: student.roll,
              section: student.section,
            }
          : r,
      ),
    });
    setEditing(undefined);
    toast(
      editing
        ? "Student details updated across linked results."
        : "Student registered. Ready for their next assessment.",
    );
  };
  const readImport = async (file: File) => {
    if (
      props.saveStatus &&
      props.saveStatus !== "saved" &&
      props.saveStatus !== "queued"
    ) {
      toast(
        "Wait for current changes to save before previewing a transactional import.",
      );
      return;
    }
    setImportFile(file);
    if (input.current) input.current.value = "";
  };
  return (
    <>
      {importFile && (
        <StudentImport
          file={importFile}
          workspace={workspace}
          onClose={() => setImportFile(null)}
          onLocalImport={(fresh) =>
            onUpdate({ ...workspace, students: [...students, ...fresh] })
          }
          onServerImport={props.reload || (async () => {})}
          toast={toast}
        />
      )}
      <div className="v2-tabs" aria-label="Student views">
        <button
          className={tab === "roster" ? "active" : ""}
          onClick={() => setTab("roster")}
        >
          <Users size={15} />
          Student register <span>{students.length}</span>
        </button>
        <button
          className={tab === "results" ? "active" : ""}
          onClick={() => setTab("results")}
        >
          <BookOpen size={15} />
          Assessment results
        </button>
      </div>
      {tab === "results" ? (
        <Students {...props} />
      ) : (
        <>
          <PageHeading
            eyebrow="EVERY LEARNER BELONGS"
            title="People, not just percentages."
            description="Register students, organise classes, and follow every learning journey."
            actions={
              <>
                <button
                  className="button button-secondary"
                  disabled={importing}
                  onClick={() => input.current?.click()}
                >
                  <Upload size={16} />
                  {importing ? "Importing…" : "Import CSV / Excel"}
                </button>
                <button
                  className="button button-primary"
                  onClick={() => setEditing(null)}
                >
                  <Plus size={17} />
                  Register student
                </button>
              </>
            }
          />
          <input
            className="sr-only"
            ref={input}
            type="file"
            accept=".csv,.xlsx"
            aria-label="Import students"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void readImport(file);
            }}
          />
          <div className="v2-register-summary">
            <span>
              <Users size={17} />
              <strong>{students.length}</strong> registered learners
            </span>
            <span>
              <BookOpen size={17} />
              <strong>
                {new Set(students.map((s) => s.section)).size}
              </strong>{" "}
              active classes
            </span>
            <button className="text-link" onClick={studentImportTemplate}>
              <ArrowDownToLine size={14} />
              Import template
            </button>
          </div>
          <section className="card">
            <div className="card-heading">
              <div>
                <h2>The student register</h2>
                <p>A single source of truth for your school.</p>
              </div>
              <Select
                aria-label="Roster class filter"
                value={section}
                onChange={(e) => {
                  setSection(e.target.value);
                  setPage(1);
                }}
              >
                <option value="all">All classes</option>
                {[
                  ...new Set([
                    ...students.map((s) => s.section),
                    ...(workspace.classes || []).map((c) => c.name),
                  ]),
                ]
                  .sort()
                  .map((s) => (
                    <option key={s}>{s}</option>
                  ))}
              </Select>
            </div>
            <div className="roster-search">
              <SearchInput
                value={search}
                onChange={(s) => {
                  setSearch(s);
                  setPage(1);
                }}
                placeholder="Search name, roll number, or email…"
              />
            </div>
            {filtered.length ? (
              <div className="table-scroll">
                <table className="results-table roster-table">
                  <thead>
                    <tr>
                      <th>Student</th>
                      <th>Roll number</th>
                      <th>Class</th>
                      <th>Contact</th>
                      <th>Assessments</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.slice((safe - 1) * 12, safe * 12).map((s, i) => (
                      <tr key={s.id}>
                        <td>
                          <button
                            className="student-cell"
                            onClick={() => setProfile(s)}
                          >
                            <Avatar name={s.name} index={i} />
                            <span>
                              <strong>{s.name}</strong>
                              <small>
                                {s.guardian
                                  ? `Guardian: ${s.guardian}`
                                  : "Registered learner"}
                              </small>
                            </span>
                          </button>
                        </td>
                        <td className="mono">{s.roll}</td>
                        <td>{s.section}</td>
                        <td>
                          <span className="contact-cell">
                            {s.email || "—"}
                            <small>{s.phone || ""}</small>
                          </span>
                        </td>
                        <td>
                          {
                            workspace.results.filter(
                              (r) => r.studentId === s.id,
                            ).length
                          }
                        </td>
                        <td>
                          <div className="row-actions">
                            <button
                              className="icon-button"
                              title="Edit student"
                              aria-label={`Edit ${s.name}`}
                              onClick={() => setEditing(s)}
                            >
                              <Pencil size={15} />
                            </button>
                            <button
                              className="icon-button danger-text"
                              title="Delete student"
                              aria-label={`Delete ${s.name}`}
                              onClick={() => setDeleting(s)}
                            >
                              <Trash2 size={15} />
                            </button>
                            <button
                              className="icon-button"
                              aria-label={`View ${s.name}'s progress`}
                              onClick={() => setProfile(s)}
                            >
                              <ArrowRight size={15} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState
                icon={<Users size={25} />}
                title={
                  students.length
                    ? "No matching students."
                    : "Your classroom starts with a name."
                }
                description={
                  students.length
                    ? "Try another search or class."
                    : "Add your first student, or bring the whole class with a CSV or Excel import."
                }
                action={
                  <button
                    className="button button-primary"
                    onClick={() => setEditing(null)}
                  >
                    <Plus size={15} />
                    Register student
                  </button>
                }
              />
            )}
            <div className="pagination">
              <span>
                {filtered.length
                  ? `${(safe - 1) * 12 + 1}–${Math.min(safe * 12, filtered.length)} of ${filtered.length} students`
                  : "0 students"}
              </span>
              <div>
                <button
                  className="pagination-button"
                  aria-label="Previous roster page"
                  disabled={safe === 1}
                  onClick={() => setPage(safe - 1)}
                >
                  <ChevronLeft size={16} />
                </button>
                <span>
                  {safe} / {max}
                </span>
                <button
                  className="pagination-button"
                  aria-label="Next roster page"
                  disabled={safe === max}
                  onClick={() => setPage(safe + 1)}
                >
                  <ChevronRight size={16} />
                </button>
              </div>
            </div>
          </section>
        </>
      )}
      {editing !== undefined && (
        <StudentForm
          student={editing}
          workspace={workspace}
          onClose={() => setEditing(undefined)}
          onSave={updateStudent}
        />
      )}
      {deleting && (
        <Modal
          title="Delete this student and their results?"
          onClose={() => setDeleting(null)}
        >
          <div className="modal-body">
            <p>
              <strong>{deleting.name}</strong> will be removed from the
              register, together with{" "}
              {
                workspace.results.filter((r) => r.studentId === deleting.id)
                  .length
              }{" "}
              linked assessment results. Export a backup first if you might need
              this record.
            </p>
          </div>
          <div className="modal-footer">
            <button
              className="button button-secondary"
              onClick={() => setDeleting(null)}
            >
              Keep student
            </button>
            <button
              className="button button-danger"
              onClick={() => {
                onUpdate({
                  ...workspace,
                  students: students.filter((s) => s.id !== deleting.id),
                  results: workspace.results.filter(
                    (r) => r.studentId !== deleting.id,
                  ),
                });
                setDeleting(null);
                toast("Student and linked results deleted.");
              }}
            >
              <Trash2 size={15} />
              Delete student
            </button>
          </div>
        </Modal>
      )}
      {profile && (
        <Modal
          title="The bigger picture, one learner at a time."
          className="student-modal"
          onClose={() => setProfile(null)}
        >
          <div className="modal-body">
            <div className="student-profile">
              <Avatar name={profile.name} large />
              <div>
                <h2>{profile.name}</h2>
                <p>
                  Roll {profile.roll} · Class {profile.section}
                </p>
              </div>
              <button
                className="button button-secondary button-small"
                onClick={() => {
                  setEditing(profile);
                  setProfile(null);
                }}
              >
                <Pencil size={14} />
                Edit details
              </button>
            </div>
            <div className="profile-meta">
              <span>
                Email<strong>{profile.email || "Not provided"}</strong>
              </span>
              <span>
                Phone<strong>{profile.phone || "Not provided"}</strong>
              </span>
              <span>
                Guardian<strong>{profile.guardian || "Not provided"}</strong>
              </span>
            </div>
            <h3 className="section-subheading">Assessment journey</h3>
            <div className="journey-list">
              {workspace.exams.map((e) => {
                const r = workspace.results.find(
                  (r) => r.studentId === profile.id && r.examId === e.id,
                );
                if (!r) return null;
                const g = gradeResult(r, e);
                return (
                  <button
                    key={e.id}
                    onClick={() => {
                      setProfile(null);
                      props.onOpen(r);
                    }}
                  >
                    <span className="journey-date">{e.date}</span>
                    <span>
                      <strong>{e.title}</strong>
                      <small>
                        {e.subject} · {g.status}
                      </small>
                    </span>
                    <div className="v2-track">
                      <i style={{ width: `${g.percentage}%` }} />
                    </div>
                    <b>{g.percentage.toFixed(1)}%</b>
                    <ArrowRight size={15} />
                  </button>
                );
              })}
              {!workspace.results.some((r) => r.studentId === profile.id) && (
                <EmptyState
                  title="A fresh learning journey."
                  description="This student’s assessment results will appear here."
                />
              )}
            </div>
          </div>
          <div className="modal-footer">
            <button
              className="button button-secondary"
              onClick={() => setProfile(null)}
            >
              Close
            </button>
          </div>
        </Modal>
      )}
      {issues && (
        <Modal title="Student import summary" onClose={() => setIssues(null)}>
          <div className="modal-body">
            <p>Valid students were added. These rows need attention:</p>
            <ul className="import-issues">
              {issues.slice(0, 100).map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ul>
            {issues.length > 100 && (
              <p>And {issues.length - 100} more issues.</p>
            )}
          </div>
          <div className="modal-footer">
            <button
              className="button button-primary"
              onClick={() => setIssues(null)}
            >
              Got it
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
function StudentForm({
  student,
  workspace,
  onClose,
  onSave,
}: {
  student: Student | null;
  workspace: Workspace;
  onClose: () => void;
  onSave: (s: Student) => void;
}) {
  const [draft, setDraft] = useState<Student>(
      student || {
        id: crypto.randomUUID(),
        schoolId: workspace.activeSchoolId!,
        name: "",
        roll: "",
        section: workspace.classes?.[0]?.name || "",
        registeredAt: new Date().toISOString(),
      },
    ),
    [error, setError] = useState("");
  const text =
    (key: keyof Student) => (e: React.ChangeEvent<HTMLInputElement>) =>
      setDraft((d) => ({ ...d, [key]: e.target.value }));
  return (
    <Modal
      title={
        student
          ? "A few details make all the difference."
          : "Meet your next success story."
      }
      onClose={onClose}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const clean = {
            ...draft,
            name: draft.name.trim(),
            roll: draft.roll.trim(),
            section: draft.section.trim(),
            classId: workspace.classes?.find(
              (c) => c.name === draft.section.trim(),
            )?.id,
          };
          const error = studentValidation(
            clean,
            workspace.students || [],
            student?.id,
          );
          if (error) {
            setError(error);
            return;
          }
          onSave(clean);
        }}
      >
        <div className="modal-body form-fields no-padding-inner">
          <label>
            Full name
            <input
              value={draft.name}
              onChange={text("name")}
              required
              maxLength={120}
              autoComplete="name"
            />
          </label>
          <div className="form-two-columns">
            <label>
              Roll number
              <input
                value={draft.roll}
                onChange={text("roll")}
                required
                maxLength={40}
              />
            </label>
            <label>
              Class / section
              <input
                aria-label="Class / section"
                list="student-class-options"
                value={draft.section}
                onChange={text("section")}
                required
                maxLength={60}
              />
              <datalist id="student-class-options">
                {workspace.classes?.map((c) => (
                  <option key={c.id}>{c.name}</option>
                ))}
              </datalist>
            </label>
          </div>
          <label>
            Email
            <input
              type="email"
              value={draft.email || ""}
              onChange={text("email")}
              maxLength={200}
            />
          </label>
          <div className="form-two-columns">
            <label>
              Phone
              <input
                type="tel"
                value={draft.phone || ""}
                onChange={text("phone")}
                maxLength={40}
              />
            </label>
            <label>
              Parent / guardian
              <input
                value={draft.guardian || ""}
                onChange={text("guardian")}
                maxLength={120}
              />
            </label>
          </div>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
        </div>
        <div className="modal-footer">
          <button
            type="button"
            className="button button-secondary"
            onClick={onClose}
          >
            Cancel
          </button>
          <button className="button button-primary" type="submit">
            <Plus size={15} />
            {student ? "Save student" : "Register student"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
