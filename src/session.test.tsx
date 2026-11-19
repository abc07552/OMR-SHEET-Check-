// @vitest-environment jsdom
import { createElement } from "react";
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
import {
  cachedSchool,
  enableVault,
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
afterEach(() => {
  cleanup();
  lockVault();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
describe("session and conflict-aware offline synchronization", () => {
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
