import { test, expect } from "@playwright/test";
test("finance sample goes from review to graded practice and persists after refresh", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.getByRole("button", { name: /Short selling & margin/ }).click();
  await expect(
    page.getByText("Short-selling sample.txt", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: /Generate Study Pack/ }).click();
  await expect(
    page.getByRole("heading", { name: "How it fits together" }),
  ).toBeVisible();
  await page.screenshot({ path: "/tmp/studyforge-review.png", fullPage: true });
  await page.locator(".citations").first().getByRole("button").first().click();
  await expect(page.getByRole("dialog")).toContainText("SOURCE VIEWER");
  await page.getByRole("button", { name: "Close source" }).click();
  await page.getByRole("button", { name: "Start practicing →" }).click();
  await page.getByLabel("Questions", { exact: true }).fill("1");
  await page
    .getByRole("button", { name: "Build my practice session →" })
    .click();
  const card = page.locator(".question-card").first();
  const prompt = await card.getByRole("heading").innerText();
  const [N, P0, m0, mm] = prompt.match(/\d+(?:\.\d+)?/g)!.map(Number);
  const answer = (N * P0 * (1 + m0 / 100)) / (N * (1 + mm / 100));
  await page.getByPlaceholder("Your numerical answer").fill(answer.toFixed(2));
  await page.getByRole("button", { name: "Check my answer" }).click();
  await expect(card.getByText("Correct ✓", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "See progress →" }).click();
  await expect(page.getByText("100%", { exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "Progress", exact: true }).click();
  await expect(page.getByText("100%", { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});
test("reading sample shows self-check feedback and usable mobile layout", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: /Tariffs & trade policy/ }).click();
  await page.getByRole("button", { name: /Generate Study Pack/ }).click();
  await expect(
    page.getByRole("heading", { name: "How it fits together" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Start practicing →" }).click();
  await page.getByLabel("Questions", { exact: true }).fill("1");
  await page
    .getByRole("button", { name: "Build my practice session →" })
    .click();
  await page
    .getByPlaceholder("Explain your reasoning…")
    .fill(
      "The higher price transfers surplus to producers and government, but production and consumption distortions create deadweight loss.",
    );
  await page.getByRole("button", { name: "Check my answer" }).click();
  await expect(
    page.getByText("Self-check reflection", { exact: true }),
  ).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  expect(overflow).toBe(false);
  await page.screenshot({ path: "/tmp/studyforge-mobile.png", fullPage: true });
});
test("real upload extracts source and missing AI fails transparently", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "＋ New course" }).click();
  await page.getByLabel("Course name", { exact: true }).fill("ECON 308");
  await page
    .getByRole("button", { name: "Create course", exact: true })
    .click();
  await page.locator("input[type=file]").setInputFiles({
    name: "notes.txt",
    mimeType: "text/plain",
    buffer: Buffer.from(
      "Money demand increases with income.\n\nInterest rates affect the opportunity cost of holding money.",
    ),
  });
  await page.getByRole("button", { name: /Upload & extract/ }).click();
  await expect(page.getByText("notes.txt", { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "Preview extracted source →" })
    .click();
  await expect(page.getByRole("dialog")).toContainText(
    "Money demand increases with income.",
  );
  await page.getByRole("button", { name: "Close source" }).click();
  await page.getByRole("button", { name: /Generate Study Pack/ }).click();
  await expect(page.locator(".alert.error")).toContainText(
    "AI is not configured",
  );
});

test("mock-exam HTTP responses hide answers until final submission and reject other workspaces", async ({
  request,
  playwright,
}) => {
  const bootstrap = await request.get("/api/bootstrap");
  expect(bootstrap.ok()).toBe(true);
  const course = await (
    await request.post("/api/courses", {
      data: {
        name: "Mock exam checks",
        subject: "Finance",
        examDate: "",
        topics: "",
      },
    })
  ).json();
  const material = await (
    await request.post("/api/samples", {
      data: { courseId: course.id, type: "finance" },
    })
  ).json();
  const job = await (
    await request.post("/api/jobs", {
      data: { courseId: course.id, materialIds: [material.id] },
    })
  ).json();
  const completed = await (await request.post("/api/jobs/" + job.id)).json();
  expect(completed.status).toBe("complete");
  const session = await (
    await request.post("/api/practice", {
      data: {
        packId: completed.packId,
        mode: "mock",
        count: 1,
        difficulty: "medium",
        topic: "",
        minutes: 20,
      },
    })
  ).json();
  const q = session.questions[0];
  expect(q).not.toHaveProperty("answer");
  expect(q).not.toHaveProperty("solution");
  expect(q).not.toHaveProperty("numericAnswer");
  const [N, P0, m0, mm] = q.prompt.match(/\d+(?:\.\d+)?/g).map(Number);
  const response = ((N * P0 * (1 + m0 / 100)) / (N * (1 + mm / 100))).toFixed(
    2,
  );
  const saved = await (
    await request.post("/api/practice/" + session.id, {
      data: { responses: { [q.id]: response }, final: false },
    })
  ).json();
  expect(saved.feedback).toEqual([]);
  const other = await playwright.request.newContext({
    baseURL: "http://localhost:3000",
  });
  expect((await other.get("/api/practice/" + session.id)).status()).toBe(404);
  expect(
    (await other.get("/api/materials/" + material.id + "/file")).status(),
  ).toBe(404);
  await other.dispose();
  const result = await (
    await request.post("/api/practice/" + session.id, {
      data: { responses: {}, final: true },
    })
  ).json();
  expect(result.completed).toBe(true);
  expect(result.feedback[0].correct).toBe(true);
  expect(result.feedback[0].solution.length).toBeGreaterThan(0);
});
