import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import JSZip from "jszip";
import { PDFDocument, StandardFonts } from "pdf-lib";
import {
  numericQuestion,
  grade,
  publicSession,
  submitSession,
} from "../lib/practice";
import { sampleMaterial, samplePack } from "../lib/samples";
import { sourceChunks, mergeParts, newJob, stepJob } from "../lib/generate";
import { extract } from "../lib/extract";
import { put, get, dataDir, withLease } from "../lib/server";
import type { PracticeSession, Course } from "../lib/types";

test("calculated short-margin problems agree with the maintenance equation", () => {
  for (let i = 0; i < 100; i++) {
    const q = numericQuestion("short-margin", "hard", []);
    const nums = q.prompt.match(/\d+(?:\.\d+)?/g)!.map(Number);
    const [N, P0, m0, mm] = nums;
    const equity = N * P0 * (1 + m0 / 100) - N * q.numericAnswer!;
    assert.ok(Math.abs(equity / (N * q.numericAnswer!) - mm / 100) < 1e-9);
    assert.equal(grade(q, q.numericAnswer!.toFixed(2)).correct, true);
    assert.equal(grade(q, String(q.numericAnswer! + 10)).correct, false);
    assert.equal(grade(q, "I am unsure").correct, null);
  }
});
test("additional collateral restores target equity", () => {
  for (let i = 0; i < 50; i++) {
    const q = numericQuestion("short-collateral", "medium", []);
    const [N, P0, m0, P, mm] = q.prompt.match(/\d+(?:\.\d+)?/g)!.map(Number);
    const equity = N * P0 * (1 + m0 / 100) + q.numericAnswer! - N * P;
    assert.ok(Math.abs(equity / (N * P) - mm / 100) < 1e-9);
  }
});
test("straight-line and portfolio templates produce finite gradeable answers", () => {
  for (const type of ["depreciation", "portfolio"])
    for (let i = 0; i < 30; i++) {
      const q = numericQuestion(type, "medium", []);
      assert.ok(Number.isFinite(q.numericAnswer));
      assert.equal(grade(q, q.answer).correct, true);
    }
});
test("source chunking preserves all text and references including long sections", () => {
  const m = sampleMaterial(randomUUID(), "finance");
  m.sources[0].text = "x".repeat(31000);
  const chunks = sourceChunks(m.sources);
  assert.ok(
    chunks.every((c) => c.reduce((n, s) => n + s.text.length, 0) <= 14000),
  );
  assert.equal(
    chunks
      .flat()
      .filter((s) => s.id === m.sources[0].id)
      .map((s) => s.text)
      .join(""),
    m.sources[0].text,
  );
});
test("duplicate source questions do not inflate observed pattern counts", () => {
  const m = sampleMaterial(randomUUID(), "finance");
  const p = samplePack(m);
  const merged = mergeParts([structuredClone(p), structuredClone(p)]);
  assert.equal(merged.patterns[0].evidence.length, 1);
  assert.equal(merged.concepts.length, 2);
});
test("Office extraction preserves slide numbers and flags embedded diagrams", async () => {
  const zip = new JSZip();
  zip.file(
    "ppt/slides/slide1.xml",
    "<p:sld><a:t>Maintenance margin</a:t><p:pic/></p:sld>",
  );
  zip.file(
    "ppt/slides/slide2.xml",
    "<p:sld><a:t>Equity equals collateral minus liability.</a:t></p:sld>",
  );
  const m = await extract(
    await zip.generateAsync({ type: "nodebuffer" }),
    "slides.pptx",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    randomUUID(),
    "lecture slides",
  );
  assert.equal(m.sources[1].location, "Slide 2");
  assert.match(m.sources[0].text, /Maintenance/);
  assert.equal(m.warnings.length, 1);
});
test("PDF extraction preserves page numbers and reads text", async () => {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  doc.addPage().drawText("Short selling: margin and account equity.", { font });
  doc
    .addPage()
    .drawText("Maintenance margin uses current short liability.", { font });
  const m = await extract(
    Buffer.from(await doc.save()),
    "lecture.pdf",
    "application/pdf",
    randomUUID(),
    "lecture slides",
  );
  assert.equal(m.sources.length, 2);
  assert.equal(m.sources[1].location, "Page 2");
  assert.match(m.sources[1].text, /Maintenance/);
});
test("invalid files and oversized files fail visibly", async () => {
  await assert.rejects(
    extract(
      Buffer.from("fake"),
      "fake.pdf",
      "application/pdf",
      randomUUID(),
      "notes",
    ),
    /valid PDF/,
  );
  await assert.rejects(
    extract(
      Buffer.alloc(3500001),
      "big.txt",
      "text/plain",
      randomUUID(),
      "notes",
    ),
    /3.5 MB/,
  );
  await assert.rejects(
    extract(Buffer.from("x"), "bad.exe", "", randomUUID(), "notes"),
    /Use PDF/,
  );
});
test("owner isolation, persisted generation, and mock answer secrecy", async () => {
  const owner = randomUUID(),
    ctx = { owner, localAI: true },
    other = { owner: randomUUID(), localAI: true };
  try {
    const course: Course = {
      id: randomUUID(),
      name: "Finance",
      subject: "Finance",
      examDate: "",
      topics: "",
      createdAt: new Date().toISOString(),
    };
    await put(ctx, "course", course);
    await assert.rejects(get(other, "course", course.id), /not found/);
    const m = sampleMaterial(course.id, "finance");
    await put(ctx, "material", m);
    const job = await newJob(ctx, course.id, [m.id]);
    const done = await stepJob(ctx, job.id);
    assert.equal(done.status, "complete");
    assert.equal((await stepJob(ctx, job.id)).packId, done.packId);
    const q = numericQuestion("short-margin", "medium", [m.sources[0].id]);
    const session: PracticeSession = {
      id: randomUUID(),
      courseId: course.id,
      packId: done.packId!,
      mode: "mock",
      questions: [q],
      responses: {},
      feedback: [],
      completed: false,
      deadline: Date.now() + 60000,
      createdAt: new Date().toISOString(),
    };
    await put(ctx, "session", session);
    const publicQ = publicSession(session).questions[0];
    assert.ok(!("answer" in publicQ));
    assert.ok(!("solution" in publicQ));
    assert.ok(!("numericAnswer" in publicQ));
    const saved = await submitSession(
      ctx,
      session.id,
      { [q.id]: q.answer },
      false,
    );
    assert.equal(saved.feedback.length, 0);
    const finished = await submitSession(ctx, session.id, {}, true);
    assert.equal(finished.feedback[0].correct, true);
    assert.equal(finished.completed, true);
    const repeated = await submitSession(ctx, session.id, {}, true);
    assert.equal(repeated.feedback.length, 1);
  } finally {
    await rm(`${dataDir}/${owner}`, { recursive: true, force: true });
  }
});
test("concurrent work is rejected by leases", async () => {
  const owner = randomUUID(),
    ctx = { owner, localAI: true };
  let unblock: () => void = () => {};
  const waiting = new Promise<void>((resolve) => {
    unblock = resolve;
  });
  let ready: () => void = () => {};
  const acquired = new Promise<void>((resolve) => {
    ready = resolve;
  });
  const first = withLease(ctx, "test", async () => {
    ready();
    await waiting;
  });
  await acquired;
  await assert.rejects(
    withLease(ctx, "test", async () => {}),
    /already running/,
  );
  unblock();
  await first;
  await rm(`${dataDir}/${owner}`, { recursive: true, force: true });
});
