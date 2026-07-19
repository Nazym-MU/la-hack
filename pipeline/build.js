import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ingestFolder } from "./ingest.js";
import { runAgent } from "./llm.js";
import { assignLayout } from "./layout.js";
import { generateRoomWorld } from "./marble.js";
import { generateMemoryObject } from "./tripo.js";

// Orchestrator: upload folder -> agent -> layout -> (optional) Marble worlds +
// TRIPO objects -> public/palace-schema.json + cached assets under
// public/palaces/<name>/.
//
// There is exactly one palace ("demo") that every upload adds to — the agent
// sees what rooms already exist and decides per new cluster whether it
// extends one of them (new memories appended, no new Marble world) or is a
// genuinely new entity (a new room, generated fresh). See taskInstruction()
// in llm.js and the split-by-existingRoomId step below.
//
// Usage:
//   node build.js <folder> [--generate] [--provider claude|gemini|mock]
//                          [--name <slug>] [--out <dir>] [--max-rooms N]
//                          [--max-objects N]
//
//   (no flags)   ingest + agent + layout, write schema. Rooms keep the bundled
//                stand-in world (splatUrl undefined) and memories stay
//                placeholder orbs — build/test everything before spending
//                Marble/TRIPO credits.
//   --generate   also call Marble per NEW room (download splats, wire
//                splatUrls) AND TRIPO per memory lacking a modelUrl (download
//                a GLB, wire modelUrl). Both idempotent: a room whose
//                world.spz already exists, or a memory whose GLB already
//                exists, is skipped. Rooms are ALWAYS built from the curated
//                marblePrompt text — never a literal reconstruction of an
//                uploaded photo (see note on sourcePhoto below).
//   --name       override the "demo" identity — for local test runs against
//                a scratch palace without touching the real one.

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
const publicDir = path.join(repoRoot, "public");

function parseArgs(argv) {
  const args = { flags: new Set(), opts: {} };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--generate") args.flags.add("generate");
    else if (a.startsWith("--")) args.opts[a.slice(2)] = argv[++i];
    else positional.push(a);
  }
  args.folder = positional[0];
  return args;
}

async function loadConfig() {
  const raw = await fs.readFile(path.join(here, "config.json"), "utf8");
  return JSON.parse(raw);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.folder) {
    console.error(
      "Usage: node build.js <upload-folder> [--generate] [--provider claude|gemini|mock] [--name <slug>]",
    );
    process.exit(1);
  }

  const config = await loadConfig();
  const provider = args.opts.provider || config.provider;
  const doGenerate = args.flags.has("generate");
  // One palace, always — "demo" unless --name overrides it for a scratch test.
  const name = slug(args.opts.name || "demo");
  const palaceDir = args.opts.out ? path.resolve(args.opts.out) : path.join(publicDir, "palaces", name);
  const appRelBase = `./palaces/${name}`;
  const schemaPath = path.join(palaceDir, "palace-schema.json");

  const existing = (await exists(schemaPath))
    ? JSON.parse(await fs.readFile(schemaPath, "utf8"))
    : null;

  console.log(`\n■ Mind Palace pipeline`);
  console.log(`  folder:   ${path.resolve(args.folder)}`);
  console.log(`  palace:   ${name}${existing ? ` (existing, ${existing.rooms.length} room(s))` : " (new)"}`);
  console.log(`  provider: ${provider}`);
  console.log(`  generate: ${doGenerate ? "YES (Marble worlds + TRIPO objects)" : "no (schema only, stand-in world)"}`);
  console.log(`  output:   ${palaceDir}\n`);

  // 1. Ingest
  const { items } = await ingestFolder(args.folder);
  console.log(`[ingest] ${items.length} item(s): ` + items.map((i) => i.name).join(", "));
  if (!items.length) throw new Error("No usable items (text/images) found in the folder.");

  // 2. Agent -> draft (rooms + marble prompts + placements + rationales) for
  // THIS batch. It's told which rooms already exist so it can extend one
  // instead of duplicating it — see existingRoomId below.
  const existingRoomsSummary = (existing?.rooms ?? []).map((r) => ({ id: r.id, title: r.title, theme: r.theme }));
  console.log(`[agent] clustering + writing Marble prompts via ${provider}…`);
  const draft = await runAgent({ items, config, provider, existingRooms: existingRoomsSummary });
  console.log(`[agent] ${draft.rooms.length} cluster(s) from this batch: ` + draft.rooms.map((r) => r.title).join(" | "));

  // 2b. Split the draft: each cluster either extends an existing room (new
  // memories appended there, no new Marble world) or is a genuinely new one.
  // A non-empty existingRoomId that doesn't match anything real is treated as
  // new rather than trusted blindly.
  const existingById = new Map((existing?.rooms ?? []).map((r) => [r.id, r]));
  const maxMem = config.maxMemoriesPerRoom ?? 6;
  const newRoomsFromDraft = [];
  for (const room of draft.rooms) {
    const target = room.existingRoomId && existingById.get(room.existingRoomId);
    if (!target) {
      newRoomsFromDraft.push(room);
      continue;
    }
    const seenMemIds = new Set(target.memories.map((m) => m.id));
    for (const m of room.memories) {
      let mid = m.id;
      while (seenMemIds.has(mid)) mid = `${mid}-2`;
      seenMemIds.add(mid);
      target.memories.push({ ...m, id: mid });
    }
    if (target.memories.length > maxMem) target.memories = target.memories.slice(0, maxMem);
    console.log(`[agent]   "${room.title}" -> extends existing room "${target.id}" (+${room.memories.length} memories)`);
  }

  // Dedupe new room ids against everything that already exists. The
  // first-ever title sticks — a palace's name shouldn't change every time you
  // add a memory to it.
  const existingRoomIds = new Set(existingById.keys());
  for (const room of newRoomsFromDraft) {
    while (existingRoomIds.has(room.id)) room.id = `${room.id}-2`;
    existingRoomIds.add(room.id);
  }
  const newRoomIds = new Set(newRoomsFromDraft.map((r) => r.id));
  const mergedTitle = existing?.title || draft.title;
  const mergedRooms = [...(existing?.rooms ?? []), ...newRoomsFromDraft];

  // 3. Layout -> spatial origins for the FULL merged set. Pure function of
  // array index/order, so already-placed rooms keep their existing origin
  // (order is preserved: existing rooms first, new ones appended after) and
  // only the new rooms get a fresh spot.
  const merged = { title: mergedTitle, rooms: mergedRooms };
  assignLayout(merged, config);

  // 4. (optional) Marble generation, cached + idempotent — only for rooms new
  // in THIS batch; already-merged rooms keep whatever splatUrl they had.
  let objectsGenerated = 0;
  if (doGenerate) {
    // Streaming (default): splatUrls point at World Labs' CDN, nothing stored
    // locally. --download caches assets under public/ instead.
    const stream = !args.flags.has("download");
    const maxRooms = args.opts["max-rooms"] ? parseInt(args.opts["max-rooms"], 10) : Infinity;
    let generatedCount = 0;
    for (const room of merged.rooms) {
      if (!newRoomIds.has(room.id)) continue; // already generated in a prior batch
      if (generatedCount >= maxRooms) {
        console.log(`[marble] --max-rooms ${maxRooms} reached — room "${room.id}" keeps the stand-in world.`);
        continue;
      }
      generatedCount++;
      const outDir = path.join(palaceDir, `room-${room.id}`);
      const appRelDir = `${appRelBase}/room-${room.id}`;

      // Download-mode idempotency: reuse an already-downloaded splat.
      if (!stream && (await exists(path.join(outDir, "world.spz")))) {
        console.log(`[marble] room "${room.id}" already cached — skipping.`);
        room.splatUrl = `${appRelDir}/world.spz`;
        if (await exists(path.join(outDir, "collider.glb"))) room.colliderUrl = `${appRelDir}/collider.glb`;
        continue;
      }
      // Rooms are always built from the curated marblePrompt text, never a
      // literal reconstruction of an uploaded photo — a room is a curated
      // mind-space, not a photo scan of the real place (see the "Mind-Space
      // Aesthetic" section of prompts/marble-guidance.md). room.sourcePhoto
      // is intentionally never resolved to an image-to-world call here.
      // (image-to-world stays implemented in marble.js, just not wired here.)
      try {
        const res = await generateRoomWorld({ room, config, outDir, appRelDir, stream });
        room.worldId = res.worldId;
        room.splatUrl = res.splatUrl;
        room.splatUrlLow = res.splatUrlLow;
        room.colliderUrl = res.colliderUrl;
      } catch (err) {
        console.error(`[marble] room "${room.id}" failed — leaving stand-in world. ${err.message}`);
      }
    }

    // 4b. TRIPO objects — every memory across the WHOLE merged palace (new
    // rooms and memories freshly appended to existing rooms alike) that has
    // an objectPrompt but no modelUrl yet gets a real GLB generated, up to
    // maxObjectsPerRoom per room (existing rooms get topped up toward the cap,
    // not re-capped from zero). Cached + idempotent: a memory whose GLB
    // already exists on disk is skipped. --max-objects is an extra ceiling on
    // the whole run, on top of the per-room cap.
    const maxObjects = args.opts["max-objects"] ? parseInt(args.opts["max-objects"], 10) : Infinity;
    const maxPerRoom = config.tripo?.maxObjectsPerRoom ?? 4;
    for (const room of merged.rooms) {
      const outDir = path.join(palaceDir, `room-${room.id}`, "objects");
      const appRelDir = `${appRelBase}/room-${room.id}/objects`;
      let roomObjectCount = room.memories.filter((m) => m.modelUrl).length;
      for (const memory of room.memories) {
        if (memory.modelUrl || !memory.objectPrompt) continue;
        const cached = path.join(outDir, `${memory.id}.glb`);
        if (await exists(cached)) {
          memory.modelUrl = `${appRelDir}/${memory.id}.glb`;
          roomObjectCount++;
          continue;
        }
        if (roomObjectCount >= maxPerRoom) {
          console.log(`[tripo] room "${room.id}" already has ${maxPerRoom} objects — "${memory.id}" stays a placeholder orb.`);
          continue;
        }
        if (objectsGenerated >= maxObjects) {
          console.log(`[tripo] --max-objects ${maxObjects} reached — "${memory.id}" stays a placeholder orb.`);
          continue;
        }
        objectsGenerated++;
        try {
          const res = await generateMemoryObject({ memory, config, outDir, appRelDir });
          memory.modelUrl = res.modelUrl;
          roomObjectCount++;
        } catch (err) {
          console.error(`[tripo] memory "${memory.id}" failed — leaving placeholder orb. ${err.message}`);
        }
      }
    }
  }

  // 5. Emit schema — both the palace's own file and the bare active URL the
  // viewer loads with no query param (see PALACE_SCHEMA_URL in
  // src/palace.ts). Same file when name is "demo" (the normal case); a
  // --name override for a scratch test intentionally does NOT touch the real
  // active palace.
  const palace = {
    title: merged.title,
    generatedAt: new Date().toISOString(),
    sourceFolder: path.resolve(args.folder),
    agent: draft.agent,
    rooms: merged.rooms,
  };
  await fs.mkdir(palaceDir, { recursive: true });
  const pretty = JSON.stringify(palace, null, 2);
  await fs.writeFile(schemaPath, pretty);
  if (name === "demo") {
    await fs.writeFile(path.join(publicDir, "palace-schema.json"), pretty);
  }

  console.log(`\n✓ Wrote palace-schema.json (${merged.rooms.length} room(s) total, ` +
    `${merged.rooms.reduce((n, r) => n + r.memories.length, 0)} memories).`);
  console.log(`  palace:  ${name}  (${schemaPath})`);
  if (!doGenerate) {
    console.log(`  worlds:  stand-in (run with --generate to create Marble worlds + TRIPO objects).`);
  } else {
    console.log(`  objects: ${objectsGenerated} generated this run.`);
  }
  console.log("");
}

const exists = (p) => fs.access(p).then(() => true).catch(() => false);
const slug = (s) =>
  String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "palace";

main().catch((err) => {
  console.error("\n✗ pipeline failed:", err.message);
  process.exit(1);
});
