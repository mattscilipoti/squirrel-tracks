const assert = require("node:assert/strict");

// Values built inside the vm context have a different Array.prototype, which strict
// deepEqual rejects; compare their JSON form instead.
const strictDeepEqual = assert.deepEqual;
assert.deepEqual = (actual, expected, message) =>
  strictDeepEqual(
    JSON.parse(JSON.stringify(actual)),
    JSON.parse(JSON.stringify(expected)),
    message,
  );
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");
const Y = require("yjs");

let idCounter = 0;

/**
 * Loads the browser scripts into a vm context with hand-built DOM fakes and a real
 * DataStore backed by an in-memory Yjs document. `store` is the tracker's store;
 * `peer()` makes a second device whose changes can be synced into it.
 */
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
    ["memoInput", { value: "" }],
    ["notesInput", { value: "" }],
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
    clearTimeout,
    setTimeout,
    Date: FixedDate,
    TextDecoder,
    window: { setTimeout() {} },
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
  for (const file of [
    "time-calculations.js",
    "remote-changes.js",
    "store.js",
    "app-grid.js",
  ]) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, file), "utf8"), context);
  }
  const DataStore = vm.runInContext("DataStore", context);
  const makeStore = () =>
    new DataStore(Y, new Y.Doc(), { idFactory: () => `t${++idCounter}` });
  const store = makeStore();
  const tracker = vm.runInContext("Object.create(GridTaskTracker.prototype)", context);
  const notices = [];
  Object.assign(tracker, {
    store,
    date,
    followToday: true,
    taskIds: [],
    tasks: [],
    gridData: [],
    taskCatalog: [],
    timerState: {
      isRunning: true,
      timeRemaining: 123,
      totalTime: 900,
      currentInterval: 12,
    },
  });
  if (options.ui !== true) {
    for (const method of [
      "renderGrid",
      "updateSummary",
      "updateTaskCount",
      "updateTaskPicker",
      "updateTimeCalculations",
    ])
      tracker[method] = () => {};
  }
  tracker.showRemoteNotice = (title, lines) => notices.push({ title, lines });
  tracker.loadDay(date);
  // A second device: sync it with `store` by passing it to `exchange`.
  const peer = () => makeStore();
  const exchange = (other) => {
    other.applyState(store.encodeState());
    store.applyState(other.encodeState());
  };
  return {
    context,
    tracker,
    store,
    storage,
    elements,
    container,
    alerts,
    notices,
    peer,
    exchange,
  };
}

const slotsOf = (row) => row.flatMap((filled, slot) => (filled ? [slot] : []));

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

test("sync status says data is saved on this device", () => {
  const { tracker, elements } = fixture("2026-10-15");
  tracker.renderSyncStatus();
  assert.equal(elements.syncStatus.dataset.state, "local-only");
  assert.match(elements.syncStatusText.textContent, /Saved on this device/);
});

test("adding a task writes it to the store and the day", () => {
  const { tracker, store } = fixture();
  tracker.addTask("  Writing ");
  assert.deepEqual(tracker.tasks, ["Writing"]);
  assert.equal(tracker.gridData[0].length, 96);
  assert.deepEqual(store.readDay("2026-10-14").tasks, ["Writing"]);
  assert.equal(tracker.taskCatalog.length, 1);
});

test("new tasks reject existing names ignoring case and surrounding spaces", () => {
  const { tracker } = fixture();
  tracker.addTask("Writing");
  assert.throws(() => tracker.addTask(" writing "), /Reuse a task/);
  assert.throws(() => tracker.addTask("   "), /Enter a task name/);
  assert.equal(tracker.tasks.length, 1);
  assert.equal(tracker.gridData.length, 1);
});

test("a reused task keeps its ID and starts with empty bubbles on the new day", () => {
  const { tracker, store } = fixture();
  tracker.addTask("Writing");
  tracker.toggleInterval(36, 0);
  const [id] = tracker.taskIds;
  tracker.changeSessionDate("2026-10-15");
  assert.deepEqual(tracker.tasks, []);
  assert.equal(tracker.taskCatalog[0].id, id);
  tracker.reuseTask(id);
  assert.deepEqual(tracker.taskIds, [id]);
  assert.equal(tracker.gridData[0].some(Boolean), false);
  assert.deepEqual(store.readDay("2026-10-15").taskIds, [id]);
  tracker.reuseTask(id);
  assert.equal(tracker.tasks.length, 1, "a task already on the day is not added twice");
  assert.throws(() => tracker.reuseTask("missing"), /existing task/);
  assert.equal(tracker.taskAllDayIntervals(0), 1);
});

test("renaming keeps the task ID and bubbles on every day", () => {
  const { tracker, store } = fixture();
  tracker.addTask("Writing");
  tracker.toggleInterval(3, 0);
  tracker.changeSessionDate("2026-10-13");
  tracker.reuseTask(tracker.taskCatalog[0].id);
  tracker.changeSessionDate("2026-10-14");
  tracker.renameTask(0, "Drafting");
  assert.deepEqual(tracker.tasks, ["Drafting"]);
  assert.deepEqual(store.readDay("2026-10-14").tasks, ["Drafting"]);
  assert.deepEqual(store.readDay("2026-10-13").tasks, ["Drafting"]);
  assert.equal(tracker.gridData[0][3], true);
});

test("renaming rejects a different existing task name but allows case-only self rename", () => {
  const { tracker } = fixture();
  tracker.addTask("Writing");
  tracker.addTask("Planning");
  assert.throws(() => tracker.renameTask(0, " planning "), /Reuse a task/);
  assert.equal(tracker.tasks[0], "Writing");
  tracker.renameTask(0, "WRITING");
  assert.equal(tracker.tasks[0], "WRITING");
  assert.throws(() => tracker.renameTask(0, "  "), /Enter a task name/);
  assert.equal(tracker.tasks[0], "WRITING");
});

test("removing a task detaches only the current day and keeps it in the catalog", () => {
  const { tracker, store } = fixture();
  tracker.addTask("Writing");
  tracker.toggleInterval(1, 0);
  tracker.removeTask(0);
  assert.deepEqual(tracker.tasks, []);
  assert.deepEqual(store.readDay("2026-10-14").tasks, []);
  assert.deepEqual(
    tracker.taskCatalog.map((task) => task.name),
    ["Writing"],
  );
});

test("toggling a bubble writes through to the store and saves the start time", () => {
  const { tracker, store, elements } = fixture("2026-10-15");
  tracker.addTask("Writing");
  tracker.toggleInterval(36, 0);
  tracker.toggleInterval(40, 0);
  assert.deepEqual(slotsOf(store.readDay("2026-10-15").gridData[0]), [36, 40]);
  assert.equal(store.readDay("2026-10-15").startTime, "09:00");
  assert.equal(elements.firstActivityDisplay.textContent, "09:00");
  assert.equal(elements.lastActivityDisplay.textContent, "10:15");
  tracker.toggleInterval(36, 0);
  tracker.toggleInterval(40, 0);
  assert.equal(store.readDay("2026-10-15").startTime, "");
  assert.equal(elements.firstActivityDisplay.textContent, "--");
});

test("memo and notes are saved to the day", () => {
  const { tracker, store, elements } = fixture();
  elements.memoInput.value = "focus";
  elements.notesInput.value = "details";
  tracker.saveDayFields();
  const day = store.readDay("2026-10-14");
  assert.deepEqual([day.memo, day.notes], ["focus", "details"]);
});

test("clearing the grid keeps tasks but removes all bubbles", () => {
  const { tracker, store } = fixture();
  tracker.addTask("Writing");
  tracker.toggleInterval(1, 0);
  tracker.clearGrid();
  assert.deepEqual(tracker.tasks, ["Writing"]);
  assert.equal(tracker.gridData[0].some(Boolean), false);
  assert.equal(store.readDay("2026-10-14").gridData[0].some(Boolean), false);
});

test("changing days saves the old day, loads the new one, and rejects bad dates", () => {
  const { tracker, elements } = fixture("2026-10-15");
  tracker.addTask("Writing");
  tracker.toggleInterval(5, 0);
  elements.memoInput.value = "today memo";
  assert.equal(tracker.changeSessionDate("2026-10-14"), true);
  assert.equal(tracker.followToday, false);
  assert.deepEqual(tracker.tasks, []);
  assert.equal(elements.memoInput.value, "");
  assert.equal(tracker.changeSessionDate("2026-10-15"), true);
  assert.equal(tracker.followToday, true);
  assert.equal(elements.memoInput.value, "today memo");
  assert.equal(tracker.gridData[0][5], true);
  assert.equal(tracker.changeSessionDate("2026-02-31"), false);
  assert.equal(tracker.changeSessionDate("garbage"), false);
  assert.equal(tracker.date, "2026-10-15");
});

test("a reloaded historical selection retains its rollover preference", () => {
  const { tracker, storage, elements } = fixture("2026-10-15");
  storage.set(
    "ettDeviceState",
    JSON.stringify({ date: "2026-10-14", followToday: false }),
  );
  tracker.loadDeviceState();
  assert.equal(tracker.followToday, false);
  assert.equal(tracker.date, "2026-10-14");
  assert.equal(tracker.rolloverDailySession(new Date(2026, 9, 15, 13)), false);
  tracker.updateDateControl(new Date(2026, 9, 15, 13));
  assert.equal(elements.dateWarning.hidden, false);
});

test("device state falls back to the pre-Yjs saved state", () => {
  const { tracker, storage } = fixture("2026-10-15");
  storage.set(
    "ettGridState",
    JSON.stringify({ date: "2026-10-12", followToday: false, tasks: [] }),
  );
  tracker.loadDeviceState();
  assert.equal(tracker.date, "2026-10-12");
  assert.equal(tracker.followToday, false);
});

test("rollover saves yesterday and starts a clean today", () => {
  const { tracker, store, elements } = fixture("2026-10-14");
  tracker.addTask("Task");
  tracker.toggleInterval(0, 0);
  elements.notesInput.value = "Yesterday's notes";
  assert.equal(tracker.rolloverDailySession(new Date(2026, 9, 15, 0, 0)), true);
  const archive = store.readDay("2026-10-14");
  assert.deepEqual(archive.tasks, ["Task"]);
  assert.equal(archive.gridData[0][0], true);
  assert.equal(archive.notes, "Yesterday's notes");
  assert.equal(tracker.date, "2026-10-15");
  assert.deepEqual(tracker.tasks, []);
  assert.equal(tracker.notes, "");
  assert.equal(elements.notesInput.value, "");
  assert.equal(elements.dateInput.value, "2026-10-15");
  assert.equal(tracker.rolloverDailySession(new Date(2026, 9, 15, 13)), false);
});

test("an explicitly selected historical day is not rolled over to today", () => {
  const { tracker } = fixture("2026-10-14");
  tracker.followToday = false;
  assert.equal(tracker.rolloverDailySession(new Date(2026, 9, 15, 13)), false);
  assert.equal(tracker.date, "2026-10-14");
});

test("same-day session is left untouched", () => {
  const { tracker } = fixture("2026-10-15");
  assert.equal(tracker.rolloverDailySession(new Date(2026, 9, 15, 13)), false);
});

test("confirmed delete removes the task and its bubbles from every day", async () => {
  const { context, tracker, store, alerts } = fixture("2026-10-15");
  tracker.addTask("Task");
  tracker.addTask("Other");
  tracker.toggleInterval(1, 0);
  tracker.changeSessionDate("2026-10-14");
  const [taskId] = tracker.taskCatalog.filter((task) => task.name === "Task");
  tracker.reuseTask(taskId.id);
  tracker.toggleInterval(2, 0);
  const shown = [];
  tracker.renderDeleteTaskDetails = (_container, task, details, description) =>
    shown.push({ task, details, description });
  context.window.chooseDeleteTask = async (render) => {
    render({});
    return true;
  };
  assert.equal(await tracker.confirmDeleteTask(taskId.id), true);
  assert.deepEqual(alerts, ['Deleted task "Task" and its 2 intervals.']);
  assert.equal(shown[0].description.count, 2);
  assert.match(shown[0].details.created_at, /^\d{4}-/);
  assert.deepEqual(tracker.tasks, []);
  assert.deepEqual(
    tracker.taskCatalog.map((task) => task.name),
    ["Other"],
  );
  assert.deepEqual(store.readDay("2026-10-15").tasks, ["Other"]);
});

test("cancelling the delete dialog changes nothing", async () => {
  const { context, tracker, alerts } = fixture();
  tracker.addTask("Task");
  context.window.chooseDeleteTask = async () => false;
  assert.equal(await tracker.confirmDeleteTask(tracker.taskIds[0]), false);
  assert.deepEqual(alerts, []);
  assert.deepEqual(tracker.tasks, ["Task"]);
  assert.equal(tracker.taskCatalog.length, 1);
});

test("a change from another device is applied and summarized", () => {
  const { tracker, store, peer, exchange, notices, elements } = fixture("2026-10-15");
  tracker.addTask("Writing");
  const other = peer();
  exchange(other);
  other.setCell("2026-10-15", tracker.taskIds[0], 7, true);
  other.setDayField("2026-10-15", "memo", "from the phone");
  exchange(other);
  tracker.refreshFromRemoteChange();
  assert.equal(tracker.gridData[0][7], true);
  assert.equal(elements.memoInput.value, "from the phone");
  assert.equal(notices.length, 1);
  assert.equal(notices[0].title, "Updated from another device");
  assert.match(notices[0].lines.join("\n"), /memo/i);
  assert.equal(store.readDay("2026-10-15").gridData[0][7], true);
});

test("an echo of our own write changes nothing and shows no message", () => {
  const { tracker, notices } = fixture("2026-10-15");
  tracker.addTask("Writing");
  tracker.toggleInterval(4, 0);
  tracker.refreshFromRemoteChange();
  assert.deepEqual(notices, []);
});

test("text being typed survives a remote change to something else", () => {
  const { tracker, peer, exchange, elements } = fixture("2026-10-15");
  tracker.addTask("Writing");
  const other = peer();
  exchange(other);
  other.setCell("2026-10-15", tracker.taskIds[0], 9, true);
  exchange(other);
  elements.notesInput.value = "half-typed";
  tracker.refreshFromRemoteChange();
  assert.equal(tracker.gridData[0][9], true);
  assert.equal(elements.notesInput.value, "half-typed");
});

test("a task renamed and a task added on another device appear here", () => {
  const { tracker, peer, exchange, notices } = fixture("2026-10-15");
  tracker.addTask("Writing");
  const other = peer();
  exchange(other);
  other.renameTask(tracker.taskIds[0], "Drafting");
  const id = other.createTask("Email");
  other.addTaskToDay("2026-10-15", id);
  exchange(other);
  tracker.refreshFromRemoteChange();
  assert.deepEqual(tracker.tasks, ["Drafting", "Email"]);
  assert.equal(notices.length, 1);
});

test("importing a Supabase export JSON file adds its days", async () => {
  const { tracker, store } = fixture("2026-10-15");
  const rows = [
    {
      date: "2026-10-15",
      memo: "m",
      notes: null,
      start_time: "09:00",
      tasks: [{ name: "Writing", intervals: [36] }],
    },
  ];
  const file = { arrayBuffer: async () => Buffer.from(JSON.stringify(rows)) };
  assert.match(await tracker.importFile(file), /Imported 1 day/);
  assert.deepEqual(tracker.tasks, ["Writing"]);
  assert.equal(tracker.gridData[0][36], true);
  assert.equal(store.readDay("2026-10-15").memo, "m");
});

test("importing a backup file merges it with this device's data", async () => {
  const { tracker, peer } = fixture("2026-10-15");
  tracker.addTask("Writing");
  const other = peer();
  const id = other.createTask("Email");
  other.setCell("2026-10-15", id, 2, true);
  const file = { arrayBuffer: async () => other.encodeState().buffer.slice(0) };
  assert.equal(await tracker.importFile(file), "Backup merged.");
  assert.deepEqual(tracker.tasks.sort(), ["Email", "Writing"]);
});

test("clicking and shift-clicking bubbles fills an inclusive range in the same row", () => {
  const { context, tracker, store } = fixture("2026-10-15", { ui: true });
  function element() {
    return {
      children: [],
      dataset: {},
      classList: { add() {} },
      setAttribute() {},
      appendChild(child) {
        this.children.push(child);
      },
      addEventListener(type, handler) {
        this[type] = handler;
      },
      set innerHTML(value) {
        if (value === "") this.children = [];
      },
    };
  }
  const body = element();
  context.document.createElement = element;
  const getElementById = context.document.getElementById;
  context.document.getElementById = (id) =>
    id === "gridBody" ? body : getElementById(id);
  tracker.addTask = tracker.addTask.bind(tracker);
  tracker.updateCurrentTimeLine = () => {};
  tracker.updateTaskPicker = () => {};
  tracker.updateSummary = () => {};
  tracker.updateTaskCount = () => {};
  tracker.addTask("Task");
  tracker.addTask("Other");
  const click = (row, index, shiftKey = false) =>
    body.children[row].children[index + 1].children[0].click({ shiftKey });
  const stored = (row) => slotsOf(store.readDay("2026-10-15").gridData[row]);

  click(0, 5);
  click(0, 2, true);
  assert.deepEqual(slotsOf(tracker.gridData[0]), [2, 3, 4, 5]);
  assert.deepEqual(stored(0), [2, 3, 4, 5]);
  click(0, 7, true);
  assert.deepEqual(slotsOf(tracker.gridData[0]), [2, 3, 4, 5, 6, 7]);
  click(1, 95, true);
  assert.deepEqual(slotsOf(tracker.gridData[1]), [95]);
  click(1, 93, true);
  assert.deepEqual(slotsOf(tracker.gridData[1]), [93, 94, 95]);
  assert.deepEqual(stored(1), [93, 94, 95]);

  tracker.gridData[1] = Array(96).fill(false);
  tracker.renderGrid();
  click(1, 90, true);
  assert.deepEqual(slotsOf(tracker.gridData[1]), [90]);
});

test("picker buttons: tasks already on the day can be deleted but not added again", () => {
  const { elements, tracker } = fixture();
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

function fakeSync(overrides = {}) {
  const calls = [];
  const sync = {
    paired: true,
    peerCount: 0,
    pairing: { signaling: null },
    isPaired() {
      return this.paired;
    },
    onChange() {},
    setSignaling(urls) {
      calls.push(urls);
    },
    ...overrides,
  };
  return { sync, calls };
}

test("sync status reflects pairing, connected devices and connectivity", () => {
  const { tracker, context, elements } = fixture("2026-10-15");
  tracker.renderSyncStatus();
  assert.equal(elements.syncStatus.dataset.state, "local-only", "no sync object");

  const { sync } = fakeSync({ paired: false });
  tracker.sync = sync;
  tracker.renderSyncStatus();
  assert.equal(elements.syncStatus.dataset.state, "local-only", "not paired");

  sync.paired = true;
  tracker.renderSyncStatus();
  assert.equal(elements.syncStatus.dataset.state, "waiting");
  assert.match(elements.syncStatusText.textContent, /another device/);

  sync.peerCount = 1;
  tracker.renderSyncStatus();
  assert.equal(elements.syncStatus.dataset.state, "synced");
  assert.equal(elements.syncStatusText.textContent, "Syncing with 1 other device");
  sync.peerCount = 3;
  tracker.renderSyncStatus();
  assert.equal(elements.syncStatusText.textContent, "Syncing with 3 other devices");

  context.navigator = { onLine: false };
  tracker.renderSyncStatus();
  assert.equal(elements.syncStatus.dataset.state, "offline");
});

test("the last time another device sent changes is remembered", () => {
  const { tracker, storage, elements } = fixture("2026-10-15");
  assert.equal(elements.lastCloudSync.textContent, undefined);
  tracker.renderSyncStatus();
  assert.equal(elements.lastCloudSync.textContent, "Never");
  const at = new Date("2026-10-18T12:34:56.000Z");
  tracker.recordSyncTime(at);
  assert.equal(storage.get("ettLastSyncTime"), at.toISOString());
  assert.equal(elements.lastCloudSync.dateTime, at.toISOString());
  assert.notEqual(elements.lastCloudSync.textContent, "Never");
});

test("saving signaling servers splits the list and empty input restores the default", () => {
  const { tracker, elements } = fixture("2026-10-15");
  const { sync, calls } = fakeSync();
  tracker.sync = sync;
  elements.pairSignaling = { value: " wss://a.example , ws://10.0.0.2:4444 " };
  tracker.savePairSignaling();
  elements.pairSignaling.value = "  ";
  tracker.savePairSignaling();
  assert.deepEqual(calls, [["wss://a.example", "ws://10.0.0.2:4444"], null]);
});

test("a rejected signaling address is shown to the user", () => {
  const { tracker, elements, alerts } = fixture("2026-10-15");
  const { sync } = fakeSync({
    setSignaling() {
      throw new Error("Use a ws:// or wss:// address.");
    },
  });
  tracker.sync = sync;
  elements.pairSignaling = { value: "https://nope" };
  tracker.savePairSignaling();
  assert.deepEqual(alerts, ["Use a ws:// or wss:// address."]);
});
