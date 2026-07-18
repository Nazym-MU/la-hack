# Mind Palace — Build Plan

## Vision
A generative memory palace. You describe your inner world, it gets generated,
you walk in, and you add objects — each a real generated 3D model that holds a
memory (a date + an optional sentence of what it represents). Revisiting the
world and clicking an object resurfaces the memory. Calm, personal, spatial.

## The two sponsor techs combine (and should)
- **World Labs Marble -> the ENVIRONMENT.** Outputs a Gaussian splat (`.spz`/`.ply`),
  loaded by `GaussianSplatLoader` / SparkJS. This is the walkable world.
- **TRIPO -> the OBJECTS.** Text -> GLB mesh, loaded by `GLTFLoader`, placed in
  the world by the user.
- One WebXR/Three.js scene holds both; splats already render behind meshes
  (`renderOrder -10`), so TRIPO objects sit correctly inside a Marble world.
- Eligibility: Marble -> "Interactive World" (World Labs); TRIPO -> "3D GenAI
  Object/Product". Using both meaningfully targets both. **OPEN:** confirm with
  organizers whether one project can count for two tracks.
- Credits: two separate API keys / pools. Both get used.

## Entry model (this replaces the broken "Enter XR" button)
- WebXR *immersive* can't auto-start (needs a user gesture) and can't run
  without an XR device, so on a laptop the button fails silently.
- **Decision: flat-3D-first.** App runs as an in-browser 3D scene (mouse-look +
  move, click to interact), no enter button. XR becomes an optional flex for
  headsets. Reliable laptop demo; matches the "immediately enter" flow.
- **Verify:** IWSDK pointer raycasting in non-immersive mode. If weak, add an
  Orbit/fly camera + a pointer raycaster fallback for desktop.

## Flow
1. **Home** — "Imagine your mind." Prompt box + presets (House / Village /
   Sherlock study). Calm aesthetic (per incoming UI design).
2. **Generate / select world** -> Marble splat loads.
3. **Enter** (flat 3D by default).
4. **Add a memory** button -> prompt an object ("a Rubik's cube") -> TRIPO
   generates a GLB -> user places it (click a spot) -> attach memory data
   (date auto, optional sentence).
5. **Click any object** -> panel shows label + date generated + the sentence.

## Data model (extend `src/memories.ts`)
```ts
interface Memory {
  id; label; note?;            // note = the optional "what it represents" line
  position: [x,y,z];
  modelUrl?;                   // TRIPO GLB (placeholder orb until present)
  dateGenerated;               // ISO string, set when the object is created
  color?; scale?;
}
interface Palace { title; splatUrl?; memories: Memory[] }
```

## Phases (scoped for the hackathon)
- **P0 — DONE.** Kit runs (Node 22 pin, sharp/peer-dep fixes), data contract,
  placeholder orbs, press-to-reveal, `CLAUDE.md`.
- **P1 — Aesthetic + entry.** Calmer palette (await UI design). Flat-3D entry,
  remove XR-button dependency. Click shows date + sentence. Extend data model.
- **P2 — World presets.** 2-3 pre-generated Marble worlds selectable on the home
  screen (calm: study, misty village). Pre-generated for demo safety.
- **P3 — TRIPO runtime objects.** "Add object" -> prompt -> TRIPO API (via a thin
  key-holding server) -> poll -> GLB -> place. Loading state. Ship a small
  pre-generated object library too, for a snappy demo.
- **P4 — (stretch) Marble world gen from prompt.** Live generation; keep exactly
  one live gen as the on-stage finale.

## Demo safety
Pre-generate the worlds and a few objects; cache under `public/`. At most ONE
live generation during judging. Never gamble the demo on a cold API call.

## Open items / to verify
- One-project-two-tracks eligibility (ask organizers).
- Marble export format + generation latency (fire one test gen).
- TRIPO text->3D latency + output format (fire one test).
- IWSDK non-immersive pointer interaction (P1 verify).
- **Backend:** a thin Node server to hold TRIPO/Marble API keys — never ship keys
  to the client. Endpoints: POST /generate-object (prompt) -> poll -> GLB URL;
  optionally /generate-world.

## Team parallelization
- Data + rendering (this contract) — one person.
- TRIPO pipeline + key-holding server — one person.
- Marble worlds (generate/curate the calm presets) — one person.
- UI / aesthetic (home screen, add-memory panel, object cards) — one person.
