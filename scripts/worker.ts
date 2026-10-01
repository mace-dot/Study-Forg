/** Optional long-running worker. Run separately from Next.js for processing that
 * continues after the browser closes. Use the same environment and data dir. */
import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());
const { admin, cloud, dataDir, list } = await import("../lib/server");
const { stepJob } = await import("../lib/generate");
const { readdir } = await import("node:fs/promises");
import type { Job } from "../lib/types";
let stopping = false;
process.on("SIGINT", () => {
  stopping = true;
});
process.on("SIGTERM", () => {
  stopping = true;
});
while (!stopping) {
  try {
    let queued: { owner: string; id: string }[] = [];
    if (cloud) {
      const { data, error } = await admin()
        .from("studyforge_records")
        .select("owner_id,payload")
        .eq("kind", "job");
      if (error) throw error;
      queued = (data || [])
        .filter(
          (r) =>
            ["queued", "running"].includes(r.payload.status) &&
            r.payload.leaseUntil < Date.now(),
        )
        .map((r) => ({ owner: r.owner_id, id: r.payload.id }));
    } else {
      const owners = (await readdir(dataDir).catch(() => [])).filter((x) =>
        /^[a-f0-9-]{36}$/.test(x),
      );
      for (const owner of owners) {
        const jobs = await list<Job>({ owner, localAI: true }, "job");
        queued.push(
          ...jobs
            .filter(
              (j) =>
                ["queued", "running"].includes(j.status) &&
                j.leaseUntil < Date.now(),
            )
            .map((j) => ({ owner, id: j.id })),
        );
      }
    }
    for (const job of queued) {
      if (stopping) break;
      try {
        await stepJob({ owner: job.owner, localAI: !cloud }, job.id);
      } catch (e) {
        console.error(
          "Worker step failed:",
          e instanceof Error ? e.message : "Unknown error",
        );
      }
    }
  } catch (e) {
    console.error(
      "Worker queue unavailable:",
      e instanceof Error ? e.message : "Unknown error",
    );
  }
  await new Promise((resolve) => setTimeout(resolve, 2000));
}
