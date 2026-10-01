import { randomUUID, createHash } from "node:crypto";
import { z } from "zod";
import {
  context,
  list,
  get,
  put,
  remove,
  saveFile,
  readFileData,
  deleteFile,
  cloud,
  aiConfigured,
  withLease,
  type Context,
} from "@/lib/server";
import { assert, AppError } from "@/lib/errors";
import { extract, MAX_BYTES } from "@/lib/extract";
import {
  materialKinds,
  type Course,
  type Material,
  type Pack,
  type Job,
  type PracticeSession,
  type Attempt,
  type RecordKind,
} from "@/lib/types";
import { sampleMaterial } from "@/lib/samples";
import { newJob, stepJob, publicJob } from "@/lib/generate";
import { createSession, publicSession, submitSession } from "@/lib/practice";
export const runtime = "nodejs";
export const maxDuration = 120;
const id = z.string().uuid();
async function boundedBody(req: Request) {
  const length = Number(req.headers.get("content-length") || 0);
  assert(length <= 4_000_000, "Request exceeds 4 MB.");
  const reader = req.body?.getReader();
  assert(reader, "Empty request.");
  const parts: Uint8Array[] = [];
  let count = 0;
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    count += part.value.length;
    if (count > 4_000_000) {
      await reader.cancel();
      throw new AppError("Request exceeds 4 MB.", 413);
    }
    parts.push(part.value);
  }
  return Buffer.concat(parts);
}
async function json(req: Request) {
  try {
    return JSON.parse((await boundedBody(req)).toString());
  } catch (e) {
    if (e instanceof AppError) throw e;
    throw new AppError("Invalid JSON.");
  }
}
const output = (data: unknown, ctx?: Context, status = 200) =>
  Response.json(data, {
    status,
    headers: ctx?.cookie ? { "Set-Cookie": ctx.cookie } : {},
  });
async function handle(
  req: Request,
  { params }: { params: Promise<{ path: string[] }> },
) {
  let ctx: Context | undefined;
  try {
    const { path } = await params;
    const [action, recordId, sub] = path;
    if (action === "config" && req.method === "GET")
      return output({
        cloud,
        ai: aiConfigured,
        supabaseUrl: cloud ? process.env.NEXT_PUBLIC_SUPABASE_URL : null,
        supabaseKey: cloud
          ? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
          : null,
        hostedDemo: Boolean(process.env.VERCEL && !cloud),
      });
    ctx = await context(req);
    if (action === "bootstrap" && req.method === "GET") {
      const [courses, materials, packs, jobs, attempts, sessions] =
        await Promise.all([
          list<Course>(ctx, "course"),
          list<Material>(ctx, "material"),
          list<Pack>(ctx, "pack"),
          list<Job>(ctx, "job"),
          list<Attempt>(ctx, "attempt"),
          list<PracticeSession>(ctx, "session"),
        ]);
      return output(
        {
          courses,
          materials,
          packs,
          jobs: jobs.map(publicJob),
          attempts,
          sessions: sessions.map(publicSession),
        },
        ctx,
      );
    }
    if (action === "courses" && req.method === "POST") {
      const values = z
        .object({
          name: z.string().trim().min(1).max(100),
          subject: z.string().max(100),
          examDate: z.string().max(20),
          topics: z.string().max(2000),
        })
        .parse(await json(req));
      const course: Course = {
        ...values,
        id: randomUUID(),
        createdAt: new Date().toISOString(),
      };
      await put(ctx, "course", course);
      return output(course, ctx, 201);
    }
    if (action === "courses" && recordId && req.method === "DELETE") {
      await get<Course>(ctx, "course", recordId);
      const jobs = (await list<Job>(ctx, "job")).filter(
        (j) => j.courseId === recordId,
      );
      assert(
        !jobs.some((j) => j.leaseUntil > Date.now()),
        "Wait for the current generation step before deleting this course.",
        409,
      );
      for (const kind of [
        "material",
        "pack",
        "job",
        "session",
        "attempt",
      ] as RecordKind[]) {
        const records = await list<{ id: string; courseId: string }>(ctx, kind);
        for (const r of records.filter((r) => r.courseId === recordId)) {
          if (kind === "material") await deleteFile(ctx, r.id);
          await remove(ctx, kind, r.id);
        }
      }
      await remove(ctx, "course", recordId);
      return output({ deleted: true }, ctx);
    }
    if (action === "samples" && req.method === "POST") {
      const data = z
        .object({ type: z.enum(["finance", "reading"]), courseId: id })
        .parse(await json(req));
      await get<Course>(ctx, "course", data.courseId);
      const m = sampleMaterial(data.courseId, data.type);
      await saveFile(
        ctx,
        m.id,
        Buffer.from(m.sources.map((s) => s.text).join("\n\n")),
        m.mime,
      );
      await put(ctx, "material", m);
      return output(m, ctx, 201);
    }
    if (action === "materials" && req.method === "POST") {
      const bytes = await boundedBody(req);
      const form = await new Request(req.url, {
        method: "POST",
        headers: { "content-type": req.headers.get("content-type") || "" },
        body: new Uint8Array(bytes),
      }).formData();
      const courseId = id.parse(form.get("courseId")),
        kind = z.enum(materialKinds).parse(form.get("kind"));
      await get<Course>(ctx, "course", courseId);
      const file = form.get("file");
      assert(file instanceof File, "Choose a file.");
      assert(file.size <= MAX_BYTES, "Each file must be under 3.5 MB.");
      const buffer = Buffer.from(await file.arrayBuffer());
      if (/\.(png|jpg|jpeg|webp)$/i.test(file.name))
        assert(
          cloud || ctx.localAI,
          "Image interpretation on a hosted site requires authenticated cloud mode.",
          503,
        );
      const hash = createHash("sha256").update(buffer).digest("hex");
      const duplicate = (await list<Material>(ctx, "material")).find(
        (m) => m.courseId === courseId && m.hash === hash && m.kind === kind,
      );
      if (duplicate) return output({ ...duplicate, cached: true }, ctx);
      const m = await extract(
        buffer,
        file.name,
        file.type || "application/octet-stream",
        courseId,
        kind,
      );
      await saveFile(ctx, m.id, buffer, m.mime);
      try {
        await put(ctx, "material", m);
      } catch (e) {
        await deleteFile(ctx, m.id);
        throw e;
      }
      return output(m, ctx, 201);
    }
    if (action === "materials" && recordId && req.method === "DELETE") {
      const m = await get<Material>(ctx, "material", recordId);
      assert(
        !(await list<Job>(ctx, "job")).some(
          (j) =>
            j.materialIds.includes(m.id) &&
            j.status !== "complete" &&
            j.leaseUntil > Date.now(),
        ),
        "Wait for generation to finish.",
        409,
      );
      await deleteFile(ctx, recordId);
      await remove(ctx, "material", recordId);
      return output({ deleted: true }, ctx);
    }
    if (
      action === "materials" &&
      recordId &&
      sub === "file" &&
      req.method === "GET"
    ) {
      const m = await get<Material>(ctx, "material", recordId);
      const data = await readFileData(ctx, recordId);
      const safe =
        m.mime === "application/pdf" ||
        m.mime.startsWith("image/") ||
        m.mime === "text/plain";
      return new Response(new Uint8Array(data), {
        headers: {
          "Content-Type": safe ? m.mime : "application/octet-stream",
          "Content-Disposition": `${safe ? "inline" : "attachment"}; filename="${m.filename.replace(/[^a-zA-Z0-9._-]/g, "_")}"`,
          "Cache-Control": "no-store",
          ...(ctx.cookie ? { "Set-Cookie": ctx.cookie } : {}),
        },
      });
    }
    if (action === "jobs" && !recordId && req.method === "POST") {
      const body = z
        .object({ courseId: id, materialIds: z.array(id).min(1).max(30) })
        .parse(await json(req));
      await get<Course>(ctx, "course", body.courseId);
      const c = ctx;
      const job = await withLease(
        c,
        "create-job:" + body.courseId,
        async () => {
          const key = [...new Set(body.materialIds)].sort().join(",");
          const existing = (await list<Job>(c, "job")).find(
            (j) =>
              j.courseId === body.courseId &&
              [...j.materialIds].sort().join(",") === key,
          );
          return (
            existing ||
            (await newJob(c, body.courseId, [...new Set(body.materialIds)]))
          );
        },
      );
      return output(publicJob(job), ctx, 201);
    }
    if (action === "jobs" && recordId && req.method === "POST")
      return output(publicJob(await stepJob(ctx, recordId)), ctx);
    if (action === "jobs" && recordId && req.method === "GET")
      return output(publicJob(await get<Job>(ctx, "job", recordId)), ctx);
    if (action === "practice" && !recordId && req.method === "POST") {
      const options = z
        .object({
          packId: id,
          mode: z.enum(["guided", "mock"]),
          count: z.number().int().min(1).max(20),
          difficulty: z.enum(["easy", "medium", "hard"]),
          topic: z.string().max(200),
          minutes: z.number().int().min(1).max(180),
        })
        .parse(await json(req));
      const pack = await get<Pack>(ctx, "pack", options.packId);
      assert(
        pack.demo || cloud || ctx.localAI,
        "Configure authenticated cloud mode for real-material practice.",
        503,
      );
      return output(
        publicSession(await createSession(ctx, pack, options)),
        ctx,
        201,
      );
    }
    if (action === "practice" && recordId && req.method === "GET")
      return output(
        publicSession(await get<PracticeSession>(ctx, "session", recordId)),
        ctx,
      );
    if (action === "practice" && recordId && req.method === "POST") {
      const body = z
        .object({
          responses: z.record(z.string(), z.string().max(4000)),
          final: z.boolean(),
        })
        .parse(await json(req));
      return output(
        await submitSession(ctx, recordId, body.responses, body.final),
        ctx,
      );
    }
    if (action === "attempts" && recordId && req.method === "POST") {
      const attempt = await get<Attempt>(ctx, "attempt", recordId);
      attempt.reported = true;
      await put(ctx, "attempt", attempt);
      return output(attempt, ctx);
    }
    throw new AppError("Endpoint not found.", 404);
  } catch (e) {
    if (e instanceof z.ZodError)
      return output(
        { error: "Some inputs are invalid. Check the form and try again." },
        ctx,
        400,
      );
    return output(
      {
        error:
          e instanceof AppError
            ? e.message
            : "The request failed. Your completed work is saved.",
      },
      ctx,
      e instanceof AppError ? e.status : 500,
    );
  }
}
export const GET = handle;
export const POST = handle;
export const DELETE = handle;
