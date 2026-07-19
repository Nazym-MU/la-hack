import {
  createSystem,
  Entity,
  Interactable,
  PanelUI,
  PanelDocument,
  ScreenSpace,
  eq,
  UIKitDocument,
  UIKit,
  type World,
} from "@iwsdk/core";
import { makeEntityRenderOnTop } from "./uiPanel.js";

// In-world room switcher (VR) — the 3D counterpart of the browser's room
// dropdown. A corner panel with one button per room; tapping a button teleports
// to that room. Shown only in an immersive session (desktop uses the DOM
// dropdown) and only when there's more than one room.

const MAX_SLOTS = 8; // fixed button slots in ui/roomnav.uikitml

let titles: string[] = [];
let onSelect: (index: number) => void = () => {};
let panel: Entity | null = null;
let immersive = false;
let activeIndex = 0;

// Create the panel entity and remember the rooms + the switch callback.
// RoomNavSystem (registered in index.ts) fills in the buttons once it loads.
export function initRoomPanel(world: World, roomTitles: string[], select: (index: number) => void): void {
  titles = roomTitles;
  onSelect = select;
  panel = world
    .createTransformEntity()
    .addComponent(PanelUI, { config: "./ui/roomnav.json", maxHeight: 0.7, maxWidth: 0.42 })
    .addComponent(Interactable)
    .addComponent(ScreenSpace, { top: "8%", right: "4%", width: "22%", height: "46%" });
  // Fixed spot up and to the right, used in XR (ScreenSpace drives desktop).
  panel.object3D!.position.set(0.85, 1.7, -1.6);
}

export function setRoomPanelImmersive(on: boolean): void {
  immersive = on;
  if (panel?.object3D) panel.object3D.visible = on && titles.length > 1;
}

export function setRoomPanelActive(index: number): void {
  activeIndex = index;
  paintActive();
}

function paintActive(): void {
  if (!panel) return;
  const doc = PanelDocument.data.document[panel.index] as UIKitDocument | undefined;
  if (!doc) return;
  for (let s = 0; s < MAX_SLOTS; s++) {
    const btn = doc.getElementById(`room-btn-${s}`) as UIKit.Text | null;
    if (!btn || s >= titles.length) continue;
    btn.setProperties({
      backgroundColor: s === activeIndex ? "#4a4636" : "#2a2824",
      color: s === activeIndex ? "#ffffff" : "#d8d4cc",
    });
  }
}

export class RoomNavSystem extends createSystem({
  nav: {
    required: [PanelUI, PanelDocument],
    where: [eq(PanelUI, "config", "./ui/roomnav.json")],
  },
}) {
  init() {
    this.queries.nav.subscribe(
      "qualify",
      (entity) => {
        makeEntityRenderOnTop(entity);
        if (entity.object3D) entity.object3D.visible = immersive && titles.length > 1;
        const doc = PanelDocument.data.document[entity.index] as UIKitDocument | undefined;
        if (!doc) return;
        for (let s = 0; s < MAX_SLOTS; s++) {
          const btn = doc.getElementById(`room-btn-${s}`) as UIKit.Text | null;
          if (!btn) continue;
          if (s < titles.length) {
            btn.setProperties({ text: `${s + 1}.  ${titles[s]}` });
            btn.addEventListener("click", () => onSelect(s));
          } else {
            btn.setProperties({ display: "none" });
          }
        }
        paintActive();
      },
      true,
    );
  }
}
