
import * as THREE from "three";
import {
  EnvironmentType,
  Interactable,
  LocomotionEnvironment,
  Mesh,
  MeshBasicMaterial,
  PanelUI,
  PlaneGeometry,
  ScreenSpace,
  SessionMode,
  VisibilityState,
  World,
} from "@iwsdk/core";
import { PanelSystem } from "./uiPanel.js";
import { GaussianSplatLoader, GaussianSplatLoaderSystem,} from "./gaussianSplatLoader.js";
import { spawnMemoryObjects, MemorySystem } from "./memoryObjects.js";
import { enableDesktopControls } from "./desktopControls.js";
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
      .registerSystem(PanelSystem)
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

    const grid = new THREE.GridHelper(100, 100, 0x444444, 0x222222);
    grid.material.transparent = true;
    grid.material.opacity = 0.4;
    world.scene.add(grid);


    // ------------------------------------------------------------
    // Memory objects — one interactable orb per Memory in the palace.
    // ------------------------------------------------------------
    spawnMemoryObjects(world);

    // Flat-browser navigation + click picking (stands down inside XR).
    enableDesktopControls(world);


    // ------------------------------------------------------------
    // Panel UI (centered on screen in desktop, positioned in 3D for XR)
    // ------------------------------------------------------------
    const panelEntity = world
      .createTransformEntity()
      .addComponent(PanelUI, {
        config: "./ui/sensai.json",
        maxHeight: 0.8,
        maxWidth: 1.6,
      })
      .addComponent(Interactable)
      .addComponent(ScreenSpace, {
        top: "30%",
        bottom: "30%",
        left: "30%",
        right: "30%",
        height: "40%",
        width: "40%",
      });
    panelEntity.object3D!.position.set(0, 1.29, -1.9);

  })
  .catch((err) => {
    console.error("[World] Failed to create the IWSDK world:", err);
    const container = document.getElementById("scene-container");
  });

  
