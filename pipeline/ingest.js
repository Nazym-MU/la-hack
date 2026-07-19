import { promises as fs } from "node:fs";
import path from "node:path";

// Read an upload folder into a flat list of items the agent can reason over.
// Content-agnostic: any folder works, no filenames are special-cased.
//
// item = { kind: "text" | "image", name, relPath, text? , base64?, mediaType? }

const TEXT_EXTS = new Set([".txt", ".md", ".markdown", ".text", ".rtf", ".csv", ".json"]);
const IMAGE_EXTS = new Map([
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".png", "image/png"],
  [".webp", "image/webp"],
  [".gif", "image/gif"],
]);

// Claude/Gemini vision limits: skip images that are too large to send cheaply.
const MAX_IMAGE_BYTES = 4.5 * 1024 * 1024;
const MAX_TEXT_CHARS = 8000;

export async function ingestFolder(root) {
  const abs = path.resolve(root);
  const stat = await fs.stat(abs).catch(() => null);
  if (!stat || !stat.isDirectory()) {
    throw new Error(`Upload folder not found or not a directory: ${abs}`);
  }

  const items = [];
  await walk(abs, abs, items);
  items.sort((a, b) => a.relPath.localeCompare(b.relPath));
  return { root: abs, items };
}

async function walk(dir, root, out) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue; // skip dotfiles / .DS_Store
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(full, root, out);
      continue;
    }
    const ext = path.extname(entry.name).toLowerCase();
    const relPath = path.relative(root, full);

    if (TEXT_EXTS.has(ext)) {
      let text = await fs.readFile(full, "utf8").catch(() => "");
      text = text.trim();
      if (!text) continue;
      if (text.length > MAX_TEXT_CHARS) text = text.slice(0, MAX_TEXT_CHARS) + "\n…[truncated]";
      out.push({ kind: "text", name: entry.name, relPath, text });
    } else if (IMAGE_EXTS.has(ext)) {
      const buf = await fs.readFile(full).catch(() => null);
      if (!buf) continue;
      if (buf.byteLength > MAX_IMAGE_BYTES) {
        console.warn(`[ingest] skipping large image (${(buf.byteLength / 1e6).toFixed(1)}MB): ${relPath}`);
        continue;
      }
      out.push({
        kind: "image",
        name: entry.name,
        relPath,
        base64: buf.toString("base64"),
        mediaType: IMAGE_EXTS.get(ext),
      });
    }
    // Everything else (video, audio, unknown) is ignored for now.
  }
}

// A compact text digest of all items, used as the user turn for the agent.
// Images are referenced by filename; their pixels are attached separately as
// vision blocks (see llm.js) so the model can see them and cite sourceRef.
export function digestItems(items) {
  const lines = [];
  lines.push(`The folder contains ${items.length} item(s):\n`);
  for (const it of items) {
    if (it.kind === "text") {
      lines.push(`--- TEXT FILE: ${it.relPath} ---\n${it.text}\n`);
    } else {
      lines.push(`--- IMAGE FILE: ${it.relPath} --- (see attached image, cite this filename as sourceRef)\n`);
    }
  }
  return lines.join("\n");
}
