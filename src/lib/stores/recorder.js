import { writable, get } from "svelte/store";
import { robotPose, robotLive, setRobotLive } from "./robot.js";
import { appendRecordedPoint } from "../robot/recorder.js";

// Boundary recording: while active, every live pose the robot reports is
// appended (distance-throttled) to an in-memory path, previewed on the map,
// and turned into a zone when the user finishes. Paused = keep the path but
// ignore poses (e.g. while repositioning the mower).
export const recording = writable({ active: false, paused: false, type: "mow", points: [] });

robotPose.subscribe((pose) => {
  const r = get(recording);
  if (!r.active || r.paused || !pose?.ok) return;
  const next = appendRecordedPoint(r.points, pose);
  if (next !== r.points) recording.set({ ...r, points: next });
});

/** Start a fresh recording (turns Live robot on — it's the pose source). */
export function startRecording(type = "mow") {
  if (!get(robotLive)) setRobotLive(true);
  const pose = get(robotPose);
  const points = pose?.ok ? [{ x: pose.x, y: pose.y }] : [];
  recording.set({ active: true, paused: false, type, points });
}

export function setRecordingPaused(paused) {
  recording.update((r) => ({ ...r, paused }));
}

export function setRecordingType(type) {
  recording.update((r) => ({ ...r, type }));
}

/** Drop the last few recorded points (undo a wrong turn). */
export function trimRecording(count = 10) {
  recording.update((r) => ({ ...r, points: r.points.slice(0, Math.max(0, r.points.length - count)) }));
}

/** Stop and return what was recorded (the caller turns it into a zone). */
export function stopRecording() {
  const r = get(recording);
  recording.set({ active: false, paused: false, type: r.type, points: [] });
  return r;
}
