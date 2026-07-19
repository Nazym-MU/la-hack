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

      // Swap the room's world onto the single splat host.
      const url = room.splatUrl || BUNDLED_STANDIN;
      const mesh = room.colliderUrl ?? "";
      if (!splat) {
        splat = world.createTransformEntity();
        splat.addComponent(GaussianSplatLoader, mesh ? { splatUrl: url, meshUrl: mesh } : { splatUrl: url });
      } else {
        splat.setValue(GaussianSplatLoader, "splatUrl", url);
        splat.setValue(GaussianSplatLoader, "meshUrl", mesh);
        await splatSystem.load(splat);
      }

      // Marble worlds come in with -Y up (they render upside-down in Spark); the
      // bundled stand-in is already upright. Set the host quaternion directly so
      // the fix doesn't depend on the ECS transform-sync patch having run yet.
      const flip = url !== BUNDLED_STANDIN;
      splat.object3D?.quaternion.setFromEuler(new THREE.Euler(flip ? Math.PI : 0, 0, 0));

      // Teleport the visitor to this room's spawn point.
      const [sx, sy, sz] = room.spawn ?? [0, 1.5, 0];
      camera.position.set(sx, sy, sz);

      changeCb(i, room);
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
  };
}
