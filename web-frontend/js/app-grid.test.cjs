const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

function fixture(date = "2026-10-14") {
  const storage = new Map();
  const elements = Object.fromEntries([
    ["firstActivityDisplay", {}],
    ["lastActivityDisplay", {}],
    ["sessionSpanDisplay", {}],
    ["trackedTimeDisplay", {}],
    ["currentSlotDisplay", {}],
    ["dateInput", { value: date }],
    ["memoInput", { value: "Yesterday's memo" }],
    ["notesInput", { value: "Yesterday's notes" }],
    ["timerDisplay", {}],
    ["startBtn", {}],
    ["pauseBtn", {}],
    ["autoCenterStatus", { hidden: true }],
    ["autoCenterCountdown", {}],
  ]);
  class FixedDate extends Date {
    constructor(...args) {
      super(...(args.length ? args : [new Date(2026, 9, 15, 13).getTime()]));
    }
  }
  const context = vm.createContext({
    console,
    clearInterval,
    Date: FixedDate,
    document: { addEventListener() {}, getElementById: (id) => elements[id] },
    localStorage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
    },
  });
  for (const file of ["time-calculations.js", "app-grid.js"]) {
    vm.runInContext(
      fs.readFileSync(path.join(__dirname, file), "utf8"),
      context,
    );
  }
  const tracker = vm.runInContext(
    "Object.create(GridTaskTracker.prototype)",
    context,
  );
  Object.assign(tracker, {
    date,
    sessionId: "yesterday",
    tasks: ["Task"],
    taskIdMap: { Task: "task-id" },
    gridData: [[true]],
    pendingWrites: new Set(),
    timerState: {
      isRunning: true,
      timeRemaining: 123,
      totalTime: 900,
      currentInterval: 12,
    },
    isSyncing: false,
    isFullSyncing: false,
    isInitializingSession: false,
  });
  return { tracker, storage, elements };
}

test("header summaries update from bubbles while current slot stays clock-based", () => {
  const { tracker, elements, storage } = fixture("2026-10-15");
  tracker.updateCurrentTimeLine = () => {};
  tracker.gridData = [new Array(96).fill(false), new Array(96).fill(false)];
  tracker.gridData[0][36] = true;
  tracker.gridData[0][40] = true;
  tracker.gridData[1][36] = true;
  tracker.updateTimeCalculations();
  assert.equal(elements.firstActivityDisplay.textContent, "09:00");
  assert.equal(elements.lastActivityDisplay.textContent, "10:15");
  assert.equal(elements.sessionSpanDisplay.textContent, "1h 15m");
  assert.equal(elements.trackedTimeDisplay.textContent, "0h 30m");
  assert.equal(elements.currentSlotDisplay.textContent, "53 / 96");
  tracker.saveToLocalStorage();
  assert.equal(JSON.parse(storage.get("ettGridState")).startTime, "09:00");
  tracker.gridData = [new Array(96).fill(false)];
  tracker.saveToLocalStorage();
  assert.equal(elements.firstActivityDisplay.textContent, "--");
  assert.equal(elements.lastActivityDisplay.textContent, "--");
  assert.equal(elements.sessionSpanDisplay.textContent, "--");
  assert.equal(elements.trackedTimeDisplay.textContent, "--");
  assert.equal(elements.currentSlotDisplay.textContent, "53 / 96");
  assert.equal(JSON.parse(storage.get("ettGridState")).startTime, "");
});

test("pause status displays a countdown and disappears at expiry", () => {
  const { tracker, elements } = fixture();
  tracker.autoCenterPausedUntil = 121000;
  assert.equal(tracker.updateAutoCenterStatus(1000), 120);
  assert.equal(elements.autoCenterStatus.hidden, false);
  assert.equal(elements.autoCenterCountdown.textContent, "2:00");
  tracker.updateAutoCenterStatus(62000);
  assert.equal(elements.autoCenterCountdown.textContent, "0:59");
  assert.equal(tracker.updateAutoCenterStatus(121000), 0);
  assert.equal(elements.autoCenterStatus.hidden, true);
});

test("resume clears the pause and immediately updates the indicator", () => {
  const { tracker, elements } = fixture();
  tracker.autoCenterPausedUntil = 9999999999999;
  let updated = false;
  tracker.updateCurrentTimeLine = () => {
    updated = true;
  };
  tracker.resumeAutoCentering();
  assert.equal(tracker.autoCenterPausedUntil, 0);
  assert.equal(elements.autoCenterStatus.hidden, true);
  assert.equal(updated, true);
});

test("loading a legacy local grid shifts 9 AM entries to slot 36", () => {
  const { tracker, storage } = fixture();
  const row = new Array(60).fill(false);
  row[0] = true;
  storage.set(
    "ettGridState",
    JSON.stringify({
      tasks: ["Legacy"],
      gridData: [row],
      date: "2026-10-15",
    }),
  );
  tracker.loadFromLocalStorage();
  assert.equal(tracker.gridData[0].length, 96);
  assert.equal(tracker.gridData[0][0], false);
  assert.equal(tracker.gridData[0][36], true);
});

test("cloud restoration accepts the final interval of a full day", async () => {
  const { tracker } = fixture("2026-10-15");
  tracker.db = {
    getSessionIntervals: async () => [
      { task_id: "task-id", interval_index: 95 },
    ],
  };
  for (const method of [
    "renderGrid",
    "updateTaskCount",
    "updateSummary",
    "updateTimeCalculations",
  ]) {
    tracker[method] = () => {};
  }
  await tracker.loadSessionFromSupabase({
    id: "today",
    date: "2026-10-15",
    tasks: [{ id: "task-id", name: "Late task" }],
  });
  assert.equal(tracker.gridData[0].length, 96);
  assert.equal(tracker.gridData[0][95], true);
});

test("rollover archives yesterday and starts a clean local day", () => {
  const { tracker, storage, elements } = fixture();
  assert.equal(tracker.rolloverDailySession(new Date(2026, 9, 15, 0, 0)), true);
  const archive = JSON.parse(storage.get("ettGridHistory"))[
    "2026-10-14:yesterday"
  ];
  assert.equal(archive.date, "2026-10-14");
  assert.equal(archive.sessionId, "yesterday");
  assert.deepEqual(archive.tasks, ["Task"]);
  assert.deepEqual(archive.gridData, [[true]]);
  assert.equal(archive.notes, "Yesterday's notes");
  const current = JSON.parse(storage.get("ettGridState"));
  assert.equal(current.date, "2026-10-15");
  assert.equal(current.sessionId, null);
  assert.deepEqual(current.tasks, []);
  assert.deepEqual(current.gridData, []);
  assert.equal(current.notes, "");
  assert.equal(current.startTime, "");
  assert.equal(current.timerState.isRunning, false);
  assert.equal(current.timerState.timeRemaining, 900);
  assert.equal(current.timerState.currentInterval, 0);
  assert.equal(elements.dateInput.value, "2026-10-15");
  assert.equal(tracker.rolloverDailySession(new Date(2026, 9, 15, 13)), false);
});

test("same-day session is left untouched", () => {
  const { tracker, storage } = fixture("2026-10-15");
  assert.equal(tracker.rolloverDailySession(new Date(2026, 9, 15, 13)), false);
  assert.equal(tracker.sessionId, "yesterday");
  assert.equal(storage.size, 0);
});

test("rollover waits for active initialization, syncs, and task writes", () => {
  for (const flag of [
    "isInitializingSession",
    "isSyncing",
    "isFullSyncing",
    "pendingWrites",
  ]) {
    const { tracker, storage } = fixture();
    tracker[flag] =
      flag === "pendingWrites" ? new Set([Promise.resolve()]) : true;
    assert.equal(tracker.rolloverDailySession(new Date(2026, 9, 15)), false);
    assert.equal(storage.size, 0);
    tracker[flag] = flag === "pendingWrites" ? new Set() : false;
    assert.equal(tracker.rolloverDailySession(new Date(2026, 9, 15)), true);
  }
});

test("cloud initialization does not restore a session from a different day", async () => {
  const { tracker } = fixture("2026-10-15");
  const created = [];
  tracker.db = {
    getSession: async () => ({ id: "yesterday", date: "2026-10-14" }),
    createSession: async (data) => {
      created.push(data);
      return { id: "today" };
    },
  };
  tracker.loadSessionFromSupabase = async () =>
    assert.fail("Old session was restored");
  await tracker.initializeSession();
  assert.equal(created.length, 1);
  assert.equal(created[0].date, "2026-10-15");
  assert.equal(tracker.sessionId, "today");
  assert.equal(tracker.isInitializingSession, false);
});

test("cloud initialization reuses a session from the same day", async () => {
  const { tracker } = fixture("2026-10-15");
  let restored = false;
  tracker.db = {
    getSession: async () => ({ id: "existing", date: "2026-10-15" }),
    createSession: async () => assert.fail("Created an unnecessary session"),
  };
  tracker.loadSessionFromSupabase = async () => {
    restored = true;
  };
  await tracker.initializeSession();
  assert.equal(restored, true);
  assert.equal(tracker.isInitializingSession, false);
});

test("restoring an old cloud response cannot change today's session or date field", () => {
  const { tracker, elements } = fixture("2026-10-15");
  assert.throws(
    () =>
      tracker.restoreSessionData({
        id: "old-session",
        date: "2026-10-14",
        tasks: [],
      }),
    /different day/,
  );
  assert.equal(tracker.date, "2026-10-15");
  assert.equal(elements.dateInput.value, "2026-10-15");
  assert.equal(tracker.sessionId, "yesterday");
  assert.deepEqual(tracker.tasks, ["Task"]);
});

test("restoring today's cloud session populates today's date", () => {
  const { tracker, elements } = fixture("2026-10-15");
  tracker.restoreSessionData({
    id: "today",
    date: "2026-10-15",
    start_time: "09:00",
    tasks: [],
  });
  assert.equal(tracker.date, "2026-10-15");
  assert.equal(elements.dateInput.value, "2026-10-15");
  assert.equal(tracker.sessionId, "today");
});
