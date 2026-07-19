import * as THREE from "three";
import type { World } from "@iwsdk/core";

// Desktop placement mode: the object ghosts along the floor following the
// mouse (camera ray intersected with the y=0 plane — a Gaussian splat has no
// queryable surfaces, so the floor plane IS the placement surface). A clean
// click confirms, Escape cancels. Used both for placing a freshly generated
// object and for moving an existing one.

const CLICK_SLOP_PX = 5;
const MAX_PLACE_DISTANCE = 14;

let placing = false;
// desktopControls checks this so a placement click doesn't also select.
export function isPlacing(): boolean {
  return placing;
}

interface PlacementOptions {
  // Y the object rests at while following the mouse. 0 for grounded GLBs
  // (their origin is at the base); pass the current height when moving an
  // orb so it keeps floating.
  floatHeight?: number;
}

// Resolves with the confirmed position, or null if cancelled (the object's
// original position is restored on cancel).
export function startPlacement(
  world: World,
  object3D: THREE.Object3D,
  options: PlacementOptions = {},
): Promise<THREE.Vector3 | null> {
  const camera = world.camera as THREE.PerspectiveCamera;
  const dom = world.renderer.domElement;
  const floatHeight = options.floatHeight ?? 0;

  const floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const hit = new THREE.Vector3();
  const originalPosition = object3D.position.clone();

  placing = true;
  setGhost(object3D, true);

  return new Promise((resolve) => {
    let downX = 0;
    let downY = 0;

    const onMove = (e: PointerEvent) => {
      const rect = dom.getBoundingClientRect();
      ndc.set(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      );
      raycaster.setFromCamera(ndc, camera);
      if (!raycaster.ray.intersectPlane(floorPlane, hit)) return; // looking at the sky

      // Keep placements within reach of the camera.
      const dx = hit.x - camera.position.x;
      const dz = hit.z - camera.position.z;
      const dist = Math.hypot(dx, dz);
      if (dist > MAX_PLACE_DISTANCE) {
        hit.x = camera.position.x + (dx / dist) * MAX_PLACE_DISTANCE;
        hit.z = camera.position.z + (dz / dist) * MAX_PLACE_DISTANCE;
      }
      object3D.position.set(hit.x, floatHeight, hit.z);
    };

    const onDown = (e: PointerEvent) => {
      downX = e.clientX;
      downY = e.clientY;
    };

    const onUp = (e: PointerEvent) => {
      // A drag is the user orbiting the camera, not a placement click.
      if (Math.hypot(e.clientX - downX, e.clientY - downY) > CLICK_SLOP_PX) {
        return;
      }
      finish(object3D.position.clone());
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        object3D.position.copy(originalPosition);
        finish(null);
      }
    };

    const finish = (position: THREE.Vector3 | null) => {
      dom.removeEventListener("pointermove", onMove);
      dom.removeEventListener("pointerdown", onDown);
      dom.removeEventListener("pointerup", onUp);
      window.removeEventListener("keydown", onKey);
      setGhost(object3D, false);
      placing = false;
      resolve(position);
    };

    dom.addEventListener("pointermove", onMove);
    dom.addEventListener("pointerdown", onDown);
    dom.addEventListener("pointerup", onUp);
    window.addEventListener("keydown", onKey);
  });
}

// Semi-transparent while following the mouse; restored on drop/cancel.
// (No-op for the orb's ShaderMaterial — it's already translucent.)
function setGhost(object3D: THREE.Object3D, ghost: boolean): void {
  object3D.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return;
    const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
    for (const material of materials) {
      if (material instanceof THREE.ShaderMaterial) continue;
      if (ghost) {
        obj.userData.__ghostPrev = {
          transparent: material.transparent,
          opacity: material.opacity,
        };
        material.transparent = true;
        material.opacity = 0.55;
      } else if (obj.userData.__ghostPrev) {
        material.transparent = obj.userData.__ghostPrev.transparent;
        material.opacity = obj.userData.__ghostPrev.opacity;
        delete obj.userData.__ghostPrev;
      }
      material.needsUpdate = true;
    }
  });
}
