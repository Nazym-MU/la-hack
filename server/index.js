import express from "express";
import cors from "cors";

// Holds the TRIPO API key server-side so it never reaches the browser.
// Set it before running: export TRIPO_API_KEY=your_key_here
const TRIPO_API_KEY = process.env.TRIPO_API_KEY;
const TRIPO_BASE = "https://api.tripo3d.ai/v2/openapi/task";

if (!TRIPO_API_KEY) {
  console.warn(
    "[server] TRIPO_API_KEY is not set. Export it before generating objects:\n" +
      "  export TRIPO_API_KEY=your_key_here",
  );
}

const app = express();
app.use(cors());
app.use(express.json());

// POST { prompt } -> kicks off a TRIPO text-to-3D task, returns { taskId }.
// The client then polls GET /api/generate-object/:taskId.
app.post("/api/generate-object", async (req, res) => {
  const { prompt } = req.body ?? {};
  if (!prompt || typeof prompt !== "string") {
    return res.status(400).json({ error: "Missing 'prompt' string in body." });
  }

  try {
    const response = await fetch(TRIPO_BASE, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${TRIPO_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ type: "text_to_model", prompt }),
    });
    const json = await response.json();
    if (!response.ok) {
      console.error("[server] TRIPO create-task error:", json);
      return res.status(502).json({ error: "TRIPO task creation failed.", detail: json });
    }
    res.json({ taskId: json.data?.task_id });
  } catch (err) {
    console.error("[server] TRIPO create-task exception:", err);
    res.status(500).json({ error: "Failed to reach TRIPO." });
  }
});

// GET :taskId -> single-shot status check (client re-polls this on an
// interval; the server does not hold a long poll open).
// Response schema note: TRIPO's `data.output` field names for the GLB URL
// were not confirmed from docs at build time. This route logs the FULL raw
// response the first time you hit it against a real task, so check the
// server console and adjust `extractModelUrl` below if the field differs.
app.get("/api/generate-object/:taskId", async (req, res) => {
  try {
    const response = await fetch(`${TRIPO_BASE}/${req.params.taskId}`, {
      headers: { Authorization: `Bearer ${TRIPO_API_KEY}` },
    });
    const json = await response.json();
    if (!response.ok) {
      return res.status(502).json({ error: "TRIPO status check failed.", detail: json });
    }

    const data = json.data ?? {};
    console.log(`[server] task ${req.params.taskId} status=${data.status}`, data.output ?? "");

    res.json({
      status: data.status, // e.g. "queued" | "running" | "success" | "failed"
      modelUrl: data.status === "success" ? extractModelUrl(data.output) : null,
      raw: data.output ?? null,
    });
  } catch (err) {
    console.error("[server] TRIPO status exception:", err);
    res.status(500).json({ error: "Failed to reach TRIPO." });
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
