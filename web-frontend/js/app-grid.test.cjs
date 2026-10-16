const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

function fixture(date = "2026-10-14", options = {}) {
  const storage = new Map();
  const container = { inert: false };
  const alerts = [];
  const dateClasses = new Set();
  const elements = Object.fromEntries([
    ["firstActivityDisplay", {}],
    ["lastActivityDisplay", {}],
    ["sessionSpanDisplay", {}],
    ["trackedTimeDisplay", {}],
    ["currentSlotDisplay", {}],
    [
      "dateInput",
      {
        value: date,
        classList: {
          toggle: (name, enabled) =>
            enabled ? dateClasses.add(name) : dateClasses.delete(name),
          contains: (name) => dateClasses.has(name),
        },
      },
    ],
    ["dateWarning", {}],
    ["todayBtn", {}],
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
    ["refreshDbBtn", {}],
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
    window: { setTimeout() {} },
    hasSupabaseConfig: () => options.configured !== false,
    confirm: options.confirm || (() => true),
    alert: (message) => alerts.push(message),
    document: {
      addEventListener() {},
      getElementById: (id) => elements[id],
      querySelector: () => container,
    },
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
  return { tracker, storage, elements, container, alerts };
}

test("reusing a task attaches the same ID and starts with empty bubbles for the new day", async () => {
  const { tracker } = fixture("2026-10-15");
  tracker.taskCatalog = [{ id: 5, name: "Task", interval_count: 10 }];
  const attachments = [];
  tracker.db = {
    attachTask: async (session, id) => attachments.push({ session, id }),
  };
  tracker.renderGrid = () => {};
  tracker.updateTaskCount = () => {};
  tracker.updateSummary = () => {};
  await tracker.reuseTask(5);
  assert.deepEqual(attachments, [{ session: "yesterday", id: 5 }]);
  assert.equal(tracker.tasks.length, 2);
  assert.equal(tracker.tasks[0], tracker.tasks[1]);
  assert.equal(tracker.getTaskId(0), "task-id");
  assert.equal(tracker.getTaskId(1), 5);
  assert.equal(tracker.gridData[1].filter(Boolean).length, 0);
  await tracker.reuseTask(5);
  assert.equal(tracker.tasks.length, 2);
  assert.equal(attachments.length, 1);
});

test("global rename updates cached days by ID without changing other task names", async () => {
  const { tracker, storage } = fixture("2026-10-15");
  tracker.tasks = ["Task", "Other"];
  tracker.taskIds = [5, 6];
  tracker.gridData = [[true], [true, true]];
  tracker.taskCatalog = [
    { id: 5, name: "Task" },
    { id: 6, name: "Other" },
  ];
  storage.set(
    "ettGridHistory",
    JSON.stringify({
      past: {
        date: "2026-10-14",
        sessionId: 14,
        tasks: ["Task", "Other"],
        taskIds: [5, 6],
        gridData: [[true], [true, true]],
      },
    }),
  );
  tracker.db = { updateTask: async (session, id) => assert.equal(id, 5) };
  tracker.renderGrid = () => {};
  tracker.updateSummary = () => {};
  await tracker.renameTask(0, "Renamed Task");
  const past = JSON.parse(storage.get("ettGridHistory")).past;
  assert.deepEqual(past.tasks, ["Renamed Task", "Other"]);
  assert.deepEqual(past.taskIds, [5, 6]);
  assert.deepEqual(past.gridData, [[true], [true, true]]);
  assert.equal(tracker.getTaskId(0), 5);
  assert.equal(tracker.getTaskId(1), 6);
});

test("removing a reusable task detaches only the current session and retains its catalog entry", async () => {
  const { tracker } = fixture("2026-10-15");
  tracker.taskIds = [5];
  tracker.taskCatalog = [{ id: 5, name: "Task", interval_count: 10 }];
  const removals = [];
  tracker.db = {
    deleteTask: async (session, id) => removals.push({ session, id }),
  };
  for (const method of ["renderGrid", "updateTaskCount", "updateSummary"])
    tracker[method] = () => {};
  tracker.removeTask(0);
  await tracker.waitForPendingWrites();
  assert.deepEqual(removals, [{ session: "yesterday", id: 5 }]);
  assert.equal(tracker.tasks.length, 0);
  assert.equal(tracker.taskCatalog[0].id, 5);
});

test("full sync attaches equal-named tasks by distinct IDs rather than matching names", async () => {
  const { tracker, container } = fixture("2026-10-15");
  tracker.tasks = ["Same", "Same"];
  tracker.taskIds = [10, 11];
  tracker.gridData = [new Array(96).fill(false), new Array(96).fill(false)];
  const attachments = [];
  tracker.db = {
    updateSession: async () => {},
    getSession: async () => ({
      id: "yesterday",
      date: "2026-10-15",
      tasks: [],
    }),
    attachTask: async (session, id) => attachments.push(id),
    getSessionIntervals: async () => [],
    createTask: async () =>
      assert.fail("Created a copy instead of reusing the ID"),
  };
  tracker.loadSessionFromSupabase = async () => {};
  await tracker.syncAndReloadFromSupabase();
  assert.deepEqual(attachments, [10, 11]);
  assert.equal(container.inert, false);
});

test("non-today dates show an explicit warning and highlight; today clears them", () => {
  const { tracker, elements } = fixture("2026-10-15");
  for (const date of ["2026-10-14", "2026-10-16"]) {
    tracker.date = date;
    tracker.updateDateControl(new Date(2026, 9, 15, 13));
    assert.equal(elements.dateInput.value, date);
    assert.equal(elements.dateInput.classList.contains("is-other-day"), true);
    assert.equal(elements.dateWarning.hidden, false);
    assert.equal(
      elements.dateWarning.textContent,
      `Not today: editing ${date}`,
    );
    assert.equal(elements.todayBtn.hidden, false);
  }
  tracker.date = "2026-10-15";
  tracker.updateDateControl(new Date(2026, 9, 15, 13));
  assert.equal(elements.dateInput.classList.contains("is-other-day"), false);
  assert.equal(elements.dateWarning.hidden, true);
  assert.equal(elements.todayBtn.hidden, true);
});

test("switching days loads the cloud session and returning restores the local day snapshot", async () => {
  const { tracker, storage, elements, container } = fixture("2026-10-15");
  tracker.db = {
    getSessionsForDate: async (date) => {
      assert.equal(date, "2026-10-14");
      return [
        {
          id: 14,
          date,
          memo: "Past focus",
          notes: "Past notes",
          tasks: [{ id: 140, name: "Past task" }],
        },
      ];
    },
    getSessionIntervals: async () => [{ task_id: 140, interval_index: 40 }],
    updateSession: async () =>
      assert.fail("Relabeled a cloud session during date selection"),
  };
  for (const method of [
    "renderGrid",
    "updateTaskCount",
    "updateSummary",
    "updateTimeCalculations",
  ])
    tracker[method] = () => {};
  assert.equal(await tracker.changeSessionDate("2026-10-14"), true);
  assert.equal(tracker.sessionId, 14);
  assert.equal(tracker.date, "2026-10-14");
  assert.equal(tracker.followToday, false);
  assert.equal(tracker.gridData[0][40], true);
  assert.equal(elements.dateWarning.hidden, false);
  const history = JSON.parse(storage.get("ettGridHistory"));
  assert.equal(history["2026-10-15:yesterday"].notes, "Yesterday's notes");
  assert.equal(await tracker.changeSessionDate("2026-10-15"), true);
  assert.equal(tracker.sessionId, "yesterday");
  assert.equal(tracker.tasks[0], "Task");
  assert.equal(tracker.taskIdMap.Task, "task-id");
  assert.equal(tracker.gridData[0][0], true);
  assert.equal(tracker.followToday, true);
  assert.equal(elements.notesInput.value, "Yesterday's notes");
  assert.equal(elements.dateWarning.hidden, true);
  assert.equal(container.inert, false);
});

test("failed day lookup preserves the previous session and resets the picker", async () => {
  const { tracker, elements, container, alerts } = fixture("2026-10-15");
  tracker.db = {
    getSessionsForDate: async () => {
      throw new Error("Offline");
    },
  };
  elements.dateInput.value = "2026-10-14";
  assert.equal(await tracker.changeSessionDate("2026-10-14"), false);
  assert.equal(tracker.date, "2026-10-15");
  assert.equal(tracker.sessionId, "yesterday");
  assert.equal(tracker.tasks[0], "Task");
  assert.equal(elements.dateInput.value, "2026-10-15");
  assert.equal(elements.dateWarning.hidden, true);
  assert.equal(container.inert, false);
  assert.match(alerts[0], /previous session was kept/);
});

test("a day without cloud data creates a blank session for that date", async () => {
  const { tracker, elements } = fixture("2026-10-15");
  tracker.db = {
    getSessionsForDate: async () => [],
    createSession: async (data) => {
      assert.equal(data.date, "2026-10-16");
      return { id: 16 };
    },
  };
  for (const method of [
    "renderGrid",
    "updateTaskCount",
    "updateSummary",
    "updateTimeCalculations",
  ])
    tracker[method] = () => {};
  assert.equal(await tracker.changeSessionDate("2026-10-16"), true);
  assert.equal(tracker.sessionId, 16);
  assert.equal(tracker.tasks.length, 0);
  assert.equal(elements.memoInput.value, "");
  assert.equal(elements.notesInput.value, "");
  assert.equal(elements.dateWarning.hidden, false);
});

test("local-only date navigation keeps per-day state without a cloud connection", async () => {
  const { tracker, elements } = fixture("2026-10-15", { configured: false });
  for (const method of [
    "renderGrid",
    "updateTaskCount",
    "updateSummary",
    "updateTimeCalculations",
  ])
    tracker[method] = () => {};
  assert.equal(await tracker.changeSessionDate("2026-10-14"), true);
  assert.equal(tracker.sessionId, null);
  assert.equal(tracker.tasks.length, 0);
  assert.equal(elements.dateWarning.hidden, false);
  assert.equal(await tracker.changeSessionDate("2026-10-15"), true);
  assert.equal(tracker.tasks[0], "Task");
});

test("historical session metadata syncs under its own date without rollover", async () => {
  const { tracker } = fixture("2026-10-14");
  tracker.followToday = false;
  const updates = [];
  tracker.db = {
    updateSession: async (id, data) => updates.push({ id, date: data.date }),
  };
  await tracker.syncToSupabase();
  assert.deepEqual(updates, [{ id: "yesterday", date: "2026-10-14" }]);
  assert.equal(tracker.date, "2026-10-14");
});

test("a reloaded historical selection retains its rollover preference", () => {
  const { tracker, storage, elements } = fixture("2026-10-15");
  storage.set(
    "ettGridState",
    JSON.stringify({
      date: "2026-10-14",
      followToday: false,
      tasks: [],
      gridData: [],
    }),
  );
  tracker.loadFromLocalStorage();
  assert.equal(tracker.followToday, false);
  assert.equal(tracker.rolloverDailySession(new Date(2026, 9, 15, 13)), false);
  assert.equal(elements.dateWarning.hidden, false);
});

test("renaming keeps the task ID and bubbles and saves the cloud name", async () => {
  const { tracker, storage, container } = fixture("2026-10-15");
  const originalGrid = tracker.gridData;
  const writes = [];
  tracker.db = {
    updateTask: async (session, task, data) =>
      writes.push({ session, task, name: data.name }),
  };
  tracker.renderGrid = () => {};
  tracker.updateSummary = () => {};
  await tracker.renameTask(0, "  Renamed task  ");
  assert.equal(tracker.tasks[0], "Renamed task");
  assert.equal(tracker.taskIdMap["Renamed task"], "task-id");
  assert.equal(tracker.taskIdMap.Task, undefined);
  assert.equal(tracker.gridData, originalGrid);
  assert.deepEqual(writes, [
    { session: "yesterday", task: "task-id", name: "Renamed task" },
  ]);
  assert.equal(
    JSON.parse(storage.get("ettGridState")).tasks[0],
    "Renamed task",
  );
  assert.equal(container.inert, false);
});

test("new tasks reject existing names ignoring case and surrounding spaces", () => {
  const { tracker } = fixture();
  tracker.taskCatalog = [{ id: 10, name: "Writing" }];
  assert.throws(() => tracker.addTask(" writing "), /Reuse a task/);
  assert.equal(tracker.tasks.length, 1);
  assert.equal(tracker.gridData.length, 1);
});

test("database duplicate-name race rolls back the optimistic local task", async () => {
  const { tracker, storage, alerts } = fixture("2026-10-15");
  tracker.sessionId = 15;
  tracker.taskCatalog = [{ id: 5, name: "Existing task" }];
  tracker.renderGrid = () => {};
  tracker.updateTaskCount = () => {};
  tracker.updateSummary = () => {};
  tracker.db = {
    createTask: async () => {
      throw new Error(
        "Task name already exists; reuse the existing task instead.",
      );
    },
  };
  tracker.addTask("New task");
  await [...tracker.pendingWrites][0];
  assert.deepEqual(tracker.tasks, ["Task"]);
  assert.equal(tracker.gridData.length, 1);
  assert.equal(JSON.parse(storage.get("ettGridState")).tasks[0], "Task");
  assert.match(alerts[0], /Reuse a task/);
});

test("renaming rejects a different existing task name but allows case-only self rename", async () => {
  const { tracker } = fixture();
  tracker.taskIds = [10];
  tracker.taskCatalog = [
    { id: 10, name: "Writing" },
    { id: 11, name: "Planning" },
  ];
  tracker.db = { updateTask: async () => {} };
  tracker.renderGrid = () => {};
  tracker.updateSummary = () => {};
  await assert.rejects(tracker.renameTask(0, " planning "), /Reuse a task/);
  assert.equal(tracker.tasks[0], "Task");
  tracker.taskCatalog = [{ id: 10, name: "Writing" }];
  await tracker.renameTask(0, "WRITING");
  assert.equal(tracker.tasks[0], "WRITING");
});

test("rename rejects blank names without changing data", async () => {
  const { tracker } = fixture();
  tracker.tasks.push("Other");
  await assert.rejects(tracker.renameTask(0, "  "), /Enter a task name/);
  assert.equal(tracker.tasks[0], "Task");
});

test("failed cloud rename keeps the old name and restores editing", async () => {
  const { tracker, storage, container } = fixture();
  tracker.db = {
    updateTask: async () => {
      throw new Error("Permission denied");
    },
  };
  await assert.rejects(tracker.renameTask(0, "New name"), /Permission denied/);
  assert.equal(tracker.tasks[0], "Task");
  assert.equal(tracker.taskIdMap.Task, "task-id");
  assert.equal(storage.size, 0);
  assert.equal(container.inert, false);
  assert.equal(tracker.isFullSyncing, false);
});

test("local-only tasks can be renamed without a database connection", async () => {
  const { tracker } = fixture();
  tracker.sessionId = null;
  tracker.renderGrid = () => {};
  tracker.updateSummary = () => {};
  await tracker.renameTask(0, "Local name");
  assert.equal(tracker.tasks[0], "Local name");
});

test("database refresh finds populated session 5 instead of empty sessions 6 and 7", async () => {
  let confirmation;
  const { tracker, storage, elements, container, alerts } = fixture(
    "2026-10-15",
    {
      confirm: (message) => {
        confirmation = message;
        return true;
      },
    },
  );
  tracker.sessionId = 6;
  tracker.db = {
    getSessionsForDate: async () => [
      { id: 7, date: "2026-10-15", tasks: [], intervals: [] },
      { id: 6, date: "2026-10-15", tasks: [], intervals: [] },
      {
        id: 5,
        date: "2026-10-15",
        tasks: [{ id: 50, name: "Recovered task" }],
        intervals: [{ id: 1 }],
      },
    ],
    getSessionIntervals: async (id) => {
      assert.equal(id, 5);
      return [{ task_id: 50, interval_index: 52 }];
    },
    updateSession: async () => assert.fail("Refresh uploaded local changes"),
  };
  for (const method of [
    "renderGrid",
    "updateTaskCount",
    "updateSummary",
    "updateTimeCalculations",
  ])
    tracker[method] = () => {};
  await tracker.refreshFromSupabase();
  assert.match(confirmation, /session 5/);
  assert.equal(tracker.sessionId, 5);
  assert.equal(tracker.tasks[0], "Recovered task");
  assert.equal(tracker.gridData[0][52], true);
  assert.equal(JSON.parse(storage.get("ettGridBeforeRefresh")).sessionId, 6);
  assert.equal(elements.refreshDbBtn.disabled, false);
  assert.equal(container.inert, false);
  assert.equal(alerts.length, 0);
});

test("canceling database refresh preserves local state", async () => {
  const { tracker, storage, container } = fixture("2026-10-15", {
    confirm: () => false,
  });
  tracker.db = {
    getSessionsForDate: async () => [
      { id: 5, date: "2026-10-15", tasks: [{ id: 50 }], intervals: [] },
    ],
    getSessionIntervals: async () => assert.fail("Loaded after cancellation"),
  };
  await tracker.refreshFromSupabase();
  assert.equal(tracker.sessionId, "yesterday");
  assert.deepEqual(tracker.tasks, ["Task"]);
  assert.equal(storage.size, 0);
  assert.equal(container.inert, false);
});

test("database refresh failure preserves local data and re-enables controls", async () => {
  const { tracker, elements, container, alerts } = fixture("2026-10-15");
  tracker.db = {
    getSessionsForDate: async () => {
      throw new Error("Offline");
    },
  };
  await tracker.refreshFromSupabase();
  assert.equal(tracker.sessionId, "yesterday");
  assert.deepEqual(tracker.tasks, ["Task"]);
  assert.equal(elements.refreshDbBtn.disabled, false);
  assert.equal(container.inert, false);
  assert.equal(tracker.isFullSyncing, false);
  assert.match(alerts[0], /Offline/);
});

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
  assert.equal(elements.trackedTimeDisplay.textContent, "0h 45m");
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
  elements.dateInput.value = "2026-10-14";
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
  assert.equal(elements.dateInput.value, "2026-10-15");
  assert.equal(tracker.rolloverDailySession(new Date(2026, 9, 15, 13)), false);
});

test("an explicitly selected historical day is not rolled over to today", () => {
  const { tracker, storage } = fixture("2026-10-14");
  tracker.followToday = false;
  assert.equal(tracker.rolloverDailySession(new Date(2026, 9, 15, 13)), false);
  assert.equal(tracker.date, "2026-10-14");
  assert.equal(storage.size, 0);
});

test("restoring the selected historical date keeps its date and data", () => {
  const { tracker, elements } = fixture("2026-10-14");
  tracker.restoreSessionData({
    id: 14,
    date: "2026-10-14",
    memo: "Historical memo",
    tasks: [{ id: 140, name: "Historical task" }],
  });
  assert.equal(tracker.date, "2026-10-14");
  assert.equal(tracker.sessionId, 14);
  assert.equal(tracker.tasks[0], "Historical task");
  assert.equal(elements.memoInput.value, "Historical memo");
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
    getSessionsForDate: async (date) => {
      assert.equal(date, "2026-10-15");
      return [];
    },
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

test("failed interval loading leaves the current local session intact", async () => {
  const { tracker, storage, elements } = fixture("2026-10-15");
  const original = JSON.stringify({
    tasks: tracker.tasks,
    gridData: tracker.gridData,
    sessionId: tracker.sessionId,
    memo: elements.memoInput.value,
    notes: elements.notesInput.value,
  });
  tracker.db = {
    getSessionIntervals: async () => {
      throw new Error("Connection interrupted");
    },
  };
  await assert.rejects(
    tracker.loadSessionFromSupabase({
      id: "remote-session",
      date: "2026-10-15",
      memo: "Remote memo",
      tasks: [],
    }),
    /Connection interrupted/,
  );
  assert.equal(
    JSON.stringify({
      tasks: tracker.tasks,
      gridData: tracker.gridData,
      sessionId: tracker.sessionId,
      memo: elements.memoInput.value,
      notes: elements.notesInput.value,
    }),
    original,
  );
  assert.equal(storage.size, 0);
});

test("a cloud load failure does not create a replacement session", async () => {
  const { tracker, storage } = fixture("2026-10-15");
  tracker.db = {
    getSessionsForDate: async () => {
      throw new Error("Temporary network error");
    },
    createSession: async () => assert.fail("Created a replacement session"),
  };
  await tracker.initializeSession();
  assert.equal(tracker.sessionId, "yesterday");
  assert.deepEqual(tracker.tasks, ["Task"]);
  assert.equal(tracker.gridData[0][0], true);
  assert.equal(tracker.isInitializingSession, false);
  assert.equal(storage.size, 0);
});

test("startup recovers populated session 5 when saved session 6 is empty", async () => {
  const { tracker } = fixture("2026-10-15");
  tracker.sessionId = 6;
  tracker.tasks = [];
  tracker.gridData = [];
  const empty = { id: 6, date: "2026-10-15", tasks: [], intervals: [] };
  const populated = {
    id: 5,
    date: "2026-10-15",
    tasks: [{ id: 50 }],
    intervals: [{ id: 1 }],
  };
  tracker.db = {
    getSession: async () => empty,
    getSessionsForDate: async () => [{ ...empty, id: 7 }, empty, populated],
    createSession: async () => assert.fail("Created another empty session"),
  };
  let restored;
  tracker.loadSessionFromSupabase = async (session) => {
    restored = session.id;
  };
  await tracker.initializeSession();
  assert.equal(restored, 5);
});

test("startup looks up today's existing sessions before creating one without a saved ID", async () => {
  const { tracker } = fixture("2026-10-15");
  tracker.sessionId = null;
  tracker.tasks = [];
  tracker.gridData = [];
  tracker.db = {
    getSessionsForDate: async () => [
      { id: 5, date: "2026-10-15", tasks: [{ id: 50 }] },
    ],
    createSession: async () => assert.fail("Created a duplicate session"),
  };
  let restored;
  tracker.loadSessionFromSupabase = async (session) => {
    restored = session.id;
  };
  await tracker.initializeSession();
  assert.equal(restored, 5);
});

test("startup restores all six tasks and 26 bubbles and persists the recovered pointer", async () => {
  const { tracker, storage } = fixture("2026-10-15");
  tracker.sessionId = 6;
  tracker.tasks = [];
  tracker.gridData = [];
  const tasks = Array.from({ length: 6 }, (_, index) => ({
    id: index + 50,
    name: `Task ${index + 1}`,
  }));
  const intervals = Array.from({ length: 26 }, (_, index) => ({
    id: index + 1,
    task_id: tasks[index % 6].id,
    interval_index: index + 36,
  }));
  tracker.db = {
    getSessionsForDate: async () => [
      { id: 7, date: "2026-10-15", tasks: [], intervals: [] },
      { id: 6, date: "2026-10-15", tasks: [], intervals: [] },
      { id: 5, date: "2026-10-15", tasks, intervals },
    ],
    getSessionIntervals: async (id) => {
      assert.equal(id, 5);
      return intervals;
    },
    createSession: async () => assert.fail("Created a duplicate session"),
    updateSession: async () =>
      assert.fail("Wrote to the cloud during recovery"),
  };
  for (const method of [
    "renderGrid",
    "updateTaskCount",
    "updateSummary",
    "updateTimeCalculations",
  ])
    tracker[method] = () => {};
  await tracker.initializeSession();
  assert.equal(tracker.sessionId, 5);
  assert.equal(tracker.tasks.length, 6);
  assert.equal(tracker.gridData.flat().filter(Boolean).length, 26);
  const saved = JSON.parse(storage.get("ettGridState"));
  assert.equal(saved.sessionId, 5);
  assert.equal(saved.tasks.length, 6);
  assert.equal(saved.gridData.flat().filter(Boolean).length, 26);
  assert.equal(
    tracker.selectCloudSession(await tracker.db.getSessionsForDate()).id,
    5,
  );
});

test("cloud initialization reuses a session from the same day", async () => {
  const { tracker } = fixture("2026-10-15");
  tracker.sessionId = "existing";
  let restored = false;
  tracker.db = {
    getSessionsForDate: async () => [
      { id: "existing", date: "2026-10-15", tasks: [{ id: 50 }] },
    ],
    createSession: async () => assert.fail("Created an unnecessary session"),
  };
  tracker.loadSessionFromSupabase = async () => {
    restored = true;
  };
  await tracker.initializeSession();
  assert.equal(restored, true);
  assert.equal(tracker.isInitializingSession, false);
});

test("startup does not replace local tasks with a different or empty cloud session", async () => {
  for (const session of [
    { id: "different", date: "2026-10-15", tasks: [{ id: 50 }] },
    { id: "yesterday", date: "2026-10-15", tasks: [] },
  ]) {
    const { tracker } = fixture("2026-10-15");
    tracker.db = { getSessionsForDate: async () => [session] };
    tracker.loadSessionFromSupabase = async () =>
      assert.fail("Replaced local tasks without confirmation");
    await tracker.initializeSession();
    assert.equal(tracker.sessionId, "yesterday");
    assert.deepEqual(tracker.tasks, ["Task"]);
    assert.equal(tracker.gridData[0][0], true);
  }
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
