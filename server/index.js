import express from "express";
import cors from "cors";

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
// Large limit: the client may send a base64 photo for image_to_model.
app.use(express.json({ limit: "25mb" }));

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

const PORT = process.env.PORT ?? 8090;
app.listen(PORT, () => {
  console.log(`[server] Mind Palace API on http://localhost:${PORT}`);
});
