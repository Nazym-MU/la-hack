import {
  createSystem,
  Entity,
  PanelUI,
  PanelDocument,
  eq,
  UIKitDocument,
  UIKit,
} from "@iwsdk/core";
import * as THREE from "three";
import type { Memory } from "./memories.js";

// In-world memory panel — the VR counterpart of the DOM memory card. DOM
// overlays don't render inside an immersive WebXR session, so on a headset
// (or the PICO emulator) selecting a memory needs a real 3D panel in the scene.
// It's gated to immersive sessions: on flat desktop the DOM card is used, so
// this panel stays hidden and the two never overlap.

let activePanel: Entity | null = null;
let immersive = false;
let pending: Memory | null = null; // last selection, applied once the panel loads

export function setPanelImmersive(on: boolean): void {
  immersive = on;
  if (!on) hidePanel();
  else if (pending) setPanelMemory(pending); // entering XR with a selection already made
}

export function hidePanel(): void {
  if (activePanel?.object3D) activePanel.object3D.visible = false;
}

// Fill the panel with a memory and show it (VR only). Remembers the last
// selection so it can be applied if the panel document isn't ready yet.
export function setPanelMemory(memory: Memory): void {
  pending = memory;
  if (!immersive || !activePanel) return;
  const doc = PanelDocument.data.document[activePanel.index] as UIKitDocument | undefined;
  if (!doc) return;
  const date = memory.dateGenerated ? new Date(memory.dateGenerated).toLocaleDateString() : "";
  (doc.getElementById("memory-title") as UIKit.Text | null)?.setProperties({ text: memory.label });
  (doc.getElementById("memory-text") as UIKit.Text | null)?.setProperties({ text: memory.note ?? "" });
  (doc.getElementById("memory-rationale") as UIKit.Text | null)?.setProperties({
    text: memory.rationale ? `“${memory.rationale}”` : "",
  });
  (doc.getElementById("memory-date") as UIKit.Text | null)?.setProperties({ text: date });
  if (activePanel.object3D) activePanel.object3D.visible = true;
}

// --- render the panel on top of the Gaussian splats ---
const UI_RENDER_ORDER = 10_000;
const APPLIED_FLAG = "__uiDepthConfigApplied";

function configureUIMaterial(material: THREE.Material | null | undefined): void {
  if (!material) return;
  material.depthTest = true;
  material.depthWrite = true;
  material.depthFunc = THREE.AlwaysDepth;
  if (material instanceof THREE.MeshBasicMaterial && material.map) {
    material.transparent = true;
    material.alphaTest = 0.01;
  }
}

function applyRenderOrderToObject(object3D: THREE.Object3D): void {
  object3D.traverse((obj) => {
    obj.renderOrder = UI_RENDER_ORDER;
    if (obj instanceof THREE.Mesh) {
      if (obj.userData[APPLIED_FLAG]) return;
      obj.userData[APPLIED_FLAG] = true;
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      mats.forEach((m) => configureUIMaterial(m));
    }
  });
}

// Retry a few frames since IWSDK may not have built the panel meshes yet.
export function makeEntityRenderOnTop(entity: Entity): void {
  let attempts = 0;
  const tryApply = () => {
    if (entity.object3D) {
      applyRenderOrderToObject(entity.object3D);
      return;
    }
    if (++attempts < 10) requestAnimationFrame(tryApply);
  };
  tryApply();
}

export class PanelSystem extends createSystem({
  sensaiPanel: {
    required: [PanelUI, PanelDocument],
    where: [eq(PanelUI, "config", "./ui/sensai.json")],
  },
}) {
  init() {
    this.queries.sensaiPanel.subscribe(
      "qualify",
      (entity) => {
        makeEntityRenderOnTop(entity);
        activePanel = entity;
        if (entity.object3D) entity.object3D.visible = false;
        const document = PanelDocument.data.document[entity.index] as UIKitDocument;
        const closeButton = document?.getElementById("close-button") as UIKit.Text | undefined;
        closeButton?.addEventListener("click", () => hidePanel());
      },
      true,
    );
  }
}
