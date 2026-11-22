const assert = require("node:assert/strict");
const { test } = require("node:test");
const Y = require("yjs");
const DataStore = require("./store.js");

let counter = 0;
const device = (prefix) =>
  new DataStore(Y, new Y.Doc(), { idFactory: () => `${prefix}-${++counter}` });

// Exchange full state both ways, as two peers eventually would.
const sync = (a, b) => {
  a.applyState(b.encodeState());
  b.applyState(a.encodeState());
};

test("creates tasks reusably and case-insensitively", () => {
  const store = device("a");
  const id = store.createTask("  Writing ");
  assert.equal(store.createTask("writing"), id);
  assert.deepEqual(store.liveTasks(), [{ id, name: "Writing" }]);
  assert.throws(() => store.renameTask(store.createTask("Email"), "WRITING"));
});

test("reads and writes a day", () => {
  const store = device("a");
  const id = store.createTask("Writing");
  store.addTaskToDay("2026-11-22", id);
  store.setCell("2026-11-22", id, 36, true);
  store.setCell("2026-11-22", id, 37, true);
  store.setCell("2026-11-22", id, 37, false);
  store.setDayField("2026-11-22", "memo", "focus");
  const day = store.readDay("2026-11-22");
  assert.deepEqual(day.tasks, ["Writing"]);
  assert.equal(day.gridData[0].filter(Boolean).length, 1);
  assert.equal(day.gridData[0][36], true);
  assert.equal(day.memo, "focus");
  assert.deepEqual(store.catalog(), [{ id, name: "Writing", interval_count: 1 }]);
});

test("deleted tasks disappear from days and totals", () => {
  const store = device("a");
  const id = store.createTask("Writing");
  store.setCell("2026-11-22", id, 1, true);
  store.deleteTask(id);
  assert.deepEqual(store.readDay("2026-11-22").tasks, []);
  assert.deepEqual(store.catalog(), []);
  assert.deepEqual(store.dayTotals(), []);
});

test("concurrent edits on two devices converge", () => {
  const a = device("a");
  const b = device("b");
  const id = a.createTask("Writing");
  sync(a, b);
  a.setCell("2026-11-22", id, 10, true);
  b.setCell("2026-11-22", id, 11, true);
  b.setDayField("2026-11-22", "memo", "from b");
  a.renameTask(id, "Drafting");
  sync(a, b);
  for (const store of [a, b]) {
    const day = store.readDay("2026-11-22");
    assert.deepEqual(day.tasks, ["Drafting"]);
    assert.equal(day.gridData[0][10] && day.gridData[0][11], true);
    assert.equal(day.memo, "from b");
  }
});

test("the same new day created on both devices keeps both devices' bubbles", () => {
  const a = device("a");
  const b = device("b");
  const id = a.createTask("Writing");
  sync(a, b);
  a.setCell("2026-11-23", id, 1, true);
  b.setCell("2026-11-23", id, 2, true);
  sync(a, b);
  assert.equal(a.readDay("2026-11-23").gridData[0].filter(Boolean).length, 2);
  assert.deepEqual(a.readDay("2026-11-23"), b.readDay("2026-11-23"));
});

test("a task created with the same name on two devices is merged", () => {
  const a = device("a");
  const b = device("b");
  const idA = a.createTask("Email");
  const idB = b.createTask("email");
  a.setCell("2026-11-22", idA, 1, true);
  b.setCell("2026-11-22", idB, 2, true);
  sync(a, b);
  sync(a, b);
  const keeper = [idA, idB].sort()[0];
  for (const store of [a, b]) {
    assert.deepEqual(
      store.liveTasks().map((task) => task.id),
      [keeper],
    );
    const day = store.readDay("2026-11-22");
    assert.deepEqual(day.taskIds, [keeper]);
    assert.deepEqual(
      day.gridData[0].flatMap((filled, slot) => (filled ? [slot] : [])),
      [1, 2],
    );
  }
});

test("remote listeners fire for imports but not for local edits", () => {
  const a = device("a");
  const b = device("b");
  let calls = 0;
  b.onRemoteChange(() => calls++);
  b.createTask("Local");
  assert.equal(calls, 0);
  a.createTask("Remote");
  b.applyState(a.encodeState());
  assert.equal(calls, 1);
});

test("migrates the old localStorage shape", () => {
  const state = {
    date: "2026-11-22",
    tasks: ["Writing", "Email"],
    taskIds: [7, "local:x"],
    gridData: [[...Array(96)].map((_, i) => i === 3), [...Array(96)].map(() => false)],
    memo: "m",
    notes: "n",
    startTime: "00:45",
  };
  const history = {
    "2026-11-21:5": {
      ...state,
      date: "2026-11-21",
      tasks: ["Writing"],
      taskIds: [7],
      gridData: [state.gridData[0]],
    },
  };
  const storage = {
    getItem: (key) =>
      ({ ettGridState: JSON.stringify(state), ettGridHistory: JSON.stringify(history) })[
        key
      ] ?? null,
  };
  const store = device("a");
  assert.equal(store.importLegacyStorage(storage), 2);
  assert.deepEqual(store.readDay("2026-11-22").tasks, ["Writing", "Email"]);
  assert.equal(store.readDay("2026-11-22").gridData[0][3], true);
  assert.equal(store.readDay("2026-11-22").memo, "m");
  assert.equal(store.liveTasks().length, 2);
  assert.equal(store.catalog().find((task) => task.name === "Writing").interval_count, 2);
});

test("imports the Supabase export, merging sessions on one date", () => {
  const store = device("a");
  const slots = (...indexes) => indexes;
  const count = store.importSupabaseExport([
    {
      date: "2026-10-15",
      memo: "m",
      notes: null,
      start_time: "09:00",
      tasks: [{ name: "Writing", intervals: slots(36, 37) }],
    },
    {
      date: "2026-10-15",
      memo: null,
      notes: "n",
      start_time: null,
      tasks: [
        { name: "writing", intervals: slots(38) },
        { name: "Email", intervals: [] },
      ],
    },
    { date: "bad", tasks: [] },
  ]);
  assert.equal(count, 2);
  const day = store.readDay("2026-10-15");
  assert.deepEqual(day.tasks, ["Writing", "Email"]);
  assert.deepEqual(
    day.gridData[0].flatMap((filled, slot) => (filled ? [slot] : [])),
    [36, 37, 38],
  );
  assert.deepEqual([day.memo, day.notes, day.startTime], ["m", "n", "09:00"]);
});

test("lists a task's intervals and clears a day", () => {
  const store = device("a");
  const id = store.createTask("Writing");
  store.setCell("2026-11-21", id, 1, true);
  store.setCell("2026-11-22", id, 2, true);
  assert.deepEqual(store.taskIntervals(id), [
    { date: "2026-11-21", slot: 1 },
    { date: "2026-11-22", slot: 2 },
  ]);
  store.clearDay("2026-11-22");
  assert.equal(store.readDay("2026-11-22").gridData[0].some(Boolean), false);
  assert.equal(store.readDay("2026-11-21").gridData[0][1], true);
});

test("accepts the Supabase dashboard's wrapped JSON download", () => {
  const store = device("a");
  const day = { date: "2026-10-13", tasks: [{ name: "task 1", intervals: [40] }] };
  assert.equal(store.importSupabaseExport([{ export: [day] }]), 1);
  assert.deepEqual(store.readDay("2026-10-13").tasks, ["task 1"]);
});
