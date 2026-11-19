import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { Dispatch, ReactNode, SetStateAction } from "react";
import type { Workspace } from "./data";
import { downloadFile, enrichWorkspace, loadWorkspace } from "./data";
import { saveSnapshot } from "./storage";
import {
  authorizationChanged,
  cacheSchool,
  cachedSchool,
  lockVault,
  refreshVaultUser,
  unlockVault,
  vaultEnabled,
} from "./offline";
import type { PendingOperation } from "./offline";
import { queryClient } from "./query";

export interface Membership {
  schoolId: string;
  name: string;
  code: string;
  role: "admin" | "teacher" | "student";
  classIds?: string[];
  studentId?: string;
  permissions?: Record<string, boolean>;
}
export interface AuthUser {
  id: string;
  name: string;
  email: string;
  owner: boolean;
  role?: string;
  memberships: Membership[];
}
const configured = import.meta.env.VITE_API_BASE?.replace(/\/$/, "");
export const API_BASE = configured || "/api";
export class APIError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
export async function api<T = any>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    cache: "no-store",
    ...options,
    credentials: "include",
    headers: {
      ...(options.body instanceof FormData
        ? {}
        : { "Content-Type": "application/json" }),
      "X-Markly-Request": "1",
      ...options.headers,
    },
  });
  const data = await response.json().catch(() => ({
    error: "The server did not return valid JSON. Check your connection.",
  }));
  if (!response.ok) {
    if (
      response.status === 401 &&
      !/^\/(auth\/(login|recovery)|setup)/.test(path)
    )
      window.dispatchEvent(new Event("omr-session-expired"));
    throw new APIError(data.error || "The request failed.", response.status);
  }
  return data;
}
export async function apiDownload(path: string, filename: string) {
  const response = await fetch(`${API_BASE}${path}`, {
    credentials: "include",
    cache: "no-store",
    headers: { "X-Markly-Request": "1" },
  });
  if (!response.ok) {
    if (response.status === 401)
      window.dispatchEvent(new Event("omr-session-expired"));
    const error = await response.json().catch(() => ({}));
    throw new APIError(
      error.error || "The report could not be downloaded.",
      response.status,
    );
  }
  downloadFile(filename, await response.blob());
}
interface Session {
  phase: "checking" | "login" | "setup" | "local" | "authenticated";
  available: boolean;
  backend: "fastapi" | "node" | "";
  offline: boolean;
  vaultEpoch: number;
  warning: string;
  tokenRequired: boolean;
  user: AuthUser | null;
  activeSchool: string;
  setSchool: (id: string) => void;
  login: (email: string, password: string) => Promise<void>;
  setup: (data: Record<string, unknown>) => Promise<void>;
  logout: () => Promise<void>;
  explore: () => void;
  openLogin: () => void;
  reloadUser: () => Promise<void>;
  unlockOffline: (email: string, passphrase: string) => Promise<void>;
  reconnect: () => Promise<void>;
}
const SessionContext = createContext<Session | null>(null);
export function SessionProvider({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<Session["phase"]>("checking"),
    [available, setAvailable] = useState(false),
    [backend, setBackend] = useState<Session["backend"]>(""),
    [offline, setOffline] = useState(!navigator.onLine),
    [tokenRequired, setTokenRequired] = useState(false),
    [needsSetup, setNeedsSetup] = useState(false),
    [user, setUser] = useState<AuthUser | null>(null),
    [activeSchool, setSchool] = useState(""),
    [vaultEpoch, setVaultEpoch] = useState(0),
    [warning, setWarning] = useState("");
  const authEpoch = useRef(0),
    currentUser = useRef(user),
    revoking = useRef<Promise<boolean> | null>(null);
  currentUser.current = user;
  useEffect(() => {
    let alive = true;
    const controller = new AbortController(),
      timeout = setTimeout(() => controller.abort(), 8000);
    void (async () => {
      try {
        if (!configured && location.hostname.endsWith("github.io"))
          throw new Error("Static hosting");
        const health = await api<{ service: string; backend?: string }>(
          "/health",
          { signal: controller.signal },
        );
        if (health.service !== "markly-api") throw new Error("No API");
        if (!alive) return;
        await revokeDeferred();
        setAvailable(true);
        setOffline(false);
        setBackend(health.backend === "fastapi" ? "fastapi" : "node");
        const status = await api<{
          needsSetup: boolean;
          setupAllowed: boolean;
          tokenRequired: boolean;
        }>("/setup/status", { signal: controller.signal });
        if (!alive) return;
        setTokenRequired(status.tokenRequired);
        setNeedsSetup(status.needsSetup);
        if (sessionStorage.getItem("markly-offline") === "1") {
          setPhase("local");
          return;
        }
        if (status.needsSetup) {
          setPhase(status.setupAllowed ? "setup" : "login");
          return;
        }
        try {
          const data = await api<{ user: AuthUser }>("/auth/me", {
            signal: controller.signal,
          });
          if (!alive) return;
          setUser(data.user);
          setSchool(data.user.memberships[0]?.schoolId || "");
          setPhase("authenticated");
        } catch (e) {
          if (alive) {
            setPhase("login");
            if (!(e instanceof APIError)) setOffline(true);
          }
        }
      } catch {
        if (alive) {
          setOffline(true);
          setPhase(location.hostname.endsWith("github.io") ? "local" : "login");
        }
      } finally {
        clearTimeout(timeout);
      }
    })();
    return () => {
      alive = false;
      controller.abort();
      clearTimeout(timeout);
    };
  }, []);
  const revokeDeferred = (): Promise<boolean> => {
    if (revoking.current) return revoking.current;
    if (localStorage.getItem("omr-revoke-on-reconnect") !== "1")
      return Promise.resolve(false);
    const task = (async () => {
      await api("/auth/logout", { method: "POST" });
      localStorage.removeItem("omr-revoke-on-reconnect");
      return true;
    })().finally(() => {
      if (revoking.current === task) revoking.current = null;
    });
    revoking.current = task;
    return task;
  };
  const adopt = async (u: AuthUser, epoch: number) => {
    if (epoch !== authEpoch.current) return;
    if (!vaultEnabled(u.id)) lockVault();
    else if (await refreshVaultUser(u))
      setWarning(
        "Your authorizations changed. The prior encrypted queue is retained but locked; resolve it with your administrator before forgetting the old vault.",
      );
    if (epoch !== authEpoch.current) return;
    queryClient.clear();
    setUser(u);
    setSchool(u.memberships[0]?.schoolId || "");
    setOffline(false);
    setAvailable(true);
    sessionStorage.removeItem("markly-offline");
    setPhase("authenticated");
  };
  const authenticate = async (
    path: string,
    values: Record<string, unknown>,
  ) => {
    const epoch = ++authEpoch.current;
    await revokeDeferred();
    if (epoch !== authEpoch.current) return;
    const data = await api<{ user: AuthUser }>(path, {
      method: "POST",
      body: JSON.stringify(values),
    });
    await adopt(data.user, epoch);
  };
  const reconnect = useCallback(async () => {
    const epoch = authEpoch.current;
    if (await revokeDeferred()) {
      window.dispatchEvent(new Event("omr-session-expired"));
      throw new APIError(
        "The previous session was revoked after offline sign-out. Sign in online before synchronizing.",
        401,
      );
    }
    const data = await api<{ user: AuthUser }>("/auth/me");
    if (epoch !== authEpoch.current) return;
    const prior = currentUser.current;
    if (prior && data.user.id !== prior.id) {
      window.dispatchEvent(new Event("omr-session-expired"));
      throw new APIError(
        "A different account is signed in. Reauthenticate before syncing.",
        401,
      );
    }
    const changed = !!prior && authorizationChanged(prior, data.user);
    let vaultChanged = false;
    try {
      vaultChanged = await refreshVaultUser(data.user);
    } catch (e) {
      // A storage failure must never retain a broader in-memory authorization projection.
      lockVault();
      setWarning(
        `Private offline storage could not be refreshed and has been locked: ${e instanceof Error ? e.message : "Storage failure"}`,
      );
    }
    if (epoch !== authEpoch.current) return;
    if (changed || vaultChanged) {
      setWarning(
        "Assignments or permissions changed. Prior private views were cleared. Any older encrypted queue is retained but locked; no queued changes were sent. Ask your administrator to reconcile it.",
      );
      queryClient.clear();
      setVaultEpoch((n) => n + 1);
    }
    setUser(data.user);
    setSchool((s) =>
      data.user.memberships.some((m) => m.schoolId === s)
        ? s
        : data.user.memberships[0]?.schoolId || "",
    );
    setAvailable(true);
    setOffline(false);
  }, []);
  useEffect(() => {
    const disconnected = () => setOffline(true);
    const connected = () => {
      if (user) void reconnect().catch(() => setOffline(true));
      else if (localStorage.getItem("omr-revoke-on-reconnect") === "1")
        void revokeDeferred()
          .then(() => {
            setOffline(false);
          })
          .catch(() => setOffline(true));
      else setOffline(false);
    };
    window.addEventListener("offline", disconnected);
    window.addEventListener("online", connected);
    return () => {
      window.removeEventListener("offline", disconnected);
      window.removeEventListener("online", connected);
    };
  }, [reconnect, user?.id]);
  useEffect(() => {
    const expired = () => {
      if (!user) return;
      authEpoch.current++;
      lockVault();
      queryClient.clear();
      setUser(null);
      setPhase("login");
      setWarning(
        "Your session expired or was revoked. Private records are locked. Sign in again; encrypted pending work is retained.",
      );
    };
    const interval = setInterval(() => {
      if (user && offline && !vaultEnabled(user.id)) expired();
      else if (user && !offline)
        void reconnect().catch((e) => {
          if (!(e instanceof APIError)) setOffline(true);
        });
    }, 60_000);
    window.addEventListener("omr-session-expired", expired);
    return () => {
      clearInterval(interval);
      window.removeEventListener("omr-session-expired", expired);
    };
  }, [user?.id, offline, reconnect]);
  const value: Session = {
    phase,
    available,
    backend,
    offline,
    vaultEpoch,
    warning,
    tokenRequired,
    user,
    activeSchool,
    setSchool,
    login: (email, password) =>
      authenticate("/auth/login", { email, password }),
    setup: (data) => authenticate("/setup", data),
    logout: async () => {
      authEpoch.current++;
      lockVault();
      queryClient.clear();
      setUser(null);
      sessionStorage.removeItem("markly-offline");
      setPhase("login");
      if (user) {
        localStorage.setItem("omr-revoke-on-reconnect", "1");
        if (!offline) {
          try {
            await revokeDeferred();
          } catch {
            /* Local lock is already complete; reconnect will retry revocation. */
          }
        }
        if (localStorage.getItem("omr-revoke-on-reconnect") === "1")
          setWarning(
            "This device is locked. The server session will be revoked when a connection returns. Pending work remains encrypted.",
          );
      }
    },
    explore: () => {
      authEpoch.current++;
      lockVault();
      queryClient.clear();
      setUser(null);
      sessionStorage.setItem("markly-offline", "1");
      setPhase("local");
    },
    openLogin: () => {
      authEpoch.current++;
      lockVault();
      queryClient.clear();
      sessionStorage.removeItem("markly-offline");
      setPhase(needsSetup ? "setup" : "login");
    },
    reloadUser: reconnect,
    unlockOffline: async (email, passphrase) => {
      const epoch = ++authEpoch.current;
      const verified = !offline
        ? (await api<{ user: AuthUser }>("/auth/me")).user
        : undefined;
      if (
        verified &&
        verified.email.toLowerCase() !== email.trim().toLowerCase()
      )
        throw new Error(
          "Unlock only the currently signed-in account's vault. Sign out before switching accounts.",
        );
      if (epoch !== authEpoch.current) return;
      const u = await unlockVault(email, passphrase, verified);
      if (epoch !== authEpoch.current) {
        lockVault();
        return;
      }
      queryClient.clear();
      setUser(u);
      setSchool((s) =>
        u.memberships.some((m) => m.schoolId === s)
          ? s
          : u.memberships.find((m) => !!cachedSchool(m.schoolId))?.schoolId ||
            u.memberships[0]?.schoolId ||
            "",
      );
      setWarning("");
      setOffline(!verified);
      setBackend("fastapi");
      setVaultEpoch((n) => n + 1);
      sessionStorage.removeItem("markly-offline");
      setPhase("authenticated");
    },
    reconnect,
  };
  return (
    <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
  );
}
export function useSession() {
  const value = useContext(SessionContext);
  if (!value) throw new Error("Session provider is missing.");
  return value;
}
export type SaveStatus = "saved" | "saving" | "queued" | "error" | "conflict";
export function useWorkspaceStore() {
  const session = useSession(),
    cloud = session.phase === "authenticated",
    schoolId = session.activeSchool;
  const [workspace, setWorkspace] = useState<Workspace>(loadWorkspace),
    [ready, setReady] = useState(!cloud),
    [status, setStatus] = useState<SaveStatus>("saved"),
    [error, setError] = useState(""),
    [queuedWorkspace, setQueuedWorkspace] = useState<Workspace>();
  const serializedWorkspace = useMemo(
    () => JSON.stringify(workspace),
    [workspace],
  );
  const sync = useRef({
      revision: 0,
      lastSaved: "",
      pending: "",
      inflight: undefined as PendingOperation | undefined,
      busy: false,
      epoch: 0,
      failed: false,
    }),
    snapshotAt = useRef(0),
    timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const offlineNow = useRef(session.offline);
  offlineNow.current = session.offline;
  // Do not expose a one-render "saved"/"queued" window before passive effects
  // notice an edit. These labels authorize navigation/reload as well as the UI.
  const displayStatus: SaveStatus =
    cloud &&
    ready &&
    ((status === "saved" && serializedWorkspace !== sync.current.lastSaved) ||
      (status === "queued" && queuedWorkspace !== workspace))
      ? "saving"
      : status;
  const persistQueue = async (current: Workspace) => {
    const epoch = sync.current.epoch;
    if (!session.user || !vaultEnabled(session.user.id)) return false;
    await cacheSchool(schoolId, {
      workspace: current,
      revision: sync.current.revision,
      pending: sync.current.pending || undefined,
      inflight: sync.current.inflight,
    });
    if (epoch !== sync.current.epoch) return false;
    setQueuedWorkspace(current);
    return true;
  };
  const load = async (discard = false) => {
    const epoch = ++sync.current.epoch;
    setReady(false);
    setError("");
    try {
      const cached = cachedSchool(schoolId);
      let data: { workspace: Workspace; revision: number };
      if (session.offline) {
        if (!cached)
          throw new Error(
            "This school is not in your unlocked encrypted offline vault. Reconnect and enable offline access first.",
          );
        data = cached;
      } else data = await api(`/schools/${schoolId}/workspace`);
      if (epoch !== sync.current.epoch) return;
      const pendingCache =
        !discard && cached && (cached.pending || cached.inflight)
          ? cached
          : undefined;
      const w = enrichWorkspace(pendingCache?.workspace || data.workspace);
      sync.current = {
        revision: pendingCache?.revision || data.revision,
        lastSaved: pendingCache ? "" : JSON.stringify(w),
        pending: pendingCache?.pending || "",
        inflight: pendingCache?.inflight,
        busy: false,
        epoch,
        failed: false,
      };
      setWorkspace(w);
      setQueuedWorkspace(pendingCache || session.offline ? w : undefined);
      setStatus(pendingCache || session.offline ? "queued" : "saved");
      setReady(true);
      if (!pendingCache && session.user && vaultEnabled(session.user.id)) {
        await cacheSchool(schoolId, { workspace: w, revision: data.revision });
        if (epoch === sync.current.epoch) setQueuedWorkspace(w);
      }
    } catch (e) {
      if (epoch === sync.current.epoch) {
        setError(
          e instanceof Error ? e.message : "Could not load the workspace.",
        );
        setStatus("error");
      }
    }
  };
  useEffect(() => {
    if (cloud) void load();
    else {
      sync.current.epoch++;
      setWorkspace(loadWorkspace());
      setReady(true);
      setStatus("saved");
      setError("");
    }
    return () => {
      sync.current.epoch++;
      clearTimeout(timer.current);
    };
  }, [cloud, schoolId]);
  const flush = async () => {
    if (
      !cloud ||
      !ready ||
      sync.current.busy ||
      sync.current.failed ||
      offlineNow.current
    )
      return;
    const epoch = sync.current.epoch;
    sync.current.busy = true;
    setStatus("saving");
    try {
      while (
        (sync.current.pending || sync.current.inflight) &&
        epoch === sync.current.epoch &&
        !offlineNow.current
      ) {
        if (!sync.current.inflight) {
          const source = sync.current.pending;
          let payload = source;
          if (
            session.backend === "fastapi" &&
            JSON.parse(source).results.some((r: { scanIds?: string[] }) =>
              r.scanIds?.some((id) => id.startsWith("local-")),
            )
          ) {
            const { materializeOriginals } = await import("./scanArchive");
            const prepared = await materializeOriginals(JSON.parse(source));
            payload = JSON.stringify(prepared.workspace);
            if (epoch !== sync.current.epoch) return;
            setWorkspace((current) =>
              JSON.stringify(current) === source ? prepared.workspace : current,
            );
          }
          sync.current.inflight = {
            id: crypto.randomUUID(),
            payload,
            revision: sync.current.revision,
          };
          if (sync.current.pending === source) sync.current.pending = "";
        }
        const operation = sync.current.inflight;
        await persistQueue(
          JSON.parse(sync.current.pending || operation.payload),
        );
        if (epoch !== sync.current.epoch || offlineNow.current) return;
        const data = await api<{ revision: number }>(
          `/schools/${schoolId}/workspace`,
          {
            method: "PUT",
            body: JSON.stringify({
              workspace: JSON.parse(operation.payload),
              revision: operation.revision,
              operationId: operation.id,
            }),
          },
        );
        if (epoch !== sync.current.epoch) return;
        sync.current.revision = data.revision;
        sync.current.lastSaved = operation.payload;
        sync.current.inflight = undefined;
        if (sync.current.pending === operation.payload)
          sync.current.pending = "";
        await persistQueue(
          JSON.parse(sync.current.pending || operation.payload),
        );
      }
      if (epoch === sync.current.epoch) {
        setStatus(
          sync.current.pending || sync.current.inflight ? "queued" : "saved",
        );
        setError("");
        void queryClient.invalidateQueries({ queryKey: ["dashboard-metrics"] });
        void queryClient.invalidateQueries({ queryKey: ["result-history"] });
        void queryClient.invalidateQueries({ queryKey: ["audit"] });
      }
    } catch (e) {
      if (epoch !== sync.current.epoch) return;
      sync.current.failed = true;
      setStatus(
        e instanceof APIError && e.status === 409 ? "conflict" : "error",
      );
      setError(
        e instanceof Error ? e.message : "The workspace could not be saved.",
      );
    } finally {
      if (epoch === sync.current.epoch) sync.current.busy = false;
    }
  };
  useEffect(() => {
    if (!ready) return;
    const json = serializedWorkspace;
    if (cloud) {
      if (
        !session.offline &&
        json === sync.current.lastSaved &&
        !sync.current.inflight &&
        !sync.current.busy &&
        !sync.current.failed
      ) {
        const canceledPending = !!sync.current.pending;
        sync.current.pending = "";
        clearTimeout(timer.current);
        setStatus("saved");
        // An undo before submission must cancel the old debounce AND replace
        // any previously encrypted pending draft, not resurrect it on reload.
        if (canceledPending) {
          const epoch = sync.current.epoch;
          void persistQueue(workspace).catch((e) => {
            if (epoch !== sync.current.epoch) return;
            setStatus("error");
            setError(String(e));
          });
        }
        return;
      }
      if (json !== sync.current.inflight?.payload) sync.current.pending = json;
      clearTimeout(timer.current);
      if (session.offline) {
        if (!session.user || !vaultEnabled(session.user.id)) {
          setStatus("error");
          setError(
            "Offline changes are only in memory. Enable the encrypted vault before disconnecting, or export unsaved data now.",
          );
          return;
        }
        setStatus("saving");
        const epoch = sync.current.epoch;
        void persistQueue(workspace)
          .then((persisted) => {
            if (epoch !== sync.current.epoch) return;
            if (!persisted)
              throw new Error(
                "The offline vault locked before this change could be retained. Export unsaved work before leaving.",
              );
            setStatus("queued");
            setError("");
          })
          .catch((e) => {
            if (epoch !== sync.current.epoch) return;
            setStatus("error");
            setError(String(e));
          });
        return;
      }
      if (sync.current.failed) return;
      setStatus("saving");
      timer.current = setTimeout(() => {
        void flush();
      }, 400);
    } else {
      try {
        localStorage.setItem("markly-workspace-v1", json);
        setStatus("saved");
        setError("");
        if (Date.now() - snapshotAt.current > 5 * 60000) {
          snapshotAt.current = Date.now();
          void saveSnapshot(workspace).catch(() =>
            setError(
              "Device recovery points are unavailable. Download a backup to keep your work safe.",
            ),
          );
        }
      } catch {
        setStatus("error");
        setError("Device storage is full or disabled. Export a backup now.");
      }
    }
  }, [workspace, serializedWorkspace, cloud, ready, session.offline]);
  useEffect(() => {
    if (
      !session.offline &&
      ready &&
      (sync.current.pending || sync.current.inflight)
    ) {
      sync.current.failed = false;
      void flush();
    }
  }, [session.offline]);
  useEffect(() => {
    const unload = (e: BeforeUnloadEvent) => {
      if (
        (cloud && displayStatus !== "saved" && displayStatus !== "queued") ||
        displayStatus === "error"
      ) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", unload);
    return () => window.removeEventListener("beforeunload", unload);
  }, [cloud, displayStatus]);
  return {
    workspace,
    setWorkspace: setWorkspace as Dispatch<SetStateAction<Workspace>>,
    ready,
    status: displayStatus,
    error,
    cloud,
    revision: sync.current.revision,
    reload: () => load(true),
    retry: () => {
      if (!cloud) {
        setWorkspace((w) => ({ ...w }));
        return;
      }
      sync.current.failed = false;
      void flush();
    },
  };
}
