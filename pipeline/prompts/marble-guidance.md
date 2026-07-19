## Marble prompt guidance (read this before writing any `marblePrompt`)

World Labs Marble turns your text into a navigable Gaussian-splat world. The
prompt is the *entire* specification of the place — write it as a **scene
description for a 3D environment generator**, not a story.

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
