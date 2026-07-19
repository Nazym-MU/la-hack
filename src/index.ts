import * as THREE from "three";
import {
  EnvironmentType,
  LocomotionEnvironment,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  SessionMode,
  VisibilityState,
  World,
} from "@iwsdk/core";
import { GaussianSplatLoader, GaussianSplatLoaderSystem } from "./gaussianSplatLoader.js";
import { spawnMemoryObjects, MemorySystem } from "./memoryObjects.js";
import { enableDesktopControls } from "./desktopControls.js";
import { initOverlay } from "./overlay.js";
import { SEED_PALACE } from "./memories.js";


// ------------------------------------------------------------
// World (IWSDK settings)
// ------------------------------------------------------------
World.create(document.getElementById("scene-container") as HTMLDivElement, {
  assets: {},
  xr: {
    sessionMode: SessionMode.ImmersiveVR,
    offer: "always",
    features: { handTracking: true, layers: true },
  },
  render: {
    defaultLighting: false,
  },
  features: {
    locomotion: true,
    grabbing: true,
    physics: false,
    sceneUnderstanding: false,
  },
})
  .then((world) => {
    world.camera.position.set(0, 1.5, 0);
    world.scene.background = new THREE.Color(0x000000);
    world.scene.add(new THREE.AmbientLight(0xffffff, 1.0));

    world
      .registerSystem(GaussianSplatLoaderSystem)
      .registerSystem(MemorySystem);


    // ------------------------------------------------------------
    // Gaussian Splat — the walkable world. Swap splatUrl for a Marble export.
    // ------------------------------------------------------------
    const splatEntity = world.createTransformEntity();
    splatEntity.addComponent(
      GaussianSplatLoader,
      SEED_PALACE.splatUrl ? { splatUrl: SEED_PALACE.splatUrl } : {},
    );

    const splatSystem = world.getSystem(GaussianSplatLoaderSystem)!;

    // Play splat animation when entering XR
    world.visibilityState.subscribe((state) => {
      if (state !== VisibilityState.NonImmersive) {
        splatSystem.replayAnimation(splatEntity).catch((err) => {
          console.error("[World] Failed to replay splat animation:", err);
        });
      }
    });


    // ------------------------------------------------------------
    // Invisible floor for locomotion (must be a Mesh for IWSDK raycasting)
    // ------------------------------------------------------------
    const floorGeometry = new PlaneGeometry(100, 100);
    floorGeometry.rotateX(-Math.PI / 2);
    const floor = new Mesh(floorGeometry, new MeshBasicMaterial());
    floor.visible = false;
    world
      .createTransformEntity(floor)
      .addComponent(LocomotionEnvironment, { type: EnvironmentType.STATIC });

    // Barely-there orientation grid; the Marble world provides the real floor.
    const grid = new THREE.GridHelper(100, 100, 0x3a3650, 0x232030);
    grid.material.transparent = true;
    grid.material.opacity = 0.15;
    world.scene.add(grid);


    // ------------------------------------------------------------
    // Memory objects — one interactable object per Memory in the palace.
    // ------------------------------------------------------------
    spawnMemoryObjects(world);

    // Flat-browser navigation + click picking (stands down inside XR).
    enableDesktopControls(world);

    // Glass DOM overlay: memory card, add-memory modal, TRIPO generate flow.
    initOverlay(world);
  })
  .catch((err) => {
    console.error("[World] Failed to create the IWSDK world:", err);
  });
