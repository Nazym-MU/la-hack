import { VisibilityState, type World } from "@iwsdk/core";

// An in-app "Enter XR" button for headset browsers (e.g. PICO). The desktop dev
// build gets a button injected by the IWER emulator, but a real headset browser
// does not — so there's no way to leave the flat view and enter the immersive
// session. This button fills that gap: it calls world.launchXR() (the same
// immersive-VR entry point, honouring the xr config in World.create) straight
// from the click, which is the user gesture WebXR requires to start a session.
//
// It's only shown where an immersive-VR session can actually begin, and it hides
// itself while a session is running (there's nothing to click in-headset).

export function initXrButton(world: World): void {
  const btn = document.createElement("button");
  btn.id = "mp-xr-btn";
  btn.type = "button";
  btn.title = "Enter the palace in VR";
  btn.innerHTML = `<span class="mp-xr-glyph" aria-hidden="true">🥽</span> Enter XR`;
  btn.hidden = true; // stays hidden until we confirm XR is supported
  document.body.appendChild(btn);

  let supported = false;
  let inSession = false;
  const refresh = () => {
    btn.hidden = !supported || inSession;
  };

  btn.addEventListener("click", () => {
    try {
      world.launchXR();
    } catch (err) {
      console.error("[XR] launchXR failed:", err);
    }
  });

  // Only offer the button where immersive-VR can actually start. On a plain
  // desktop browser with no WebXR, navigator.xr is undefined and it stays hidden.
  const xr = navigator.xr;
  if (xr?.isSessionSupported) {
    xr.isSessionSupported("immersive-vr")
      .then((ok) => {
        supported = ok;
        refresh();
      })
      .catch(() => {
        supported = false;
        refresh();
      });
  }

  // Stand down while inside a session; reappear on exit.
  world.visibilityState.subscribe((state) => {
    inSession = state !== VisibilityState.NonImmersive;
    refresh();
  });
}
