import { writable } from "svelte/store";
import { editor } from "./editor.js";
import { mowParams } from "./mowParams.js";
import { validateMap } from "../validation.js";

// Validation runs polygon clipping across zone pairs, so it's debounced
// rather than recomputed on every brush step / drag frame.
const DEBOUNCE_MS = 250;

export const validationIssues = writable([]);

let mapData = null;
let toolWidth = 0;
let timer = null;

function run() {
  timer = null;
  validationIssues.set(mapData ? validateMap(mapData, { toolWidth }) : []);
}

function schedule() {
  if (timer) clearTimeout(timer);
  timer = setTimeout(run, DEBOUNCE_MS);
}

editor.subscribe(($e) => {
  const first = mapData == null && $e.mapData != null;
  mapData = $e.mapData;
  if (first) run();
  else schedule();
});

mowParams.subscribe(($p) => {
  toolWidth = $p.toolWidth;
  schedule();
});

/** Validate right now (e.g. before saving) and return the fresh issue list. */
export function validateNow() {
  if (timer) clearTimeout(timer);
  const issues = mapData ? validateMap(mapData, { toolWidth }) : [];
  validationIssues.set(issues);
  return issues;
}
