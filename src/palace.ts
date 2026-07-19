import type { Vector3Tuple } from "three";

// ============================================================================
// Palace schema — the spine of the whole system.
//
// A `Palace` is produced by the offline pipeline (pipeline/build.js) from an
// upload folder and written to public/palaces/<name>/palace-schema.json. The
// viewer loads it verbatim. NOTHING content-specific is hardcoded anywhere —
// a new upload folder yields a new schema with zero code changes.
//
// The integration seams are schema FIELDS, not code:
//   - Room.splatUrl / Room.colliderUrl  ← World Labs Marble (environment person)
//   - MemoryPlacement.modelUrl          ← TRIPO GLB (object-generation person)
//
// The LLM agent's visible reasoning lives in this schema too, and is the
// primary judged artifact:
//   - Room.marblePrompt   the prompt the agent wrote to generate the room
//   - Room.rationale      why this cluster of content became a room
//   - MemoryPlacement.rationale  why this memory sits where it does
// ============================================================================

export interface MemoryPlacement {
  id: string;
  // Short title shown on the object's card.
  label: string;
  // Optional sentence: what this object represents.
  note?: string;
  // The agent's one-line reasoning for placing this memory here (judged).
  rationale?: string;
  // Which uploaded file this memory was distilled from (provenance, optional).
  sourceRef?: string;
  // Short TRIPO prompt describing the object to generate for this memory.
  // The object-generation lane can consume this; not required by the viewer.
  objectPrompt?: string;
  // Position RELATIVE to the room origin, in metres. Authored by the agent,
  // never derived from splat geometry (a Gaussian splat has no surfaces).
  position: Vector3Tuple;
  // TRIPO GLB seam. When absent the viewer renders a placeholder orb.
  modelUrl?: string;
  // ISO timestamp; auto-set at runtime if omitted.
  dateGenerated?: string;
  // Placeholder tint + optional scale multiplier on the normalized GLB.
  color?: number;
  scale?: number;
}

export interface Room {
  id: string;
  // Human-facing room name (e.g. the cluster's theme).
  title: string;
  // The agent's short theme/cluster label.
  theme?: string;
  // THE core mechanism: the Marble world-generation prompt the agent wrote for
  // this room. Judged material. Lives in the schema so it's inspectable.
  marblePrompt: string;
  // Why the agent decided this cluster deserves its own room (judged).
  rationale?: string;
  // Filename of the uploaded photo this room was built from, when the pipeline
  // used Marble image-to-world instead of text-to-world (provenance).
  sourcePhoto?: string;
  // World-space offset of this room, in metres. Assigned by pipeline/layout.js
  // so rooms are spatially connected and walkable. The room's splat and all its
  // memories are placed relative to this origin.
  origin: Vector3Tuple;
  // Cached Marble Gaussian-splat URL (relative to the app base, under public/).
  // Undefined until Marble generation has run; the viewer falls back to the
  // bundled stand-in world so the loop is testable before any generation.
  splatUrl?: string;
  // A lower-resolution splat URL for the same world. When present the viewer
  // loads this first (fast) and swaps to the full splatUrl once it arrives —
  // progressive detail instead of a slow blank load.
  splatUrlLow?: string;
  // Cached Marble collider mesh (GLB) — feeds GaussianSplatLoader.meshUrl.
  colliderUrl?: string;
  // Marble world id, kept so assets can be re-exported later.
  worldId?: string;
  // Room-local point (relative to origin) where the visitor should appear.
  spawn?: Vector3Tuple;
  memories: MemoryPlacement[];
}

export interface Palace {
  title: string;
  // ISO timestamp the pipeline produced this palace.
  generatedAt?: string;
  // The upload folder this palace was built from (provenance, optional).
  sourceFolder?: string;
  // Which LLM provider/model wrote the schema (provenance, optional).
  agent?: { provider?: string; model?: string };
  rooms: Room[];
}

// Where the viewer looks for a generated palace. There is exactly one —
// "Build from photos" always adds to it (see pipeline/build.js, which
// decides per upload whether new content extends an existing room or
// creates a new one). If the fetch 404s (nothing built yet), the viewer
// falls back to a single-room palace built from SEED_PALACE in memories.ts.
export const PALACE_SCHEMA_URL = "./palace-schema.json";
