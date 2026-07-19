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
import { GaussianSplatLoaderSystem } from "./gaussianSplatLoader.js";
import { MemorySystem, onMemorySelected } from "./memoryObjects.js";
import { enableDesktopControls } from "./desktopControls.js";
import { initOverlay, initControlsHint, initPalaceTitle } from "./overlay.js";
import { initUploadPanel } from "./uploadPanel.js";
import { initRoomDropdown } from "./roomDropdown.js";
import { initXrButton } from "./xrButton.js";
import { PanelSystem, setPanelMemory, setPanelImmersive } from "./uiPanel.js";
import { RoomNavSystem, initRoomPanel, setRoomPanelActive, setRoomPanelImmersive } from "./roomPanel.js";
import { createRoomManager, loadPalace, seedAsPalace } from "./rooms.js";


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
  .then(async (world) => {
    world.camera.position.set(0, 1.5, 0);
    world.scene.background = new THREE.Color(0x000000);
    world.scene.add(new THREE.AmbientLight(0xffffff, 1.0));

    world
      .registerSystem(GaussianSplatLoaderSystem)
      .registerSystem(MemorySystem)
      .registerSystem(PanelSystem)
      .registerSystem(RoomNavSystem);


    // ------------------------------------------------------------
    // Invisible floor for locomotion (must be a Mesh for IWSDK raycasting)
    // ------------------------------------------------------------
    const floorGeometry = new PlaneGeometry(200, 200);
    floorGeometry.rotateX(-Math.PI / 2);
    const floor = new Mesh(floorGeometry, new MeshBasicMaterial());
    floor.visible = false;
    world
      .createTransformEntity(floor)
      .addComponent(LocomotionEnvironment, { type: EnvironmentType.STATIC });

    // Barely-there orientation grid; the Marble worlds provide the real floors.
    const grid = new THREE.GridHelper(200, 200, 0x3a3650, 0x232030);
    grid.material.transparent = true;
    grid.material.opacity = 0.15;
    world.scene.add(grid);

    // In-world memory panel (VR): the 3D counterpart of the DOM card, since HTML
    // doesn't render in an immersive session. PanelSystem drives it; it stays
    // hidden on flat desktop (the DOM card handles that) and appears in XR when
    // a memory is selected, floating in front of the visitor.
    world
      .createTransformEntity()
      .addComponent(PanelUI, { config: "./ui/sensai.json", maxHeight: 0.8, maxWidth: 1.6 })
      .addComponent(Interactable)
      .addComponent(ScreenSpace, {
        top: "30%",
        bottom: "30%",
        left: "30%",
        right: "30%",
        height: "40%",
        width: "40%",
      })
      .object3D!.position.set(0, 1.29, -1.9);
    onMemorySelected(setPanelMemory);


    // ------------------------------------------------------------
    // Palace — load the generated schema (rooms + Marble splats + memories);
    // fall back to the seed single-room palace when none has been built yet.
    // One room is shown at a time (teleport between them) so each Marble world
    // fills the view solidly instead of bleeding into its neighbours.
    // ------------------------------------------------------------
    const palace = (await loadPalace()) ?? seedAsPalace();
    console.log(
      `[World] palace "${palace.title}" — ${palace.rooms.length} room(s), ` +
        `${palace.rooms.reduce((n, r) => n + r.memories.length, 0)} memories.`,
    );

    initPalaceTitle(palace.title);
    initControlsHint();
    const manager = createRoomManager(world, palace);
    const setActiveDropdown = initRoomDropdown(manager.titles, (i) => void manager.show(i));
    initRoomPanel(world, manager.titles, (i) => void manager.show(i)); // in-VR room switcher
    manager.onChange((i) => {
      setActiveDropdown(i);
      setRoomPanelActive(i);
    });
    await manager.show(0);

    // Room switching: [ / ] to cycle, number keys to jump. F cycles the world
    // orientation live (none -> flip-X -> flip-Z) so we can nail the viewpoint.
    let hintTimer = 0;
    const flashHint = (text: string) => {
      const hint = document.getElementById("mp-controls-hint");
      if (!hint) return;
      hint.textContent = text;
      window.clearTimeout(hintTimer);
      hintTimer = window.setTimeout(() => {
        hint.textContent = "walk WASD · up/down E Q · look drag · rooms [ ] · flip F";
      }, 2500);
    };
    window.addEventListener("keydown", (e) => {
      if ((e.target as HTMLElement)?.tagName === "INPUT" || (e.target as HTMLElement)?.tagName === "TEXTAREA") return;
      if (e.code === "BracketRight") manager.next();
      else if (e.code === "BracketLeft") manager.prev();
      else if (e.code === "KeyF") flashHint(`orientation: ${manager.cycleFlip()} — press F to cycle`);
      else if (/^Digit[1-9]$/.test(e.code)) {
        const i = Number(e.code.slice(5)) - 1;
        if (i < manager.count) void manager.show(i);
      }
    });

    // Replay the current room's splat fly-in when entering XR.
    const splatSystem = world.getSystem(GaussianSplatLoaderSystem)!;
    world.visibilityState.subscribe((state) => {
      const immersive = state !== VisibilityState.NonImmersive;
      setPanelImmersive(immersive); // memory panel is XR-only
      setRoomPanelImmersive(immersive); // room switcher is XR-only
      if (!immersive) return;

      // Start at the room's eye level. In XR the headset adds real head height
      // on top of the player rig, so drop the rig by ~standing height to land
      // the eyes where the desktop camera sat (the Marble capture eye). Tune
      // XR_EYE_RIG_Y if the view sits too high or low in the headset.
      const XR_EYE_RIG_Y = -1.6;
      world.player.position.set(0, XR_EYE_RIG_Y, 0);
      world.player.rotation.set(0, 0, 0);

      const entity = manager.splatEntity();
      if (entity) {
        splatSystem.replayAnimation(entity).catch((err) => {
          console.error("[World] Failed to replay splat animation:", err);
        });
      }
    });

    // Flat-browser navigation + click picking (stands down inside XR).
    enableDesktopControls(world);

    // Glass DOM overlay: memory card (now with rationale), add-memory modal.
    initOverlay(world);

    // Upload panel: drop photos -> server runs the pipeline -> palace reloads.
    initUploadPanel();

    // In-app "Enter XR" button for headset browsers (PICO) that get no
    // IWER-injected one. Hidden where immersive-VR isn't supported.
    initXrButton(world);
  })
  .catch((err) => {
    console.error("[World] Failed to create the IWSDK world:", err);
  });
