// Top-right room switcher: a plain dropdown listing every room in the
// (single) palace — the only room switcher now (the old top-center chip row
// was removed as redundant). Renders nothing for a 0/1-room palace.

export function initRoomDropdown(
  titles: string[],
  onSelect: (index: number) => void,
): (active: number) => void {
  if (titles.length <= 1) return () => {};

  const select = document.createElement("select");
  select.id = "mp-room-dropdown";
  select.title = "Jump to a room";
  titles.forEach((title, i) => {
    const opt = document.createElement("option");
    opt.value = String(i);
    opt.textContent = `${i + 1} · ${title}`;
    select.appendChild(opt);
  });
  select.addEventListener("change", () => onSelect(Number(select.value)));
  document.body.appendChild(select);

  return (active: number) => {
    select.value = String(active);
  };
}
