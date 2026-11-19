import {
  test,
  expect,
  type Page,
  type APIRequestContext,
} from "@playwright/test";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";

const header = { "X-Markly-Request": "1" };
async function api(
  request: APIRequestContext,
  url: string,
  method = "GET",
  data?: unknown,
) {
  const response = await request.fetch(`/api${url}`, {
    method,
    headers: header,
    ...(data ? { data } : {}),
  });
  expect(response.ok(), `${method} ${url}: ${await response.text()}`).toBe(
    true,
  );
  return response.json();
}
async function saved(page: Page) {
  await expect(page.locator(".v2-storage-pill.saved")).toBeVisible();
}
async function navigate(page: Page, route: string) {
  await page.goto(`/#/${route}`);
  await expect(page.locator(".initial-loader")).toHaveCount(0);
}
async function login(page: Page, email: string, password: string) {
  await page.goto("/");
  await page.getByLabel("Email address", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page
    .getByRole("button", { name: "Sign in to your workspace", exact: true })
    .click();
}

test("genuine enterprise workflows, restricted portals, reports and encrypted offline queue", async ({
  page,
  context,
  browser,
}, info) => {
  const errors: string[] = [],
    consoleErrors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text());
  });
  const email = `qa-admin-${randomUUID()}@school.example`,
    password = `QA-${randomUUID()}-${randomUUID()}`,
    phrase = `offline-${randomUUID()}`;
  const teacherEmail = `qa-teacher-${randomUUID()}@school.example`,
    studentEmail = `qa-student-${randomUUID()}@school.example`;
  let school = "",
    examId = "",
    studentResultId = "";
  let primaryExam: Record<string, unknown>;
  let offlineTemplate: Buffer;
  const state = () => api(page.request, `/schools/${school}/workspace`);

  await test.step("fresh first-run setup and real database-backed fixture", async () => {
    expect(
      (await api(page.request, "/setup/status")).needsSetup,
      "Use a FRESH disposable database; this suite never resets an existing institution.",
    ).toBe(true);
    await page.goto("/");
    await page
      .getByLabel("Your name", { exact: true })
      .fill("QA Administrator");
    await page
      .getByLabel("School or institution", { exact: true })
      .fill("Optical QA Academy");
    await page.getByLabel("Email address", { exact: true }).fill(email);
    await page.getByLabel("Create a password", { exact: true }).fill(password);
    await page
      .getByRole("button", { name: "Create secure workspace", exact: true })
      .click();
    await saved(page);
    school = (await api(page.request, "/auth/me")).user.memberships[0].schoolId;
    const body = await state(),
      w = body.workspace;
    w.classes = [
      {
        id: "class-a",
        schoolId: school,
        name: "10 A",
        academicYear: "2026–27",
      },
      {
        id: "class-b",
        schoolId: school,
        name: "10 B",
        academicYear: "2026–27",
      },
    ];
    w.students = [
      {
        id: "qa-learner",
        schoolId: school,
        classId: "class-a",
        name: "Optical Learner",
        roll: "10001",
        section: "10 A",
        registeredAt: "2026-11-17T10:00:00Z",
      },
      {
        id: "other-learner",
        schoolId: school,
        classId: "class-b",
        name: "Private Other Learner",
        roll: "10002",
        section: "10 B",
        registeredAt: "2026-11-17T10:00:00Z",
      },
    ];
    primaryExam = {
      ...w.exams[0],
      id: "qa-exam-a",
      title: "Optical QA assessment",
      subject: "Science",
      date: "2026-11-17",
      questions: 5,
      optionCount: 5,
      answers: ["A", "B", "C", "D", "E"],
      classIds: ["class-a"],
      marksCorrect: 2,
      negativeMarks: 0.5,
      passPercentage: 40,
      published: true,
      resultsPublished: false,
    };
    examId = primaryExam.id as string;
    w.exams = [
      primaryExam,
      {
        ...primaryExam,
        id: "qa-exam-b",
        title: "Restricted class B",
        classIds: ["class-b"],
        resultsPublished: true,
      },
    ];
    w.results = [
      {
        id: "private-other-result",
        studentId: "other-learner",
        examId: "qa-exam-b",
        name: "Private Other Learner",
        roll: "10002",
        section: "10 B",
        answers: ["A", "B", "C", "D", "E"],
        flagged: [],
        confirmed: false,
        source: "scan",
        createdAt: "2026-11-17T10:00:00Z",
      },
    ];
    await api(page.request, `/schools/${school}/workspace`, "PUT", {
      ...body,
      operationId: randomUUID(),
    });
    await page.reload();
    await saved(page);
    await page.getByLabel("Current assessment").selectOption(examId);
    expect(
      (await api(page.request, `/schools/${school}/dashboard`)).metrics
        .students,
    ).toBe(2);
  });

  await test.step("column mapping, validation, invalid-row download and explicit transactional confirmation", async () => {
    await navigate(page, "students");
    await page.getByLabel("Import students", { exact: true }).setInputFiles({
      name: "mapped-qa.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(
        "Display,Admission,Cohort\r\nImported Learner,10003,10 A\r\nDuplicate Learner,10001,10 A\r\nInvalid Learner,,10 A\r\n",
      ),
    });
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Map Student name").selectOption("Display");
    await dialog
      .getByLabel("Map Roll / registration")
      .selectOption("Admission");
    await dialog.getByLabel("Map Class / section").selectOption("Cohort");
    await dialog
      .getByRole("button", { name: "Validate & preview rows", exact: true })
      .click();
    await expect(
      dialog.getByText("1 valid rows", { exact: true }),
    ).toBeVisible();
    await expect(
      dialog.getByText("2 invalid / duplicate rows skipped", { exact: true }),
    ).toBeVisible();
    expect((await state()).workspace.students).toHaveLength(2);
    const confirm = dialog.getByRole("button", {
      name: "Confirm student import",
      exact: true,
    });
    await expect(confirm).toBeDisabled();
    const invalidDownload = page.waitForEvent("download");
    await dialog.getByRole("button", { name: /Download all invalid/ }).click();
    const invalid = await invalidDownload;
    const text = await readFile((await invalid.path())!, "utf8");
    expect(text).toContain("10001");
    expect(text).toContain("Row");
    await dialog.getByRole("checkbox").check();
    await confirm.click();
    await expect(dialog).toHaveCount(0);
    await saved(page);
    expect((await state()).workspace.students).toHaveLength(3);
    await expect(
      page.getByRole("button", { name: "Edit Imported Learner", exact: true }),
    ).toBeVisible();
  });

  await test.step("administrator creates assigned teacher and linked student accounts through the UI", async () => {
    await navigate(page, "administration");
    for (const member of [
      { name: "Assigned QA Teacher", email: teacherEmail, role: "teacher" },
      { name: "QA Student Account", email: studentEmail, role: "student" },
    ]) {
      await page
        .getByRole("button", { name: "Add team member", exact: true })
        .click();
      const dialog = page.getByRole("dialog");
      await dialog.getByLabel("Full name", { exact: true }).fill(member.name);
      await dialog
        .getByLabel("Email address", { exact: true })
        .fill(member.email);
      await dialog
        .getByLabel("Initial password", { exact: true })
        .fill(password);
      await dialog
        .getByRole("combobox", { name: "Access role", exact: true })
        .selectOption(member.role);
      if (member.role === "teacher")
        await dialog.getByLabel("10 A", { exact: true }).check();
      else
        await dialog
          .getByRole("combobox", { name: /Linked student registration/ })
          .selectOption("qa-learner");
      await dialog
        .getByRole("button", { name: "Add member", exact: true })
        .click();
      await expect(dialog).toHaveCount(0);
      await expect(page.getByText(member.name, { exact: true })).toBeVisible();
    }
  });

  await test.step("native OpenCV batch detects real ink, requires identity verification and retains original evidence", async () => {
    const imagePath = info.outputPath("genuine-ink.png");
    execFileSync(
      process.env.OMR_TEST_PYTHON || path.resolve(".venv/bin/python"),
      [
        "-c",
        'import json,sys;from pathlib import Path;from backend.tests.test_omr import png,sheet_image;e=json.loads(sys.stdin.read());Path(sys.argv[1]).write_bytes(png(sheet_image(e,[["A","B"],["B"],["C"],["D"],["E"]])))',
        imagePath,
      ],
      { input: JSON.stringify(primaryExam) },
    );
    await navigate(page, "batches");
    await page.getByLabel("Current assessment").selectOption(examId);
    await page.getByLabel("New batch name").fill("Genuine ink QA");
    await page
      .getByRole("button", { name: "Create durable batch", exact: true })
      .click();
    await page
      .getByLabel("Upload durable batch pages")
      .setInputFiles(imagePath);
    await page
      .getByRole("button", { name: "Match & verify", exact: true })
      .click({ timeout: 45_000 });
    const dialog = page.getByRole("dialog");
    await expect(
      dialog.getByRole("img", { name: "Measured OpenCV bubble overlay" }),
    ).toBeVisible();
    const apply = dialog.getByRole("button", {
      name: "Apply verified page",
      exact: true,
    });
    await expect(apply).toBeDisabled();
    await dialog.getByLabel("Matched batch student").selectOption("qa-learner");
    await dialog.getByLabel(/I verified/).check();
    await apply.click();
    await expect(dialog).toHaveCount(0);
    await saved(page);
    await expect(page.getByLabel("Current assessment")).toHaveValue(examId);
    const result = (await state()).workspace.results.find(
      (r: { studentId: string }) => r.studentId === "qa-learner",
    );
    studentResultId = result.id;
    expect(result.answers[0]).toBeNull();
    expect(result.detectedOptions[0]).toEqual(["A", "B"]);
    expect(result.flagged).toContain(0);
    expect(result.answerMeta[0].verified).toBe(false);
    expect(result.scanIds).toHaveLength(1);
    const history = await api(
      page.request,
      `/schools/${school}/results/${studentResultId}/history`,
    );
    expect(history.evaluations[0].outcome.needsReview).toBe(true);
    const original = await page.request.get(
      `/api/schools/${school}/objects/${result.scanIds[0]}`,
    );
    expect(original.headers()["cache-control"]).toContain("no-store");
    expect(await original.body()).toEqual(await readFile(imagePath));
  });

  await test.step("measured original overlay and explicit human correction update the actual graded response", async () => {
    await navigate(page, "students");
    await page
      .getByRole("button", { name: "Assessment results", exact: true })
      .click();
    await page
      .getByRole("button", {
        name: "View Optical Learner's result",
        exact: true,
      })
      .click();
    const dialog = page.getByRole("dialog");
    await expect(
      dialog.getByLabel(
        "Original answer sheet with optional measured bubble coordinates",
      ),
    ).toBeVisible();
    await dialog.getByRole("button", { name: /Question 1,/ }).click();
    await dialog
      .getByRole("button", {
        name: "Set question 1 response to A",
        exact: true,
      })
      .click();
    await dialog
      .getByRole("button", { name: "Save responses", exact: true })
      .click();
    await expect(dialog).toHaveCount(0);
    await saved(page);
    const history = await api(
      page.request,
      `/schools/${school}/results/${studentResultId}/history`,
    );
    expect(history.evaluations[0].outcome).toMatchObject({
      correct: 5,
      score: 10,
      needsReview: false,
    });
    expect(history.evaluations.length).toBeGreaterThan(1);
  });

  await test.step("real exports and institution defaults are usable from the browser", async () => {
    await navigate(page, "reports");
    for (const format of ["PDF", "XLSX", "CSV"]) {
      const pending = page.waitForEvent("download");
      await page
        .getByRole("button", {
          name: `Evaluated result sheet ${format}`,
          exact: true,
        })
        .click();
      const file = await pending,
        buffer = await readFile((await file.path())!);
      expect(buffer.length).toBeGreaterThan(40);
      if (format === "PDF")
        expect(buffer.subarray(0, 4).toString()).toBe("%PDF");
      if (format === "XLSX")
        expect(buffer.subarray(0, 2).toString()).toBe("PK");
      if (format === "CSV")
        expect(buffer.toString()).toContain("Optical Learner");
    }
    const templateDownload = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "Blank OMR PDF", exact: true })
      .click();
    offlineTemplate = await readFile((await (await templateDownload).path())!);
    expect(offlineTemplate.subarray(0, 4).toString()).toBe("%PDF");
    await navigate(page, "system");
    await page
      .getByLabel("Academic session", { exact: true })
      .fill("2026–27 QA");
    await page
      .getByLabel("Contact email", { exact: true })
      .fill("contact@qa.example");
    await page
      .getByRole("button", { name: "Save institution defaults", exact: true })
      .click();
    await expect
      .poll(
        async () =>
          (await api(page.request, `/schools/${school}/settings`)).settings
            .academicSession,
      )
      .toBe("2026–27 QA");
    await saved(page);
  });

  await test.step("browser OpenCV reads exposure variants and a sharp QR cannot certify a missing bubble grid", async () => {
    const directory = info.outputPath("optical-conditions");
    execFileSync(
      process.env.OMR_TEST_PYTHON || path.resolve(".venv/bin/python"),
      [
        "-c",
        `import json,sys
from pathlib import Path
from backend.tests.test_omr import png,sheet_image
from backend.tests.test_omr_conditions import exposure
exam=json.loads(sys.stdin.read())
root=Path(sys.argv[1]); root.mkdir(parents=True,exist_ok=True)
image=sheet_image(exam,[[option] for option in "ABCDE"])
for condition in ("dark","overexposed","shadow","faded-print"):
    (root / (condition + ".png")).write_bytes(png(exposure(image,condition)))
image[380:1500,100:1150]=255
(root / "sharp-qr-missing-grid.png").write_bytes(png(image))`,
        directory,
      ],
      { input: JSON.stringify(primaryExam) },
    );
    await navigate(page, "scanner");
    await page.getByLabel("Current assessment").selectOption(examId);
    await page
      .getByRole("combobox", { name: "Detection engine", exact: true })
      .selectOption("opencv");
    await page
      .getByLabel("Read roll numbers with OCR", { exact: true })
      .uncheck();
    await page
      .getByLabel("Replace a previously scanned page", { exact: true })
      .check();
    await expect(page.locator(".scan-tip")).toContainText(
      "encrypted and retained",
    );
    for (const condition of ["dark", "overexposed", "shadow", "faded-print"]) {
      await page
        .getByLabel("Upload OMR sheets or PDF", { exact: true })
        .setInputFiles(path.join(directory, `${condition}.png`));
      await page
        .getByLabel(`Roll number for ${condition}.png`, { exact: true })
        .fill("10001");
      await page
        .getByRole("button", { name: "Scan 1 page", exact: true })
        .click();
      await expect(page.locator(".scan-queue-item.done")).toHaveCount(1, {
        timeout: 90_000,
      });
      await saved(page);
      const result = (await state()).workspace.results.find(
        (r: { id: string }) => r.id === studentResultId,
      );
      expect(result.engine).toBe("opencv");
      expect(result.answers).toEqual(["A", "B", "C", "D", "E"]);
      expect(
        result.answerMeta.every((row: { verified: boolean }) => !row.verified),
      ).toBe(true);
      await page
        .getByRole("button", { name: "Clear queue", exact: true })
        .click();
    }
    const before = await state();
    await page
      .getByLabel("Upload OMR sheets or PDF", { exact: true })
      .setInputFiles(path.join(directory, "sharp-qr-missing-grid.png"));
    await page
      .getByLabel("Roll number for sharp-qr-missing-grid.png", { exact: true })
      .fill("10001");
    await page
      .getByRole("button", { name: "Scan 1 page", exact: true })
      .click();
    await expect(page.locator(".scan-queue-item.error")).toContainText(
      /printed bubble grid.*blurred/,
    );
    const after = await state();
    expect(after.revision).toBe(before.revision);
    expect(after.workspace.results).toEqual(before.workspace.results);
    await page
      .getByRole("button", { name: "Clear queue", exact: true })
      .click();
  });

  await test.step("teacher assignments and student publication/privacy are enforced by real APIs and screens", async () => {
    const teacher = await browser.newContext({
      baseURL: test.info().project.use.baseURL,
    });
    const tp = await teacher.newPage();
    await login(tp, teacherEmail, password);
    await saved(tp);
    const projection = await api(tp.request, `/schools/${school}/workspace`);
    expect(
      projection.workspace.students.map((s: { name: string }) => s.name),
    ).not.toContain("Private Other Learner");
    expect(projection.workspace.exams).toHaveLength(1);
    expect(
      (
        await tp.request.get(`/api/schools/${school}/students/other-learner`)
      ).status(),
    ).toBe(403);
    await navigate(tp, "students");
    await expect(
      tp.getByText("Private Other Learner", { exact: true }),
    ).toHaveCount(0);
    await teacher.close();
    const student = await browser.newContext({
      baseURL: test.info().project.use.baseURL,
    });
    const sp = await student.newPage();
    await login(sp, studentEmail, password);
    await expect(
      sp.getByRole("button", { name: "My results", exact: true }),
    ).toBeVisible();
    expect(
      (await api(sp.request, `/schools/${school}/portal`)).results,
    ).toHaveLength(0);
    expect(
      (await sp.request.get(`/api/schools/${school}/workspace`)).status(),
    ).toBe(403);
    await navigate(page, "evaluation");
    await page.getByLabel("Current assessment").selectOption(examId);
    await page
      .getByLabel("Publish evaluated results to linked student accounts")
      .check();
    await page
      .getByRole("button", { name: "Save evaluation policy", exact: true })
      .click();
    await saved(page);
    await sp.getByLabel("Refresh my results").click();
    await expect
      .poll(
        async () =>
          (await api(sp.request, `/schools/${school}/portal`)).results.length,
      )
      .toBe(1);
    await expect(
      sp.getByText("Private Other Learner", { exact: true }),
    ).toHaveCount(0);
    expect(
      (
        await sp.request.get(
          `/api/schools/${school}/reports/student?examId=qa-exam-b&resultId=private-other-result&format=pdf`,
        )
      ).status(),
    ).toBe(403);
    await expect(
      sp.getByText("Optical QA assessment", { exact: true }),
    ).toBeVisible();
    const cardTops = await sp
      .locator(".portal-stat-grid > section")
      .evaluateAll((nodes) =>
        nodes.map((n) => Math.round(n.getBoundingClientRect().top)),
      );
    expect(new Set(cardTops).size).toBe(1);
    await sp.screenshot({
      path: info.outputPath("private-student-portal.png"),
      fullPage: true,
    });
    await student.close();
  });

  await test.step("static cache excludes private HTTP responses; encrypted offline changes survive reload and synchronize", async () => {
    await navigate(page, "system");
    await page
      .getByLabel("Separate offline passphrase", { exact: true })
      .fill(phrase);
    await page
      .getByLabel("Confirm offline passphrase", { exact: true })
      .fill(phrase);
    await page
      .getByRole("button", {
        name: "Enable encrypted offline work",
        exact: true,
      })
      .click();
    await expect(
      page.getByRole("button", {
        name: "Refresh authorized offline copy",
        exact: true,
      }),
    ).toBeVisible();
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });
    await expect
      .poll(() => page.evaluate(() => !!navigator.serviceWorker.controller))
      .toBe(true);
    const cached = await page.evaluate(async () =>
      (
        await Promise.all(
          (await caches.keys()).map(async (key) =>
            (await (await caches.open(key)).keys()).map((r) => r.url),
          ),
        )
      ).flat(),
    );
    expect(
      cached.some((url) => url.includes("pdf.worker") && url.includes(".mjs")),
    ).toBe(true);
    expect(
      cached.some((url) => /\/api(?:\/|$)/.test(new URL(url).pathname)),
    ).toBe(false);
    await context.setOffline(true);
    await navigate(page, "students");
    await page
      .getByRole("button", { name: "Edit Imported Learner", exact: true })
      .click();
    await page
      .getByRole("dialog")
      .getByLabel("Full name", { exact: true })
      .fill("Offline Imported Learner");
    await page
      .getByRole("button", { name: "Save student", exact: true })
      .click();
    await expect(page.locator(".v2-storage-pill.queued")).toBeVisible();
    await page.reload();
    await page
      .getByRole("button", { name: "Unlock offline workspace", exact: true })
      .click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Email address", { exact: true }).fill(email);
    await dialog
      .getByLabel("Offline vault passphrase", { exact: true })
      .fill(phrase);
    await dialog
      .getByRole("button", { name: "Unlock encrypted cache", exact: true })
      .click();
    await expect(dialog).toHaveCount(0);
    await expect(
      page.getByRole("button", {
        name: "Edit Offline Imported Learner",
        exact: true,
      }),
    ).toBeVisible();
    await navigate(page, "scanner");
    await page.getByLabel("Current assessment").selectOption(examId);
    await page
      .getByLabel("Upload OMR sheets or PDF", { exact: true })
      .setInputFiles({
        name: "offline-blank.pdf",
        mimeType: "application/pdf",
        buffer: offlineTemplate,
      });
    await page.getByRole("textbox", { name: /Roll number for/ }).fill("10003");
    await page
      .getByRole("button", { name: "Scan 1 page", exact: true })
      .click();
    await expect(page.locator(".scan-queue-item.done")).toBeVisible({
      timeout: 90_000,
    });
    await expect(page.locator(".v2-storage-pill.queued")).toBeVisible();
    await context.setOffline(false);
    await saved(page);
    expect(
      (await state()).workspace.students.some(
        (s: { name: string }) => s.name === "Offline Imported Learner",
      ),
    ).toBe(true);
    const synchronized = (await state()).workspace;
    const imported = synchronized.students.find(
      (s: { roll: string }) => s.roll === "10003",
    );
    const offlineRead = synchronized.results.find(
      (r: { studentId: string }) => r.studentId === imported.id,
    );
    expect(offlineRead.answers).toEqual([null, null, null, null, null]);
    expect(offlineRead.engine).toBe("opencv");
    expect(offlineRead.scanIds.length).toBe(1);
    expect(offlineRead.scanIds[0].startsWith("local-")).toBe(false);
  });

  await test.step("responsive navy and daylight views have no document overflow", async () => {
    for (const theme of ["dark", "light"]) {
      await navigate(page, "system");
      await page
        .getByRole("combobox", { name: "Color theme", exact: true })
        .selectOption(theme);
      for (const width of [1440, 768, 390]) {
        await page.setViewportSize({ width, height: 960 });
        for (const route of [
          "overview",
          "students",
          "batches",
          "evaluation",
          "reports",
          "system",
        ]) {
          await navigate(page, route);
          expect(
            await page.evaluate(
              () => document.documentElement.scrollWidth <= innerWidth + 1,
            ),
            `${theme} ${route} at ${width}px`,
          ).toBe(true);
        }
      }
    }
    await page.screenshot({
      path: info.outputPath("enterprise-mobile-light.png"),
      fullPage: true,
    });
  });
  await info.attach("browser-console-errors", {
    body: consoleErrors.join("\n"),
    contentType: "text/plain",
  });
  expect(errors).toEqual([]);
  // Failed connectivity requests and the initial unauthenticated /auth/me are expected in this test.
  expect(
    consoleErrors.filter(
      (message) =>
        !/net::ERR_INTERNET_DISCONNECTED|status of 401/.test(message),
    ),
  ).toEqual([]);
});
