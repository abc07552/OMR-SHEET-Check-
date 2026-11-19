import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Clock3,
  GraduationCap,
  KeyRound,
  LockKeyhole,
  Pencil,
  Plus,
  ShieldCheck,
  Trash2,
  Users,
} from "lucide-react";
import type { Workspace } from "./data";
import { api, useSession } from "./session";
import {
  Avatar,
  EmptyState,
  Modal,
  PageHeading,
  SearchInput,
  Select,
} from "./components";
import { queryClient } from "./query";
interface Member {
  id: string;
  name: string;
  email: string;
  role: "admin" | "teacher" | "student";
  active?: boolean;
  classIds?: string[];
  studentId?: string;
  permissions?: Record<string, boolean>;
  superAdmin?: boolean;
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
    member = session.user?.memberships.find((m) => m.schoolId === school),
    admin = session.phase === "authenticated" && member?.role === "admin",
    enabled = admin && !session.offline;
  const [adding, setAdding] = useState(false),
    [editing, setEditing] = useState<Member | null>(null),
    [reset, setReset] = useState<Member | null>(null),
    [search, setSearch] = useState(""),
    [role, setRole] = useState("all"),
    [page, setPage] = useState(1);
  const members = useQuery<{ users: Member[] }>({
    queryKey: ["members", session.user?.id, school],
    queryFn: () => api(`/schools/${school}/users`),
    enabled,
  });
  const events = useQuery<{
    events: { id?: string; action: string; createdAt: string; user: string }[];
  }>({
    queryKey: ["audit", session.user?.id, school],
    queryFn: () => api(`/schools/${school}/audit`),
    enabled,
  });
  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ["members"] });
    await queryClient.invalidateQueries({ queryKey: ["audit"] });
  };
  const filtered = (members.data?.users || []).filter(
    (m) =>
      (role === "all" || m.role === role) &&
      `${m.name} ${m.email}`.toLowerCase().includes(search.toLowerCase()),
  );
  const maxPage = Math.max(1, Math.ceil(filtered.length / 12)),
    safePage = Math.min(page, maxPage),
    visible = filtered.slice((safePage - 1) * 12, safePage * 12);
  return (
    <>
      <PageHeading
        eyebrow="THOUGHTFULLY CONNECTED"
        title="A great team. Clear boundaries."
        description="Secure roles, assigned classes and a private account for every learner."
        actions={
          enabled ? (
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
            title="A space for your administrator."
            description={
              session.phase === "authenticated"
                ? "Only school administrators manage accounts. Teacher and student permissions are enforced by the backend, not just this interface."
                : "Secure accounts require the FastAPI backend. The separate device demo does not offer pretend authentication."
            }
          />
        </section>
      ) : (
        <>
          {session.offline && (
            <div className="v2-notice warning">
              Account administration is unavailable offline. Reconnect before
              changing access.
            </div>
          )}
          <div className="role-description-grid enterprise-role-grid">
            {[
              {
                role: "admin",
                title: "Administrator",
                description:
                  "Institution settings, users, publication, backups, and all school records.",
                icon: ShieldCheck,
              },
              {
                role: "teacher",
                title: "Teacher",
                description:
                  "Assigned classes only, with separate examination, scanning and reporting permissions.",
                icon: Users,
              },
              {
                role: "student",
                title: "Student",
                description:
                  "Only their own published results, progress, report cards and contact profile.",
                icon: GraduationCap,
              },
            ].map((r) => (
              <div className="card" key={r.role}>
                <span className="stat-icon lavender">
                  <r.icon size={21} />
                </span>
                <h2>
                  {r.title}{" "}
                  <span className="count-badge">
                    {members.data?.users.filter((m) => m.role === r.role)
                      .length || 0}
                  </span>
                </h2>
                <p>{r.description}</p>
              </div>
            ))}
          </div>
          {members.error && (
            <p className="form-error" role="alert">
              {members.error.message}
            </p>
          )}
          <section className="card">
            <div className="card-heading">
              <div>
                <h2>
                  Your school team{" "}
                  <span className="count-badge">
                    {members.data?.users.length || 0}
                  </span>
                </h2>
                <p>
                  Suspension or removal immediately blocks subsequent protected
                  requests.
                </p>
              </div>
              <Select
                aria-label="Filter account role"
                value={role}
                onChange={(e) => {
                  setRole(e.target.value);
                  setPage(1);
                }}
              >
                <option value="all">All roles</option>
                <option value="admin">Administrators</option>
                <option value="teacher">Teachers</option>
                <option value="student">Students</option>
              </Select>
            </div>
            <div className="roster-search">
              <SearchInput
                value={search}
                onChange={(s) => {
                  setSearch(s);
                  setPage(1);
                }}
                placeholder="Search account name or email…"
              />
            </div>
            <div className="table-scroll">
              <table className="results-table">
                <thead>
                  <tr>
                    <th>Team member</th>
                    <th>Access role</th>
                    <th>Assignments</th>
                    <th>Account</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((m, i) => (
                    <tr key={m.id}>
                      <td>
                        <div className="student-cell">
                          <Avatar name={m.name} index={i} />
                          <div>
                            <strong>
                              {m.name}
                              {m.id === session.user?.id ? " (you)" : ""}
                            </strong>
                            <small className="table-secondary">{m.email}</small>
                          </div>
                        </div>
                      </td>
                      <td>
                        <span className="soft-tag">
                          {m.superAdmin ? "SUPER ADMIN" : m.role}
                        </span>
                      </td>
                      <td>
                        {m.role === "teacher"
                          ? m.classIds?.length
                            ? m.classIds
                                .map(
                                  (id) =>
                                    workspace.classes?.find((c) => c.id === id)
                                      ?.name || id,
                                )
                                .join(", ")
                            : "No assigned classes"
                          : m.role === "student"
                            ? workspace.students?.find(
                                (s) => s.id === m.studentId,
                              )?.name || "Unlinked"
                            : "Institution-wide"}
                      </td>
                      <td>
                        <span
                          className={`status-badge ${m.active === false ? "status-failed" : "status-passed"}`}
                        >
                          {m.active === false ? "Suspended" : "Active"}
                        </span>
                      </td>
                      <td>
                        <div className="row-actions">
                          <button
                            className="icon-button"
                            aria-label={`Edit ${m.name}'s access`}
                            disabled={
                              !enabled ||
                              m.id === session.user?.id ||
                              session.backend !== "fastapi"
                            }
                            onClick={() => setEditing(m)}
                          >
                            <Pencil size={15} />
                          </button>
                          <button
                            className="icon-button"
                            aria-label={`Reset ${m.name}'s password`}
                            disabled={
                              !enabled ||
                              m.id === session.user?.id ||
                              m.superAdmin
                            }
                            onClick={() => setReset(m)}
                          >
                            <KeyRound size={15} />
                          </button>
                          <button
                            className="icon-button danger-text"
                            aria-label={`Remove ${m.name}'s access`}
                            disabled={!enabled || m.id === session.user?.id}
                            onClick={async () => {
                              if (
                                !confirm(
                                  `Remove ${m.name}'s access to this institution?`,
                                )
                              )
                                return;
                              try {
                                await api(`/schools/${school}/users/${m.id}`, {
                                  method: "DELETE",
                                });
                                await refresh();
                                toast(
                                  "School membership removed. Other institutions and historical results are unchanged.",
                                );
                              } catch (e) {
                                toast(
                                  e instanceof Error
                                    ? e.message
                                    : "Access removal failed.",
                                );
                              }
                            }}
                          >
                            <Trash2 size={15} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="pagination">
              <span>
                {filtered.length} accounts · page {safePage} of {maxPage}
              </span>
              <div>
                <button
                  className="button button-secondary button-small"
                  disabled={safePage <= 1}
                  onClick={() => setPage(safePage - 1)}
                >
                  Previous
                </button>
                <button
                  className="button button-secondary button-small"
                  disabled={safePage >= maxPage}
                  onClick={() => setPage(safePage + 1)}
                >
                  Next
                </button>
              </div>
            </div>
          </section>
          <section className="card">
            <div className="card-heading">
              <div>
                <h2>
                  <Clock3 size={17} />
                  Recent activity
                </h2>
                <p>
                  Latest 50 institution audit events. Passwords and session
                  tokens are never recorded here.
                </p>
              </div>
              <button
                className="text-button"
                disabled={!enabled}
                onClick={() => void events.refetch()}
              >
                Refresh
              </button>
            </div>
            {events.error && (
              <p className="form-error">{events.error.message}</p>
            )}
            <div className="audit-list">
              {events.data?.events.map((e, i) => (
                <div key={e.id || i}>
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
        <MemberEditor
          workspace={workspace}
          onClose={() => setAdding(false)}
          onSaved={async () => {
            setAdding(false);
            await refresh();
            toast(
              "Account membership saved. Existing accounts retain their password; share new credentials securely.",
            );
          }}
        />
      )}
      {editing && (
        <MemberEditor
          workspace={workspace}
          member={editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await refresh();
            toast("Role, assignments and permissions updated.");
          }}
        />
      )}
      {reset && (
        <PasswordReset
          school={school}
          member={reset}
          onClose={() => setReset(null)}
          toast={toast}
        />
      )}
    </>
  );
}
function MemberEditor({
  workspace,
  member,
  onClose,
  onSaved,
}: {
  workspace: Workspace;
  member?: Member;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const session = useSession();
  const [name, setName] = useState(member?.name || ""),
    [email, setEmail] = useState(member?.email || ""),
    [password, setPassword] = useState(""),
    [role, setRole] = useState<Member["role"]>(member?.role || "teacher"),
    [classes, setClasses] = useState(member?.classIds || []),
    [student, setStudent] = useState(member?.studentId || ""),
    [permissions, setPermissions] = useState(
      member?.permissions || { createExams: true, scan: true, reports: true },
    ),
    [suspended, setSuspended] = useState(member?.active === false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <Modal
      title={
        member
          ? "Clear access. Deliberate permissions."
          : "A little more teamwork."
      }
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          try {
            const payload = {
              name,
              email,
              password,
              role,
              classIds: classes,
              studentId: role === "student" ? student : undefined,
              permissions,
              ...(member ? { suspended } : {}),
            };
            await api(
              `/schools/${workspace.activeSchoolId}/users${member ? `/${member.id}` : ""}`,
              {
                method: member ? "PATCH" : "POST",
                body: JSON.stringify(payload),
              },
            );
            await onSaved();
          } catch (e) {
            setError(
              e instanceof Error
                ? e.message
                : "Could not save this membership.",
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="modal-body form-fields no-padding">
          {!member && (
            <>
              <label>
                Full name
                <input
                  required
                  maxLength={120}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoComplete="name"
                />
              </label>
              <label>
                Email address
                <input
                  required
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="off"
                />
              </label>
              <label>
                Initial password
                <input
                  aria-label="Initial password"
                  aria-describedby="member-password-guidance"
                  required
                  type="password"
                  minLength={12}
                  maxLength={128}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="new-password"
                />
                <small id="member-password-guidance" className="muted">
                  12–128 characters. Existing accounts retain their own
                  password.
                </small>
              </label>
            </>
          )}
          <label>
            Access role
            <Select
              value={role}
              onChange={(e) => setRole(e.target.value as Member["role"])}
            >
              <option value="teacher">Teacher</option>
              <option value="admin">School administrator</option>
              {session.backend === "fastapi" && (
                <option value="student">Student · private portal</option>
              )}
            </Select>
          </label>
          {role === "teacher" && (
            <>
              <strong>Assigned classes</strong>
              {workspace.classes?.length ? (
                workspace.classes.map((c) => (
                  <label className="checkbox-label" key={c.id}>
                    <input
                      type="checkbox"
                      checked={classes.includes(c.id)}
                      onChange={(e) =>
                        setClasses(
                          e.target.checked
                            ? [...classes, c.id]
                            : classes.filter((id) => id !== c.id),
                        )
                      }
                    />
                    {c.name}
                  </label>
                ))
              ) : (
                <p className="muted">
                  Create a class in Settings before assigning teacher access. An
                  unassigned teacher sees no student records.
                </p>
              )}
              <strong>Feature permissions</strong>
              {[
                {
                  id: "createExams",
                  label:
                    "Create examinations, edit keys and re-evaluate assigned work",
                },
                {
                  id: "scan",
                  label: "Scan, verify and correct assigned student responses",
                },
                {
                  id: "reports",
                  label: "View analytics and download authorized reports",
                },
              ].map((p) => (
                <label className="checkbox-label" key={p.id}>
                  <input
                    type="checkbox"
                    checked={!!permissions[p.id]}
                    onChange={(e) =>
                      setPermissions({
                        ...permissions,
                        [p.id]: e.target.checked,
                      })
                    }
                  />
                  {p.label}
                </label>
              ))}
            </>
          )}
          {role === "student" && (
            <label>
              Linked student registration
              <Select
                required
                value={student}
                onChange={(e) => setStudent(e.target.value)}
              >
                <option value="">Choose a registered learner</option>
                {workspace.students?.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.roll} · {s.name} · {s.section}
                  </option>
                ))}
              </Select>
              <small className="muted">
                One account per student. A student cannot browse classmates or
                unpublished results.
              </small>
            </label>
          )}
          {member && (
            <label className="checkbox-label danger-text">
              <input
                type="checkbox"
                checked={suspended}
                onChange={(e) => setSuspended(e.target.checked)}
              />
              Suspend access to this institution
            </label>
          )}
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
            disabled={busy}
            onClick={onClose}
          >
            Cancel
          </button>
          <button className="button button-primary" disabled={busy}>
            <ShieldCheck size={16} />
            {busy ? "Saving…" : member ? "Save access" : "Add member"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
function PasswordReset({
  school,
  member,
  onClose,
  toast,
}: {
  school: string;
  member: Member;
  onClose: () => void;
  toast: (s: string) => void;
}) {
  const [current, setCurrent] = useState(""),
    [password, setPassword] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <Modal
      title={`Reset ${member.name}'s password`}
      onClose={() => {
        if (!busy) onClose();
      }}
    >
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
              "Password changed. All of this member's previous sessions have been revoked.",
            );
            onClose();
          } catch (e) {
            setError(e instanceof Error ? e.message : "Password reset failed.");
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="modal-body form-fields no-padding">
          <p className="muted">
            Verify your administrator password. Multi-school accounts and super
            administrators must use their own verified recovery flow.
          </p>
          <label>
            Your administrator password
            <input
              type="password"
              autoComplete="current-password"
              required
              maxLength={128}
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
            />
          </label>
          <label>
            New member password
            <input
              type="password"
              autoComplete="new-password"
              required
              minLength={12}
              maxLength={128}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
        </div>
        <div className="modal-footer">
          <button
            className="button button-secondary"
            type="button"
            disabled={busy}
            onClick={onClose}
          >
            Cancel
          </button>
          <button className="button button-primary" disabled={busy}>
            <KeyRound size={16} />
            Verify & reset password
          </button>
        </div>
      </form>
    </Modal>
  );
}
