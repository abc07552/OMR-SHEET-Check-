import { createContext, useContext, useEffect, useRef, useState } from "react";
import type { ReactNode, Dispatch, SetStateAction } from "react";
import type { Workspace } from "./data";
import { enrichWorkspace, loadWorkspace } from "./data";
import { saveSnapshot } from "./storage";
export interface Membership {
  schoolId: string;
  name: string;
  code: string;
  role: "admin" | "teacher";
}
export interface AuthUser {
  id: string;
  name: string;
  email: string;
  owner: boolean;
  memberships: Membership[];
}
const configured = import.meta.env.VITE_API_BASE?.replace(/\/$/, "");
export const API_BASE = configured || "/api";
export class APIError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}
export async function api<T = any>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      "X-Markly-Request": "1",
      ...options.headers,
    },
  });
  const data = await response.json().catch(() => ({
    error:
      "The backend did not return a valid response. Check the server connection.",
  }));
  if (!response.ok)
    throw new APIError(data.error || "The request failed.", response.status);
  return data;
}
interface Session {
  phase: "checking" | "login" | "setup" | "local" | "authenticated";
  available: boolean;
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
}
const SessionContext = createContext<Session | null>(null);
export function SessionProvider({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<Session["phase"]>("checking"),
    [available, setAvailable] = useState(false),
    [tokenRequired, setTokenRequired] = useState(false),
    [needsSetup, setNeedsSetup] = useState(false),
    [user, setUser] = useState<AuthUser | null>(null),
    [activeSchool, setSchool] = useState("");
  useEffect(() => {
    let alive = true;
    const controller = new AbortController(),
      timeout = setTimeout(() => controller.abort(), 3500);
    void (async () => {
      try {
        if (!configured && location.hostname.endsWith("github.io"))
          throw new Error("Static hosting");
        const health = await api<{ service: string }>("/health", {
          signal: controller.signal,
        });
        if (health.service !== "markly-api") throw new Error("No API");
        if (!alive) return;
        setAvailable(true);
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
        } catch {
          if (alive) setPhase("login");
        }
      } catch {
        if (alive) setPhase("local");
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
  const adopt = (u: AuthUser) => {
    setUser(u);
    setSchool(u.memberships[0]?.schoolId || "");
    sessionStorage.removeItem("markly-offline");
    setPhase("authenticated");
  };
  const value: Session = {
    phase,
    available,
    tokenRequired,
    user,
    activeSchool,
    setSchool,
    login: async (email, password) => {
      adopt(
        (
          await api<{ user: AuthUser }>("/auth/login", {
            method: "POST",
            body: JSON.stringify({ email, password }),
          })
        ).user,
      );
    },
    setup: async (data) => {
      adopt(
        (
          await api<{ user: AuthUser }>("/setup", {
            method: "POST",
            body: JSON.stringify(data),
          })
        ).user,
      );
    },
    logout: async () => {
      if (user) await api("/auth/logout", { method: "POST" });
      setUser(null);
      sessionStorage.removeItem("markly-offline");
      setPhase("login");
    },
    explore: () => {
      setUser(null);
      sessionStorage.setItem("markly-offline", "1");
      setPhase("local");
    },
    openLogin: () => {
      sessionStorage.removeItem("markly-offline");
      setPhase(needsSetup ? "setup" : "login");
    },
    reloadUser: async () => {
      const data = await api<{ user: AuthUser }>("/auth/me");
      setUser(data.user);
    },
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
export function useWorkspaceStore() {
  const session = useSession(),
    cloud = session.phase === "authenticated",
    schoolId = session.activeSchool;
  const [workspace, setWorkspace] = useState<Workspace>(loadWorkspace),
    [ready, setReady] = useState(!cloud),
    [status, setStatus] = useState<"saved" | "saving" | "error" | "conflict">(
      "saved",
    ),
    [error, setError] = useState("");
  const sync = useRef({
      revision: 0,
      lastSaved: "",
      pending: "",
      busy: false,
      epoch: 0,
      failed: false,
    }),
    snapshotAt = useRef(0),
    timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const load = async () => {
    const epoch = ++sync.current.epoch;
    setReady(false);
    setError("");
    try {
      const data = await api<{ workspace: Workspace; revision: number }>(
        `/schools/${schoolId}/workspace`,
      );
      if (epoch !== sync.current.epoch) return;
      const w = enrichWorkspace(data.workspace);
      sync.current = {
        revision: data.revision,
        lastSaved: JSON.stringify(w),
        pending: "",
        busy: false,
        epoch,
        failed: false,
      };
      setWorkspace(w);
      setStatus("saved");
      setReady(true);
    } catch (e) {
      if (epoch === sync.current.epoch) {
        setError(e instanceof Error ? e.message : "Could not load workspace.");
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
      clearTimeout(timer.current);
    };
  }, [cloud, schoolId]);
  const flush = async () => {
    if (!cloud || !ready || sync.current.busy || sync.current.failed) return;
    const epoch = sync.current.epoch;
    sync.current.busy = true;
    setStatus("saving");
    try {
      while (sync.current.pending && epoch === sync.current.epoch) {
        const payload = sync.current.pending;
        sync.current.pending = "";
        try {
          const data = await api<{ revision: number }>(
            `/schools/${schoolId}/workspace`,
            {
              method: "PUT",
              body: JSON.stringify({
                workspace: JSON.parse(payload),
                revision: sync.current.revision,
              }),
            },
          );
          if (epoch !== sync.current.epoch) return;
          sync.current.revision = data.revision;
          sync.current.lastSaved = payload;
        } catch (e) {
          if (epoch !== sync.current.epoch) return;
          if (!sync.current.pending) sync.current.pending = payload;
          throw e;
        }
      }
      if (epoch === sync.current.epoch) {
        setStatus("saved");
        setError("");
      }
    } catch (e) {
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
    const json = JSON.stringify(workspace);
    if (cloud) {
      if (json === sync.current.lastSaved) return;
      sync.current.pending = json;
      if (sync.current.failed) return;
      setStatus("saving");
      clearTimeout(timer.current);
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
          void saveSnapshot(workspace).catch(() => {
            setError(
              "Device recovery points are unavailable. Download a backup to keep your work safe.",
            );
          });
        }
      } catch {
        setStatus("error");
        setError("Device storage is full or disabled. Export a backup now.");
      }
    }
  }, [workspace, cloud, ready]);
  useEffect(() => {
    const unload = (e: BeforeUnloadEvent) => {
      if ((cloud && status !== "saved") || status === "error") {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", unload);
    return () => window.removeEventListener("beforeunload", unload);
  }, [cloud, status]);
  return {
    workspace,
    setWorkspace: setWorkspace as Dispatch<SetStateAction<Workspace>>,
    ready,
    status,
    error,
    cloud,
    reload: load,
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
