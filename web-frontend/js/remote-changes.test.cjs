const assert = require("node:assert/strict");
const { test } = require("node:test");
const RemoteChanges = require("./remote-changes.js");

const local = () => ({
  memo: "m",
  notes: "n",
  tasks: [
    { id: 1, name: "Writing", slots: [36, 37] },
    { id: 2, name: "Email", slots: [40] },
    { id: "local:x", name: "Unsynced", slots: [1] },
  ],
});
const remote = (overrides = {}) => ({
  memo: "m",
  notes: "n",
  tasks: [
    { id: 1, name: "Writing" },
    { id: 2, name: "Email" },
  ],
  intervals: [
    { task_id: 1, interval_index: 36 },
    { task_id: 1, interval_index: 37 },
    { task_id: 2, interval_index: 40 },
  ],
  ...overrides,
});

test("identical days (including echoes of our own writes) produce an empty diff", () => {
  const changes = RemoteChanges.diff(local(), remote());
  assert.equal(changes.isEmpty, true);
  assert.deepEqual(RemoteChanges.describe(changes), []);
});

test("interval additions and removals are counted per task", () => {
  const changes = RemoteChanges.diff(
    local(),
    remote({
      intervals: [
        { task_id: 1, interval_index: 36 },
        { task_id: 1, interval_index: 50 },
        { task_id: 1, interval_index: 51 },
        { task_id: 2, interval_index: 40 },
      ],
    }),
  );
  assert.deepEqual(changes.intervals, [{ name: "Writing", added: 2, removed: 1 }]);
  assert.deepEqual(RemoteChanges.describe(changes), ['"Writing": +2 / −1 intervals']);
});

test("added, removed, and renamed tasks and memo or notes edits are summarized", () => {
  const changes = RemoteChanges.diff(
    local(),
    remote({
      memo: "changed",
      notes: "changed",
      tasks: [
        { id: 1, name: "Deep work" },
        { id: 3, name: "Reading" },
      ],
      intervals: [
        { task_id: 1, interval_index: 36 },
        { task_id: 1, interval_index: 37 },
        { task_id: 3, interval_index: 5 },
      ],
    }),
  );
  assert.deepEqual(RemoteChanges.describe(changes), [
    'Added task "Reading" (1 interval)',
    'Removed task "Email" from this day',
    'Renamed "Writing" to "Deep work"',
    "Memo changed",
    "Notes changed",
  ]);
});

test("tasks with local-only IDs are never reported as removed", () => {
  const changes = RemoteChanges.diff(local(), remote());
  assert.deepEqual(changes.tasksRemoved, []);
});
