// The JSON Schema the agent is constrained to (Claude structured outputs /
// Gemini responseSchema), plus a normalizer that hardens whatever the model
// returns into a clean palace *draft* (rooms + memories, no splats/origins yet).
//
// Structured-output limits we work within: every object sets
// additionalProperties:false + required; no numeric/length constraints — so
// positions come back as a free number array and we clamp them in code.

export const PALACE_DRAFT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["title", "rooms"],
  properties: {
    title: { type: "string", description: "A short evocative name for the whole palace." },
    rooms: {
      type: "array",
      description: "Coherent rooms, one place each. Aim for the requested count.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "title", "theme", "marblePrompt", "rationale", "memories"],
        properties: {
          id: { type: "string", description: "kebab-case unique id, e.g. 'sunlit-study'." },
          title: { type: "string", description: "Human-facing room name." },
          theme: { type: "string", description: "The cluster's one-line theme." },
          marblePrompt: {
            type: "string",
            description: "The World Labs Marble world-generation prompt. Scene description only — see the guidance.",
          },
          rationale: {
            type: "string",
            description: "Why this cluster of material became its own room (judged).",
          },
          memories: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["id", "label", "note", "rationale", "objectPrompt", "sourceRef", "position"],
              properties: {
                id: { type: "string", description: "kebab-case unique id." },
                label: { type: "string", description: "2-4 word title." },
                note: { type: "string", description: "One sentence: what this object represents." },
                rationale: {
                  type: "string",
                  description: "Why this memory sits at this exact spot in the room (method of loci; judged).",
                },
                objectPrompt: {
                  type: "string",
                  description: "Short concrete description of a single physical object for a 3D generator.",
                },
                sourceRef: {
                  type: "string",
                  description: "Filename of the uploaded item this memory traces to.",
                },
                position: {
                  type: "array",
                  items: { type: "number" },
                  description: "Room-local [x, y, z] in metres. x/z within ~3m of centre, y in 0.8-1.8.",
                },
              },
            },
          },
        },
      },
    },
  },
};

// Placeholder-orb tints, cycled deterministically so a run is reproducible.
const ORB_PALETTE = [0x8b9fd4, 0xb08bc9, 0xc9a37e, 0x7eb8a6, 0xc98b9b, 0x5b8cff];

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

// Coerce a possibly-messy position array into a sane room-local [x,y,z].
function normalizePosition(pos, index) {
  const p = Array.isArray(pos) ? pos.map(Number) : [];
  // Spread memories on a ring as a fallback when the model gives junk.
  const angle = (index * 2 * Math.PI) / 5;
  const x = Number.isFinite(p[0]) ? p[0] : Math.cos(angle) * 1.6;
  const y = Number.isFinite(p[1]) ? p[1] : 1.3;
  const z = Number.isFinite(p[2]) ? p[2] : Math.sin(angle) * 1.6 - 1.2;
  return [clamp(x, -3.5, 3.5), clamp(y, 0.6, 2.2), clamp(z, -3.5, 3.5)];
}

let colorCursor = 0;
const nextColor = () => ORB_PALETTE[colorCursor++ % ORB_PALETTE.length];

// Turn the raw model object into a validated palace draft. Enforces unique ids,
// sane positions/colors, and per-room memory caps. Throws only on structural
// nonsense (no rooms) — everything else is coerced, so a slightly-off model
// response still yields a usable palace.
export function normalizeDraft(raw, config = {}) {
  if (!raw || !Array.isArray(raw.rooms) || raw.rooms.length === 0) {
    throw new Error("Agent returned no rooms.");
  }
  const maxMem = config.maxMemoriesPerRoom ?? 6;
  const seenRoomIds = new Set();
  colorCursor = 0;

  const rooms = raw.rooms.map((room, ri) => {
    let id = slug(room.id || room.title || `room-${ri + 1}`);
    while (seenRoomIds.has(id)) id = `${id}-${ri}`;
    seenRoomIds.add(id);

    const seenMemIds = new Set();
    const memories = (Array.isArray(room.memories) ? room.memories : [])
      .slice(0, maxMem)
      .map((m, mi) => {
        let mid = slug(m.id || m.label || `${id}-m${mi + 1}`);
        while (seenMemIds.has(mid)) mid = `${mid}-${mi}`;
        seenMemIds.add(mid);
        return {
          id: mid,
          label: String(m.label ?? "Untitled").trim(),
          note: m.note ? String(m.note).trim() : undefined,
          rationale: m.rationale ? String(m.rationale).trim() : undefined,
          objectPrompt: m.objectPrompt ? String(m.objectPrompt).trim() : undefined,
          sourceRef: m.sourceRef ? String(m.sourceRef).trim() : undefined,
          position: normalizePosition(m.position, mi),
          color: nextColor(),
        };
      });

    return {
      id,
      title: String(room.title ?? "Untitled Room").trim(),
      theme: room.theme ? String(room.theme).trim() : undefined,
      marblePrompt: String(room.marblePrompt ?? "").trim(),
      rationale: room.rationale ? String(room.rationale).trim() : undefined,
      memories,
    };
  });

  return { title: String(raw.title ?? "Mind Palace").trim(), rooms };
}

function slug(s) {
  return String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "room";
}
