import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { VisibilityState, World } from "@iwsdk/core";
import { memoryMeshes, requestMemory } from "./memoryObjects.js";

// Non-immersive navigation + picking. IWSDK ships neither for the flat browser
// view, so we add OrbitControls (look/zoom around the palace) and a canvas
// raycaster that turns a click into a memory selection. Both stand down while
// an immersive XR session owns the camera and pointer.
const CLICK_SLOP_PX = 5; // pointer travel above this counts as an orbit drag, not a click

export function enableDesktopControls(world: World): void {
  const camera = world.camera as THREE.PerspectiveCamera;
  const dom = world.renderer.domElement;

  const controls = new OrbitControls(camera, dom);
  controls.target.set(0, 1.3, -2);
  controls.enableDamping = false;
  controls.minDistance = 0.5;
  controls.maxDistance = 12;
  controls.update();

  world.visibilityState.subscribe((state) => {
    controls.enabled = state === VisibilityState.NonImmersive;
  });

  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  let downX = 0;
  let downY = 0;

  dom.addEventListener("pointerdown", (e) => {
    downX = e.clientX;
    downY = e.clientY;
  });

  dom.addEventListener("pointerup", (e) => {
    if (Math.hypot(e.clientX - downX, e.clientY - downY) > CLICK_SLOP_PX) return;

    const rect = dom.getBoundingClientRect();
    ndc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    ndc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(ndc, camera);

    const hits = raycaster.intersectObjects(memoryMeshes, true);
    if (!hits.length) return;

    let obj: THREE.Object3D | null = hits[0].object;
    while (obj && obj.userData.memoryId === undefined) obj = obj.parent;
    if (obj?.userData.memoryId) requestMemory(obj.userData.memoryId as string);
  });
}
