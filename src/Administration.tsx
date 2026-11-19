import { useEffect, useState } from "react";
import {
  ArrowRight,
  Clock3,
  KeyRound,
  LockKeyhole,
  Plus,
  ShieldCheck,
  Trash2,
  Users,
} from "lucide-react";
import type { Workspace } from "./data";
import { api, useSession } from "./session";
import { Avatar, EmptyState, Modal, PageHeading, Select } from "./components";
interface Member {
  id: string;
  name: string;
  email: string;
  role: "admin" | "teacher";
}
export default function Administration({
  workspace,
  toast,
}: {
  workspace: Workspace;
  toast: (s: string) => void;
}) {
  const session = useSession(),
    school = workspace.activeSchoolId!,
    cloud = session.phase === "authenticated",
    admin =
      cloud &&
      session.user?.memberships.find((m) => m.schoolId === school)?.role ===
        "admin";
  const [members, setMembers] = useState<Member[]>([]),
    [events, setEvents] = useState<
      { action: string; createdAt: string; user: string }[]
    >([]),
    [adding, setAdding] = useState(false),
    [error, setError] = useState(""),
    [reset, setReset] = useState<Member | null>(null);
  const refresh = async () => {
    try {
      const [u, a] = await Promise.all([
        api<{ users: Member[] }>(`/schools/${school}/users`),
        api<{ events: typeof events }>(`/schools/${school}/audit`),
      ]);
      setMembers(u.users);
      setEvents(a.events);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load team.");
    }
  };
  useEffect(() => {
    if (admin) void refresh();
  }, [admin, school]);
  return (
    <>
      <PageHeading
        eyebrow="THOUGHTFULLY CONNECTED"
        title="A great team. Clear boundaries."
        description="Real accounts and server-enforced roles for the people behind your students’ progress."
        actions={
          admin ? (
            <button
              className="button button-primary"
              onClick={() => setAdding(true)}
            >
              <Plus size={16} />
              Add team member
            </button>
          ) : undefined
        }
      />
      {!admin ? (
        <section className="card">
          <EmptyState
            icon={<LockKeyhole size={30} />}
            title={
              cloud
                ? "A space for your administrator."
                : "A real backend, not a pretend login."
            }
            description={
              cloud
                ? "Your teacher account can manage students, keys, scanning, corrections, analytics, and reports. Only administrators can manage accounts, school details, and server recovery points."
                : "Device mode has no secure user accounts. Deploy the included Node/SQLite backend, create the first administrator, and invite teachers to enable shared access."
            }
            action={
              !cloud && session.available ? (
                <button
                  className="button button-primary"
                  onClick={session.openLogin}
                >
                  Open secure sign-in
                  <ArrowRight size={16} />
                </button>
              ) : undefined
            }
          />
        </section>
      ) : (
        <>
          {error && <p className="form-error">{error}</p>}
          <div className="role-description-grid">
            <div className="card">
              <span className="stat-icon green">
                <ShieldCheck size={21} />
              </span>
              <h2>School administrator</h2>
              <p>
                Everything teachers can do, plus account membership, institution
                settings, workspace imports, and server backups.
              </p>
            </div>
            <div className="card">
              <span className="stat-icon lavender">
                <Users size={21} />
              </span>
              <h2>Teacher</h2>
              <p>
                Students, classes, assessments, template layouts, scanning,
                response correction, analytics, and report downloads.
              </p>
            </div>
          </div>
          <section className="card">
            <div className="card-heading">
              <div>
                <h2>
                  Your school team{" "}
                  <span className="count-badge">{members.length}</span>
                </h2>
                <p>
                  Membership is scoped to this school. Removing it revokes
                  access immediately.
                </p>
              </div>
              <ShieldCheck size={19} className="muted" />
            </div>
            <div className="table-scroll">
              <table className="results-table">
                <thead>
                  <tr>
                    <th>Team member</th>
                    <th>Email address</th>
                    <th>Access role</th>
                    <th>Account</th>
                    <th>Remove access</th>
                  </tr>
                </thead>
                <tbody>
                  {members.map((m, i) => (
                    <tr key={m.id}>
                      <td>
                        <div className="student-cell">
                          <Avatar name={m.name} index={i} />
                          <strong>
                            {m.name}
                            {m.id === session.user?.id ? " (you)" : ""}
                          </strong>
                        </div>
                      </td>
                      <td>{m.email}</td>
                      <td>
                        <span className="soft-tag">{m.role}</span>
                      </td>
                      <td>
                        <button
                          className="text-button"
                          disabled={m.id === session.user?.id}
                          onClick={() => setReset(m)}
                        >
                          <KeyRound size={13} />
                          Reset password
                        </button>
                      </td>
                      <td>
                        <button
                          className="icon-button danger-text"
                          disabled={m.id === session.user?.id}
                          aria-label={`Remove ${m.name}'s access`}
                          onClick={async () => {
                            if (
                              !confirm(
                                `Remove ${m.name}'s access to this school?`,
                              )
                            )
                              return;
                            try {
                              await api(`/schools/${school}/users/${m.id}`, {
                                method: "DELETE",
                              });
                              await refresh();
                              toast("School membership removed.");
                            } catch (e) {
                              toast(
                                e instanceof Error
                                  ? e.message
                                  : "Could not remove access.",
                              );
                            }
                          }}
                        >
                          <Trash2 size={16} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          <section className="card">
            <div className="card-heading">
              <div>
                <h2>
                  <Clock3 size={17} />
                  Recent activity
                </h2>
                <p>The latest 50 server audit events.</p>
              </div>
              <button
                className="text-button"
                onClick={() => {
                  void refresh();
                }}
              >
                Refresh
              </button>
            </div>
            <div className="audit-list">
              {events.map((e, i) => (
                <div key={i}>
                  <span className="live-dot" />
                  <div>
                    <strong>{e.action}</strong>
                    <small>{e.user || "System"}</small>
                  </div>
                  <time>{new Date(e.createdAt).toLocaleString()}</time>
                </div>
              ))}
            </div>
          </section>
        </>
      )}
      {adding && (
        <AddMember
          school={school}
          onClose={() => setAdding(false)}
          onSaved={async () => {
            setAdding(false);
            await refresh();
            toast(
              "Team membership created. Share credentials securely; no email is sent automatically.",
            );
          }}
        />
      )}
      {reset && (
        <ResetPassword
          member={reset}
          school={school}
          onClose={() => setReset(null)}
          toast={toast}
        />
      )}
    </>
  );
}
function AddMember({
  school,
  onClose,
  onSaved,
}: {
  school: string;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [name, setName] = useState(""),
    [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [role, setRole] = useState("teacher"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <Modal title="A little more teamwork." onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await api(`/schools/${school}/users`, {
              method: "POST",
              body: JSON.stringify({ name, email, password, role }),
            });
            await onSaved();
          } catch (e) {
            setError(
              e instanceof Error ? e.message : "Could not create membership.",
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="modal-body form-fields">
          <label>
            Full name
            <input
              required
              maxLength={120}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label>
            Email address
            <input
              required
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <label>
            Initial password
            <input
              required
              type="password"
              minLength={12}
              maxLength={128}
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          <label>
            School role
            <Select value={role} onChange={(e) => setRole(e.target.value)}>
              <option value="teacher">Teacher</option>
              <option value="admin">School administrator</option>
            </Select>
          </label>
          <p className="small muted">
            Use at least 12 characters. Share initial credentials through a
            secure channel. If this email already has an account, only school
            membership is added; its existing password is not changed.
          </p>
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
          <button
            type="submit"
            className="button button-primary"
            disabled={busy}
          >
            <Plus size={15} />
            {busy ? "Adding…" : "Add member"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
function ResetPassword({
  member,
  school,
  onClose,
  toast,
}: {
  member: Member;
  school: string;
  onClose: () => void;
  toast: (s: string) => void;
}) {
  const [current, setCurrent] = useState(""),
    [password, setPassword] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <Modal title={`Reset ${member.name}'s password?`} onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await api(`/schools/${school}/users/${member.id}/password`, {
              method: "POST",
              body: JSON.stringify({ currentPassword: current, password }),
            });
            toast(
              "Password reset. All of their sessions have been signed out. Share the new password securely.",
            );
            onClose();
          } catch (e) {
            setError(e instanceof Error ? e.message : "Reset failed.");
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="modal-body form-fields">
          <p>
            Only accounts belonging exclusively to this school can be reset
            here. Multi-school accounts must change their own password or be
            recovered by the server owner.
          </p>
          <label>
            Your administrator password
            <input
              type="password"
              required
              autoComplete="current-password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
            />
          </label>
          <label>
            New password for {member.name}
            <input
              type="password"
              required
              minLength={12}
              maxLength={128}
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          {error && <p className="form-error">{error}</p>}
        </div>
        <div className="modal-footer">
          <button
            type="button"
            className="button button-secondary"
            onClick={onClose}
          >
            Cancel
          </button>
          <button className="button button-danger" disabled={busy}>
            Reset password
          </button>
        </div>
      </form>
    </Modal>
  );
}
