// Client side of the TRIPO pipeline. Talks only to our own server (vite
// proxies /api -> localhost:8090) so the API key never reaches the browser.

export interface GenerationRequest {
  prompt: string;
  // Optional base64 data URL; when present the server runs image_to_model.
  imageDataUrl?: string;
}

export interface GenerationStatus {
  status: string; // "queued" | "running" | "success" | "failed" | ...
  progress: number | null;
}

const POLL_INTERVAL_MS = 2500;
const TIMEOUT_MS = 5 * 60_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Kicks off a TRIPO task and polls it to completion. Resolves with a GLB URL
// routed through our server's /api/model proxy (immune to CDN CORS).
export async function generateModel(
  request: GenerationRequest,
  onStatus?: (status: GenerationStatus) => void,
): Promise<string> {
  const createRes = await fetch("/api/generate-object", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
  const created = await createRes.json();
  if (!createRes.ok || !created.taskId) {
    throw new Error(created.error ?? "TRIPO task creation failed");
  }

  const start = Date.now();
  while (Date.now() - start < TIMEOUT_MS) {
    await sleep(POLL_INTERVAL_MS);

    const res = await fetch(`/api/generate-object/${created.taskId}`);
    const json = await res.json();
    if (!res.ok) throw new Error(json.error ?? "TRIPO status check failed");

    onStatus?.({ status: json.status, progress: json.progress ?? null });

    if (json.status === "success") {
      if (!json.modelUrl) {
        throw new Error(
          "TRIPO succeeded but no model URL was found — check the server log's raw output and adjust extractModelUrl().",
        );
      }
      return `/api/model?url=${encodeURIComponent(json.modelUrl)}`;
    }
    if (["failed", "cancelled", "banned", "expired"].includes(json.status)) {
      throw new Error(`TRIPO task ${json.status}`);
    }
  }
  throw new Error("TRIPO generation timed out");
}
