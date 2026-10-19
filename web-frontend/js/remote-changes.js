// Pure helpers for comparing this device's day with the cloud copy.
const RemoteChanges = {
  /**
   * local:  { memo, notes, tasks: [{ id, name, slots: [filled slot indexes] }] }
   * remote: { memo, notes, tasks: [{ id, name }], intervals: [{ task_id, interval_index }] }
   * Tasks with local-only IDs are ignored: they have not reached the cloud yet.
   */
  diff(local, remote) {
    const localTasks = new Map(
      local.tasks
        .filter((task) => !String(task.id).startsWith("local:"))
        .map((task) => [String(task.id), task]),
    );
    const remoteTasks = new Map(remote.tasks.map((task) => [String(task.id), task]));
    const remoteSlots = new Map();
    for (const row of remote.intervals) {
      const key = String(row.task_id);
      if (!remoteSlots.has(key)) remoteSlots.set(key, new Set());
      remoteSlots.get(key).add(Number(row.interval_index));
    }

    const changes = {
      tasksAdded: [],
      tasksRemoved: [],
      renamed: [],
      intervals: [],
      memoChanged: (local.memo || "") !== (remote.memo || ""),
      notesChanged: (local.notes || "") !== (remote.notes || ""),
    };
    for (const [id, task] of remoteTasks) {
      const slots = remoteSlots.get(id) || new Set();
      const before = localTasks.get(id);
      if (!before) {
        changes.tasksAdded.push({ name: task.name, intervals: slots.size });
        continue;
      }
      if (before.name !== task.name)
        changes.renamed.push({ from: before.name, to: task.name });
      const beforeSlots = new Set(before.slots);
      const added = [...slots].filter((slot) => !beforeSlots.has(slot)).length;
      const removed = [...beforeSlots].filter((slot) => !slots.has(slot)).length;
      if (added || removed) changes.intervals.push({ name: task.name, added, removed });
    }
    for (const [id, task] of localTasks) {
      if (!remoteTasks.has(id)) changes.tasksRemoved.push({ name: task.name });
    }
    changes.isEmpty =
      !changes.tasksAdded.length &&
      !changes.tasksRemoved.length &&
      !changes.renamed.length &&
      !changes.intervals.length &&
      !changes.memoChanged &&
      !changes.notesChanged;
    return changes;
  },

  /** One human-readable line per change. */
  describe(changes) {
    const count = (n) => `${n} interval${n === 1 ? "" : "s"}`;
    const lines = [];
    for (const task of changes.tasksAdded)
      lines.push(`Added task "${task.name}" (${count(task.intervals)})`);
    for (const task of changes.tasksRemoved)
      lines.push(`Removed task "${task.name}" from this day`);
    for (const task of changes.renamed)
      lines.push(`Renamed "${task.from}" to "${task.to}"`);
    for (const task of changes.intervals) {
      const parts = [];
      if (task.added) parts.push(`+${task.added}`);
      if (task.removed) parts.push(`−${task.removed}`);
      lines.push(
        `"${task.name}": ${parts.join(" / ")} ${task.added + task.removed === 1 ? "interval" : "intervals"}`,
      );
    }
    if (changes.memoChanged) lines.push("Memo changed");
    if (changes.notesChanged) lines.push("Notes changed");
    return lines;
  },
};

if (typeof module !== "undefined" && module.exports) {
  module.exports = RemoteChanges;
}
