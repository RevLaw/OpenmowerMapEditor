// Global keyboard shortcuts -> editor actions / tool changes. Suppressed while
// typing in form fields (except global Ctrl/Cmd combos).
import { setTool, toggleTool } from "./stores/tools.js";
import { undo, redo, removePoint, requestSave, nudge, duplicateZoneAction } from "./actions.js";
import { mapApi } from "./stores/mapApi.js";
import { editor, setAreaIndex } from "./stores/editor.js";
import { toggleZoneLocked, toggleZoneHidden } from "./stores/zoneView.js";
import { contextMenu, saveDialog } from "./stores/ui.js";
import { get } from "svelte/store";

/** Select the previous / next zone in list order. */
function cycleZone(dir) {
  const s = get(editor);
  const n = s.mapData?.areas?.length || 0;
  if (!n) return;
  setAreaIndex((s.areaIndex + dir + n) % n);
  get(mapApi)?.fitCurrentArea();
}

function withCurrentZone(fn) {
  const s = get(editor);
  const area = s.mapData?.areas?.[s.areaIndex];
  if (area) fn(area, s.areaIndex);
}

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
      requestSave({ restart: false });
      return;
    }
    if (mod && key === "d") {
      e.preventDefault();
      duplicateZoneAction();
      return;
    }

    if (isTyping(e.target) || mod || e.altKey) return;
    // Menus and dialogs own the keyboard while open.
    if (get(contextMenu) || get(saveDialog)) return;

    // Multi-click tools (polygon / ruler) consume Enter and Backspace first.
    if (["enter", "backspace", "delete"].includes(key) && get(mapApi)?.handleKey(key)) {
      e.preventDefault();
      return;
    }

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
      case "p":
        toggleTool("poly");
        break;
      case "x":
        toggleTool("split");
        break;
      case "d":
        toggleTool("ruler");
        break;
      case "l":
        withCurrentZone(toggleZoneLocked);
        break;
      case "h":
        withCurrentZone(toggleZoneHidden);
        break;
      case "[":
        cycleZone(-1);
        break;
      case "]":
        cycleZone(1);
        break;
      case "o":
        toggleTool("circle");
        break;
      case "f":
        if (e.shiftKey) get(mapApi)?.fitAll();
        else get(mapApi)?.fitCurrentArea();
        break;
      case "delete":
      case "backspace":
        e.preventDefault();
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
