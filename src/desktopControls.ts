import * as THREE from "three";
import { VisibilityState, World } from "@iwsdk/core";
import { memoryMeshes, requestMemory } from "./memoryObjects.js";
import { isPlacing } from "./placement.js";

// Flat-browser navigation: first-person WALK, not orbit. WASD / arrow keys move
// you across the floor at eye height (Shift to move faster); drag the mouse to
// look around. A click that doesn't drag selects a memory. Everything stands
// down while an immersive XR session owns the camera and pointer.
//
// Movement is horizontal only (y is left at the spawn height), so you walk
// rather than fly. Collision against room geometry is a future step — for now
// you can pass through walls.

const CLICK_SLOP_PX = 5;
const LOOK_SENSITIVITY = 0.0026;
const WALK_SPEED = 2.0; // metres / second (rooms are small — walk gently)
const RUN_SPEED = 4.0;
const ROOM_BOUND = 4.5; // keep the visitor inside the room, not out in the void
const PITCH_LIMIT = 1.45; // ~83°
const WORLD_UP = new THREE.Vector3(0, 1, 0);
const MOVE_CODES = new Set([
  "KeyW", "KeyA", "KeyS", "KeyD",
  "KeyE", "KeyQ", // fly up / down (set eye level)
  "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight",
  "ShiftLeft", "ShiftRight",
]);

function isTyping(): boolean {
  const el = document.activeElement;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA");
}

export function enableDesktopControls(world: World): void {
  const camera = world.camera as THREE.PerspectiveCamera;
  const dom = world.renderer.domElement;

  let enabled = true;
  world.visibilityState.subscribe((state) => {
    enabled = state === VisibilityState.NonImmersive;
    if (!enabled) keys.clear();
  });

  // ---- look (drag) ----
  const euler = new THREE.Euler(0, 0, 0, "YXZ");
  euler.setFromQuaternion(camera.quaternion);
  let dragging = false;
  let downX = 0;
  let downY = 0;
  let travel = 0;

  dom.addEventListener("pointerdown", (e) => {
    if (!enabled || isPlacing()) return;
    dragging = true;
    downX = e.clientX;
    downY = e.clientY;
    travel = 0;
    dom.setPointerCapture?.(e.pointerId);
  });

  dom.addEventListener("pointermove", (e) => {
    if (!dragging || !enabled) return;
    const dx = e.movementX || 0;
    const dy = e.movementY || 0;
    travel += Math.abs(dx) + Math.abs(dy);
    euler.y += dx * LOOK_SENSITIVITY;
    euler.x = THREE.MathUtils.clamp(euler.x + dy * LOOK_SENSITIVITY, -PITCH_LIMIT, PITCH_LIMIT);
    camera.quaternion.setFromEuler(euler);
  });

  dom.addEventListener("pointerup", (e) => {
    dom.releasePointerCapture?.(e.pointerId);
    if (!dragging) return;
    dragging = false;
    if (isPlacing()) return; // placement owns this click
    if (Math.hypot(e.clientX - downX, e.clientY - downY) > CLICK_SLOP_PX) return; // was a look-drag
    pick(e.clientX, e.clientY);
  });

  // ---- click-to-select ----
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  function pick(clientX: number, clientY: number) {
    const rect = dom.getBoundingClientRect();
    ndc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    ndc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(ndc, camera);
    const hits = raycaster.intersectObjects(memoryMeshes, true);
    if (!hits.length) return;
    let obj: THREE.Object3D | null = hits[0].object;
    while (obj && obj.userData.memoryId === undefined) obj = obj.parent;
    if (obj?.userData.memoryId) requestMemory(obj.userData.memoryId as string);
  }

  // ---- move (keys) ----
  const keys = new Set<string>();
  window.addEventListener("keydown", (e) => {
    if (isTyping() || !MOVE_CODES.has(e.code)) return;
    keys.add(e.code);
    if (e.code.startsWith("Arrow")) e.preventDefault();
  });
  window.addEventListener("keyup", (e) => keys.delete(e.code));
  window.addEventListener("blur", () => keys.clear());

  const clock = new THREE.Clock();
  const forward = new THREE.Vector3();
  const right = new THREE.Vector3();
  const move = new THREE.Vector3();

  function tick() {
    requestAnimationFrame(tick);
    const dt = Math.min(clock.getDelta(), 0.05);
    if (!enabled || keys.size === 0) return;

    const speed = (keys.has("ShiftLeft") || keys.has("ShiftRight") ? RUN_SPEED : WALK_SPEED) * dt;

    // Horizontal walk, relative to where you're looking.
    camera.getWorldDirection(forward);
    forward.y = 0;
    if (forward.lengthSq() > 1e-6) {
      forward.normalize();
      right.crossVectors(forward, WORLD_UP).normalize();
      move.set(0, 0, 0);
      if (keys.has("KeyW") || keys.has("ArrowUp")) move.add(forward);
      if (keys.has("KeyS") || keys.has("ArrowDown")) move.sub(forward);
      if (keys.has("KeyD") || keys.has("ArrowRight")) move.add(right);
      if (keys.has("KeyA") || keys.has("ArrowLeft")) move.sub(right);
      if (move.lengthSq() > 0) {
        move.normalize().multiplyScalar(speed);
        camera.position.x += move.x;
        camera.position.z += move.z;
      }
    }

    // Vertical fly to set eye level (E up / Q down).
    if (keys.has("KeyE")) camera.position.y += speed;
    if (keys.has("KeyQ")) camera.position.y -= speed;

    // Soft boundary on the floor plane: stay inside the room, not out in the void.
    camera.position.x = THREE.MathUtils.clamp(camera.position.x, -ROOM_BOUND, ROOM_BOUND);
    camera.position.z = THREE.MathUtils.clamp(camera.position.z, -ROOM_BOUND, ROOM_BOUND);
  }
  tick();
}
