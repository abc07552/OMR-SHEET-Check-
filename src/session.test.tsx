// @vitest-environment jsdom
import { createElement, useLayoutEffect } from "react";
import type { ReactNode } from "react";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import { webcrypto } from "node:crypto";
import { File as NodeFile } from "node:buffer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { blankWorkspace } from "./data";
import {
  APIError,
  SessionProvider,
  apiDownload,
  useSession,
  useWorkspaceStore,
} from "./session";
import type { AuthUser } from "./session";
import * as offline from "./offline";
import * as native from "./native";
import {
  cachedSchool,
  enableVault,
  forgetVault,
  lockVault,
  saveOfflineImage,
  vaultEnabled,
} from "./offline";

const user: AuthUser = {
  id: "teacher",
  name: "Teacher",
  email: "teacher@school.edu",
  owner: false,
  memberships: [
    {
      schoolId: "s",
      name: "School",
      code: "S",
      role: "teacher",
      classIds: ["a", "b"],
      permissions: { scan: true, createExams: true, reports: true },
    },
  ],
};
const freshWorkspace = () =>
  blankWorkspace({ id: "s", name: "School", code: "S" }, "Teacher");
let serverUser: AuthUser,
  stored: ReturnType<typeof freshWorkspace>,
  revision: number,
  puts: { operationId: string; revision: number; workspace: typeof stored }[],
  methods: string[],
  loseAcknowledgment: boolean;
const receipts = new Map<string, number>();
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
const wrapper = ({ children }: { children: ReactNode }) =>
  createElement(SessionProvider, null, children);
const combined = () => ({ session: useSession(), store: useWorkspaceStore() });
beforeEach(() => {
  lockVault();
  localStorage.clear();
  sessionStorage.clear();
  receipts.clear();
  serverUser = structuredClone(user);
  stored = freshWorkspace();
  revision = 4;
  puts = [];
  methods = [];
  loseAcknowledgment = false;
  vi.stubGlobal("indexedDB", new IDBFactory());
  vi.stubGlobal("crypto", webcrypto);
  vi.stubGlobal("File", NodeFile);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input).replace(/^.*\/api/, ""),
        method = init?.method || "GET";
      methods.push(`${method} ${path}`);
      if (path === "/health")
        return json({ service: "markly-api", backend: "fastapi" });
      if (path === "/setup/status")
        return json({
          needsSetup: false,
          setupAllowed: false,
          tokenRequired: false,
        });
      if (path === "/auth/me" || path === "/auth/login")
        return json({ user: serverUser });
      if (path === "/auth/logout") return json({ ok: true });
      if (path === "/schools/s/workspace" && method === "GET")
        return json({ workspace: stored, revision });
      if (path === "/schools/s/workspace" && method === "PUT") {
        const data = JSON.parse(init!.body as string);
        puts.push(data);
        if (receipts.has(data.operationId))
          return json({
            revision: receipts.get(data.operationId),
            replayed: true,
          });
        if (data.revision !== revision)
          return json(
            { error: "Newer server revision; changes were not overwritten." },
            409,
          );
        stored = data.workspace;
        revision++;
        receipts.set(data.operationId, revision);
        if (loseAcknowledgment) {
          loseAcknowledgment = false;
          throw new TypeError("Connection lost after the server committed");
        }
        return json({ revision });
      }
      if (path.endsWith("/objects") && method === "POST")
        return json({ objectId: "server-original" }, 201);
      return json({ error: `Unexpected QA request: ${method} ${path}` }, 404);
    }),
  );
});
afterEach(async () => {
  cleanup();
  lockVault();
  // Captured encryption writes deliberately survive a lock in production.
  // Drain them against THIS fake database before the next test swaps factories.
  await forgetVault(user.email);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
describe("session and conflict-aware offline synchronization", () => {
  it("starts bundled Android at server onboarding, not a pretend account or an automatic private-data upload", async () => {
    vi.spyOn(native, "isBundledAndroid").mockReturnValue(true);
    const { result } = renderHook(useSession, { wrapper });
    await waitFor(() => expect(result.current.phase).toBe("connection"));
    expect(result.current.available).toBe(false);
    expect(result.current.user).toBeNull();
    expect(result.current.warning).toContain("not account-protected");
    expect(fetch).not.toHaveBeenCalled();
    act(() => result.current.explore());
    expect(result.current.phase).toBe("local");
    act(() => result.current.openLogin());
    expect(result.current.phase).toBe("connection");
    expect(fetch).not.toHaveBeenCalled();
  });
  it("locks private state on native server departure and ignores a late sign-in response", async () => {
    const { result } = renderHook(useSession, { wrapper });
    await waitFor(() => expect(result.current.phase).toBe("authenticated"));
    await act(async () => {
      await enableVault(
        user,
        "s",
        stored,
        revision,
        "independent-offline-passphrase",
      );
    });
    let finish!: (response: Response) => void;
    const original = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation((input, init) =>
      String(input).endsWith("/auth/login")
        ? new Promise((resolve) => {
            finish = resolve;
          })
        : original(input, init),
    );
    let login!: Promise<void>;
    act(() => {
      login = result.current.login(user.email, "a-valid-password");
    });
    await waitFor(() => expect(finish).toBeTypeOf("function"));
    act(() => window.dispatchEvent(new Event("omr-server-leaving")));
    expect(result.current.user).toBeNull();
    expect(result.current.phase).toBe("login");
    expect(vaultEnabled()).toBe(false);
    await act(async () => {
      finish(json({ user }));
      await login;
    });
    expect(result.current.user).toBeNull();
    expect(result.current.phase).toBe("login");
  });
  it("does not restore a private session from a bootstrap request that completes after native departure", async () => {
    let finish!: (response: Response) => void;
    const original = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation((input, init) =>
      String(input).endsWith("/auth/me")
        ? new Promise((resolve) => {
            finish = resolve;
          })
        : original(input, init),
    );
    const { result } = renderHook(useSession, { wrapper });
    await waitFor(() => expect(finish).toBeTypeOf("function"));
    act(() => window.dispatchEvent(new Event("omr-server-leaving")));
    await act(async () => finish(json({ user })));
    expect(result.current.phase).toBe("login");
    expect(result.current.user).toBeNull();
  });
  it("never renders a saved badge for a changed workspace before the server acknowledges it", async () => {
    const seen: { teacher: string; status: string }[] = [];
    const { result } = renderHook(
      () => {
        const value = combined();
        useLayoutEffect(() => {
          seen.push({
            teacher: value.store.workspace.teacher,
            status: value.store.status,
          });
        });
        return value;
      },
      { wrapper },
    );
    await waitFor(() =>
      expect(
        result.current.store.ready &&
          result.current.store.workspace.activeSchoolId === "s",
      ).toBe(true),
    );
    let release!: () => void;
    const original = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation((input, init) => {
      if (String(input).endsWith("/workspace") && init?.method === "PUT")
        return new Promise((resolve) => {
          release = () => {
            void original(input, init).then(resolve);
          };
        });
      return original(input, init);
    });
    act(() =>
      result.current.store.setWorkspace((w) => ({
        ...w,
        teacher: "Not acknowledged yet",
      })),
    );
    await waitFor(() => expect(release).toBeTypeOf("function"), {
      timeout: 3000,
    });
    expect(
      seen
        .filter((s) => s.teacher === "Not acknowledged yet")
        .some((s) => s.status === "saved"),
    ).toBe(false);
    await act(async () => release());
    await waitFor(() => expect(result.current.store.status).toBe("saved"));
    expect(stored.teacher).toBe("Not acknowledged yet");
  });
  it("cancels an unsubmitted debounced edit when the user restores the acknowledged workspace", async () => {
    const { result } = renderHook(combined, { wrapper });
    await waitFor(() =>
      expect(
        result.current.store.ready &&
          result.current.store.workspace.activeSchoolId === "s",
      ).toBe(true),
    );
    const baseline = result.current.store.workspace;
    act(() =>
      result.current.store.setWorkspace((w) => ({
        ...w,
        teacher: "A quickly undone draft",
      })),
    );
    act(() => result.current.store.setWorkspace(baseline));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 650));
    });
    expect(puts).toHaveLength(0);
    expect(stored.teacher).toBe(baseline.teacher);
    expect(result.current.store.status).toBe("saved");
  });
  it("persists an offline undo rather than retaining the superseded encrypted draft", async () => {
    const { result } = renderHook(combined, { wrapper });
    await waitFor(() =>
      expect(
        result.current.store.ready &&
          result.current.store.workspace.activeSchoolId === "s",
      ).toBe(true),
    );
    const baseline = result.current.store.workspace;
    await act(async () => {
      await enableVault(
        user,
        "s",
        baseline,
        revision,
        "independent-offline-passphrase",
      );
    });
    act(() => window.dispatchEvent(new Event("offline")));
    await waitFor(() => expect(result.current.session.offline).toBe(true));
    act(() =>
      result.current.store.setWorkspace((w) => ({
        ...w,
        teacher: "Superseded offline draft",
      })),
    );
    await waitFor(() => expect(result.current.store.status).toBe("queued"));
    expect(cachedSchool("s")?.workspace.teacher).toBe(
      "Superseded offline draft",
    );
    act(() => result.current.store.setWorkspace(baseline));
    await waitFor(() =>
      expect(cachedSchool("s")?.workspace.teacher).toBe(baseline.teacher),
    );
    // The in-memory projection changes before AES-GCM/IndexedDB commits.
    await waitFor(() => expect(result.current.store.status).toBe("queued"));
    expect(puts).toHaveLength(0);
  });
  it("does not render an offline edit as queued until its encrypted write finishes", async () => {
    const seen: { teacher: string; status: string }[] = [];
    const { result } = renderHook(
      () => {
        const value = combined();
        useLayoutEffect(() => {
          seen.push({
            teacher: value.store.workspace.teacher,
            status: value.store.status,
          });
        });
        return value;
      },
      { wrapper },
    );
    await waitFor(() =>
      expect(
        result.current.store.ready &&
          result.current.store.workspace.activeSchoolId === "s",
      ).toBe(true),
    );
    await act(async () => {
      await enableVault(
        user,
        "s",
        result.current.store.workspace,
        revision,
        "independent-offline-passphrase",
      );
    });
    act(() => window.dispatchEvent(new Event("offline")));
    await waitFor(() => expect(result.current.store.status).toBe("queued"));
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const originalCache = offline.cacheSchool;
    const write = vi
      .spyOn(offline, "cacheSchool")
      .mockImplementation(async (...args) => {
        await gate;
        await originalCache(...args);
      });
    act(() =>
      result.current.store.setWorkspace((w) => ({
        ...w,
        teacher: "Encryption still running",
      })),
    );
    await waitFor(() => expect(write).toHaveBeenCalled());
    expect(
      seen
        .filter((s) => s.teacher === "Encryption still running")
        .some((s) => s.status === "queued"),
    ).toBe(false);
    await act(async () => release());
    await waitFor(() => expect(result.current.store.status).toBe("queued"));
    expect(cachedSchool("s")?.workspace.teacher).toBe(
      "Encryption still running",
    );
  });
  it("keeps an undo made during original materialization after the started operation completes", async () => {
    const { result } = renderHook(combined, { wrapper });
    await waitFor(() =>
      expect(
        result.current.store.ready &&
          result.current.store.workspace.activeSchoolId === "s",
      ).toBe(true),
    );
    const baseline = result.current.store.workspace;
    await act(async () => {
      await enableVault(
        user,
        "s",
        baseline,
        revision,
        "independent-offline-passphrase",
      );
      await saveOfflineImage(
        "local-undone-page",
        new File(["retained pixels"], "sheet.png", { type: "image/png" }),
      );
    });
    let release!: (r: Response) => void;
    const original = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation((input, init) =>
      String(input).endsWith("/objects")
        ? new Promise((resolve) => {
            release = resolve;
          })
        : original(input, init),
    );
    act(() =>
      result.current.store.setWorkspace((w) => ({
        ...w,
        results: [
          {
            id: "undone-result",
            studentId: "learner",
            examId: w.exams[0].id,
            name: "Learner",
            roll: "1",
            section: "A",
            answers: Array(w.exams[0].questions).fill(null),
            flagged: [],
            confirmed: false,
            source: "scan",
            createdAt: "2026-11-17",
            scanIds: ["local-undone-page"],
          },
        ],
      })),
    );
    await waitFor(() => expect(release).toBeTypeOf("function"), {
      timeout: 3000,
    });
    act(() => result.current.store.setWorkspace(baseline));
    await act(async () => release(json({ objectId: "server-original" }, 201)));
    await waitFor(() => expect(result.current.store.status).toBe("saved"), {
      timeout: 3000,
    });
    expect(puts).toHaveLength(2);
    expect(puts[0].workspace.results[0].scanIds).toEqual(["server-original"]);
    expect(stored.results).toEqual([]);
    expect(result.current.store.workspace.results).toEqual([]);
  });
  it("clears private projections after changed assignments even when no encrypted vault exists", async () => {
    const { result } = renderHook(useSession, { wrapper });
    await waitFor(() => expect(result.current.phase).toBe("authenticated"));
    expect(vaultEnabled()).toBe(false);
    serverUser = {
      ...serverUser,
      memberships: serverUser.memberships.map((m) => ({
        ...m,
        classIds: ["a"],
      })),
    };
    await act(async () => {
      await result.current.reconnect();
    });
    expect(result.current.vaultEpoch).toBe(1);
    expect(result.current.user?.memberships[0].classIds).toEqual(["a"]);
    await act(async () => {
      await result.current.reconnect();
    });
    expect(result.current.vaultEpoch).toBe(1);
  });
  it("retries an ambiguous network acknowledgment with the exact same operation ID instead of duplicating a committed save", async () => {
    const { result } = renderHook(combined, { wrapper });
    await waitFor(() =>
      expect(
        result.current.store.ready &&
          result.current.session.phase === "authenticated",
      ).toBe(true),
    );
    await act(async () => {
      await enableVault(
        user,
        "s",
        result.current.store.workspace,
        revision,
        "independent-offline-passphrase",
      );
    });
    loseAcknowledgment = true;
    act(() =>
      result.current.store.setWorkspace((w) => ({
        ...w,
        teacher: "Saved once, not twice",
      })),
    );
    await waitFor(() => expect(result.current.store.status).toBe("error"), {
      timeout: 3000,
    });
    expect(puts).toHaveLength(1);
    const operation = puts[0].operationId;
    expect(cachedSchool("s")?.inflight?.id).toBe(operation);
    act(() => result.current.store.retry());
    await waitFor(() => expect(result.current.store.status).toBe("saved"));
    expect(puts).toHaveLength(2);
    expect(puts[1].operationId).toBe(operation);
    expect(revision).toBe(5);
    expect(cachedSchool("s")?.inflight).toBeUndefined();
    expect(stored.teacher).toBe("Saved once, not twice");
    expect(localStorage.getItem("markly-workspace-v1")).not.toContain(
      "Saved once, not twice",
    );
  });
  it("preserves both the pending payload and original CAS revision on a newer-server conflict", async () => {
    const { result } = renderHook(combined, { wrapper });
    await waitFor(() =>
      expect(
        result.current.store.ready &&
          result.current.session.phase === "authenticated",
      ).toBe(true),
    );
    await act(async () => {
      await enableVault(
        user,
        "s",
        result.current.store.workspace,
        revision,
        "independent-offline-passphrase",
      );
    });
    revision = 9;
    stored = { ...stored, teacher: "Other device's newer revision" };
    act(() =>
      result.current.store.setWorkspace((w) => ({
        ...w,
        teacher: "My deliberate offline change",
      })),
    );
    await waitFor(() => expect(result.current.store.status).toBe("conflict"), {
      timeout: 3000,
    });
    expect(stored.teacher).toBe("Other device's newer revision");
    expect(cachedSchool("s")?.inflight?.revision).toBe(4);
    expect(JSON.parse(cachedSchool("s")!.inflight!.payload).teacher).toBe(
      "My deliberate offline change",
    );
    expect(result.current.store.workspace.teacher).toBe(
      "My deliberate offline change",
    );
  });
  it("uploads a retained original with stable receipts before saving its result, without losing edits made during upload", async () => {
    const { result } = renderHook(combined, { wrapper });
    await waitFor(() =>
      expect(
        result.current.store.ready &&
          result.current.store.workspace.activeSchoolId === "s",
      ).toBe(true),
    );
    await act(async () => {
      await enableVault(
        user,
        "s",
        result.current.store.workspace,
        revision,
        "independent-offline-passphrase",
      );
      await saveOfflineImage(
        "local-offline-page",
        new File(["genuine bytes retained by browser capture"], "sheet.png", {
          type: "image/png",
        }),
      );
    });
    let release!: (r: Response) => void;
    const uploads: string[] = [];
    const original = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation((input, init) => {
      if (String(input).endsWith("/objects")) {
        uploads.push(String((init!.body as FormData).get("operationId")));
        if (uploads.length === 1)
          return new Promise((resolve) => {
            release = resolve;
          });
        return Promise.resolve(json({ objectId: "server-original" }, 201));
      }
      return original(input, init);
    });
    act(() =>
      result.current.store.setWorkspace((w) => ({
        ...w,
        results: [
          {
            id: "r",
            studentId: "student",
            examId: w.exams[0].id,
            name: "Learner",
            roll: "1",
            section: "A",
            answers: Array(w.exams[0].questions).fill(null),
            flagged: [],
            confirmed: false,
            source: "scan",
            createdAt: "2026-11-17",
            scanIds: ["local-offline-page"],
            sourceTransforms: [
              {
                objectId: "local-offline-page",
                pageIndex: 0,
                sourceToAligned: [
                  [1, 0, 0],
                  [0, 1, 0],
                  [0, 0, 1],
                ],
              },
            ],
          },
        ],
      })),
    );
    await waitFor(() => expect(release).toBeTypeOf("function"), {
      timeout: 3000,
    });
    act(() =>
      result.current.store.setWorkspace((w) => ({
        ...w,
        teacher: "An edit during the original upload",
      })),
    );
    await act(async () => {
      release(json({ objectId: "server-original" }, 201));
    });
    await waitFor(() => expect(result.current.store.status).toBe("saved"), {
      timeout: 3000,
    });
    expect(stored.teacher).toBe("An edit during the original upload");
    expect(stored.results[0].scanIds).toEqual(["server-original"]);
    expect(stored.results[0].sourceTransforms?.[0].objectId).toBe(
      "server-original",
    );
    expect(uploads.every((id) => id === "upload-local-offline-page")).toBe(
      true,
    );
    expect(
      puts.every(
        (p) => p.workspace.results[0].scanIds?.[0] === "server-original",
      ),
    ).toBe(true);
  });
  it("locks immediately on offline sign-out and revokes the prior cookie before an online login can proceed", async () => {
    const { result } = renderHook(useSession, { wrapper });
    await waitFor(() => expect(result.current.phase).toBe("authenticated"));
    await enableVault(
      user,
      "s",
      stored,
      revision,
      "independent-offline-passphrase",
    );
    act(() => window.dispatchEvent(new Event("offline")));
    await act(async () => {
      await result.current.logout();
    });
    expect(result.current.user).toBeNull();
    expect(vaultEnabled()).toBe(false);
    expect(localStorage.getItem("omr-revoke-on-reconnect")).toBe("1");
    expect(methods).not.toContain("POST /auth/logout");
    await act(async () => {
      await result.current.login(
        user.email,
        "account-password-is-not-the-offline-passphrase",
      );
    });
    const logout = methods.indexOf("POST /auth/logout"),
      login = methods.indexOf("POST /auth/login");
    expect(logout).toBeGreaterThan(-1);
    expect(login).toBeGreaterThan(logout);
    expect(localStorage.getItem("omr-revoke-on-reconnect")).toBeNull();
  });
  it("does not accept an in-flight account revalidation after sign-out", async () => {
    const { result } = renderHook(useSession, { wrapper });
    await waitFor(() => expect(result.current.phase).toBe("authenticated"));
    let release!: (r: Response) => void;
    const original = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation((input, init) =>
      String(input).endsWith("/auth/me")
        ? new Promise((resolve) => {
            release = resolve;
          })
        : original(input, init),
    );
    let reconnect!: Promise<void>;
    act(() => {
      reconnect = result.current.reconnect();
    });
    await waitFor(() => expect(release).toBeTypeOf("function"));
    await act(async () => {
      await result.current.logout();
      release(json({ user }));
      await reconnect;
    });
    expect(result.current.phase).toBe("login");
    expect(result.current.user).toBeNull();
  });
  it("locks a private view when a report download discovers a revoked session", async () => {
    const { result } = renderHook(useSession, { wrapper });
    await waitFor(() => expect(result.current.phase).toBe("authenticated"));
    vi.mocked(fetch).mockResolvedValueOnce(
      json({ error: "Session revoked" }, 401),
    );
    await act(async () => {
      await expect(
        apiDownload("/private-report", "report.pdf"),
      ).rejects.toBeInstanceOf(APIError);
    });
    expect(result.current.phase).toBe("login");
    expect(result.current.user).toBeNull();
  });
});

it("does not strand an expired/revoked logout cookie in an endless offline login loop", async () => {
  const { result } = renderHook(useSession, { wrapper });
  await waitFor(() => expect(result.current.phase).toBe("authenticated"));
  const original = vi.mocked(fetch).getMockImplementation()!;
  vi.mocked(fetch).mockImplementation(async (input, init) =>
    String(input).endsWith("/auth/logout")
      ? json({ error: "Already revoked" }, 401)
      : original(input, init),
  );
  await act(async () => {
    await result.current.logout();
  });
  expect(result.current.phase).toBe("login");
  expect(localStorage.getItem("omr-revoke-on-reconnect")).toBeNull();
  await act(async () => {
    await result.current.login(user.email, "correct-login-password");
  });
  expect(result.current.phase).toBe("authenticated");
  expect(result.current.offline).toBe(false);
});
