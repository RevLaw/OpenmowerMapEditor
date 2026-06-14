// Global keyboard shortcuts -> editor actions / tool changes. Suppressed while
// typing in form fields (except global Ctrl/Cmd combos).
import { setTool, toggleTool } from "./stores/tools.js";
import { undo, redo, removePoint, saveCurrent, nudge, duplicateZoneAction } from "./actions.js";
import { mapApi } from "./stores/mapApi.js";
import { get } from "svelte/store";

function isTyping(target) {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select" || target.isContentEditable;
}

/**
 * @param {{ openPalette:()=>void, toggleCheat:()=>void }} ctx
 * @returns {() => void} cleanup
 */
export function initShortcuts(ctx) {
  function onKey(e) {
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();

    // Command palette — always available.
    if (mod && key === "k") {
      e.preventDefault();
      ctx.openPalette();
      return;
    }

    // Undo / redo / save — available even while a field is focused.
    if (mod && !e.altKey && (key === "z" || key === "y")) {
      if (key === "z" && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else {
        e.preventDefault();
        redo();
      }
      return;
    }
    if (mod && key === "s") {
      e.preventDefault();
      saveCurrent({ restart: false });
      return;
    }
    if (mod && key === "d") {
      e.preventDefault();
      duplicateZoneAction();
      return;
    }

    if (isTyping(e.target) || mod || e.altKey) return;

    const step = e.shiftKey ? 0.25 : 0.05;
    switch (key) {
      case "arrowup":
        e.preventDefault();
        nudge(0, step);
        break;
      case "arrowdown":
        e.preventDefault();
        nudge(0, -step);
        break;
      case "arrowleft":
        e.preventDefault();
        nudge(-step, 0);
        break;
      case "arrowright":
        e.preventDefault();
        nudge(step, 0);
        break;
      case "?":
        ctx.toggleCheat();
        break;
      case "v":
        setTool("none");
        break;
      case "a":
        toggleTool("add");
        break;
      case "b":
        toggleTool("brush");
        break;
      case "s":
        toggleTool("snap");
        break;
      case "m":
        toggleTool("multi");
        break;
      case "g":
        toggleTool("move");
        break;
      case "r":
        toggleTool("rect");
        break;
      case "o":
        toggleTool("circle");
        break;
      case "f":
        get(mapApi)?.fitCurrentArea();
        break;
      case "delete":
      case "backspace":
        removePoint();
        break;
      case "escape":
        setTool("none");
        break;
      default:
        return;
    }
  }

  document.addEventListener("keydown", onKey);
  return () => document.removeEventListener("keydown", onKey);
}
