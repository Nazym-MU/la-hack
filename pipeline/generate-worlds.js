import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateRoomWorld } from "./marble.js";

// Generate Marble worlds for an EXISTING palace-schema.json, without re-running
// the agent. By default it fills in only the rooms that don't have a world yet
// (idempotent pre-generation), streaming from the CDN and writing the URLs back
// into the schema. Room 1 (already generated) is left untouched.
//
// Usage:
//   node --env-file=../.env generate-worlds.js [schemaPath] [--all] [--download]
//   --all       regenerate every room, even ones that already have a world
//   --download  cache splats under public/ instead of streaming from the CDN

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
const publicDir = path.join(repoRoot, "public");

async function main() {
  const args = process.argv.slice(2);
  const flags = new Set(args.filter((a) => a.startsWith("--")));
  const schemaPath = path.resolve(args.find((a) => !a.startsWith("--")) || path.join(publicDir, "palace-schema.json"));
  const stream = !flags.has("--download");
  const all = flags.has("--all");

  const config = JSON.parse(await fs.readFile(path.join(here, "config.json"), "utf8"));
  const palace = JSON.parse(await fs.readFile(schemaPath, "utf8"));
  const isRealWorld = (r) => r.splatUrl && r.splatUrl.startsWith("http");

  console.log(`■ generate-worlds  (${stream ? "stream" : "download"})  ${schemaPath}`);
  for (const [i, room] of palace.rooms.entries()) {
    if (!all && isRealWorld(room)) {
      console.log(`  room ${i + 1} "${room.title}" already has a world — skipping.`);
      continue;
    }
    if (!room.marblePrompt) {
      console.log(`  room ${i + 1} "${room.title}" has no marblePrompt — skipping.`);
      continue;
    }
    const outDir = path.join(publicDir, "palaces", "worlds", room.id);
    const appRelDir = `./palaces/worlds/${room.id}`;
    try {
      const res = await generateRoomWorld({ room, config, outDir, appRelDir, stream });
      room.worldId = res.worldId;
      room.splatUrl = res.splatUrl;
      room.splatUrlLow = res.splatUrlLow;
      room.colliderUrl = res.colliderUrl;
      // Persist after each room so a mid-run failure still keeps finished worlds.
      await fs.writeFile(schemaPath, JSON.stringify(palace, null, 2));
      console.log(`  ✓ room ${i + 1} "${room.title}" done.`);
    } catch (err) {
      console.error(`  ✗ room ${i + 1} "${room.title}" failed: ${err.message}`);
    }
  }
  console.log("done.");
}

main().catch((err) => {
  console.error("generate-worlds failed:", err.message);
  process.exit(1);
});
