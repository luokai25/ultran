/**
 * Safe bridge between the Ultran brain and the visible application.
 *
 * The model may request semantic actions, never arbitrary JavaScript or CSS
 * selectors. Clicks are limited to explicitly registered, non-destructive
 * controls; navigation is same-origin; sensitive actions require human approval.
 */
export type UltranUiCommand =
  | { type: "point"; target: string; side?: "left" | "right" }
  | { type: "highlight"; target: string }
  | { type: "click"; target: string }
  | { type: "open"; path: string }
  | { type: "scroll"; target: string; direction: "up" | "down" }
  | { type: "release" };

export type UltranUiCommandResult =
  | { ok: true; action: UltranUiCommand["type"] }
  | { ok: false; reason: string };

const TARGET_ID = /^[a-zA-Z0-9][a-zA-Z0-9:_-]{0,79}$/;

function targetElement(id: string): HTMLElement | null {
  if (!TARGET_ID.test(id)) return null;
  return document.querySelector<HTMLElement>(`[data-ultran-target="${CSS.escape(id)}"]`);
}

/** Dispatches a gesture to the 3D rig and performs only explicitly allowed UI actions. */
export function executeUltranUiCommand(command: UltranUiCommand): UltranUiCommandResult {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return { ok: false, reason: "UI commands are only available in the browser." };
  }

  if (command.type === "open") {
    let destination: URL;
    try {
      destination = new URL(command.path, window.location.origin);
    } catch {
      return { ok: false, reason: "Invalid page path." };
    }
    if (destination.origin !== window.location.origin || !destination.pathname.startsWith("/")) {
      return { ok: false, reason: "Navigation must stay inside this Ultran app." };
    }
    window.dispatchEvent(new CustomEvent("ultran:avatar-gesture", { detail: { gesture: "open", target: "page" } }));
    window.location.assign(destination.href);
    return { ok: true, action: "open" };
  }

  if (command.type === "release") {
    window.dispatchEvent(new CustomEvent("ultran:avatar-gesture", { detail: { gesture: "idle" } }));
    document.querySelectorAll<HTMLElement>("[data-ultran-highlighted]").forEach((node) => {
      node.removeAttribute("data-ultran-highlighted");
    });
    return { ok: true, action: "release" };
  }

  const element = targetElement(command.target);
  if (!element) return { ok: false, reason: "That UI target is not registered on the current page." };

  if (command.type === "point") {
    window.dispatchEvent(new CustomEvent("ultran:avatar-gesture", {
      detail: { gesture: "point", target: command.target, side: command.side ?? "right" },
    }));
    element.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
    element.focus({ preventScroll: true });
    return { ok: true, action: "point" };
  }

  if (command.type === "highlight") {
    element.setAttribute("data-ultran-highlighted", "true");
    window.dispatchEvent(new CustomEvent("ultran:avatar-gesture", {
      detail: { gesture: "point", target: command.target, side: "right" },
    }));
    element.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
    return { ok: true, action: "highlight" };
  }

  if (command.type === "click") {
    if (element.dataset.ultranAction !== "safe") {
      return { ok: false, reason: "This control is not marked as safe for autonomous activation." };
    }
    if (element.matches(":disabled, [aria-disabled='true']")) {
      return { ok: false, reason: "That control is currently disabled." };
    }
    element.click();
    return { ok: true, action: "click" };
  }

  if (command.type === "scroll") {
    element.scrollBy({ top: command.direction === "down" ? Math.max(240, element.clientHeight * 0.7) : -Math.max(240, element.clientHeight * 0.7), behavior: "smooth" });
    return { ok: true, action: "scroll" };
  }

  return { ok: false, reason: "Unsupported UI command." };
}
