// @vitest-environment jsdom
import { QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import { blankWorkspace } from "./data";
import { queryClient } from "./query";
import SystemCenter from "./SystemCenter";

const { request, session } = vi.hoisted(() => ({
  request: vi.fn(),
  session: {
    phase: "authenticated",
    backend: "fastapi",
    offline: false,
    user: {
      id: "settings-admin",
      name: "Administrator",
      owner: false,
      memberships: [{ schoolId: "s", role: "admin" }],
    },
  },
}));
vi.mock("./session", () => ({ api: request, useSession: () => session }));

const original = {
  logo: "",
  academicSession: "Original session",
  contactEmail: "saved@school.example",
  contactPhone: "",
  notifications: true,
  defaultNegativeMarks: 0,
  defaultPassPercentage: 40,
  theme: "dark",
};
type Snapshot = { settings: typeof original; revision: number };
const key = ["institution-settings", "settings-admin", "s"];
let readSettings: () => Promise<Snapshot>,
  writeSettings: (body: Record<string, unknown>) => Promise<Snapshot>,
  writes: Record<string, unknown>[],
  toast: Mock<(message: string) => void>,
  reload: Mock<() => Promise<void>>;
const academicSession = () =>
  screen.getByLabelText("Academic session", {
    exact: true,
  }) as HTMLInputElement;
const saveButton = () =>
  screen.getByRole("button", {
    name: "Save institution defaults",
  });
function mount(revision = 4) {
  return render(
    <QueryClientProvider client={queryClient}>
      <SystemCenter
        workspace={blankWorkspace({ id: "s", name: "School", code: "S" })}
        revision={revision}
        reload={reload}
        status="saved"
        toast={toast}
      />
    </QueryClientProvider>,
  );
}
beforeEach(() => {
  queryClient.clear();
  queryClient.setDefaultOptions({
    queries: { retry: false, gcTime: 0, refetchOnWindowFocus: false },
    mutations: { retry: false },
  });
  localStorage.clear();
  request.mockReset();
  writes = [];
  toast = vi.fn<(message: string) => void>();
  reload = vi.fn(async () => {});
  readSettings = async () => ({ settings: { ...original }, revision: 4 });
  writeSettings = async (body) => ({
    settings: { ...original, ...body },
    revision: Number(body.revision) + 1,
  });
  request.mockImplementation((path: string, init?: RequestInit) => {
    if (path.endsWith("/settings")) {
      if (init?.method === "PUT") {
        const body = JSON.parse(init.body as string);
        writes.push(body);
        return writeSettings(body);
      }
      return readSettings();
    }
    if (path.endsWith("/sync/log")) return Promise.resolve({ operations: [] });
    throw new Error(`Unexpected settings QA request: ${path}`);
  });
});
afterEach(async () => {
  cleanup();
  await queryClient.cancelQueries();
  queryClient.clear();
  vi.restoreAllMocks();
});

describe("institution form loading and revision safety", () => {
  it("does not enable editing or submit placeholder defaults before the initial snapshot arrives", async () => {
    let release!: (snapshot: Snapshot) => void;
    readSettings = () => new Promise((resolve) => (release = resolve));
    mount();
    expect(academicSession().matches(":disabled")).toBe(true);
    expect(saveButton().matches(":disabled")).toBe(true);
    expect(writes).toEqual([]);
    await act(async () => release({ settings: original, revision: 4 }));
    await waitFor(() =>
      expect(academicSession().value).toBe("Original session"),
    );
    expect(academicSession().matches(":disabled")).toBe(false);
  });

  it("does not replace a dirty draft or advance its base revision when a background snapshot arrives", async () => {
    mount();
    await waitFor(() =>
      expect(academicSession().value).toBe("Original session"),
    );
    fireEvent.change(academicSession(), {
      target: { value: "My unsaved session" },
    });
    await act(async () => {
      queryClient.setQueryData(key, {
        settings: { ...original, academicSession: "Newer server session" },
        revision: 8,
      });
      // TanStack notifies observers on a queued task; flush that task before
      // asserting, rather than passing against the pre-refetch DOM by accident.
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(academicSession().value).toBe("My unsaved session");
    fireEvent.click(saveButton());
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0].revision).toBe(4);
    expect(writes[0].academicSession).toBe("My unsaved session");
  });

  it("submits the revision belonging to the loaded settings rather than an unrelated workspace prop", async () => {
    mount(2);
    await waitFor(() =>
      expect(academicSession().value).toBe("Original session"),
    );
    fireEvent.change(academicSession(), {
      target: { value: "Validated session" },
    });
    fireEvent.click(saveButton());
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0].revision).toBe(4);
  });

  it("keeps a rejected draft visible and shows the server conflict without claiming success", async () => {
    writeSettings = async () => {
      throw new Error(
        "Newer server revision; reload or reconcile your retained draft.",
      );
    };
    mount();
    await waitFor(() =>
      expect(academicSession().value).toBe("Original session"),
    );
    fireEvent.change(academicSession(), {
      target: { value: "Retain this draft" },
    });
    fireEvent.click(saveButton());
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain(
        "Newer server revision",
      ),
    );
    expect(academicSession().value).toBe("Retain this draft");
    expect(reload).not.toHaveBeenCalled();
    expect(toast).not.toHaveBeenCalledWith(
      "Institution settings saved with revision protection.",
    );
  });

  it("locks the draft during submission and caches the acknowledged snapshot before workspace reload", async () => {
    let release!: (snapshot: Snapshot) => void;
    writeSettings = () => new Promise((resolve) => (release = resolve));
    reload = vi.fn(async () => {
      expect(
        queryClient.getQueryData<Snapshot>(key)?.settings.academicSession,
      ).toBe("Acknowledged session");
    });
    mount();
    await waitFor(() =>
      expect(academicSession().value).toBe("Original session"),
    );
    fireEvent.change(academicSession(), {
      target: { value: "Acknowledged session" },
    });
    fireEvent.click(saveButton());
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(academicSession().matches(":disabled")).toBe(true);
    await act(async () =>
      release({
        settings: { ...original, academicSession: "Acknowledged session" },
        revision: 5,
      }),
    );
    await waitFor(() => expect(reload).toHaveBeenCalledOnce());
  });

  it("does not reload or repopulate a private query after the owning form unmounts during a save", async () => {
    let release!: (snapshot: Snapshot) => void;
    writeSettings = () => new Promise((resolve) => (release = resolve));
    const view = mount();
    await waitFor(() =>
      expect(academicSession().value).toBe("Original session"),
    );
    fireEvent.change(academicSession(), {
      target: { value: "Old account draft" },
    });
    fireEvent.click(saveButton());
    await waitFor(() => expect(writes).toHaveLength(1));
    view.unmount();
    queryClient.removeQueries({ queryKey: key });
    await act(async () =>
      release({
        settings: { ...original, academicSession: "Old account draft" },
        revision: 5,
      }),
    );
    expect(reload).not.toHaveBeenCalled();
    expect(toast).not.toHaveBeenCalled();
    expect(queryClient.getQueryData(key)).toBeUndefined();
  });

  it("requires explicit discard confirmation before replacing a draft with a newer server snapshot", async () => {
    mount();
    await waitFor(() =>
      expect(academicSession().value).toBe("Original session"),
    );
    fireEvent.change(academicSession(), {
      target: { value: "Keep unless confirmed" },
    });
    const confirmation = vi.spyOn(window, "confirm").mockReturnValue(false);
    readSettings = async () => ({
      settings: { ...original, academicSession: "Explicit server reload" },
      revision: 8,
    });
    const refresh = screen.getByRole("button", {
      name: "Reload institution defaults",
    });
    fireEvent.click(refresh);
    expect(confirmation).toHaveBeenCalledOnce();
    expect(academicSession().value).toBe("Keep unless confirmed");
    confirmation.mockReturnValue(true);
    fireEvent.click(refresh);
    await waitFor(() =>
      expect(academicSession().value).toBe("Explicit server reload"),
    );
    fireEvent.change(academicSession(), {
      target: { value: "Based on revision eight" },
    });
    fireEvent.click(saveButton());
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0].revision).toBe(8);
  });
});
