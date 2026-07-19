import express from "express";
import cors from "cors";
import { spawn } from "node:child_process";
import { promises as fsp } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Holds the TRIPO API key server-side so it never reaches the browser.
// Put it in server/.env (see .env.example) — the dev script loads it via
// node --env-file-if-exists — or export TRIPO_API_KEY before running.
const TRIPO_API_KEY = process.env.TRIPO_API_KEY;
const TRIPO_ROOT = "https://api.tripo3d.ai/v2/openapi";
const TRIPO_TASK = `${TRIPO_ROOT}/task`;

if (!TRIPO_API_KEY) {
  console.warn(
    "[server] TRIPO_API_KEY is not set. Paste it into server/.env:\n" +
      "  TRIPO_API_KEY=your_key_here",
  );
}

const app = express();
app.use(cors());
// Large limit: the client may send base64 photos (single TRIPO object, or a
// whole folder for the build-palace flow).
app.use(express.json({ limit: "60mb" }));

// POST { prompt, imageDataUrl? } -> kicks off a TRIPO task, returns { taskId }.
//  - prompt only          -> text_to_model
//  - imageDataUrl present -> uploads the image, then image_to_model
// The client then polls GET /api/generate-object/:taskId.
app.post("/api/generate-object", async (req, res) => {
  const { prompt, imageDataUrl } = req.body ?? {};
  if (!imageDataUrl && (!prompt || typeof prompt !== "string")) {
    return res
      .status(400)
      .json({ error: "Provide a 'prompt' string and/or an 'imageDataUrl'." });
  }

  try {
    let taskBody;
    if (imageDataUrl) {
      const { token, type } = await uploadImage(imageDataUrl);
      taskBody = { type: "image_to_model", file: { type, file_token: token } };
    } else {
      taskBody = { type: "text_to_model", prompt };
    }

    const response = await fetch(TRIPO_TASK, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${TRIPO_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(taskBody),
    });
    const json = await response.json();
    if (!response.ok) {
      console.error("[server] TRIPO create-task error:", json);
      return res
        .status(502)
        .json({ error: "TRIPO task creation failed.", detail: json });
    }
    res.json({ taskId: json.data?.task_id });
  } catch (err) {
    console.error("[server] TRIPO create-task exception:", err);
    res.status(500).json({ error: String(err.message ?? err) });
  }
});

// data URL -> TRIPO upload endpoint -> image token for image_to_model.
async function uploadImage(dataUrl) {
  const match = /^data:image\/(\w+);base64,(.+)$/.exec(dataUrl);
  if (!match) throw new Error("imageDataUrl must be a base64 image data URL");
  const [, ext, b64] = match;
  const type = ext === "jpeg" ? "jpg" : ext;

  const form = new FormData();
  form.append(
    "file",
    new Blob([Buffer.from(b64, "base64")], { type: `image/${ext}` }),
    `memory.${type}`,
  );

  const response = await fetch(`${TRIPO_ROOT}/upload`, {
    method: "POST",
    headers: { Authorization: `Bearer ${TRIPO_API_KEY}` },
    body: form,
  });
  const json = await response.json();
  console.log("[server] TRIPO upload response:", JSON.stringify(json));
  const token = json.data?.image_token;
  if (!response.ok || !token) {
    throw new Error(`TRIPO image upload failed: ${JSON.stringify(json)}`);
  }
  return { token, type };
}

// GET :taskId -> single-shot status check (client re-polls this on an
// interval; the server does not hold a long poll open).
// Response schema note: TRIPO's `data.output` field names for the GLB URL
// were not confirmed from docs at build time. This route logs the FULL raw
// response the first time you hit it against a real task, so check the
// server console and adjust `extractModelUrl` below if the field differs.
app.get("/api/generate-object/:taskId", async (req, res) => {
  try {
    const response = await fetch(`${TRIPO_TASK}/${req.params.taskId}`, {
      headers: { Authorization: `Bearer ${TRIPO_API_KEY}` },
    });
    const json = await response.json();
    if (!response.ok) {
      return res
        .status(502)
        .json({ error: "TRIPO status check failed.", detail: json });
    }

    const data = json.data ?? {};
    console.log(
      `[server] task ${req.params.taskId} status=${data.status} progress=${data.progress}`,
      data.output ?? "",
    );

    res.json({
      status: data.status, // e.g. "queued" | "running" | "success" | "failed"
      progress: data.progress ?? null,
      modelUrl: data.status === "success" ? extractModelUrl(data.output) : null,
      raw: data.output ?? null,
    });
  } catch (err) {
    console.error("[server] TRIPO status exception:", err);
    res.status(500).json({ error: "Failed to reach TRIPO." });
  }
});

// GET /api/model?url=... -> streams a generated GLB through this server so
// GLTFLoader never depends on TRIPO's CDN CORS headers. https-only.
app.get("/api/model", async (req, res) => {
  const url = req.query.url;
  if (typeof url !== "string" || !url.startsWith("https://")) {
    return res.status(400).json({ error: "Provide an https 'url' query param." });
  }
  try {
    const upstream = await fetch(url);
    if (!upstream.ok) {
      return res.status(502).json({ error: `Upstream ${upstream.status}` });
    }
    res.set(
      "Content-Type",
      upstream.headers.get("content-type") ?? "model/gltf-binary",
    );
    res.send(Buffer.from(await upstream.arrayBuffer()));
  } catch (err) {
    console.error("[server] model proxy exception:", err);
    res.status(500).json({ error: "Failed to fetch model." });
  }
});

function extractModelUrl(output) {
  if (!output) return null;
  return output.pbr_model ?? output.model ?? output.base_model ?? null;
}

// -------------------------------------------------------------------
// Build-a-palace from browser uploads: save files -> spawn the offline
// pipeline (build.js) -> stream its progress over SSE. The generated
// palace-schema.json lands in public/, and the viewer reloads to walk it.
// -------------------------------------------------------------------
const pipelineDir = path.resolve(__dirname, "../pipeline");
const rootEnv = path.resolve(__dirname, "../.env");
const uploadsBase = path.resolve(__dirname, ".uploads");
const jobs = new Map();

app.post("/api/build-palace", async (req, res) => {
  const { files, notes, provider } = req.body ?? {};
  if ((!Array.isArray(files) || files.length === 0) && !(notes && notes.trim())) {
    return res.status(400).json({ error: "Provide at least one photo or some notes." });
  }
  try {
    const jobId = randomUUID();
    const jobDir = path.join(uploadsBase, jobId);
    await fsp.mkdir(jobDir, { recursive: true });

    let n = 0;
    for (const f of files ?? []) {
      const m = /^data:image\/(\w+);base64,(.+)$/.exec(f.dataUrl || "");
      if (!m) continue;
      n++;
      const ext = m[1] === "jpeg" ? "jpg" : m[1];
      const base = path.basename(f.name || `photo-${n}`).replace(/[^\w.\-]+/g, "_") || `photo-${n}.${ext}`;
      await fsp.writeFile(path.join(jobDir, base), Buffer.from(m[2], "base64"));
    }
    if (notes && typeof notes === "string" && notes.trim()) {
      await fsp.writeFile(path.join(jobDir, "notes.txt"), notes.trim());
    }

    const job = { log: [], finished: false, ok: false, cancelled: false, child: null };
    jobs.set(jobId, job);

    const child = spawn(
      process.execPath,
      [`--env-file-if-exists=${rootEnv}`, "build.js", jobDir, "--provider", provider || "gemini", "--generate"],
      { cwd: pipelineDir, env: process.env },
    );
    job.child = child;
    const onData = (buf) => {
      for (const line of buf.toString().split(/\r?\n/)) if (line.trim()) job.log.push(line);
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.on("close", (code) => {
      if (job.cancelled) return; // cancel endpoint already finalized this job
      job.finished = true;
      job.ok = code === 0;
    });
    child.on("error", (err) => {
      if (job.cancelled) return;
      job.log.push("spawn error: " + err.message);
      job.finished = true;
      job.ok = false;
    });

    console.log(`[server] build-palace ${jobId}: ${n} photo(s), notes=${!!notes}`);
    res.json({ jobId });
  } catch (err) {
    console.error("[server] build-palace error:", err);
    res.status(500).json({ error: String(err.message ?? err) });
  }
});

// Cancel a running build: SIGTERM the spawned pipeline child and finalize the
// job as failed so the SSE stream ends cleanly with { done: true, ok: false }.
app.post("/api/build-palace/:id/cancel", (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: "job not found" });
  if (job.finished) return res.json({ ok: true, alreadyFinished: true });

  job.cancelled = true;
  job.child?.kill("SIGTERM");
  job.log.push("✗ build cancelled by user.");
  job.finished = true;
  job.ok = false;
  res.json({ ok: true });
});

// SSE progress for a build job. Replays the log so far, then streams new lines,
// then a final { done, ok } event.
app.get("/api/build-palace/:id/stream", (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).end();
  res.set({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
  res.flushHeaders?.();
  let idx = 0;
  const tick = () => {
    while (idx < job.log.length) res.write(`data: ${JSON.stringify({ line: job.log[idx++] })}\n\n`);
    if (job.finished) {
      res.write(`data: ${JSON.stringify({ done: true, ok: job.ok })}\n\n`);
      clearInterval(timer);
      res.end();
    }
  };
  const timer = setInterval(tick, 400);
  tick();
  req.on("close", () => clearInterval(timer));
});

const PORT = process.env.PORT ?? 8090;
app.listen(PORT, () => {
  console.log(`[server] Mind Palace API on http://localhost:${PORT}`);
});
