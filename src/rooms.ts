import * as THREE from "three";
import type { World } from "@iwsdk/core";
import { GaussianSplatLoader, GaussianSplatLoaderSystem } from "./gaussianSplatLoader.js";
import { addMemoryObject, clearMemories } from "./memoryObjects.js";
import { PALACE_SCHEMA_URL, type Palace, type Room } from "./palace.js";
import { SEED_PALACE } from "./memories.js";
import type { Memory } from "./memories.js";

// Room switching, done the way Gaussian-splat worlds want: ONE room loaded at a
// time. Each Marble world is a full 360° environment, so showing several at
// once makes them bleed into each other. Instead we keep a single splat host,
// swap its world on room change, and rebuild just that room's memories. The
// result is a solid, single environment per room. A teleport (not a corridor)
// moves you between rooms.

const BUNDLED_STANDIN = "./splats/sensai.spz";

export async function loadPalace(): Promise<Palace | null> {
  try {
    const res = await fetch(PALACE_SCHEMA_URL, { cache: "no-cache" });
    if (!res.ok) return null;
    const palace = (await res.json()) as Palace;
    if (!palace?.rooms?.length) return null;
    return palace;
  } catch {
    return null;
  }
}

// The seed palace as a one-room Palace, so the viewer has one code path. Its
// room shows the bundled stand-in as a backdrop (the only place we use it).
export function seedAsPalace(): Palace {
  const room: Room = {
    id: "seed",
    title: SEED_PALACE.title,
    marblePrompt: "",
    origin: [0, 0, 0],
    spawn: [0, 1.5, 0],
    splatUrl: BUNDLED_STANDIN,
    memories: SEED_PALACE.memories.map((m) => ({
      id: m.id,
      label: m.label,
      note: m.note,
      position: m.position,
      modelUrl: m.modelUrl,
      color: m.color,
      scale: m.scale,
      dateGenerated: m.dateGenerated,
    })),
  };
  return { title: SEED_PALACE.title, rooms: [room] };
}

export interface RoomManager {
  count: number;
  current: () => number;
  titles: string[];
  show: (index: number) => Promise<void>;
  next: () => void;
  prev: () => void;
  onChange: (cb: (index: number, room: Room) => void) => void;
  splatEntity: () => ReturnType<World["createTransformEntity"]> | null;
  cycleFlip: () => "none" | "x" | "z";
}

// Builds the manager. Nothing is shown until you call show(); index.ts kicks it
// off with show(0).
export function createRoomManager(world: World, palace: Palace): RoomManager {
  const rooms = palace.rooms;
  const splatSystem = world.getSystem(GaussianSplatLoaderSystem)!;
  const camera = world.camera as THREE.PerspectiveCamera;

  let splat: ReturnType<World["createTransformEntity"]> | null = null;
  let index = -1;
  let changeCb: (index: number, room: Room) => void = () => {};
  let switching = false;
  let showToken = 0; // invalidates a stale high-res upgrade when the room changes
  // World orientation. Marble worlds load with -Y up; a 180° roll about Z
  // corrects "up" without spinning you to face a wall (rotating about X would).
  // The 'f' key cycles none/x/z live in case a world needs a different fix.
  let flipMode: "none" | "x" | "z" = "z";

  const applyFlip = () => {
    if (!splat?.object3D) return;
    const rx = flipMode === "x" ? Math.PI : 0;
    const rz = flipMode === "z" ? Math.PI : 0;
    splat.object3D.quaternion.setFromEuler(new THREE.Euler(rx, 0, rz));
  };

  async function show(i: number) {
    if (i === index || switching || i < 0 || i >= rooms.length) return;
    switching = true;
    try {
      const room = rooms[i];
      index = i;

      // Rebuild memories for this room (all placed relative to the origin,
      // since only one room occupies the scene at a time).
      clearMemories();
      for (const p of room.memories) {
        const memory: Memory = {
          id: p.id,
          label: p.label,
          note: p.note,
          position: p.position,
          modelUrl: p.modelUrl,
          color: p.color,
          scale: p.scale,
          dateGenerated: p.dateGenerated,
          rationale: p.rationale,
          room: room.title,
        };
        void addMemoryObject(world, memory).catch((err) =>
          console.error(`[rooms] failed to add memory "${memory.id}":`, err),
        );
      }

      // Swap the room's world onto the single splat host. Load the low-res
      // splat first (fast) when there is one, then upgrade to full res below.
      const high = room.splatUrl || BUNDLED_STANDIN;
      const low = room.splatUrlLow;
      const first = low ?? high;
      const mesh = room.colliderUrl ?? "";
      const token = ++showToken;

      if (!splat) {
        splat = world.createTransformEntity();
        splat.addComponent(GaussianSplatLoader, mesh ? { splatUrl: first, meshUrl: mesh } : { splatUrl: first });
      } else {
        splat.setValue(GaussianSplatLoader, "splatUrl", first);
        splat.setValue(GaussianSplatLoader, "meshUrl", mesh);
        await splatSystem.load(splat);
      }

      // Apply the current world orientation (cycled live with the 'f' key).
      applyFlip();

      // Spawn at the world origin — the Marble capture eye, i.e. natural human
      // standing height. The flip pivots on the origin, so this stays put
      // whatever the orientation. Fly up/down (E/Q) to fine-tune eye level.
      const [sx, , sz] = room.spawn ?? [0, 0, 0];
      camera.position.set(sx, 0, sz);

      changeCb(i, room);

      // Progressive upgrade: once the low-res world is showing, swap to full
      // res in the background (skip if the room changed meanwhile).
      if (low && high !== low) {
        void (async () => {
          try {
            if (token !== showToken || !splat) return;
            splat.setValue(GaussianSplatLoader, "splatUrl", high);
            await splatSystem.load(splat);
            if (token === showToken) applyFlip();
          } catch (err) {
            console.error(`[rooms] high-res upgrade failed for "${room.id}":`, err);
          }
        })();
      }
    } finally {
      switching = false;
    }
  }

  return {
    count: rooms.length,
    current: () => index,
    titles: rooms.map((r) => r.title),
    show,
    next: () => void show((index + 1) % rooms.length),
    prev: () => void show((index - 1 + rooms.length) % rooms.length),
    onChange: (cb) => {
      changeCb = cb;
    },
    splatEntity: () => splat,
    cycleFlip: () => {
      flipMode = flipMode === "none" ? "x" : flipMode === "x" ? "z" : "none";
      applyFlip();
      return flipMode;
    },
  };
}
