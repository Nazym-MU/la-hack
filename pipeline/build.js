import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ingestFolder } from "./ingest.js";
import { runAgent } from "./llm.js";
import { assignLayout } from "./layout.js";
import { generateRoomWorld } from "./marble.js";

// Orchestrator: upload folder -> agent -> layout -> (optional) Marble worlds ->
// public/palace-schema.json + cached assets under public/palaces/<name>/.
//
// Usage:
//   node build.js <folder> [--generate] [--provider claude|gemini|mock]
//                          [--name <slug>] [--out <dir>]
//
//   (no flags)   ingest + agent + layout, write schema. Rooms keep the bundled
//                stand-in world (splatUrl undefined) — build/test everything
//                before spending Marble credits.
//   --generate   also call Marble per room, download splats, wire splatUrls.
//                Idempotent: a room whose world.spz already exists is skipped.

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
  const name = slug(args.opts.name || path.basename(path.resolve(args.folder)) || "palace");
  const palaceDir = args.opts.out ? path.resolve(args.opts.out) : path.join(publicDir, "palaces", name);
  const appRelBase = `./palaces/${name}`;

  console.log(`\n■ Mind Palace pipeline`);
  console.log(`  folder:   ${path.resolve(args.folder)}`);
  console.log(`  provider: ${provider}`);
  console.log(`  generate: ${doGenerate ? "YES (Marble worlds)" : "no (schema only, stand-in world)"}`);
  console.log(`  output:   ${palaceDir}\n`);

  // 1. Ingest
  const { items } = await ingestFolder(args.folder);
  console.log(`[ingest] ${items.length} item(s): ` + items.map((i) => i.name).join(", "));
  if (!items.length) throw new Error("No usable items (text/images) found in the folder.");

  // 2. Agent -> draft (rooms + marble prompts + placements + rationales)
  console.log(`[agent] clustering + writing Marble prompts via ${provider}…`);
  const draft = await runAgent({ items, config, provider });
  console.log(`[agent] ${draft.rooms.length} room(s): ` + draft.rooms.map((r) => r.title).join(" | "));

  // 3. Layout -> spatial origins
  assignLayout(draft, config);

  // 4. (optional) Marble generation, cached + idempotent
  if (doGenerate) {
    // Streaming (default): splatUrls point at World Labs' CDN, nothing stored
    // locally. --download caches assets under public/ instead.
    const stream = !args.flags.has("download");
    const maxRooms = args.opts["max-rooms"] ? parseInt(args.opts["max-rooms"], 10) : Infinity;
    let generatedCount = 0;
    for (const room of draft.rooms) {
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
      try {
        const res = await generateRoomWorld({ room, config, outDir, appRelDir, stream });
        room.worldId = res.worldId;
        room.splatUrl = res.splatUrl;
        room.colliderUrl = res.colliderUrl;
      } catch (err) {
        console.error(`[marble] room "${room.id}" failed — leaving stand-in world. ${err.message}`);
      }
    }
  }

  // 5. Emit schema — a copy in the palace folder, and the active one the viewer loads.
  const palace = {
    title: draft.title,
    generatedAt: new Date().toISOString(),
    sourceFolder: path.resolve(args.folder),
    agent: draft.agent,
    rooms: draft.rooms,
  };
  await fs.mkdir(palaceDir, { recursive: true });
  const pretty = JSON.stringify(palace, null, 2);
  await fs.writeFile(path.join(palaceDir, "palace-schema.json"), pretty);
  await fs.writeFile(path.join(publicDir, "palace-schema.json"), pretty);

  console.log(`\n✓ Wrote palace-schema.json (${draft.rooms.length} rooms, ` +
    `${draft.rooms.reduce((n, r) => n + r.memories.length, 0)} memories).`);
  console.log(`  active:  ${path.join(publicDir, "palace-schema.json")}`);
  if (!doGenerate) console.log(`  worlds:  stand-in (run with --generate to create Marble worlds).`);
  console.log("");
}

const exists = (p) => fs.access(p).then(() => true).catch(() => false);
const slug = (s) =>
  String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "palace";

main().catch((err) => {
  console.error("\n✗ pipeline failed:", err.message);
  process.exit(1);
});
