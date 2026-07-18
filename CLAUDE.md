# Mind Palace — Worlds in Action Hack (LA, SIGGRAPH edition)

Generative memory palace in WebXR. A journal entry (or study notes) is parsed
into key moments; each moment becomes a 3D object placed inside a walkable
AI-generated world. Revisiting the world and selecting an object resurfaces the
memory tied to it. Doubles as a study tool (method of loci).

**Track:** Best Interactive World Experience (World Labs). Gate: must use World
Labs Marble + at least one interactive/responsive element. TRIPO integration is
a stretch that may also qualify for the 3D GenAI Character/Product track.

## Stack

Built on the SensAI `sensai-webxr-worldmodels` template (kept as git remote
`upstream`).

- **IWSDK** (`@iwsdk/core`) — WebXR ECS framework. Entities + components +
  systems. Built-in locomotion, grabbing, spatial UI, XR session, headset
  simulator (IWER). This is NOT raw Three.js — compose components, don't write
  raycasters by hand.
- **SparkJS** (`@sparkjsdev/spark`) — Gaussian splat renderer with LoD tuned for
  Quest/PICO. Renders the Marble world.
- **World Labs Marble** — generates the walkable world; export as `.spz`/`.ply`,
  drop into `GaussianSplatLoader`'s `splatUrl`.
- **TRIPO** — text/image -> GLB for the memory objects (stretch).
- **Three.js** — `super-three@0.181.0` under IWSDK.

## Run

```bash
npm run dev      # https://localhost:8081  (mkcert; WebXR needs https)
npm run build && npm run preview
```

Open in a desktop browser: the IWER headset simulator is injected so you can
emulate a Quest/PICO without hardware. Click "Enter XR" on the panel.

## Environment gotchas (already solved — don't re-hit these)

- **Node is pinned to 22.19.0 via `mise.toml`.** The template engine wants
  `>=20.19.0`. Use `mise exec node@22.19.0 -- npm ...` if your shell defaults to
  Node 24.
- **`@iwsdk/vite-plugin-gltf-optimizer` was removed from package.json.** It was
  commented out in `vite.config.ts` (unused) but its native `sharp` dependency
  fails to build here (npm optional-deps bug -> source build -> no toolchain).
  If you later need GLB compression, re-add it AND fix sharp
  (`npm install --include=optional sharp`, or install the darwin-arm64 binary).
- If install ever fails on sharp again: `rm -rf node_modules package-lock.json`
  then reinstall (fresh resolve pulls the right platform binaries).

## Key files

- `src/index.ts` — `World.create(...)`; registers systems, builds the scene.
- `src/memories.ts` — **the data contract.** `Memory`/`Palace` types + seed
  data. The generation pipeline only has to emit this shape.
- `src/memoryObjects.ts` — spawns an interactable object per memory.
- `src/gaussianSplatLoader.ts` — `GaussianSplatLoader` component/system (kit).
  Set `splatUrl` on the entity to load a Marble world.
- `src/uiPanel.ts` + `ui/*.uikitml` — spatial UI panel (compiled to
  `public/ui/*.json`). Shows memory text.
- `public/splats/` — bundled `sensai.spz` placeholder world.

## Data contract (the spine)

```ts
interface Memory {
  id; label; note?;          // note = optional "what it represents" sentence
  position: [x,y,z];
  modelUrl?;                 // TRIPO GLB; orb placeholder when absent
  dateGenerated?;            // ISO; auto-set at runtime if omitted
  color?; scale?;
}
interface Palace { title; splatUrl?; memories: Memory[] }
```

Object positions are **authored**, not derived from splat geometry — a Gaussian
splat has no queryable surfaces, so place objects on a fixed ring/path.

## Where teammates plug in (the two seams)

- **World Labs / environment person:** set `SEED_PALACE.splatUrl` in
  `src/memories.ts` to a Marble `.spz`/`.ply` export. That's the whole
  environment swap — `GaussianSplatLoader` (`src/gaussianSplatLoader.ts`) loads
  whatever URL is there. Host large splats on a CDN, not in the repo.
- **Object-generation person:** call
  `addMemoryObject(world, { id, label, note?, position, modelUrl, scale? })`
  from `src/memoryObjects.ts`. Pass a TRIPO GLB URL as `modelUrl` and it loads +
  places + registers the object, interactable and clickable, no other wiring.
  Orb placeholder renders if `modelUrl` is omitted. `world` is the instance from
  `World.create(...)` in `src/index.ts`.

## Interaction

IWSDK marks interactable entities with `Pressed`/`Hovered` state-tag components
(from `@iwsdk/core` input system). `MemorySystem` reacts on the rising edge of
`Pressed` and writes the memory's label/note/date into the panel.

**KNOWN GAP (P1):** IWSDK has no desktop-mouse picking — 3D-object clicking only
works through the XR/IWER-simulator pointer ray, not a plain browser mouse
click. Flat-desktop navigation + pointer raycast is unbuilt. Until then, test
interaction inside the IWER simulator session. Panels (ScreenSpace) still work
in the flat browser view.

## Demo safety

Marble/TRIPO generation is slow and network-bound. For judging: pre-generate the
palace assets, cache them under `public/`, keep at most ONE live generation as
the finale. Never gamble the live demo on a cold API call.
