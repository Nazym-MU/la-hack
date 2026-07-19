// Assign each room a world-space origin so rooms are spatially connected and
// walkable. Marble worlds each have their own local origin; we place room i's
// whole world (splat + memories) at a computed offset. Memory positions in the
// schema stay room-local — the viewer adds the room origin at spawn time.
//
// "line": rooms in a row along +x, spaced so you walk from one into the next.
// (A grid pattern could go here later; the viewer doesn't care which.)

export function assignLayout(draft, config = {}) {
  const pattern = config.layout?.pattern ?? "line";
  const spacing = config.layout?.roomSpacingMeters ?? 14;

  draft.rooms.forEach((room, i) => {
    if (pattern === "grid") {
      const cols = Math.ceil(Math.sqrt(draft.rooms.length));
      const col = i % cols;
      const row = Math.floor(i / cols);
      room.origin = [col * spacing, 0, -row * spacing];
    } else {
      // line (default)
      room.origin = [i * spacing, 0, 0];
    }
    // Enter each room at its centre, standing height, looking along -z.
    room.spawn = room.spawn ?? [0, 1.5, 0];
  });

  return draft;
}
