import { describe, expect, it } from "vitest";
import {
  mergeWifiSample,
  wifiPercentFromDbm,
  wifiSignalColor,
} from "./signal.js";

describe("WiFi signal helpers", () => {
  it("normalizes dBm to a bounded percentage", () => {
    expect(wifiPercentFromDbm(-100)).toBe(0);
    expect(wifiPercentFromDbm(-66)).toBe(68);
    expect(wifiPercentFromDbm(-50)).toBe(100);
  });

  it("uses stable heatmap color bands", () => {
    expect(wifiSignalColor(-50)).toBe("#22c55e");
    expect(wifiSignalColor(-68)).toBe("#facc15");
    expect(wifiSignalColor(-85)).toBe("#ef4444");
  });

  it("averages readings that are close together", () => {
    const first = mergeWifiSample([], { x: 1, y: 2, signalDbm: -60 }, 1);
    const merged = mergeWifiSample(first, { x: 1.2, y: 2.1, signalDbm: -70 }, 2);
    expect(merged).toHaveLength(1);
    expect(merged[0].signalDbm).toBe(-65);
    expect(merged[0].samples).toBe(2);
  });

  it("keeps spatially separate readings", () => {
    const first = mergeWifiSample([], { x: 1, y: 2, signalDbm: -60 }, 1);
    const separate = mergeWifiSample(first, { x: 2, y: 2, signalDbm: -70 }, 2);
    expect(separate).toHaveLength(2);
  });
});
