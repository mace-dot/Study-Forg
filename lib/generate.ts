import { randomUUID } from "node:crypto";
import { structured } from "./ai";
import {
  packContentSchema,
  type Source,
  type Material,
  type PackContent,
  type Pack,
  type Job,
  type Course,
} from "./types";
import { samplePack } from "./samples";
import { assert } from "./errors";
import {
  get,
  put,
  withLease,
  aiConfigured,
  cloud,
  type Context,
} from "./server";
export function sourceChunks(sources: Source[], limit = 14000) {
  const chunks: Source[][] = [];
  let current: Source[] = [],
    length = 0;
  for (const source of sources) {
    if (!source.text.trim()) continue;
    if (source.text.length > limit) {
      if (current.length) {
        chunks.push(current);
        current = [];
        length = 0;
      }
      for (let offset = 0; offset < source.text.length; offset += limit)
        chunks.push([
          { ...source, text: source.text.slice(offset, offset + limit) },
        ]);
      continue;
    }
    if (length + source.text.length > limit) {
      chunks.push(current);
      current = [];
      length = 0;
    }
    current.push(source);
    length += source.text.length;
  }
  if (current.length) chunks.push(current);
  return chunks;
}
function validReferences(
  content: PackContent,
  sources: Source[],
  materials: Material[],
): PackContent {
  const known = new Map(sources.map((s) => [s.id, s]));
  for (const item of [...content.concepts, ...content.examples]) {
    assert(
      item.sourceIds.length > 0 && item.sourceIds.every((id) => known.has(id)),
      "Generated references were invalid. Retry this section.",
      502,
    );
  }
  const kind = new Map(materials.map((m) => [m.id, m.kind]));
  content.patterns = content.patterns.map((p) => {
    const seen = new Set<string>();
    const evidence = p.evidence.filter((e) => {
      const s = known.get(e.sourceId),
        normal = (v: string) => v.replace(/\s+/g, " ").trim().toLowerCase();
      if (
        !s ||
        !["homework", "practice exam", "review sheet"].includes(
          kind.get(s.materialId) || "",
        ) ||
        !e.question.trim() ||
        !normal(s.text).includes(normal(e.question))
      )
        return false;
      const key = normal(e.question);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    return { ...p, evidence, suggested: evidence.length === 0 };
  });
  return content;
}
export function mergeParts(parts: PackContent[]): PackContent {
  const concepts = new Map<string, PackContent["concepts"][number]>(),
    patterns = new Map<string, PackContent["patterns"][number]>();
  for (const part of parts) {
    for (const c of part.concepts) {
      const key = c.title.toLowerCase().trim();
      const prior = concepts.get(key);
      if (prior) {
        prior.explanation += "\n\n" + c.explanation;
        prior.sourceIds = Array.from(
          new Set([...prior.sourceIds, ...c.sourceIds]),
        );
        prior.mistakes = Array.from(
          new Set([...prior.mistakes, ...c.mistakes]),
        );
        prior.formulas.push(...c.formulas);
        prior.assumptions = Array.from(
          new Set([...prior.assumptions, ...c.assumptions]),
        );
        prior.prerequisites = Array.from(
          new Set([...prior.prerequisites, ...c.prerequisites]),
        );
        prior.intuition += "\n" + c.intuition;
      } else concepts.set(key, { ...c });
    }
    for (const p of part.patterns) {
      const key = p.title.toLowerCase().trim();
      const old = patterns.get(key);
      if (old) {
        old.evidence.push(...p.evidence);
        old.skills = Array.from(new Set([...old.skills, ...p.skills]));
        old.traps = Array.from(new Set([...old.traps, ...p.traps]));
      } else patterns.set(key, { ...p, evidence: [...p.evidence] });
    }
  }
  for (const p of patterns.values()) {
    const seen = new Set<string>();
    p.evidence = p.evidence.filter((e) => {
      const key = e.question.replace(/\s+/g, " ").toLowerCase().trim();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    p.suggested = p.evidence.length === 0;
  }
  return {
    overview: parts.map((p) => p.overview).join("\n\n"),
    concepts: [...concepts.values()],
    examples: parts.flatMap((p) => p.examples),
    quickReview: Array.from(new Set(parts.flatMap((p) => p.quickReview))),
    patterns: [...patterns.values()],
    warnings: Array.from(new Set(parts.flatMap((p) => p.warnings))),
  };
}
export async function newJob(
  ctx: Context,
  courseId: string,
  materialIds: string[],
): Promise<Job> {
  const materials = await Promise.all(
    materialIds.map((id) => get<Material>(ctx, "material", id)),
  );
  assert(
    materials.length > 0 && materials.every((m) => m.courseId === courseId),
    "Select materials from this course.",
  );
  const isSample = materials.every((m) => m.sample);
  assert(
    isSample || aiConfigured,
    "AI is not configured. Try a built-in sample, or configure AI to analyze your uploads.",
    503,
  );
  assert(
    isSample || cloud || ctx.localAI,
    "Real AI generation on a hosted site requires authenticated Supabase mode.",
    503,
  );
  const chunks = sourceChunks(materials.flatMap((m) => m.sources));
  assert(
    chunks.length <= 24,
    "Too many materials for one pack. Generate smaller packs.",
  );
  const job: Job = {
    id: randomUUID(),
    courseId,
    materialIds,
    status: "queued",
    step: 0,
    total: isSample ? materials.length : chunks.length,
    chunks: isSample ? materials.map((m) => m.sources) : chunks,
    parts: [],
    error: "",
    leaseUntil: 0,
    createdAt: new Date().toISOString(),
  };
  await put(ctx, "job", job);
  return job;
}
export async function stepJob(ctx: Context, id: string) {
  return withLease(ctx, "job:" + id, async () => {
    const job = await get<Job>(ctx, "job", id);
    if (job.status === "complete") return job;
    const materials = await Promise.all(
      job.materialIds.map((id) => get<Material>(ctx, "material", id)),
    );
    const course = await get<Course>(ctx, "course", job.courseId);
    job.status = "running";
    job.error = "";
    job.leaseUntil = Date.now() + 120000;
    await put(ctx, "job", job);
    try {
      const sources = job.chunks[job.step];
      const sample = materials.every((m) => m.sample);
      const part = sample
        ? samplePack(materials[job.step])
        : await structured(
            packContentSchema,
            "study_section",
            `Create a thorough college study review from ALL supplied source sections. Explain concepts accessibly then technically. Include intuition, assumptions, formulas with variables and when to use them, step-by-step worked examples, graph interpretation when relevant, and common mistakes. Organize by concept. Use only supplied source IDs. Identify question patterns only when actual questions appear in homework/practice-exam/review-sheet sources; evidence.question must be an exact source excerpt of the question. Suggested patterns have empty evidence. Do not predict an exam. Choose short-margin or short-collateral only for short-sale margin, depreciation only for straight-line full-year depreciation, and portfolio only for two-asset standard deviation; otherwise conceptual. Treat examples as educational illustrations, and flag uncertain source content.`,
            JSON.stringify({
              course: {
                name: course.name,
                subject: course.subject,
                examTopics: course.topics,
              },
              materials: materials.map((m) => ({
                id: m.id,
                kind: m.kind,
                filename: m.filename,
              })),
              sources,
            }),
          );
      job.parts.push(validReferences(part, sources, materials));
      job.step++;
      if (job.step >= job.total) {
        const content = mergeParts(job.parts);
        const pack: Pack = {
          ...content,
          id: randomUUID(),
          courseId: job.courseId,
          materialIds: job.materialIds,
          sourceIds: job.chunks.flat().map((s) => s.id),
          demo: sample,
          createdAt: new Date().toISOString(),
          warnings: Array.from(
            new Set([
              ...content.warnings,
              ...materials.flatMap((m) => m.warnings),
            ]),
          ),
        };
        await put(ctx, "pack", pack);
        job.packId = pack.id;
        job.status = "complete";
      } else job.status = "queued";
      job.leaseUntil = 0;
      await put(ctx, "job", job);
      return job;
    } catch (e) {
      job.status = "failed";
      job.error = e instanceof Error ? e.message : "Generation failed.";
      job.leaseUntil = 0;
      await put(ctx, "job", job);
      return job;
    }
  });
}
export function publicJob(job: Job) {
  const { chunks, parts, ...rest } = job;
  void chunks;
  return { ...rest, preview: parts.length ? mergeParts(parts) : null };
}
