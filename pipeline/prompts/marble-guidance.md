## Marble prompt guidance (read this before writing any `marblePrompt`)

World Labs Marble turns your text into a navigable Gaussian-splat world. The
prompt is the *entire* specification of the place — write it as a **scene
description for a 3D environment generator**, not a story.

### ALWAYS a small, enclosed, cozy interior room (non-negotiable)

Every room is an **interior**: four walls, a floor, a ceiling, a clear
boundary. Small and human-scale — a few metres across, intimate, furnished,
warm. **Never an outdoor scene, never a vast or open space, never a landscape.**

A memory set outdoors becomes a *snug themed room that evokes it*, not the
place itself. A beach trip → a small sunlit room with a big window looking out
to the sea, sandy-warm light, a shell on the sill, a folded map on the desk —
NOT an open beach or boardwalk. A city → a cozy apartment room with the skyline
framed in one window. The visitor always stands **inside a real room**.

Start the prompt by naming the enclosed room and its size (e.g. "A small,
low-ceilinged study, about four metres across, …"). Describe the walls and how
the room is closed in. Keep it tidy and pleasant, not cluttered.

### Furnish it with clear surfaces for objects

The room must contain **reachable surfaces with open, uncluttered spots** — a
table, shelves, a windowsill, a mantel, a desk, a chest — arranged around the
space at roughly waist-to-chest height. These are where memory objects (3D
tokens) will later be placed, so each memory's anchor object should map to a
spot on one of these surfaces. Leave the surfaces mostly clear so objects have
room to sit.

**Infer, then specify.** From the room's clustered material, infer the dominant
**mood**, the **time of day / era**, and the **material and colour palette**.
Then describe, in vivid, concrete, spatial language:

- **Architecture & scale** — the kind of space, its size, how it's enclosed
  (a low-ceilinged study, an open rooftop at dusk, a long corridor of arches).
- **Materials & colour** — surfaces, textures, the palette (worn oak and brass;
  cold concrete and sodium-orange light; sun-bleached linen and pale sand).
- **Lighting & atmosphere** — the light source, direction, quality, and the air
  itself (low sun raking through dust; overcast flat grey; warm lamplight pooling).
- **The anchor objects** — the concrete objects and features that the room's
  memories map to MUST appear in the scene description, so each becomes a real
  thing the visitor can walk up to and select. If a memory is "the acceptance
  letter", the scene includes a table with a letter on it.

**Let the space imply mood — never state it as fact.** Do not narrate the
person's biography, feelings, diagnosis, or life events. A room can *feel*
triumphant or grieving through light, material, and object choice without the
prompt ever saying so. Describe the space; let it carry the emotion.

**Never include in a `marblePrompt`:** named real people or celebrities, brand
names, copyrighted characters or fictional settings, or direct quotes from the
source material. These degrade generation and violate content rules. Translate
specifics into their physical, generic form (not "Sarah's Nikon", but "a
well-used film camera on a strap").

**No narrative, no characters, no events.** No people in the scene unless the
memory is literally about an object a person left behind. Describe the empty,
inhabitable place.

**Thin input is fine — don't leave gaps.** If a cluster is sparse, default to a
tasteful, atmospheric, warm-but-generic space that fits the mood you inferred.
Never write placeholders, never ask questions, never emit "TODO"-style text.

**Length:** write as much as the place needs to be described fairly and
concretely — usually 3–6 sentences of dense spatial detail. Favour concrete
nouns and light over adjectives.
