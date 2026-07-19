import Anthropic from "@anthropic-ai/sdk";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PALACE_DRAFT_SCHEMA, normalizeDraft } from "./schema.js";
import { digestItems } from "./ingest.js";

// Provider-agnostic agent seam. `runAgent` picks a provider and returns a
// normalized palace draft. Claude is wired; Gemini is a stub; "mock" needs no
// key so the whole pipeline + viewer can be built and demoed offline.

const here = path.dirname(fileURLToPath(import.meta.url));

async function loadPrompt() {
  const [system, guidance] = await Promise.all([
    fs.readFile(path.join(here, "prompts", "system.md"), "utf8"),
    fs.readFile(path.join(here, "prompts", "marble-guidance.md"), "utf8"),
  ]);
  return `${system}\n\n${guidance}`;
}

function taskInstruction(config) {
  const n = config.preferredRoomCount ?? 3;
  const tol = config.roomCountTolerance ?? 1;
  const maxMem = config.maxMemoriesPerRoom ?? 6;
  return (
    `Build a memory palace from the uploaded items below. ` +
    `Prefer about ${n} room(s) (${Math.max(1, n - tol)}–${n + tol} is fine), ` +
    `each with up to ${maxMem} memories. Return only the structured object.\n\n`
  );
}

export async function runAgent({ items, config, provider }) {
  const chosen = provider || config.provider || "claude";
  const system = await loadPrompt();
  const task = taskInstruction(config);

  let raw;
  let modelLabel = chosen;
  if (chosen === "claude") {
    raw = await runClaude({ items, config, system, task });
    modelLabel = config.model ?? "claude-opus-4-8";
  } else if (chosen === "ollama" || chosen === "openai") {
    const oa = openaiSettings(chosen, config);
    raw = await runOpenAICompatible({ items, system, task, ...oa });
    modelLabel = items.some((it) => it.kind === "image") ? oa.visionModel : oa.model;
  } else if (chosen === "gemini") {
    raw = await runGemini({ items, config, system, task });
  } else if (chosen === "mock") {
    raw = runMock({ items, config });
  } else {
    throw new Error(`Unknown provider "${chosen}" (use claude | ollama | openai | gemini | mock).`);
  }

  const draft = normalizeDraft(raw, config);
  draft.agent = { provider: chosen, model: modelLabel };
  return draft;
}

// ---------------------------------------------------------------------------
// Claude — Anthropic SDK, adaptive thinking + structured output, streamed.
// ---------------------------------------------------------------------------
async function runClaude({ items, config, system, task }) {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set. Put it in .env (root or pipeline/), or run with --provider mock.",
    );
  }
  const client = new Anthropic();

  // User turn: the text digest, then each image as a vision block so the model
  // can see photos and cite their filenames as sourceRef.
  const content = [{ type: "text", text: task + digestItems(items) }];
  for (const it of items) {
    if (it.kind === "image") {
      content.push({
        type: "image",
        source: { type: "base64", media_type: it.mediaType, data: it.base64 },
      });
    }
  }

  const stream = client.messages.stream({
    model: config.model ?? "claude-opus-4-8",
    max_tokens: 32000,
    thinking: { type: "adaptive" },
    output_config: {
      effort: "high",
      format: { type: "json_schema", schema: PALACE_DRAFT_SCHEMA },
    },
    system,
    messages: [{ role: "user", content }],
  });

  const msg = await stream.finalMessage();
  if (msg.stop_reason === "refusal") {
    throw new Error("Claude declined the request (stop_reason: refusal).");
  }
  const text = msg.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("");
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("Claude did not return valid JSON. First 400 chars:\n" + text.slice(0, 400));
  }
}

// ---------------------------------------------------------------------------
// OpenAI-compatible — one code path for a LOCAL open-source model (Ollama) or
// any hosted OpenAI-compatible endpoint (Groq, OpenRouter, Together, …). The
// agent is "just" structured text generation, so an open model does it well.
// We ask for a JSON object and embed the schema in the prompt (json_object mode
// is universally supported; strict json_schema is not) and lean on
// normalizeDraft to harden the result.
// ---------------------------------------------------------------------------
function openaiSettings(chosen, config) {
  if (chosen === "ollama") {
    const c = config.ollama ?? {};
    return {
      baseUrl: process.env.OLLAMA_BASE_URL || c.baseUrl || "http://localhost:11434/v1",
      model: process.env.OLLAMA_MODEL || c.model || "llama3.2:3b",
      visionModel: process.env.OLLAMA_VISION_MODEL || c.visionModel || "llama3.2-vision",
      apiKey: "ollama", // Ollama ignores the key
    };
  }
  const c = config.openai ?? {};
  const apiKey = process.env.OPENAI_API_KEY || process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new Error(
      "No OPENAI_API_KEY / GROQ_API_KEY set (needed for provider 'openai'). Get a free key from " +
        "Groq (console.groq.com/keys) or OpenRouter, and put it in .env.",
    );
  }
  return {
    baseUrl: process.env.OPENAI_BASE_URL || c.baseUrl || "https://api.groq.com/openai/v1",
    model: process.env.OPENAI_MODEL || c.model || "llama-3.3-70b-versatile",
    // Multimodal model used when the folder contains photos.
    visionModel: process.env.OPENAI_VISION_MODEL || c.visionModel || "meta-llama/llama-4-scout-17b-16e-instruct",
    apiKey,
  };
}

// A concise shape hint works far better than dumping the full JSON Schema:
// small open models echo a big schema back instead of filling it in.
const SHAPE_HINT =
  'Return ONE JSON object with this exact shape:\n' +
  '{"title": string, "rooms": [{"id": string, "title": string, "theme": string, ' +
  '"marblePrompt": string, "rationale": string, "sourcePhoto": string, "memories": [{"id": string, ' +
  '"label": string, "note": string, "rationale": string, "objectPrompt": string, "sourceRef": string, ' +
  '"position": [x, y, z]}]}]}\n' +
  'position is room-local metres: x/z within ~1.5 of centre, y between 0.8 and 1.4. ' +
  'sourcePhoto is the filename of the best photo for the room, or "". Output JSON only.';

async function runOpenAICompatible({ items, system, task, baseUrl, model, visionModel, apiKey }) {
  const images = items.filter((it) => it.kind === "image");
  const useVision = images.length > 0;
  const userText = task + digestItems(items) + "\n\n" + SHAPE_HINT;

  // With photos: use the vision model and attach images as image_url blocks.
  // (Skip json_object mode there — some vision models reject it; parseLooseJson
  // handles fenced/plain JSON.) Text-only: keep the stronger text model + json.
  const userContent = useVision
    ? [
        { type: "text", text: userText },
        ...images.map((it) => ({
          type: "image_url",
          image_url: { url: `data:${it.mediaType};base64,${it.base64}` },
        })),
      ]
    : userText;

  const reqBody = {
    model: useVision ? visionModel : model,
    temperature: 0.7,
    messages: [
      { role: "system", content: system },
      { role: "user", content: userContent },
    ],
  };
  if (!useVision) reqBody.response_format = { type: "json_object" };

  const res = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(reqBody),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`OpenAI-compatible endpoint ${res.status}: ${text.slice(0, 400)}`);

  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error("Endpoint did not return JSON. First 400 chars:\n" + text.slice(0, 400));
  }
  const content = body.choices?.[0]?.message?.content ?? "";
  return parseLooseJson(content);
}

// Open models sometimes wrap JSON in prose or ```json fences — extract the object.
function parseLooseJson(s) {
  const fenced = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : s;
  try {
    return JSON.parse(candidate);
  } catch {
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start !== -1 && end > start) return JSON.parse(candidate.slice(start, end + 1));
    throw new Error("Could not parse JSON from model output. First 400 chars:\n" + s.slice(0, 400));
  }
}

// ---------------------------------------------------------------------------
// Gemini — seam left for the teammate who has that key. Same contract: return
// a raw object matching PALACE_DRAFT_SCHEMA. Wire via the Gemini SDK's
// responseSchema (structured output) using the same `system` + `task` + items.
// ---------------------------------------------------------------------------
async function runGemini() {
  throw new Error(
    "Gemini provider not wired yet — use --provider claude (default) or --provider mock. " +
      "The seam is runGemini() in pipeline/llm.js; mirror runClaude with the Gemini SDK's responseSchema.",
  );
}

// ---------------------------------------------------------------------------
// Mock — deterministic, no API key. Clusters items round-robin into the
// requested number of rooms and derives plausible (but clearly templated)
// Marble prompts + placements from the actual item content. Nothing is
// hardcoded to any specific folder — it reads whatever is there.
// ---------------------------------------------------------------------------
function runMock({ items, config }) {
  const n = Math.max(1, config.preferredRoomCount ?? 3);
  const maxMem = config.maxMemoriesPerRoom ?? 6;
  const buckets = Array.from({ length: n }, () => []);
  items.forEach((it, i) => buckets[i % n].push(it));

  const MOODS = ["low golden afternoon light", "cool overcast morning", "warm lamplit dusk"];
  const rooms = buckets
    .filter((b) => b.length)
    .map((bucket, ri) => {
      const keywords = keywordsFrom(bucket);
      const mood = MOODS[ri % MOODS.length];
      return {
        id: `room-${ri + 1}`,
        title: titleCase(keywords[0] || `Room ${ri + 1}`),
        theme: keywords.slice(0, 3).join(", ") || "assorted memories",
        marblePrompt:
          `An intimate room bathed in ${mood}, its surfaces worn wood, linen, and pale plaster. ` +
          `Shelves, a low table, and a wide window arrange the space around ${keywords.slice(0, 3).join(", ") || "everyday objects"}. ` +
          `Dust hangs in the light; the palette is warm and muted. The room feels lived-in and quiet, ` +
          `with clear surfaces where small keepsakes rest within reach.`,
        rationale:
          `[mock] These ${bucket.length} item(s) share a common register, so they anchor one place.`,
        memories: bucket.slice(0, maxMem).map((it, mi) => {
          const angle = (mi * 2 * Math.PI) / Math.max(1, bucket.length);
          const label = titleCase((it.kind === "text" ? firstWords(it.text, 3) : baseName(it.name)) || "Keepsake");
          return {
            id: `${ri + 1}-${mi + 1}-${baseSlug(it.name)}`,
            label,
            note: it.kind === "text" ? firstSentence(it.text) : `An image: ${it.name}.`,
            rationale: `[mock] Placed where the eye lands when turning ${mi % 2 ? "left" : "right"} on entering.`,
            objectPrompt: it.kind === "image" ? "a framed photograph on a wooden stand" : "a folded handwritten note",
            sourceRef: it.relPath,
            position: [Math.cos(angle) * 1.6, 1.3, Math.sin(angle) * 1.6 - 1.2],
          };
        }),
      };
    });

  return { title: "Mind Palace", rooms };
}

// --- tiny text helpers for the mock ---
const STOP = new Set("the a an and or of to in on at for with from into is was were it this that my our your".split(" "));
function keywordsFrom(items) {
  const freq = new Map();
  for (const it of items) {
    const src = it.kind === "text" ? it.text : baseName(it.name);
    for (const w of String(src).toLowerCase().match(/[a-z]{3,}/g) || []) {
      if (STOP.has(w)) continue;
      freq.set(w, (freq.get(w) || 0) + 1);
    }
  }
  return [...freq.entries()].sort((a, b) => b[1] - a[1]).map(([w]) => w).slice(0, 6);
}
const firstWords = (s, n) => String(s).trim().split(/\s+/).slice(0, n).join(" ");
const firstSentence = (s) => (String(s).trim().split(/(?<=[.!?])\s/)[0] || "").slice(0, 160);
const baseName = (f) => f.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ");
const baseSlug = (f) => baseName(f).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 24) || "item";
const titleCase = (s) => String(s).replace(/\b\w/g, (c) => c.toUpperCase()).slice(0, 40);
