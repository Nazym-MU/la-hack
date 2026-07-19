import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import {
  createComponent,
  createSystem,
  Interactable,
  Mesh,
  PanelDocument,
  PanelUI,
  Pressed,
  Types,
  UIKit,
  UIKitDocument,
  World,
  eq,
} from "@iwsdk/core";
import { SEED_PALACE, type Memory } from "./memories.js";
import { showPanel } from "./uiPanel.js";

// Tag component linking an interactable entity back to its Memory by id.
export const MemoryObject = createComponent("MemoryObject", {
  memoryId: { type: Types.String, default: "" },
});

// Every memory placed in the world (seed or runtime-added) is registered here
// so MemorySystem can resolve a pressed entity back to its data.
const memoryRegistry = new Map<string, Memory>();
export function getMemory(id: string): Memory | undefined {
  return memoryRegistry.get(id);
}

// Placed object roots, for desktop raycast picking. Each carries its memory id
// in userData.memoryId.
export const memoryMeshes: THREE.Object3D[] = [];

// Desktop (mouse) selection funnels through here; MemorySystem drains it so the
// panel is written in exactly one place, whatever triggered the selection.
let requestedMemoryId: string | null = null;
export function requestMemory(id: string): void {
  requestedMemoryId = id;
}

const gltfLoader = new GLTFLoader();

// Calm placeholder orb, used until a real TRIPO GLB is supplied.
function makeOrb(memory: Memory): THREE.Mesh {
  const color = new THREE.Color(memory.color ?? 0x6b7fa8);
  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
    uniforms: {
      uColor: { value: color },
      uRimColor: { value: color.clone().lerp(new THREE.Color(0xffffff), 0.25) },
    },
    vertexShader: /* glsl */ `
      varying vec3 vNormal;
      varying vec3 vViewDir;
      void main() {
        vec4 worldPos = modelMatrix * vec4(position, 1.0);
        vNormal = normalize(normalMatrix * normal);
        vViewDir = normalize(cameraPosition - worldPos.xyz);
        gl_Position = projectionMatrix * viewMatrix * worldPos;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform vec3 uRimColor;
      varying vec3 vNormal;
      varying vec3 vViewDir;
      void main() {
        float fresnel = pow(1.0 - abs(dot(vNormal, vViewDir)), 2.5);
        vec3 color = mix(uColor, uRimColor, fresnel);
        float alpha = fresnel * 0.4 + 0.06;
        gl_FragColor = vec4(color, alpha);
      }
    `,
  });
  const orb = new Mesh(new THREE.SphereGeometry(0.2, 48, 48), material);
  orb.renderOrder = 999;
  return orb;
}

// THE object seam. Places one memory in the world at runtime.
//  - If memory.modelUrl is set, loads that GLB (TRIPO output).
//  - Otherwise renders the placeholder orb.
// The entity is interactable and resolvable back to its Memory on press.
export async function addMemoryObject(
  world: World,
  memory: Memory,
): Promise<void> {
  const resolved: Memory = {
    ...memory,
    dateGenerated: memory.dateGenerated ?? new Date().toISOString(),
  };
  memoryRegistry.set(resolved.id, resolved);

  let object3D: THREE.Object3D;
  if (resolved.modelUrl) {
    const gltf = await gltfLoader.loadAsync(resolved.modelUrl);
    object3D = gltf.scene;
    object3D.scale.setScalar(resolved.scale ?? 1);
  } else {
    object3D = makeOrb(resolved);
    if (resolved.scale) object3D.scale.setScalar(resolved.scale);
  }
  object3D.position.set(...resolved.position);
  object3D.userData.memoryId = resolved.id;
  memoryMeshes.push(object3D);

  world
    .createTransformEntity(object3D)
    .addComponent(Interactable)
    .addComponent(MemoryObject, { memoryId: resolved.id });
}

// Places every memory in the seed palace. Orbs render immediately; any GLBs
// pop in when their load resolves.
export function spawnMemoryObjects(world: World): void {
  for (const memory of SEED_PALACE.memories) {
    void addMemoryObject(world, memory).catch((err) =>
      console.error(`[MemoryObjects] Failed to add "${memory.id}":`, err),
    );
  }
}

// Reacts to a memory object being pressed (rising edge) and pushes its label,
// note, and date into the spatial panel.
export class MemorySystem extends createSystem({
  memories: { required: [Interactable, MemoryObject] },
  panels: {
    required: [PanelUI, PanelDocument],
    where: [eq(PanelUI, "config", "./ui/sensai.json")],
  },
}) {
  private prevPressed = new Set<number>();

  update() {
    const nowPressed = new Set<number>();

    this.queries.memories.entities.forEach((entity) => {
      if (!entity.hasComponent(Pressed)) return;
      nowPressed.add(entity.index);
      if (this.prevPressed.has(entity.index)) return; // still held, not a new press

      const id = entity.getValue(MemoryObject, "memoryId") as string;
      const memory = getMemory(id);
      if (memory) this.showMemory(memory);
    });

    this.prevPressed = nowPressed;

    // Drain any desktop mouse-click selection.
    if (requestedMemoryId) {
      const memory = getMemory(requestedMemoryId);
      requestedMemoryId = null;
      if (memory) this.showMemory(memory);
    }
  }

  private showMemory(memory: Memory): void {
    const date = memory.dateGenerated
      ? new Date(memory.dateGenerated).toLocaleDateString()
      : "";

    this.queries.panels.entities.forEach((panel) => {
      const doc = PanelDocument.data.document[panel.index] as UIKitDocument;
      if (!doc) return;
      const title = doc.getElementById("memory-title") as UIKit.Text | null;
      const text = doc.getElementById("memory-text") as UIKit.Text | null;
      const dateEl = doc.getElementById("memory-date") as UIKit.Text | null;
      title?.setProperties({ text: memory.label });
      text?.setProperties({ text: memory.note ?? "" });
      dateEl?.setProperties({ text: date });
    });

    showPanel();
  }
}
