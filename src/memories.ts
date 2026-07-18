import type { Vector3Tuple } from "three";

// The core contract of the whole app. Each Memory becomes an interactable
// object placed inside the Marble world; selecting it resurfaces its data.
//
// Two teammates produce Memory data:
//  - World Labs person sets Palace.splatUrl (the environment).
//  - Object-generation person calls addMemoryObject() with a modelUrl (TRIPO
//    GLB), a position, and an optional note.
export interface Memory {
  id: string;
  // Short label shown as the object's title.
  label: string;
  // Optional sentence: what this object represents, so you don't forget.
  note?: string;
  // Where the object sits in the world, in metres. Authored, not derived from
  // splat geometry (a Gaussian splat has no queryable surfaces).
  position: Vector3Tuple;
  // GLB from TRIPO. When absent we render a placeholder orb so the interaction
  // loop works before any 3D assets exist.
  modelUrl?: string;
  // ISO timestamp the object was created. Auto-set at runtime if omitted.
  dateGenerated?: string;
  // Placeholder tint + optional scale applied to the GLB.
  color?: number;
  scale?: number;
}

// The world the memories live inside. Swap splatUrl for a Marble export.
export interface Palace {
  title: string;
  splatUrl?: string;
  memories: Memory[];
}

// Seed palace: placeholder memories so the walk + click-to-reveal loop is
// testable today, with no TRIPO assets and no Marble world yet.
export const SEED_PALACE: Palace = {
  title: "Mind Palace",
  // Leave undefined to use the kit's bundled sensai.spz as a stand-in world.
  splatUrl: undefined,
  memories: [
    {
      id: "m1",
      label: "The Final",
      note: "The day we won the final at Old Trafford. Rain, floodlights, everyone hoarse by the end.",
      position: [-1.4, 1.3, -1.9],
      dateGenerated: "2026-07-18T12:00:00.000Z",
      color: 0x5b8cff,
    },
    {
      id: "m2",
      label: "First Flight",
      note: "First time I flew alone. Window seat, the coast unspooling underneath, terrified and free.",
      position: [0, 1.5, -2.3],
      dateGenerated: "2026-07-18T12:00:00.000Z",
      color: 0xd9a441,
    },
    {
      id: "m3",
      label: "The Letter",
      note: "The acceptance letter on the kitchen table. Mum read it twice before she believed it.",
      position: [1.4, 1.3, -1.9],
      dateGenerated: "2026-07-18T12:00:00.000Z",
      color: 0xc86a9a,
    },
  ],
};
