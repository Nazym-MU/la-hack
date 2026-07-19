// The simplest "build a palace on the website" UI: a button that opens a modal
// to upload photos (+ optional notes), POSTs them to the server's
// /api/build-palace, streams the pipeline's progress over SSE, and reloads the
// viewer with the freshly generated palace when it finishes.

export function initUploadPanel(): void {
  const root = document.createElement("div");
  root.id = "mp-build";
  root.innerHTML = /* html */ `
    <button id="mp-build-btn" title="Build a palace from your photos">✦&nbsp;Build from photos</button>
    <div id="mp-build-backdrop" class="mp-hidden">
      <div id="mp-build-modal" class="mp-glass">
        <h2>Build a palace</h2>
        <p class="mp-sub">Upload a few photos (notes optional). They're clustered into rooms and each world is generated. Takes a few minutes.</p>
        <label>Photos
          <input id="mp-build-files" type="file" accept="image/*" multiple />
        </label>
        <label>Notes <span style="text-transform:none;opacity:.6">(optional)</span>
          <textarea id="mp-build-notes" placeholder="anything about these memories — names, feelings, what happened"></textarea>
        </label>
        <div class="mp-actions">
          <button id="mp-build-cancel" type="button">Cancel</button>
          <button id="mp-build-go" type="button">Build</button>
        </div>
        <pre id="mp-build-log" class="mp-hidden"></pre>
      </div>
    </div>
  `;
  document.body.appendChild(root);

  const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
  const backdrop = el<HTMLDivElement>("mp-build-backdrop");
  const filesInput = el<HTMLInputElement>("mp-build-files");
  const notes = el<HTMLTextAreaElement>("mp-build-notes");
  const goBtn = el<HTMLButtonElement>("mp-build-go");
  const logBox = el<HTMLPreElement>("mp-build-log");
  let busy = false;

  const open = () => backdrop.classList.remove("mp-hidden");
  const close = () => {
    if (!busy) backdrop.classList.add("mp-hidden");
  };
  el<HTMLButtonElement>("mp-build-btn").addEventListener("click", open);
  el<HTMLButtonElement>("mp-build-cancel").addEventListener("click", close);
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) close();
  });

  const appendLog = (line: string) => {
    logBox.classList.remove("mp-hidden");
    logBox.textContent += line + "\n";
    logBox.scrollTop = logBox.scrollHeight;
  };

  goBtn.addEventListener("click", async () => {
    if (busy) return;
    const fileList = Array.from(filesInput.files ?? []);
    if (!fileList.length && !notes.value.trim()) {
      appendLog("Add at least one photo or some notes.");
      return;
    }
    busy = true;
    goBtn.disabled = true;
    goBtn.textContent = "Building…";
    logBox.textContent = "";

    try {
      appendLog(`reading ${fileList.length} photo(s)…`);
      const files = await Promise.all(
        fileList.map(
          (f) =>
            new Promise<{ name: string; dataUrl: string }>((resolve, reject) => {
              const r = new FileReader();
              r.onload = () => resolve({ name: f.name, dataUrl: r.result as string });
              r.onerror = () => reject(r.error);
              r.readAsDataURL(f);
            }),
        ),
      );

      appendLog("sending to the pipeline…");
      const res = await fetch("/api/build-palace", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ files, notes: notes.value, provider: "openai" }),
      });
      const j = await res.json();
      if (!res.ok || !j.jobId) throw new Error(j.error ?? "the build didn't start");

      const es = new EventSource(`/api/build-palace/${j.jobId}/stream`);
      es.onmessage = (ev) => {
        const d = JSON.parse(ev.data);
        if (d.line) appendLog(d.line);
        if (d.done) {
          es.close();
          if (d.ok) {
            appendLog("\n✓ done — reloading the palace…");
            setTimeout(() => location.reload(), 1500);
          } else {
            appendLog("\n✗ build failed — see the log above.");
            resetButton();
          }
        }
      };
      es.onerror = () => {
        appendLog("(progress stream dropped — the build may still be running; refresh in a minute)");
        es.close();
        resetButton();
      };
    } catch (err) {
      appendLog("error: " + (err as Error).message);
      resetButton();
    }
  });

  function resetButton() {
    busy = false;
    goBtn.disabled = false;
    goBtn.textContent = "Build";
  }
}
