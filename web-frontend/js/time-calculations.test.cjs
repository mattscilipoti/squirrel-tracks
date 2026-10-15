const assert = require("node:assert/strict");
const { describe, test } = require("node:test");
const TimeCalculations = require("./time-calculations.js");

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

    test("9 AM to 1 PM is 16 completed intervals and current interval 17", () =>
      inTimezone(() => {
        const now = new Date(2026, 9, 15, 13);
        const original = now.getTime();
        assert.deepEqual(
          TimeCalculations.sessionTime(now, "09:00", "2026-10-15"),
          {
            endTime: "00:00",
            elapsedText: "4h 0m",
            intervalText: "17 (Hour 5.1)",
            elapsedMinutes: 240,
            intervalsElapsed: 16,
          },
        );
        assert.equal(now.getTime(), original);
      }));

    test("selected previous date is not shifted back an extra day", () =>
      inTimezone(() => {
        const result = TimeCalculations.sessionTime(
          new Date(2026, 9, 15, 12, 56, 22),
          "09:00",
          "2026-10-14",
        );
        assert.equal(result.elapsedMinutes, 1676);
        assert.equal(result.elapsedText, "27h 56m");
        assert.equal(result.intervalsElapsed, 111);
        assert.equal(result.intervalText, "Complete");
      }));

    test("missing date falls back to the supplied local day near midnight", () =>
      inTimezone(() => {
        for (const hour of [0, 23]) {
          const now = new Date(2026, 9, 15, hour, 30);
          assert.equal(TimeCalculations.localDate(now), "2026-10-15");
          assert.equal(
            TimeCalculations.sessionTime(now, "00:00", "").elapsedMinutes,
            hour * 60 + 30,
          );
        }
      }));

    test("missing start time produces empty display values", () =>
      inTimezone(() => {
        assert.deepEqual(
          TimeCalculations.sessionTime(
            new Date(2026, 9, 15, 13),
            "",
            "2026-10-15",
          ),
          {
            endTime: "--:--",
            elapsedText: "0h 0m",
            intervalText: "-",
            elapsedMinutes: null,
            intervalsElapsed: null,
          },
        );
      }));

    test("session status changes at start, quarter-hour, and 15-hour boundaries", () =>
      inTimezone(() => {
        for (const [hour, minute, second, expected] of [
          [8, 59, 59, "Not started"],
          [9, 0, 0, "1 (Hour 1.1)"],
          [9, 14, 59, "1 (Hour 1.1)"],
          [9, 15, 0, "2 (Hour 1.2)"],
          [23, 59, 59, "60 (Hour 15.4)"],
        ]) {
          const result = TimeCalculations.sessionTime(
            new Date(2026, 9, 15, hour, minute, second),
            "09:00",
            "2026-10-15",
          );
          assert.equal(result.intervalText, expected);
        }
        for (const minute of [0, 1]) {
          const result = TimeCalculations.sessionTime(
            new Date(2026, 9, 16, 0, minute),
            "09:00",
            "2026-10-15",
          );
          assert.equal(result.intervalText, "Complete");
        }
      }));

    test("start minutes are preserved when calculating the end time", () =>
      inTimezone(() => {
        assert.equal(
          TimeCalculations.sessionTime(
            new Date(2026, 9, 15, 13),
            "10:30",
            "2026-10-15",
          ).endTime,
          "01:30",
        );
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
