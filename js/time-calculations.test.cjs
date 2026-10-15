const assert = require("node:assert/strict");
const { describe, test } = require("node:test");
const TimeCalculations = require("./time-calculations.js");

test("empty grids have no activity summaries", () => {
  for (const grid of [[], [new Array(96).fill(false)]]) {
    assert.deepEqual(TimeCalculations.activitySummary(grid), {
      firstActivity: "--", lastActivity: "--", sessionSpan: "--",
      trackedTime: "--", trackedMinutes: 0,
    });
  }
});

test("activity span includes gaps while tracked time deduplicates overlapping tasks", () => {
  const first = new Array(96).fill(false);
  const second = new Array(96).fill(false);
  first[36] = true;
  first[40] = true;
  second[36] = true;
  const original = JSON.stringify([first, second]);
  assert.deepEqual(TimeCalculations.activitySummary([first, second]), {
    firstActivity: "09:00", lastActivity: "10:15", sessionSpan: "1h 15m",
    trackedTime: "0h 30m", trackedMinutes: 30,
  });
  assert.equal(JSON.stringify([first, second]), original);
});

test("single final bubble ends at 24:00 and removing it clears summaries", () => {
  const row = new Array(96).fill(false);
  row[95] = true;
  assert.deepEqual(TimeCalculations.activitySummary([row]), {
    firstActivity: "23:45", lastActivity: "24:00", sessionSpan: "0h 15m",
    trackedTime: "0h 15m", trackedMinutes: 15,
  });
  row[95] = false;
  assert.equal(TimeCalculations.activitySummary([row]).firstActivity, "--");
});

test("a filled day spans and tracks 24 hours", () => {
  assert.deepEqual(TimeCalculations.activitySummary([new Array(96).fill(true)]), {
    firstActivity: "00:00", lastActivity: "24:00", sessionSpan: "24h 0m",
    trackedTime: "24h 0m", trackedMinutes: 1440,
  });
});

test("current slot follows local clock quarter-hours independently of activity", () => {
  for (const [hour, minute, slot] of [[0, 0, 1], [0, 14, 1], [0, 15, 2], [13, 0, 53], [23, 59, 96]]) {
    assert.equal(TimeCalculations.currentSlot(new Date(2026, 9, 15, hour, minute)), slot);
  }
});

test("centering accounts for sticky tasks and clamps at day edges", () => {
  assert.equal(TimeCalculations.centeredScrollLeft(1500, 800, 200, 3200), 1000);
  assert.equal(TimeCalculations.centeredScrollLeft(200, 800, 200, 3200), 0);
  assert.equal(TimeCalculations.centeredScrollLeft(3190, 800, 200, 3200), 2400);
});

test("auto-centering pause counts down and expires", () => {
  assert.equal(TimeCalculations.autoCenterSeconds(120000, 0), 120);
  assert.equal(TimeCalculations.autoCenterSeconds(120000, 119001), 1);
  assert.equal(TimeCalculations.autoCenterSeconds(120000, 120000), 0);
  assert.equal(TimeCalculations.autoCenterSeconds(120000, 130000), 0);
});

test("legacy 9 AM grids retain their clock times in a midnight grid", () => {
  const row = new Array(60).fill(false);
  row[0] = true;
  row[59] = true;
  const normalized = TimeCalculations.normalizeGridRow(row);
  assert.equal(normalized.length, 96);
  assert.equal(normalized[0], false);
  assert.equal(normalized[36], true);
  assert.equal(normalized[95], true);
  assert.deepEqual(TimeCalculations.normalizeGridRow(normalized), normalized);
});

test("full day positions include midnight, noon, and the final minute", () => {
  for (const [hour, minute, intervalIndex, fraction] of [
    [0, 0, 0, 0],
    [12, 0, 48, 0],
    [23, 59, 95, 14 / 15],
  ]) {
    assert.deepEqual(
      TimeCalculations.gridPosition(new Date(2026, 9, 15, hour, minute), 0, 96),
      { intervalIndex, fraction },
    );
  }
});

for (const timezone of ["America/New_York", "UTC", "Asia/Kolkata"]) {
  describe(timezone, () => {
    function inTimezone(run) {
      const previous = process.env.TZ;
      process.env.TZ = timezone;
      try {
        run();
      } finally {
        if (previous === undefined) delete process.env.TZ;
        else process.env.TZ = previous;
      }
    }

    test("1 PM is slot 53 regardless of the first activity", () =>
      inTimezone(() => {
        const now = new Date(2026, 9, 15, 13);
        const original = now.getTime();
        assert.equal(TimeCalculations.currentSlot(now), 53);
        assert.equal(now.getTime(), original);
      }));

    test("local date remains correct near midnight", () =>
      inTimezone(() => {
        for (const hour of [0, 23]) {
          const now = new Date(2026, 9, 15, hour, 30);
          assert.equal(TimeCalculations.localDate(now), "2026-10-15");
          assert.equal(TimeCalculations.currentSlot(now), hour * 4 + 3);
        }
      }));

    test("activity boundaries are grid times, not UTC-converted dates", () =>
      inTimezone(() => {
        const row = new Array(96).fill(false);
        row[36] = true;
        row[95] = true;
        const summary = TimeCalculations.activitySummary([row]);
        assert.equal(summary.firstActivity, "09:00");
        assert.equal(summary.lastActivity, "24:00");
      }));

    test("line position follows table hours and advances within each column", () =>
      inTimezone(() => {
        for (const [hour, minute, intervalIndex, fraction] of [
          [9, 0, 0, 0],
          [13, 0, 16, 0],
          [13, 7, 16, 7 / 15],
          [13, 15, 17, 0],
          [23, 59, 59, 14 / 15],
        ]) {
          assert.deepEqual(
            TimeCalculations.gridPosition(
              new Date(2026, 9, 15, hour, minute),
              9,
              60,
            ),
            { intervalIndex, fraction },
          );
        }
      }));

    test("line is absent outside the table range", () =>
      inTimezone(() => {
        for (const [hour, minute] of [
          [8, 59],
          [0, 0],
        ]) {
          assert.equal(
            TimeCalculations.gridPosition(
              new Date(2026, 9, 15, hour, minute),
              9,
              60,
            ),
            null,
          );
        }
        assert.equal(
          TimeCalculations.gridPosition(new Date(2026, 9, 15, 13), 9, 16),
          null,
        );
        assert.equal(
          TimeCalculations.gridPosition(new Date(2026, 9, 15, 9), 9, 0),
          null,
        );
      }));
  });
}
