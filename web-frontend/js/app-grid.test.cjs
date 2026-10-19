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
    ["syncStatus", { dataset: {} }],
    ["syncStatusIcon", {}],
    ["syncStatusText", {}],
    [
      "lastCloudSync",
      {
        removeAttribute(name) {
          delete this[name === "datetime" ? "dateTime" : name];
        },
      },
    ],
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
    window: {
      setTimeout() {},
      chooseSyncConflict: options.chooseSyncConflict || (async () => "cancel"),
    },
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
    vm.runInContext(fs.readFileSync(path.join(__dirname, file), "utf8"), context);
  }
  const tracker = vm.runInContext("Object.create(GridTaskTracker.prototype)", context);
  Object.assign(tracker, {
    date,
    cloudAuthenticated: options.authenticated !== false,
    cloudReachable: options.reachable ?? null,
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
  return { context, tracker, storage, elements, container, alerts };
}

test("sync status warns for local-only mode and persists the latest successful sync time", () => {
  const { tracker, storage, elements } = fixture("2026-10-15", {
    configured: false,
  });

  tracker.renderSyncStatus();
  assert.equal(elements.syncStatus.dataset.state, "local-only");
  assert.equal(elements.syncStatusIcon.textContent, "⚠");
  assert.match(elements.syncStatusText.textContent, /Local only/);
  assert.equal(elements.lastCloudSync.textContent, "Never");

  const syncedAt = new Date("2026-10-18T12:34:56.000Z");
  tracker.recordSyncSuccess(syncedAt);
  assert.equal(storage.get("ettLastSyncTime"), syncedAt.toISOString());
  assert.equal(elements.lastCloudSync.dateTime, syncedAt.toISOString());
  assert.equal(elements.syncStatus.dataset.state, "local-only");
});

test("sync status distinguishes offline from configured signed-out mode", () => {
  const { context, tracker, elements } = fixture("2026-10-15", {
    authenticated: false,
  });
  context.navigator = { onLine: false };
  tracker.renderSyncStatus();
  assert.equal(elements.syncStatus.dataset.state, "offline");
  assert.equal(elements.syncStatusIcon.textContent, "⚠");

  context.navigator.onLine = true;
  tracker.renderSyncStatus();
  assert.equal(elements.syncStatus.dataset.state, "sign-in");
  assert.match(elements.syncStatusText.textContent, /sign in/i);

  tracker.cloudAuthenticated = true;
  tracker.renderSyncStatus();
  assert.equal(elements.syncStatus.dataset.state, "checking");

  context.navigator.onLine = true;
  tracker.setCloudReachability(false);
  assert.equal(elements.syncStatus.dataset.state, "offline");

  tracker.setCloudReachability(true);
  assert.equal(elements.syncStatus.dataset.state, "connected");
  assert.equal(elements.syncStatusIcon.textContent, "✓");
  assert.equal(elements.syncStatusText.textContent, "Connected for syncing");
  assert.doesNotMatch(elements.syncStatusText.textContent, /supabase/i);

  tracker.recordSyncSuccess(new Date("2026-10-18T12:34:56.000Z"));
  assert.equal(elements.syncStatus.dataset.state, "synced");
  assert.equal(elements.syncStatusIcon.textContent, "✓");
  assert.equal(elements.syncStatusText.textContent, "Connected for syncing");
});

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
    createTask: async () => assert.fail("Created a copy instead of reusing the ID"),
  };
  tracker.loadSessionFromSupabase = async () => {};
  await tracker.syncAndReloadFromSupabase();
  assert.deepEqual(attachments, [10, 11]);
  assert.equal(container.inert, false);
});

test("full sync attaches a local task to an existing reusable cloud task", async () => {
  const { tracker } = fixture("2026-10-15");
  tracker.tasks = ["Reusable"];
  tracker.taskIds = ["local:offline-task"];
  tracker.gridData = [new Array(96).fill(false)];
  tracker.taskCatalog = [{ id: 42, name: "Reusable" }];
  const attached = [];
  tracker.db = {
    updateSession: async () => {},
    getSession: async () => ({ id: "yesterday", tasks: [] }),
    attachTask: async (sessionId, taskId) => attached.push({ sessionId, taskId }),
    createTask: async () => assert.fail("Created a duplicate reusable task"),
    getSessionIntervals: async () => [],
  };
  tracker.loadSessionFromSupabase = async () => {};

  await tracker.syncAndReloadFromSupabase();

  assert.deepEqual(attached, [{ sessionId: "yesterday", taskId: 42 }]);
  assert.equal(tracker.taskIds[0], 42);
});

test("non-today dates show an explicit warning and highlight; today clears them", () => {
  const { tracker, elements } = fixture("2026-10-15");
  for (const date of ["2026-10-14", "2026-10-16"]) {
    tracker.date = date;
    tracker.updateDateControl(new Date(2026, 9, 15, 13));
    assert.equal(elements.dateInput.value, date);
    assert.equal(elements.dateInput.classList.contains("is-other-day"), true);
    assert.equal(elements.dateWarning.hidden, false);
    assert.equal(elements.dateWarning.textContent, `Not today: editing ${date}`);
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

test("missing config keeps edits local even when a cached cloud session ID exists", async () => {
  const { tracker } = fixture("2026-10-15", {
    configured: false,
    authenticated: false,
  });
  const calls = [];
  tracker.db = {
    isAuthenticated: () => false,
    updateSession: async () => calls.push("updateSession"),
    createTask: async () => calls.push("createTask"),
    createInterval: async () => calls.push("createInterval"),
  };
  for (const method of ["renderGrid", "updateTaskCount", "updateSummary"])
    tracker[method] = () => {};
  tracker.saveToLocalStorage = () => {};

  tracker.addTask("Local task");
  await tracker.syncToSupabase();
  await tracker.syncIntervalToSupabase(0, 0, true);
  await tracker.initializeSession();

  assert.deepEqual(tracker.tasks, ["Task", "Local task"]);
  assert.equal(tracker.sessionId, "yesterday");
  assert.deepEqual(calls, []);
});

test("authenticated setup uploads local data marked during session initialization", async () => {
  const { context, tracker } = fixture();
  const calls = [];
  const db = {
    isAuthenticated: () => true,
    setAccessToken: (token) => calls.push(`token:${token}`),
  };
  context.getSupabaseClient = () => db;
  tracker.initializeSession = async () => {
    calls.push("initialize");
    tracker.pendingInitialSyncAction = "upload";
  };
  tracker.syncAndReloadFromSupabase = async () => calls.push("upload");

  assert.equal(await tracker.setupSupabase("user-token"), true);
  assert.deepEqual(calls, ["token:user-token", "initialize", "upload"]);
  assert.equal(tracker.pendingInitialSyncAction, null);
});

test("a local-only day is marked for upload when authenticated cloud setup creates its session", async () => {
  const { tracker } = fixture();
  tracker.db = {
    getSessionsForDate: async () => [],
    createSession: async () => ({ id: 15 }),
  };
  tracker.saveToLocalStorage = () => {};

  await tracker.initializeSession();

  assert.equal(tracker.sessionId, 15);
  assert.equal(tracker.pendingInitialSyncAction, "upload");
});

test("merging local and cloud sessions unions tasks and intervals and prompts for differing text", async () => {
  const prompts = [];
  const { tracker } = fixture("2026-10-15", {
    chooseSyncConflict: async () => "merge",
    confirm: (message) => {
      prompts.push(message);
      return prompts.length === 1;
    },
  });
  const cloudSession = {
    id: 15,
    date: "2026-10-15",
    start_time: "",
    memo: "Cloud memo",
    notes: "Cloud notes",
    tasks: [
      { id: 50, name: "Task" },
      { id: 60, name: "Cloud task" },
    ],
  };
  tracker.db = {
    getSessionsForDate: async () => [cloudSession],
    getSessionIntervals: async () => [
      { task_id: 50, interval_index: 1 },
      { task_id: 60, interval_index: 2 },
    ],
  };
  tracker.saveToLocalStorage = () => {};
  for (const method of ["renderGrid", "updateTaskCount", "updateSummary"])
    tracker[method] = () => {};

  await tracker.initializeSession();

  assert.deepEqual(Array.from(tracker.tasks), ["Task", "Cloud task"]);
  assert.deepEqual(Array.from(tracker.taskIds), [50, 60]);
  assert.deepEqual(Array.from(tracker.gridData[0].slice(0, 3)), [true, true, false]);
  assert.deepEqual(Array.from(tracker.gridData[1].slice(0, 3)), [false, false, true]);
  assert.equal(tracker.memo, "Yesterday's memo");
  assert.equal(tracker.notes, "Cloud notes");
  assert.equal(prompts.length, 2);
});

test("canceling a local/cloud conflict keeps local state and disconnects the day", async () => {
  const { tracker } = fixture("2026-10-15", {
    chooseSyncConflict: async () => "cancel",
  });
  const calls = [];
  tracker.db = {
    isAuthenticated: () => true,
    updateSession: async () => calls.push("updateSession"),
    getSessionsForDate: async () => [
      {
        id: 15,
        date: "2026-10-15",
        tasks: [{ id: 50, name: "Cloud task" }],
      },
    ],
    getSessionIntervals: async () => [],
  };
  tracker.saveToLocalStorage = () => {};

  await tracker.initializeSession();
  await tracker.syncToSupabase();

  assert.equal(tracker.sessionId, "yesterday");
  assert.equal(tracker.syncPausedForConflict, true);
  assert.deepEqual(tracker.tasks, ["Task"]);
  assert.equal(tracker.gridData[0][0], true);
  assert.deepEqual(calls, []);
});

test("choosing upload preserves the local snapshot and marks it for cloud upload", async () => {
  const { tracker } = fixture("2026-10-15", {
    chooseSyncConflict: async () => "upload",
  });
  tracker.db = {
    getSessionsForDate: async () => [
      {
        id: 15,
        date: "2026-10-15",
        tasks: [{ id: 50, name: "Cloud task" }],
      },
    ],
    getSessionIntervals: async () => [],
  };
  tracker.saveToLocalStorage = () => {};

  await tracker.initializeSession();

  assert.equal(tracker.sessionId, 15);
  assert.equal(tracker.pendingInitialSyncAction, "upload");
  assert.deepEqual(Array.from(tracker.tasks), ["Task"]);
  assert.equal(tracker.gridData[0][0], true);
});

test("choosing cloud backs up local data before loading the remote session", async () => {
  const { tracker, storage } = fixture("2026-10-15", {
    chooseSyncConflict: async () => "load",
  });
  tracker.db = {
    getSessionsForDate: async () => [
      {
        id: 15,
        date: "2026-10-15",
        tasks: [{ id: 50, name: "Cloud task" }],
      },
    ],
    getSessionIntervals: async () => [],
  };
  tracker.saveToLocalStorage = () => storage.set("ettGridState", "local snapshot");
  let loadedSessionId;
  tracker.loadSessionFromSupabase = async (session) => {
    loadedSessionId = session.id;
  };

  await tracker.initializeSession();

  assert.equal(loadedSessionId, 15);
  assert.equal(storage.get("ettGridBeforeCloudLoad:2026-10-15"), "local snapshot");
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
  assert.equal(JSON.parse(storage.get("ettGridState")).tasks[0], "Renamed task");
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
      throw new Error("Task name already exists; reuse the existing task instead.");
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
  const { tracker, storage, elements, container, alerts } = fixture("2026-10-15", {
    confirm: (message) => {
      confirmation = message;
      return true;
    },
  });
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
  assert.equal(JSON.parse(storage.get("ettReminderSettings")).bellEnabled, false);
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
  for (const state of [undefined, "suspended", "interrupted", "closed", "running"]) {
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
    getSessionIntervals: async () => [{ task_id: "task-id", interval_index: 95 }],
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
  const archive = JSON.parse(storage.get("ettGridHistory"))["2026-10-14:yesterday"];
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
    tracker[flag] = flag === "pendingWrites" ? new Set([Promise.resolve()]) : true;
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
  tracker.loadSessionFromSupabase = async () => assert.fail("Old session was restored");
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
  const { tracker, elements } = fixture("2026-10-15");
  elements.memoInput.value = "";
  elements.notesInput.value = "";
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
    getSessionIntervals: async () => [],
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
  const { tracker, elements } = fixture("2026-10-15");
  elements.memoInput.value = "";
  elements.notesInput.value = "";
  tracker.sessionId = null;
  tracker.tasks = [];
  tracker.gridData = [];
  tracker.db = {
    getSessionsForDate: async () => [{ id: 5, date: "2026-10-15", tasks: [{ id: 50 }] }],
    getSessionIntervals: async () => [],
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
  const { tracker, storage, elements } = fixture("2026-10-15");
  elements.memoInput.value = "";
  elements.notesInput.value = "";
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
    updateSession: async () => assert.fail("Wrote to the cloud during recovery"),
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
  assert.equal(tracker.selectCloudSession(await tracker.db.getSessionsForDate()).id, 5);
});

test("cloud initialization reuses a session from the same day", async () => {
  const { tracker } = fixture("2026-10-15");
  tracker.sessionId = "existing";
  let restored = false;
  tracker.db = {
    getSessionsForDate: async () => [
      {
        id: "existing",
        date: "2026-10-15",
        tasks: [{ id: 50, name: "Task" }],
        memo: "Yesterday's memo",
        notes: "Yesterday's notes",
      },
    ],
    getSessionIntervals: async () => [{ task_id: 50, interval_index: 0 }],
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
    { id: "different", date: "2026-10-15", tasks: [{ id: 50, name: "Cloud task" }] },
    { id: "yesterday", date: "2026-10-15", tasks: [] },
  ]) {
    const { tracker } = fixture("2026-10-15");
    tracker.db = {
      getSessionsForDate: async () => [session],
      getSessionIntervals: async () => [],
    };
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

function deleteFixture() {
  const setup = fixture("2026-10-15");
  const { tracker, storage } = setup;
  tracker.tasks = ["Task", "Other"];
  tracker.taskIds = [5, 6];
  tracker.taskIdMap = { Task: 5, Other: 6 };
  tracker.gridData = [[true], [true, true]];
  tracker.taskCatalog = [
    { id: 5, name: "Task" },
    { id: 6, name: "Other" },
  ];
  tracker.taskDayTotals = [
    { session_id: 14, task_id: 5, interval_count: 3 },
    { session_id: 14, task_id: 6, interval_count: 1 },
  ];
  storage.set(
    "ettGridHistory",
    JSON.stringify({
      past: {
        date: "2026-10-14",
        sessionId: 14,
        tasks: ["Task", "Other"],
        taskIds: [5, 6],
        taskIdMap: { Task: 5, Other: 6 },
        gridData: [[true], [true, true]],
      },
    }),
  );
  for (const method of [
    "renderGrid",
    "updateSummary",
    "updateTaskCount",
    "updateTaskPicker",
  ])
    tracker[method] = () => {};
  const shown = [];
  tracker.renderDeleteTaskDetails = (container, task, details, description) =>
    shown.push({ task, details, description });
  setup.shown = shown;
  return setup;
}

test("confirmed delete removes the task from the cloud, grid, and every local cache", async () => {
  const { context, tracker, storage, container, shown, alerts } = deleteFixture();
  const calls = [];
  tracker.db = {
    getTaskDetails: async (id) => ({ id, created_at: "2026-10-01T00:00:00Z" }),
    getTaskIntervals: async () => [
      { date: "2026-10-14", slot: 1 },
      { date: "2026-10-15", slot: 2 },
    ],
    deleteTaskEverywhere: async (id) => calls.push(id),
  };
  context.window.chooseDeleteTask = async (render) => {
    render({});
    return true;
  };
  assert.equal(await tracker.confirmDeleteTask("5"), true);
  assert.deepEqual(calls, ["5"]);
  assert.deepEqual(alerts, ['Deleted task "Task" and its 2 intervals.']);
  assert.equal(shown[0].description.count, 2);
  assert.equal(shown[0].details.created_at, "2026-10-01T00:00:00Z");
  assert.deepEqual(tracker.tasks, ["Other"]);
  assert.deepEqual(tracker.taskIds, [6]);
  assert.deepEqual(tracker.taskCatalog, [{ id: 6, name: "Other" }]);
  assert.deepEqual(tracker.taskDayTotals, [
    { session_id: 14, task_id: 6, interval_count: 1 },
  ]);
  const past = JSON.parse(storage.get("ettGridHistory")).past;
  assert.deepEqual(past.tasks, ["Other"]);
  assert.deepEqual(past.taskIds, [6]);
  assert.deepEqual(past.taskIdMap, { Other: 6 });
  assert.deepEqual(past.gridData, [[true, true]]);
  assert.equal(JSON.parse(storage.get("ettTaskCatalog")).length, 1);
  assert.equal(container.inert, false);
});

test("cancelling the delete dialog changes nothing", async () => {
  const { context, tracker, alerts } = deleteFixture();
  tracker.db = {
    getTaskDetails: async () => null,
    getTaskIntervals: async () => [],
    deleteTaskEverywhere: async () => assert.fail("Deleted after cancel"),
  };
  context.window.chooseDeleteTask = async () => false;
  assert.equal(await tracker.confirmDeleteTask("5"), false);
  assert.deepEqual(alerts, []);
  assert.deepEqual(tracker.tasks, ["Task", "Other"]);
  assert.equal(tracker.taskCatalog.length, 2);
});

test("a failed cloud delete keeps all local data and unlocks editing", async () => {
  const { context, tracker, storage, container } = deleteFixture();
  tracker.db = {
    getTaskDetails: async () => null,
    getTaskIntervals: async () => [],
    deleteTaskEverywhere: async () => {
      throw new Error("permission denied");
    },
  };
  context.window.chooseDeleteTask = async () => true;
  await assert.rejects(() => tracker.confirmDeleteTask("5"), /permission denied/);
  assert.deepEqual(tracker.tasks, ["Task", "Other"]);
  assert.equal(tracker.taskCatalog.length, 2);
  assert.equal(JSON.parse(storage.get("ettGridHistory")).past.tasks.length, 2);
  assert.equal(tracker.isFullSyncing, false);
  assert.equal(container.inert, false);
});

test("local-only tasks are deleted without the database and list intervals from snapshots", async () => {
  const { context, tracker, storage, shown } = deleteFixture();
  tracker.taskIds = ["local:a", 6];
  tracker.taskIdMap = { Task: "local:a", Other: 6 };
  tracker.taskCatalog[0].id = "local:a";
  storage.set(
    "ettGridHistory",
    JSON.stringify({
      past: {
        date: "2026-10-14",
        tasks: ["Task"],
        taskIds: ["local:a"],
        gridData: [[false, true, true]],
      },
    }),
  );
  tracker.db = {
    getTaskIntervals: async () => assert.fail("Read the cloud for a local task"),
    deleteTaskEverywhere: async () => assert.fail("Deleted a local task in the cloud"),
  };
  context.window.chooseDeleteTask = async (render) => {
    render({});
    return true;
  };
  assert.equal(await tracker.confirmDeleteTask("local:a"), true);
  assert.equal(shown[0].details, null);
  assert.equal(shown[0].description.count, 3);
  assert.deepEqual(tracker.tasks, ["Other"]);
  assert.deepEqual(JSON.parse(storage.get("ettGridHistory")).past.tasks, []);
});

test("saved tasks cannot be deleted while the cloud is unavailable", async () => {
  const { tracker } = deleteFixture();
  tracker.cloudAuthenticated = false;
  await assert.rejects(() => tracker.confirmDeleteTask("5"), /Sign in/);
  assert.equal(tracker.taskCatalog.length, 2);
});

test("picker buttons: tasks already on the day can be deleted but not added again", () => {
  const { elements, tracker } = deleteFixture();
  elements.reuseTaskBtn = {};
  elements.deleteTaskBtn = {};
  elements.existingTaskSelect = { value: "", selectedOptions: [] };
  tracker.updatePickerButtons();
  assert.equal(elements.reuseTaskBtn.disabled, true);
  assert.equal(elements.deleteTaskBtn.disabled, true);
  elements.existingTaskSelect = {
    value: "5",
    selectedOptions: [{ dataset: { onDay: "true" } }],
  };
  tracker.updatePickerButtons();
  assert.equal(elements.reuseTaskBtn.disabled, true);
  assert.equal(elements.deleteTaskBtn.disabled, false);
  elements.existingTaskSelect = { value: "9", selectedOptions: [{ dataset: {} }] };
  tracker.updatePickerButtons();
  assert.equal(elements.reuseTaskBtn.disabled, false);
  assert.equal(elements.deleteTaskBtn.disabled, false);
});
