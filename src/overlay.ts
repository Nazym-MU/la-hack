import * as THREE from "three";
import type { World } from "@iwsdk/core";
import "./overlay.css";
import type { Memory } from "./memories.js";
import {
  addPlacedMemory,
  getMemoryObject3D,
  loadMemoryModel,
  makeOrb,
  onMemorySelected,
} from "./memoryObjects.js";
import { generateModel, type GenerationStatus } from "./generation.js";
import { startPlacement } from "./placement.js";

// The flat-browser UI: a small glass memory card (visible only after clicking
// an object), a floating "+" button, and the add-memory modal that drives the
// TRIPO generate -> place flow. Pure DOM on top of the canvas — no uikitml.

const ORB_PALETTE = [0x8b9fd4, 0xb08bc9, 0xc9a37e, 0x7eb8a6, 0xc98b9b];

const STATUS_LINES: Record<string, string> = {
  queued: "Waiting for the dream to start…",
  running: "Shaping your memory…",
};

export function initOverlay(world: World): void {
  const root = document.createElement("div");
  root.id = "mp-overlay";
  root.innerHTML = /* html */ `
    <div id="mp-toast" class="mp-glass mp-hidden">
      <span class="mp-spinner"></span><span id="mp-toast-text"></span>
    </div>
    <div id="mp-place-hint" class="mp-glass mp-hidden">
      move the mouse to position it &nbsp;·&nbsp; click to place &nbsp;·&nbsp; esc to cancel
    </div>
    <button id="mp-add-btn" title="Add a memory">+</button>
    <div id="mp-card" class="mp-glass mp-hidden">
      <button id="mp-card-close" title="Close">×</button>
      <h3 id="mp-card-title"></h3>
      <p id="mp-card-note"></p>
      <div id="mp-card-footer">
        <span id="mp-card-date"></span>
        <button id="mp-card-move">move</button>
      </div>
    </div>
    <div id="mp-modal-backdrop" class="mp-hidden">
      <div id="mp-modal" class="mp-glass">
        <h2>New memory</h2>
        <p class="mp-sub">Describe an object to hold it. It will be dreamed into the room.</p>
        <label>Title
          <input id="mp-in-title" type="text" placeholder="First flight" />
        </label>
        <label>The object
          <textarea id="mp-in-prompt" placeholder="a paper airplane folded from a boarding pass"></textarea>
        </label>
        <label>Notes <span style="text-transform:none;opacity:.6">(optional)</span>
          <textarea id="mp-in-note" placeholder="how it felt, what you want to keep"></textarea>
        </label>
        <div class="mp-row">
          <label>Date
            <input id="mp-in-date" type="date" />
          </label>
          <label>Photo <span style="text-transform:none;opacity:.6">(optional)</span>
            <input id="mp-in-image" type="file" accept="image/*" />
            <button id="mp-image-btn" type="button">generate from a photo</button>
          </label>
        </div>
        <div class="mp-actions">
          <button id="mp-cancel" type="button">Cancel</button>
          <button id="mp-generate" type="button">Generate</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(root);

  const el = <T extends HTMLElement>(id: string) =>
    document.getElementById(id) as T;
  const card = el<HTMLDivElement>("mp-card");
  const cardTitle = el<HTMLHeadingElement>("mp-card-title");
  const cardNote = el<HTMLParagraphElement>("mp-card-note");
  const cardDate = el<HTMLSpanElement>("mp-card-date");
  const backdrop = el<HTMLDivElement>("mp-modal-backdrop");
  const toast = el<HTMLDivElement>("mp-toast");
  const toastText = el<HTMLSpanElement>("mp-toast-text");
  const spinner = toast.querySelector(".mp-spinner") as HTMLSpanElement;
  const placeHint = el<HTMLDivElement>("mp-place-hint");
  const inTitle = el<HTMLInputElement>("mp-in-title");
  const inPrompt = el<HTMLTextAreaElement>("mp-in-prompt");
  const inNote = el<HTMLTextAreaElement>("mp-in-note");
  const inDate = el<HTMLInputElement>("mp-in-date");
  const inImage = el<HTMLInputElement>("mp-in-image");
  const imageBtn = el<HTMLButtonElement>("mp-image-btn");
  const generateBtn = el<HTMLButtonElement>("mp-generate");

  let selectedMemory: Memory | null = null;
  let busy = false;

  // ---------- memory card ----------
  const showCard = (memory: Memory) => {
    selectedMemory = memory;
    cardTitle.textContent = memory.label;
    cardNote.textContent = memory.note ?? "";
    cardDate.textContent = memory.dateGenerated
      ? new Date(memory.dateGenerated).toLocaleDateString(undefined, {
          year: "numeric",
          month: "long",
          day: "numeric",
        })
      : "";
    card.classList.remove("mp-hidden");
  };
  const hideCard = () => card.classList.add("mp-hidden");

  onMemorySelected(showCard);
  el<HTMLButtonElement>("mp-card-close").addEventListener("click", hideCard);

  // ---------- toast ----------
  const showToast = (text: string, withSpinner = true) => {
    toastText.textContent = text;
    spinner.classList.toggle("mp-hidden", !withSpinner);
    toast.classList.remove("mp-hidden");
  };
  const hideToast = () => toast.classList.add("mp-hidden");
  const flashToast = (text: string, ms = 4000) => {
    showToast(text, false);
    setTimeout(hideToast, ms);
  };

  // ---------- add-memory modal ----------
  const openModal = () => {
    inDate.value = new Date().toISOString().slice(0, 10);
    backdrop.classList.remove("mp-hidden");
    inTitle.focus();
  };
  const closeModal = () => backdrop.classList.add("mp-hidden");

  el<HTMLButtonElement>("mp-add-btn").addEventListener("click", openModal);
  el<HTMLButtonElement>("mp-cancel").addEventListener("click", closeModal);
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) closeModal();
  });
  window.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    closeModal();
    hideCard();
  });

  imageBtn.addEventListener("click", () => inImage.click());
  inImage.addEventListener("change", () => {
    imageBtn.textContent = inImage.files?.[0]
      ? inImage.files[0].name
      : "generate from a photo";
  });

  // ---------- generate -> place flow ----------
  generateBtn.addEventListener("click", async () => {
    if (busy) return;
    const prompt = inPrompt.value.trim();
    const imageFile = inImage.files?.[0] ?? null;
    if (!prompt && !imageFile) {
      inPrompt.focus();
      return;
    }

    const memory: Memory = {
      id: `m-${Date.now()}`,
      label: inTitle.value.trim() || prompt.slice(0, 40) || "Untitled memory",
      note: inNote.value.trim() || undefined,
      position: [0, 0, 0], // set by placement below
      dateGenerated: inDate.value
        ? new Date(`${inDate.value}T12:00:00`).toISOString()
        : undefined,
      color: ORB_PALETTE[Math.floor(Math.random() * ORB_PALETTE.length)],
    };

    busy = true;
    generateBtn.disabled = true;
    closeModal();

    let object3D: THREE.Object3D;
    let floatHeight = 0;
    try {
      showToast("Sending it off to be dreamed…");
      const imageDataUrl = imageFile ? await fileToDataUrl(imageFile) : undefined;
      const modelUrl = await generateModel({ prompt, imageDataUrl }, (s) =>
        showToast(statusLine(s)),
      );
      showToast("Bringing the object in…");
      object3D = await loadMemoryModel(modelUrl);
      memory.modelUrl = modelUrl;
    } catch (err) {
      console.error("[Overlay] generation failed:", err);
      flashToast("Generation didn’t come back — placing a soft orb instead.");
      object3D = makeOrb(memory.color);
      floatHeight = 1.2;
    }

    hideToast();
    resetModalFields();

    // Preview lives directly in the scene; on confirm it becomes an entity.
    world.scene.add(object3D);
    placeHint.classList.remove("mp-hidden");
    const position = await startPlacement(world, object3D, { floatHeight });
    placeHint.classList.add("mp-hidden");
    world.scene.remove(object3D);

    if (position) {
      memory.position = [position.x, position.y, position.z];
      addPlacedMemory(world, memory, object3D);
      showCard(memory);
    }

    busy = false;
    generateBtn.disabled = false;
  });

  // ---------- move an existing memory ----------
  el<HTMLButtonElement>("mp-card-move").addEventListener("click", async () => {
    if (busy || !selectedMemory) return;
    const object3D = getMemoryObject3D(selectedMemory.id);
    if (!object3D) return;

    busy = true;
    hideCard();
    placeHint.classList.remove("mp-hidden");
    const position = await startPlacement(world, object3D, {
      floatHeight: object3D.position.y, // orbs keep floating, GLBs stay grounded
    });
    placeHint.classList.add("mp-hidden");

    if (position) {
      selectedMemory.position = [position.x, position.y, position.z];
    }
    busy = false;
  });

  function resetModalFields() {
    inTitle.value = "";
    inPrompt.value = "";
    inNote.value = "";
    inImage.value = "";
    imageBtn.textContent = "generate from a photo";
  }
}

function statusLine(status: GenerationStatus): string {
  const base = STATUS_LINES[status.status] ?? "Shaping your memory…";
  return status.progress ? `${base} ${status.progress}%` : base;
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}
