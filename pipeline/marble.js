import { promises as fs } from "node:fs";
import path from "node:path";

// World Labs Marble client. Generates a world from a text prompt, polls to
// completion, and downloads the Gaussian-splat (.spz) + collider mesh (.glb)
// into public/ so the viewer loads them locally (demo-safe, no live CDN call).
//
// API shape (docs.worldlabs.ai/api):
//   POST {base}/marble/v1/worlds:generate  -> { operation_id / name, done }
//   GET  {base}/marble/v1/operations/{id}  -> poll until { done: true }
//   GET  {base}/marble/v1/worlds/{worldId} -> assets.splats.spz_urls, assets.mesh.collider_mesh_url
// Header: WLT-Api-Key. Exact field names aren't fully pinned in the public
// docs, so extraction is defensive and logs raw responses on first contact.

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function apiKey() {
  const k = process.env.WORLDLABS_API_KEY || process.env.WLT_API_KEY;
  if (!k) {
    throw new Error(
      "WORLDLABS_API_KEY is not set. Put it in .env (root or pipeline/). " +
        "Run without --generate to build the schema against the bundled stand-in world instead.",
    );
  }
  return k;
}

async function wlFetch(url, opts = {}) {
  const res = await fetch(url, {
    ...opts,
    headers: {
      "WLT-Api-Key": apiKey(),
      "Content-Type": "application/json",
      ...(opts.headers || {}),
    },
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { _raw: text };
  }
  if (!res.ok) {
    throw new Error(`Marble ${res.status} on ${url}: ${JSON.stringify(json).slice(0, 400)}`);
  }
  return json;
}

// Generate one world, poll, resolve assets. Returns { worldId, splatUrl,
// colliderUrl }. In stream mode (default) the URLs point straight at World
// Labs' public CDN (nothing stored locally — the browser/headset fetches them;
// CORS is open). With stream:false the assets are downloaded into public/ and
// the URLs are app-relative (e.g. "./palaces/<name>/room-<id>/world.spz").
export async function generateRoomWorld({ room, config, outDir, appRelDir, stream = true }) {
  const base = config.marble?.apiBase ?? "https://api.worldlabs.ai";
  const model = config.marble?.model ?? "marble-1.1";
  const pollMs = (config.marble?.pollIntervalSeconds ?? 15) * 1000;
  const timeoutMs = (config.marble?.timeoutMinutes ?? 12) * 60_000;

  console.log(`[marble] generating world for room "${room.id}" (${model})…`);
  const gen = await wlFetch(`${base}/marble/v1/worlds:generate`, {
    method: "POST",
    body: JSON.stringify({
      display_name: room.title || room.id,
      model,
      world_prompt: { type: "text", text_prompt: room.marblePrompt },
    }),
  });

  const opId = gen.operation_id || gen.name || gen.id || gen.operation?.id;
  if (!opId) {
    console.log("[marble] generate response (raw):", JSON.stringify(gen).slice(0, 600));
    throw new Error("Could not find an operation id in the Marble generate response (see raw above).");
  }

  // Poll the long-running operation.
  const start = Date.now();
  let op;
  let logged = false;
  while (Date.now() - start < timeoutMs) {
    op = await wlFetch(`${base}/marble/v1/operations/${encodeURIComponent(opId)}`);
    if (!logged) {
      console.log("[marble] first operation poll (raw):", JSON.stringify(op).slice(0, 600));
      logged = true;
    }
    if (op.done || op.status === "SUCCEEDED" || op.status === "done") break;
    if (op.error) throw new Error(`Marble operation failed: ${JSON.stringify(op.error).slice(0, 300)}`);
    const mins = ((Date.now() - start) / 60000).toFixed(1);
    console.log(`[marble]   …still cooking (${mins} min elapsed)`);
    await sleep(pollMs);
  }
  if (!(op && (op.done || op.status === "SUCCEEDED" || op.status === "done"))) {
    throw new Error(`Marble generation timed out after ${config.marble?.timeoutMinutes ?? 12} min.`);
  }

  // Find the world id from the operation result, then fetch the world assets.
  const world = op.response || op.result || op.world || {};
  const worldId =
    world.world_id ||
    world.id ||
    op.world_id ||
    op.metadata?.world_id ||
    (typeof op.response === "string" ? op.response : null);
  if (!worldId) {
    console.log("[marble] completed operation (raw):", JSON.stringify(op).slice(0, 800));
    throw new Error("Could not find world id in the completed operation (see raw above).");
  }

  const worldData = await wlFetch(`${base}/marble/v1/worlds/${encodeURIComponent(worldId)}`);
  const assets = worldData.assets || worldData.response?.assets || {};
  const spzUrl = pickSpz(assets, config.marble?.splatResolution ?? "500k");
  const colliderRemote = assets.mesh?.collider_mesh_url || assets.mesh?.colliderMeshUrl || null;
  if (!spzUrl) {
    console.log("[marble] world assets (raw):", JSON.stringify(assets).slice(0, 800));
    throw new Error("No splat (.spz) URL found in world assets (see raw above).");
  }

  // Stream mode: hand the viewer the CDN URLs directly, store nothing locally.
  if (stream) {
    console.log(`[marble] ✓ room "${room.id}" world ${worldId} (streaming from CDN).`);
    return { worldId, splatUrl: spzUrl, colliderUrl: colliderRemote ?? undefined };
  }

  // Download mode: cache the assets under public/ for offline/CDN-hosting.
  await fs.mkdir(outDir, { recursive: true });
  await download(spzUrl, path.join(outDir, "world.spz"));
  let colliderRel;
  if (colliderRemote) {
    await download(colliderRemote, path.join(outDir, "collider.glb"));
    colliderRel = `${appRelDir}/collider.glb`;
  }
  console.log(`[marble] ✓ room "${room.id}" world ${worldId} cached.`);
  return { worldId, splatUrl: `${appRelDir}/world.spz`, colliderUrl: colliderRel };
}

// spz_urls may be an array (100k, 500k, full) or an object keyed by resolution.
function pickSpz(assets, preferred) {
  const s = assets.splats?.spz_urls ?? assets.splats?.spzUrls ?? assets.splats;
  if (!s) return null;
  if (Array.isArray(s)) {
    // Heuristic: middle entry ~ 500k; last ~ full res.
    if (preferred === "full") return s[s.length - 1];
    if (preferred === "100k") return s[0];
    return s[Math.min(1, s.length - 1)] ?? s[0];
  }
  if (typeof s === "object") {
    return (
      s[preferred] || s["500k"] || s["full_res"] || s["150k"] || s["100k"] || Object.values(s)[0] || null
    );
  }
  return typeof s === "string" ? s : null;
}

async function download(url, dest) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed (${res.status}) for ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await fs.writeFile(dest, buf);
  console.log(`[marble]   downloaded ${(buf.byteLength / 1e6).toFixed(1)}MB -> ${dest}`);
}
