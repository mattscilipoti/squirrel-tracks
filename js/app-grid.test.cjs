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
    ["dateDisplay", { textContent: date }],
    ["memoInput", { value: "Yesterday's memo" }],
    ["notesInput", { value: "Yesterday's notes" }],
    ["timerDisplay", {}],
    ["reminderMinutesInput", {}],
    ["bellEnabledInput", {}],
    ["bellVolumeInput", {}],
    ["bellVolumeValue", {}],
    ["enableBellBtn", {}],
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

test("reminder starts automatically and repeats without alerts or stopping", () => {
  const { tracker, elements } = fixture();
  let bells = 0;
  tracker.playReminderBell = () => {
    bells++;
  };
  tracker.initializeReminder(0);
  assert.equal(elements.timerDisplay.textContent, "15:00");
  assert.equal(tracker.timerState.isRunning, true);
  tracker.timerTick(900000);
  assert.equal(bells, 1);
  assert.equal(elements.timerDisplay.textContent, "15:00");
  assert.equal(tracker.timerState.isRunning, true);
  tracker.timerTick(900000);
  assert.equal(bells, 1);
  tracker.timerTick(1800000);
  assert.equal(bells, 2);
});

test("saved custom interval and muted bell survive reload", () => {
  const { tracker, storage, elements } = fixture();
  storage.set(
    "ettReminderSettings",
    JSON.stringify({
      minutes: 5,
      bellEnabled: false,
      nextReminderAt: 300000,
    }),
  );
  tracker.playReminderBell = () => assert.fail("Muted reminder rang");
  tracker.initializeReminder(120000);
  assert.equal(elements.timerDisplay.textContent, "3:00");
  assert.equal(elements.reminderMinutesInput.value, 5);
  assert.equal(elements.bellEnabledInput.checked, false);
  assert.equal(elements.enableBellBtn.hidden, true);
  tracker.timerTick(300000);
  assert.equal(elements.timerDisplay.textContent, "5:00");
  assert.equal(
    JSON.parse(storage.get("ettReminderSettings")).bellEnabled,
    false,
  );
});

test("bell volume defaults to the existing level and persists independently of mute", () => {
  const { tracker, storage, elements } = fixture();
  tracker.initializeReminder(0);
  assert.equal(tracker.bellVolume, 1);
  assert.equal(elements.bellVolumeValue.textContent, "100%");
  const gains = [];
  tracker.audioContext = { state: "running", currentTime: 5 };
  tracker.bellOutput = {
    gain: { setTargetAtTime: (value) => gains.push(value) },
  };
  tracker.setBellVolume(35);
  assert.equal(gains.at(-1), 0.35);
  assert.equal(elements.bellVolumeValue.textContent, "35%");
  tracker.bellEnabled = false;
  tracker.updateBellVolume();
  tracker.saveReminderSettings();
  assert.equal(gains.at(-1), 0);
  assert.equal(JSON.parse(storage.get("ettReminderSettings")).volume, 0.35);
  tracker.initializeReminder(0);
  assert.equal(tracker.bellEnabled, false);
  assert.equal(elements.bellVolumeInput.value, 35);
  assert.equal(gains.at(-1), 0);
  tracker.setBellVolume(60);
  assert.equal(gains.at(-1), 0);
  tracker.bellEnabled = true;
  tracker.updateBellVolume();
  assert.equal(gains.at(-1), 0.6);
});

test("volume accepts silence and rejects invalid stored settings", () => {
  for (const volume of [0, 0.5, 1, -1, 2, "0.5", null]) {
    const { tracker, storage } = fixture();
    storage.set("ettReminderSettings", JSON.stringify({ volume }));
    tracker.initializeReminder(0);
    const valid = typeof volume === "number" && volume >= 0 && volume <= 1;
    assert.equal(tracker.bellVolume, valid ? volume : 1);
    tracker.setBellVolume(-10);
    assert.equal(tracker.bellVolume, 0);
    tracker.setBellVolume(110);
    assert.equal(tracker.bellVolume, 1);
    tracker.setBellVolume(NaN);
    assert.equal(tracker.bellVolume, 1);
  }
});

test("long suspensions and overdue reloads skip missed bells", () => {
  const { tracker, elements } = fixture();
  tracker.playReminderBell = () => assert.fail("Missed reminder rang");
  tracker.initializeReminder(0);
  tracker.timerTick(2705000);
  assert.equal(elements.timerDisplay.textContent, "14:55");
  tracker.initializeReminder(4500000);
  assert.equal(elements.timerDisplay.textContent, "15:00");
  assert.equal(tracker.nextReminderAt, 5400000);
});

test("invalid or corrupt reminder settings fall back to 15 minutes", () => {
  for (const settings of [
    "invalid",
    "null",
    '{"minutes":0}',
    '{"minutes":121}',
    '{"minutes":1.5}',
  ]) {
    const { tracker, storage, elements } = fixture();
    storage.set("ettReminderSettings", settings);
    tracker.initializeReminder(0);
    assert.equal(elements.reminderMinutesInput.value, 15);
    assert.equal(elements.timerDisplay.textContent, "15:00");
  }
});

test("bell requires enabled, unlocked audio", () => {
  const { tracker } = fixture();
  tracker.bellEnabled = false;
  tracker.audioContext = {
    state: "running",
    createOscillator: () => assert.fail("Muted audio played"),
  };
  tracker.playReminderBell();
  tracker.bellEnabled = true;
  tracker.audioContext.state = "suspended";
  tracker.playReminderBell();
});

test("audio enable button is shown for unknown or inactive audio and hidden when ready or muted", () => {
  const { tracker, elements } = fixture();
  tracker.bellEnabled = true;
  for (const state of [
    undefined,
    "suspended",
    "interrupted",
    "closed",
    "running",
  ]) {
    tracker.audioContext = state ? { state } : undefined;
    tracker.updateBellControl();
    assert.equal(elements.enableBellBtn.hidden, state === "running");
  }
  tracker.bellEnabled = false;
  tracker.audioContext = undefined;
  tracker.updateBellControl();
  assert.equal(elements.enableBellBtn.hidden, true);
});

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

test("saving and syncing use the session date rather than display text", async () => {
  const { tracker, elements, storage } = fixture("2026-10-15");
  elements.dateDisplay.textContent = "2026-10-14";
  tracker.saveToLocalStorage();
  assert.equal(tracker.date, "2026-10-15");
  assert.equal(JSON.parse(storage.get("ettGridState")).date, "2026-10-15");
  const updates = [];
  tracker.db = {
    updateSession: async (id, data) => updates.push({ id, data }),
  };
  await tracker.syncToSupabase();
  assert.equal(updates.length, 1);
  assert.equal(updates[0].data.date, "2026-10-15");
  assert.equal(tracker.sessionId, "yesterday");
  assert.equal(tracker.rolloverDailySession(new Date(2026, 9, 15, 13)), false);
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
  assert.equal(current.timerState.isRunning, true);
  assert.equal(current.timerState.timeRemaining, 123);
  assert.equal(current.timerState.currentInterval, 12);
  assert.equal(elements.dateDisplay.textContent, "2026-10-15");
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
  assert.equal(elements.dateDisplay.textContent, "2026-10-15");
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
  assert.equal(elements.dateDisplay.textContent, "2026-10-15");
  assert.equal(tracker.sessionId, "today");
});
