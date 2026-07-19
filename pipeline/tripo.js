import { promises as fs } from "node:fs";
import path from "node:path";

// TRIPO client for the offline pipeline. Turns one memory's `objectPrompt`
// into a GLB, downloaded into public/ so the viewer loads it locally (no live
// TRIPO call or CDN CORS dependency at demo/runtime). Mirrors marble.js's
// generate -> poll -> download shape.

const TRIPO_ROOT = "https://api.tripo3d.ai/v2/openapi";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function apiKey() {
  const k = process.env.TRIPO_API_KEY;
  if (!k) {
    throw new Error(
      "TRIPO_API_KEY is not set. Put it in .env (root or pipeline/) — objects will stay placeholder orbs without it.",
    );
  }
  return k;
}

async function tripoFetch(url, opts = {}) {
  const res = await fetch(url, {
    ...opts,
    headers: {
      Authorization: `Bearer ${apiKey()}`,
      "Content-Type": "application/json",
      ...(opts.headers || {}),
    },
  });
  const json = await res.json();
  if (!res.ok) {
    throw new Error(`TRIPO ${res.status} on ${url}: ${JSON.stringify(json).slice(0, 400)}`);
  }
  return json;
}

// Generate one memory's object, poll, download. Returns { modelUrl } (an
// app-relative path under public/) or throws — caller decides idempotency
// (whether to call this at all for a given memory) and how to handle failure.
export async function generateMemoryObject({ memory, config, outDir, appRelDir }) {
  const base = config.tripo?.apiBase ?? TRIPO_ROOT;
  const pollMs = (config.tripo?.pollIntervalSeconds ?? 10) * 1000;
  const timeoutMs = (config.tripo?.timeoutMinutes ?? 8) * 60_000;

  if (!memory.objectPrompt) {
    throw new Error(`Memory "${memory.id}" has no objectPrompt — nothing to generate.`);
  }

  console.log(`[tripo]   generating object for "${memory.id}" ("${memory.objectPrompt}")…`);
  const created = await tripoFetch(`${base}/task`, {
    method: "POST",
    body: JSON.stringify({ type: "text_to_model", prompt: memory.objectPrompt }),
  });
  const taskId = created.data?.task_id;
  if (!taskId) {
    console.log("[tripo]   create-task response (raw):", JSON.stringify(created).slice(0, 600));
    throw new Error("Could not find a task_id in the TRIPO create-task response (see raw above).");
  }

  const start = Date.now();
  let data;
  let logged = false;
  while (Date.now() - start < timeoutMs) {
    const poll = await tripoFetch(`${base}/task/${taskId}`);
    data = poll.data ?? {};
    if (!logged) {
      console.log("[tripo]   first task poll (raw):", JSON.stringify(data).slice(0, 600));
      logged = true;
    }
    if (data.status === "success") break;
    if (["failed", "cancelled", "banned", "expired"].includes(data.status)) {
      throw new Error(`TRIPO task ${data.status} for memory "${memory.id}".`);
    }
    const secs = ((Date.now() - start) / 1000).toFixed(0);
    console.log(`[tripo]     …${data.status ?? "queued"} (${secs}s elapsed)`);
    await sleep(pollMs);
  }
  if (data?.status !== "success") {
    throw new Error(`TRIPO generation timed out for memory "${memory.id}".`);
  }

  const modelUrl = extractModelUrl(data.output);
  if (!modelUrl) {
    console.log("[tripo]   completed task output (raw):", JSON.stringify(data.output).slice(0, 600));
    throw new Error(`No model URL found in TRIPO output for memory "${memory.id}" (see raw above).`);
  }

  await fs.mkdir(outDir, { recursive: true });
  const dest = path.join(outDir, `${memory.id}.glb`);
  await download(modelUrl, dest);
  console.log(`[tripo]   ✓ "${memory.id}" object cached.`);
  return { modelUrl: `${appRelDir}/${memory.id}.glb` };
}

function extractModelUrl(output) {
  if (!output) return null;
  return output.pbr_model ?? output.model ?? output.base_model ?? null;
}

async function download(url, dest) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed (${res.status}) for ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await fs.writeFile(dest, buf);
  console.log(`[tripo]     downloaded ${(buf.byteLength / 1e6).toFixed(1)}MB -> ${dest}`);
}
