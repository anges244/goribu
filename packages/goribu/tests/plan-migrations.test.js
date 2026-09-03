import { describe, expect, it } from "vitest";
import { describeDrift, planMigrations } from "../src/build/migrations/plan-migrations.js";

const file = (sequence, checksum) => ({
  name: `${String(sequence).padStart(4, "0")}_m${sequence}`,
  sequence,
  checksum,
});

describe("planMigrations", () => {
  it("splits applied from pending in sequence order", () => {
    const migrations = [file(1, "a"), file(2, "b"), file(3, "c")];
    const plan = planMigrations({
      migrations,
      appliedRows: [{ name: "0001_m1", checksum: "a" }],
    });

    expect(plan.applied.map((m) => m.name)).toEqual(["0001_m1"]);
    expect(plan.pending.map((m) => m.name)).toEqual(["0002_m2", "0003_m3"]);
    expect(plan.drift).toEqual([]);
  });

  it("flags a modified applied file", () => {
    const plan = planMigrations({
      migrations: [file(1, "a-new")],
      appliedRows: [{ name: "0001_m1", checksum: "a-old" }],
    });
    expect(plan.drift).toEqual([{ name: "0001_m1", reason: "modified" }]);
  });

  it("flags a deleted applied file", () => {
    const plan = planMigrations({
      migrations: [],
      appliedRows: [{ name: "0001_m1", checksum: "a" }],
    });
    expect(plan.drift).toEqual([{ name: "0001_m1", reason: "missing" }]);
  });

  it("flags a pending migration sequenced before an applied one", () => {
    const plan = planMigrations({
      migrations: [file(1, "a"), file(2, "b")],
      appliedRows: [{ name: "0002_m2", checksum: "b" }],
    });
    expect(plan.drift).toEqual([{ name: "0001_m1", reason: "out-of-order" }]);
    expect(plan.pending.map((m) => m.name)).toEqual(["0001_m1"]);
  });

  it("describes each drift reason for the mutating-command error", () => {
    const message = describeDrift([
      { name: "0001_a", reason: "modified" },
      { name: "0002_b", reason: "missing" },
      { name: "0003_c", reason: "out-of-order" },
    ]);
    expect(message).toContain("0001_a: the file changed after it was applied");
    expect(message).toContain("0002_b: the applied file has been deleted");
    expect(message).toContain("0003_c: is sequenced before an already-applied migration");
    expect(message).toMatch(/Never edit a migration that has already run/);
  });
});
