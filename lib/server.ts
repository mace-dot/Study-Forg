import { createClient, SupabaseClient } from "@supabase/supabase-js";
import {
  createHmac,
  createHash,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import {
  mkdir,
  readFile,
  writeFile,
  rename,
  readdir,
  unlink,
  stat,
  rm,
} from "node:fs/promises";
import path from "node:path";
import { AppError, assert } from "./errors";
import type { RecordKind } from "./types";
export const cloud = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL &&
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY &&
  process.env.SUPABASE_SECRET_KEY,
);
export const dataDir =
  process.env.STUDYFORGE_DATA_DIR ||
  (process.env.VERCEL
    ? "/tmp/studyforge"
    : path.join(process.cwd(), ".studyforge"));
export const aiConfigured = Boolean(
  process.env.OPENAI_API_KEY && process.env.OPENAI_MODEL,
);
let adminClient: SupabaseClient | undefined;
export function admin() {
  if (!adminClient)
    adminClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SECRET_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
  return adminClient;
}
let secretPromise: Promise<string> | undefined;
async function secret() {
  if (process.env.APP_SECRET) return process.env.APP_SECRET;
  if (process.env.VERCEL)
    throw new AppError("Set APP_SECRET before hosting demo mode.", 503);
  if (!secretPromise)
    secretPromise = (async () => {
      await mkdir(dataDir, { recursive: true });
      const file = path.join(dataDir, "secret");
      try {
        return await readFile(file, "utf8");
      } catch {
        const value = randomUUID() + randomUUID();
        await writeFile(file, value, { flag: "wx", mode: 0o600 });
        return value;
      }
    })();
  return secretPromise;
}
export type Context = { owner: string; cookie?: string; localAI: boolean };
export async function context(req: Request): Promise<Context> {
  const hostname = new URL(
    "http://" + (req.headers.get("host") || new URL(req.url).host),
  ).hostname;
  if (req.method !== "GET") {
    const origin = req.headers.get("origin");
    assert(
      !origin ||
        new URL(origin).host ===
          (req.headers.get("host") || new URL(req.url).host),
      "Request origin does not match.",
      403,
    );
  }
  if (cloud) {
    const token = req.headers.get("authorization")?.replace(/^Bearer /, "");
    assert(token, "Sign in to access your courses.", 401);
    const { data, error } = await admin().auth.getUser(token);
    assert(
      !error && data.user,
      "Your session expired. Please sign in again.",
      401,
    );
    return { owner: data.user.id, localAI: false };
  }
  const key = await secret();
  const sign = (id: string) =>
    createHmac("sha256", key).update(id).digest("hex");
  const value = req.headers
    .get("cookie")
    ?.split("; ")
    .find((x) => x.startsWith("studyforge="))
    ?.slice(11);
  const [id, sig] = value?.split(".") || [];
  if (
    id &&
    /^[a-f0-9-]{36}$/.test(id) &&
    /^[a-f0-9]{64}$/.test(sig || "") &&
    timingSafeEqual(Buffer.from(sign(id)), Buffer.from(sig))
  )
    return {
      owner: id,
      localAI:
        !process.env.VERCEL && ["localhost", "127.0.0.1"].includes(hostname),
    };
  const owner = randomUUID();
  return {
    owner,
    localAI:
      !process.env.VERCEL && ["localhost", "127.0.0.1"].includes(hostname),
    cookie: `studyforge=${owner}.${sign(owner)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000${new URL(req.url).protocol === "https:" ? "; Secure" : ""}`,
  };
}
function safeId(id: string) {
  assert(/^[a-f0-9-]{36}$/.test(id), "Invalid record identifier.");
  return id;
}
function location(ctx: Context, kind: RecordKind, id: string) {
  return path.join(dataDir, safeId(ctx.owner), kind, safeId(id) + ".json");
}
export async function get<T>(
  ctx: Context,
  kind: RecordKind,
  id: string,
): Promise<T> {
  safeId(id);
  if (cloud) {
    const { data, error } = await admin()
      .from("studyforge_records")
      .select("payload")
      .eq("owner_id", ctx.owner)
      .eq("kind", kind)
      .eq("id", id)
      .maybeSingle();
    if (error)
      throw new AppError(
        "Database read failed. Check the StudyForge migration.",
        503,
      );
    assert(data, "Record not found.", 404);
    return data.payload as T;
  }
  try {
    return JSON.parse(await readFile(location(ctx, kind, id), "utf8"));
  } catch (e) {
    if (e instanceof SyntaxError) throw e;
    throw new AppError("Record not found.", 404);
  }
}
export async function list<T>(ctx: Context, kind: RecordKind): Promise<T[]> {
  if (cloud) {
    const { data, error } = await admin()
      .from("studyforge_records")
      .select("payload")
      .eq("owner_id", ctx.owner)
      .eq("kind", kind)
      .order("created_at");
    if (error)
      throw new AppError(
        "Database read failed. Check the StudyForge migration.",
        503,
      );
    return (data || []).map((x) => x.payload as T);
  }
  try {
    const dir = path.join(dataDir, ctx.owner, kind);
    const names = await readdir(dir);
    return await Promise.all(
      names
        .filter((x) => x.endsWith(".json"))
        .map(async (n) =>
          JSON.parse(await readFile(path.join(dir, n), "utf8")),
        ),
    );
  } catch {
    return [];
  }
}
export async function put<T extends { id: string }>(
  ctx: Context,
  kind: RecordKind,
  value: T,
) {
  safeId(value.id);
  if (cloud) {
    const { error } = await admin().from("studyforge_records").upsert(
      {
        id: value.id,
        owner_id: ctx.owner,
        kind,
        payload: value,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "owner_id,kind,id" },
    );
    if (error) throw new AppError("Could not save your work.", 503);
    return;
  }
  const file = location(ctx, kind, value.id);
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = file + "." + randomUUID() + ".tmp";
  await writeFile(temporary, JSON.stringify(value), { mode: 0o600 });
  await rename(temporary, file);
}
export async function remove(ctx: Context, kind: RecordKind, id: string) {
  safeId(id);
  if (cloud) {
    const { error } = await admin()
      .from("studyforge_records")
      .delete()
      .eq("owner_id", ctx.owner)
      .eq("kind", kind)
      .eq("id", id);
    if (error) throw new AppError("Could not delete record.", 503);
  } else await unlink(location(ctx, kind, id)).catch(() => {});
}
export async function saveFile(
  ctx: Context,
  id: string,
  buffer: Buffer,
  mime: string,
) {
  safeId(id);
  if (cloud) {
    const { error } = await admin()
      .storage.from("studyforge-materials")
      .upload(`${ctx.owner}/${id}`, buffer, {
        contentType: mime,
        upsert: false,
      });
    if (error)
      throw new AppError(
        "File storage failed. Check your private storage bucket.",
        503,
      );
  } else {
    const dir = path.join(dataDir, ctx.owner, "files");
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, id), buffer, { mode: 0o600 });
  }
}
export async function readFileData(ctx: Context, id: string) {
  safeId(id);
  if (cloud) {
    const { data, error } = await admin()
      .storage.from("studyforge-materials")
      .download(`${ctx.owner}/${id}`);
    if (error || !data)
      throw new AppError("Original file is unavailable.", 404);
    return Buffer.from(await data.arrayBuffer());
  }
  return await readFile(path.join(dataDir, ctx.owner, "files", id));
}
export async function deleteFile(ctx: Context, id: string) {
  safeId(id);
  if (cloud) {
    const { error } = await admin()
      .storage.from("studyforge-materials")
      .remove([`${ctx.owner}/${id}`]);
    if (error) throw new AppError("File deletion failed.", 503);
  } else
    await unlink(path.join(dataDir, ctx.owner, "files", id)).catch(() => {});
}
// Single-worker leases prevent duplicate generation calls. Cloud leases are atomic RPCs.
const leases = new Set<string>();
export async function withLease<T>(
  ctx: Context,
  key: string,
  fn: () => Promise<T>,
): Promise<T> {
  const lock = ctx.owner + key;
  if (cloud) {
    const { data, error } = await admin().rpc("studyforge_claim_lock", {
      p_owner: ctx.owner,
      p_key: key,
    });
    if (error)
      throw new AppError("Job lock unavailable. Apply the migration.", 503);
    assert(data, "This task is already running. Try again shortly.", 409);
  } else {
    assert(
      !leases.has(lock),
      "This task is already running. Try again shortly.",
      409,
    );
    const lockDir = path.join(
      dataDir,
      ctx.owner,
      "locks",
      createHash("sha256").update(key).digest("hex"),
    );
    await mkdir(path.dirname(lockDir), { recursive: true });
    try {
      await mkdir(lockDir);
    } catch {
      const info = await stat(lockDir).catch(() => null);
      if (info && Date.now() - info.mtimeMs > 180000) {
        await rm(lockDir, { recursive: true, force: true });
        try {
          await mkdir(lockDir);
        } catch {
          throw new AppError("This task is already running.", 409);
        }
      } else
        throw new AppError(
          "This task is already running. Try again shortly.",
          409,
        );
    }
    leases.add(lock);
  }
  try {
    return await fn();
  } finally {
    if (cloud)
      await admin().rpc("studyforge_release_lock", {
        p_owner: ctx.owner,
        p_key: key,
      });
    else {
      leases.delete(lock);
      await rm(
        path.join(
          dataDir,
          ctx.owner,
          "locks",
          createHash("sha256").update(key).digest("hex"),
        ),
        { recursive: true, force: true },
      );
    }
  }
}
