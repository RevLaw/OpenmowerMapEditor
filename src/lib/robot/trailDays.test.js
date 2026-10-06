import { describe, it, expect } from "vitest";
import { dateKeyOf, dataDayKeys, monthGrid, adjacentDataDay } from "./trailDays.js";

const at = (y, m, d, h = 12) => new Date(y, m - 1, d, h).getTime();

describe("dataDayKeys", () => {
  it("collects session start days (local), skips empty sessions, adds today with live points", () => {
    const days = dataDayKeys(
      [
        { startedAt: at(2026, 10, 1), pointCount: 120 },
        { startedAt: at(2026, 10, 1, 18), pointCount: 40 },
        { startedAt: at(2026, 10, 3), pointCount: 0 },
        { startedAt: at(2026, 9, 28) },
        { startedAt: "bad" },
      ],
      "2026-10-05",
      true
    );
    expect([...days].sort()).toEqual(["2026-09-28", "2026-10-01", "2026-10-05"]);
  });

  it("leaves today out without live points", () => {
    expect(dataDayKeys([], "2026-10-05", false).size).toBe(0);
  });
});

describe("monthGrid", () => {
  it("starts on Monday and covers whole weeks", () => {
    const weeks = monthGrid(2026, 9); // October 2026 starts on a Thursday
    expect(weeks[0].map((c) => c.key)).toEqual([
      "2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04",
    ]);
    expect(weeks[0][3]).toEqual({ key: "2026-10-01", day: 1, inMonth: true });
    expect(weeks.every((w) => w.length === 7)).toBe(true);
    const inMonth = weeks.flat().filter((c) => c.inMonth);
    expect(inMonth).toHaveLength(31);
    expect(inMonth.at(-1).key).toBe("2026-10-31");
  });
});

describe("adjacentDataDay", () => {
  const days = new Set(["2026-09-28", "2026-10-01", "2026-10-05"]);
  it("finds the previous / next day with data", () => {
    expect(adjacentDataDay(days, "2026-10-04", -1)).toBe("2026-10-01");
    expect(adjacentDataDay(days, "2026-10-01", -1)).toBe("2026-09-28");
    expect(adjacentDataDay(days, "2026-10-01", 1)).toBe("2026-10-05");
  });
  it("returns null at the ends", () => {
    expect(adjacentDataDay(days, "2026-09-28", -1)).toBeNull();
    expect(adjacentDataDay(days, "2026-10-05", 1)).toBeNull();
  });
});

describe("dateKeyOf", () => {
  it("formats local dates with zero padding", () => {
    expect(dateKeyOf(at(2026, 3, 7))).toBe("2026-03-07");
  });
});
