import { useState } from "react";
import {
  ArrowRight,
  BookOpen,
  Building2,
  Check,
  Cloud,
  KeyRound,
  Plus,
  Save,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import type { ClassRoom, Page, School, Workspace } from "./data";
import { api, useSession } from "./session";
import { Modal, PageHeading } from "./components";
export default function Settings({
  workspace,
  onUpdate,
  onAddSchool,
  navigate,
  toast,
}: {
  workspace: Workspace;
  onUpdate: (w: Workspace) => void;
  onAddSchool: (s: School) => Promise<void>;
  navigate: (p: Page) => void;
  toast: (s: string) => void;
}) {
  const session = useSession(),
    cloud = session.phase === "authenticated",
    admin =
      !cloud ||
      session.user?.memberships.find(
        (m) => m.schoolId === workspace.activeSchoolId,
      )?.role === "admin";
  const [school, setSchool] = useState(workspace.school),
    [teacher, setTeacher] = useState(workspace.teacher),
    [newSchool, setNewSchool] = useState(false),
    [className, setClassName] = useState(""),
    [year, setYear] = useState("2026–27"),
    [editing, setEditing] = useState<ClassRoom | null>(null),
    [current, setCurrent] = useState(""),
    [password, setPassword] = useState(""),
    [busy, setBusy] = useState(false);
  const addClass = () => {
    if (!className.trim() || !year.trim()) return;
    if (
      workspace.classes?.some(
        (c) =>
          c.id !== editing?.id &&
          c.name.toLowerCase() === className.trim().toLowerCase(),
      )
    ) {
      toast("That class name already exists.");
      return;
    }
    const record: ClassRoom = {
      id: editing?.id || crypto.randomUUID(),
      schoolId: workspace.activeSchoolId!,
      name: className.trim(),
      academicYear: year.trim(),
    };
    onUpdate({
      ...workspace,
      classes: editing
        ? workspace.classes!.map((c) => (c.id === editing.id ? record : c))
        : [...(workspace.classes || []), record],
      students: workspace.students!.map((s) =>
        editing && (s.classId === editing.id || s.section === editing.name)
          ? { ...s, classId: record.id, section: record.name }
          : s,
      ),
      results: workspace.results.map((r) =>
        editing && r.section === editing.name
          ? { ...r, section: record.name }
          : r,
      ),
    });
    setClassName("");
    setEditing(null);
    toast(
      editing
        ? "Class updated. Linked records followed along."
        : "Class created.",
    );
  };
  return (
    <>
      <PageHeading
        eyebrow="A WORKSPACE THAT WORKS FOR YOU"
        title="Make room for your whole school."
        description="Your institution, classes, profile, and security. All the details that make it yours."
      />
      <div className="v2-settings-grid">
        <div>
          <section className="card">
            <div className="card-heading">
              <div>
                <h2>
                  <Building2 size={18} />
                  Your school & profile
                </h2>
                <p>The people and place behind the progress.</p>
              </div>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!school.trim() || !teacher.trim()) return;
                onUpdate({
                  ...workspace,
                  school: admin ? school.trim() : workspace.school,
                  teacher: teacher.trim(),
                });
                toast("Workspace profile updated.");
              }}
            >
              <div className="form-fields">
                <label>
                  School or institution
                  <input
                    value={school}
                    disabled={!admin}
                    maxLength={120}
                    required
                    onChange={(e) => setSchool(e.target.value)}
                  />
                </label>
                <label>
                  Report author / educator
                  <input
                    value={teacher}
                    maxLength={120}
                    required
                    onChange={(e) => setTeacher(e.target.value)}
                  />
                </label>
                <p className="small muted">
                  The report author is shared workspace metadata, not your login
                  identity.{" "}
                  {cloud
                    ? `Signed in as ${session.user?.email}.`
                    : "Device mode does not authenticate users."}
                </p>
              </div>
              <div className="key-footer">
                <span className="saved-indicator">
                  <Check size={13} />
                  {cloud
                    ? "Server-enforced shared storage"
                    : "Saved on this device"}
                </span>
                <button
                  className="button button-primary"
                  disabled={
                    school === workspace.school && teacher === workspace.teacher
                  }
                >
                  <Save size={15} />
                  Save details
                </button>
              </div>
            </form>
          </section>
          <section className="card class-settings">
            <div className="card-heading">
              <div>
                <h2>
                  <BookOpen size={18} />
                  Classes & sections
                </h2>
                <p>Keep every learning group organised.</p>
              </div>
            </div>
            <div className="class-list">
              {workspace.classes?.map((c) => (
                <div key={c.id}>
                  <span className="stat-icon green">
                    <BookOpen size={16} />
                  </span>
                  <span>
                    <strong>{c.name}</strong>
                    <small>
                      {c.academicYear} ·{" "}
                      {workspace.students?.filter((s) => s.section === c.name)
                        .length || 0}{" "}
                      students
                    </small>
                  </span>
                  <button
                    className="text-button"
                    onClick={() => {
                      setEditing(c);
                      setClassName(c.name);
                      setYear(c.academicYear);
                    }}
                  >
                    Edit
                  </button>
                  <button
                    className="icon-button danger-text"
                    aria-label={`Delete class ${c.name}`}
                    onClick={() => {
                      if (
                        workspace.students?.some(
                          (s) => s.classId === c.id || s.section === c.name,
                        )
                      ) {
                        toast(
                          "Move or remove the registered students before deleting this class.",
                        );
                        return;
                      }
                      if (confirm(`Delete class ${c.name}?`)) {
                        onUpdate({
                          ...workspace,
                          classes: workspace.classes!.filter(
                            (v) => v.id !== c.id,
                          ),
                        });
                        toast("Class deleted.");
                      }
                    }}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              ))}
            </div>
            <form
              className="form-fields"
              onSubmit={(e) => {
                e.preventDefault();
                addClass();
              }}
            >
              <div className="form-two-columns">
                <label>
                  Class / section
                  <input
                    required
                    maxLength={60}
                    value={className}
                    onChange={(e) => setClassName(e.target.value)}
                    placeholder="e.g. 12 A"
                  />
                </label>
                <label>
                  Academic year
                  <input
                    required
                    maxLength={30}
                    value={year}
                    onChange={(e) => setYear(e.target.value)}
                  />
                </label>
              </div>
              <div className="row-actions">
                <button className="button button-secondary">
                  <Plus size={15} />
                  {editing ? "Save class" : "Add class"}
                </button>
                {editing && (
                  <button
                    className="text-button"
                    type="button"
                    onClick={() => {
                      setEditing(null);
                      setClassName("");
                    }}
                  >
                    Cancel edit
                  </button>
                )}
              </div>
            </form>
          </section>
          {cloud && (
            <section className="card">
              <div className="card-heading">
                <div>
                  <h2>
                    <KeyRound size={17} />
                    Change your password
                  </h2>
                  <p>Changing it signs out all other sessions.</p>
                </div>
              </div>
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  setBusy(true);
                  try {
                    await api("/auth/password", {
                      method: "POST",
                      body: JSON.stringify({
                        currentPassword: current,
                        password,
                      }),
                    });
                    setPassword("");
                    setCurrent("");
                    toast(
                      "Your password has been changed. Other sessions have been signed out.",
                    );
                  } catch (e) {
                    toast(
                      e instanceof Error
                        ? e.message
                        : "Password change failed.",
                    );
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <div className="form-fields">
                  <label>
                    Current password
                    <input
                      type="password"
                      required
                      autoComplete="current-password"
                      value={current}
                      onChange={(e) => setCurrent(e.target.value)}
                    />
                  </label>
                  <label>
                    New password
                    <input
                      type="password"
                      required
                      autoComplete="new-password"
                      minLength={12}
                      maxLength={128}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                    />
                  </label>
                  <button className="button button-secondary" disabled={busy}>
                    <KeyRound size={15} />
                    Update password
                  </button>
                </div>
              </form>
            </section>
          )}
        </div>
        <aside>
          <section className="card">
            <div className="card-heading">
              <div>
                <h2>
                  <Building2 size={18} />
                  Your institutions
                </h2>
                <p>Switch schools from the sidebar.</p>
              </div>
            </div>
            <div className="school-list">
              {workspace.schools?.map((s) => (
                <div key={s.id}>
                  <span className="workspace-icon">
                    <Building2 size={17} />
                  </span>
                  <span>
                    <strong>{s.name}</strong>
                    <small>{s.code}</small>
                  </span>
                  {s.id === workspace.activeSchoolId && <Check size={15} />}
                </div>
              ))}
            </div>
            {admin && (
              <div className="form-fields">
                <button
                  className="button button-secondary"
                  onClick={() => setNewSchool(true)}
                >
                  <Plus size={15} />
                  Add another school
                </button>
              </div>
            )}
          </section>
          <section className="v2-security-card">
            <ShieldCheck size={27} />
            <h2>
              {cloud
                ? "Real accounts. Real boundaries."
                : "Your device, your workspace."}
            </h2>
            <p>
              {cloud
                ? "Administrator and teacher permissions are checked on every server request. Sessions use HttpOnly cookies; FastAPI passwords use Argon2id. The preserved Node service uses scrypt and can be migrated without resetting passwords."
                : "This mode saves to your browser. It is not protected by an account login, and does not sync across devices."}
            </p>
            <button className="text-link" onClick={() => navigate("backups")}>
              Manage backups
              <ArrowRight size={15} />
            </button>
          </section>
          <section className="card hosting-card">
            <div className="card-heading">
              <h2>
                <Cloud size={18} />
                Hosting & storage
              </h2>
            </div>
            <div className="form-fields">
              <p>
                {cloud
                  ? "Your browser is connected to the shared API. Check Sync & system for the actual backend, database, storage and recovery configuration."
                  : "The static web client and Android APK do not embed a school server. Secure logins, PostgreSQL data, and encrypted server backups need the included FastAPI backend deployed on persistent HTTPS hosting."}
              </p>
              <p className="small muted">
                Deployment instructions, environment variables, and a Dockerfile
                are included in the repository README. No paid hosting or
                external storage has been provisioned automatically.
              </p>
              <button
                className="button button-secondary"
                onClick={session.openConnection}
              >
                {cloud ? "School server connection" : "Connect school server"}
                <ArrowRight size={15} />
              </button>
              {!cloud && session.available && (
                <button className="text-button" onClick={session.openLogin}>
                  Sign in to this server
                </button>
              )}
            </div>
          </section>
        </aside>
      </div>
      {newSchool && (
        <NewSchoolModal
          onClose={() => setNewSchool(false)}
          onCreate={async (s) => {
            await onAddSchool(s);
            setNewSchool(false);
          }}
        />
      )}
    </>
  );
}
function NewSchoolModal({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (s: School) => Promise<void>;
}) {
  const [name, setName] = useState(""),
    [code, setCode] = useState(""),
    [address, setAddress] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <Modal title="Make space for another institution." onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await onCreate({
              id: crypto.randomUUID(),
              name: name.trim(),
              code: code.trim(),
              address: address.trim(),
            });
          } catch (e) {
            setError(
              e instanceof Error ? e.message : "Could not create school.",
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="modal-body form-fields">
          <label>
            Institution name
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              maxLength={120}
            />
          </label>
          <label>
            Short code
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              required
              maxLength={20}
            />
          </label>
          <label>
            Address
            <input
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              maxLength={500}
            />
          </label>
          {error && <p className="form-error">{error}</p>}
          <p className="small muted">
            Each school has its own students, classes, assessments and results.{" "}
            {useSession().phase === "authenticated"
              ? "You will be an administrator of this new school."
              : "This new school will be saved on this device."}
          </p>
        </div>
        <div className="modal-footer">
          <button
            type="button"
            className="button button-secondary"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="button button-primary"
            disabled={busy}
          >
            <Plus size={15} />
            {busy ? "Creating…" : "Create school"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
