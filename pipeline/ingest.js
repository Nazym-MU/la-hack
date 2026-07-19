import { promises as fs } from "node:fs";
import path from "node:path";
import sharp from "sharp";

// Read an upload folder into a flat list of items the agent can reason over.
// Content-agnostic: any folder works, no filenames are special-cased.
//
// item = { kind: "text" | "image", name, relPath, text? , base64?, mediaType? }

const TEXT_EXTS = new Set([".txt", ".md", ".markdown", ".text", ".rtf", ".csv", ".json"]);
const IMAGE_EXTS = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif"]);

// Every image is downscaled + recompressed before it's sent to any vision
// model. This keeps per-image size predictable (a few hundred KB) regardless
// of source phone-camera resolution, which matters most for providers like
// Groq that reject the whole request (413) once the combined base64 payload
// of several full-res photos crosses their body-size limit.
const MAX_IMAGE_DIM = 1568; // long edge in px; matches Claude's own vision cap
const IMAGE_JPEG_QUALITY = 82;
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
      let resized;
      try {
        resized = await sharp(buf)
          .rotate() // respect EXIF orientation before dropping the metadata
          .resize({ width: MAX_IMAGE_DIM, height: MAX_IMAGE_DIM, fit: "inside", withoutEnlargement: true })
          .jpeg({ quality: IMAGE_JPEG_QUALITY })
          .toBuffer();
      } catch (err) {
        console.warn(`[ingest] skipping unreadable image: ${relPath} (${err.message})`);
        continue;
      }
      out.push({
        kind: "image",
        name: entry.name,
        relPath,
        base64: resized.toString("base64"),
        mediaType: "image/jpeg",
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
