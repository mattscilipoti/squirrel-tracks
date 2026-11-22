/**
 * DataStore - the local-first data layer, backed by a Yjs document.
 *
 * Every collection is a flat Y.Map keyed by composite strings. Nested shared types are
 * avoided on purpose: two devices that each create the same nested map would keep only
 * one of them and silently lose the other's contents.
 *
 *   taskNames   id                      -> JSON text of { name, createdAt }
 *   tombstones  id                      -> true          (task deleted)
 *   dayTasks    date|taskId             -> order number  (task appears on that day)
 *   cells       date|taskId|slot        -> true          (filled bubble)
 *   dayFields   date|field              -> string        (memo, notes, startTime)
 *
 * Yjs is injected so the browser (global Y from the module loader) and the Node tests
 * (npm yjs) can share this file.
 */
class DataStore {
  constructor(Y, doc = new Y.Doc(), { idFactory } = {}) {
    this.Y = Y;
    this.doc = doc;
    this.idFactory = idFactory || (() => globalThis.crypto.randomUUID());
    this.taskNames = doc.getMap("taskNames");
    this.tombstones = doc.getMap("tombstones");
    this.dayTasks = doc.getMap("dayTasks");
    this.cells = doc.getMap("cells");
    this.dayFields = doc.getMap("dayFields");
    this.localOrigin = "local";
    this.slotCount = 96;
    this.remoteListeners = [];

    doc.on("update", (_update, origin) => {
      if (origin === this.localOrigin || origin === "dedupe") return;
      this.dedupeTasks();
      this.remoteListeners.forEach((listener) => listener(origin));
    });
  }

  static normalizeName(name) {
    return String(name ?? "")
      .trim()
      .toLocaleLowerCase();
  }

  transact(fn) {
    this.doc.transact(fn, this.localOrigin);
  }

  /** Calls `listener` after changes that arrived from another device or an import. */
  onRemoteChange(listener) {
    this.remoteListeners.push(listener);
  }

  // ── Tasks ────────────────────────────────────────────────────────────────

  taskRecord(id) {
    const text = this.taskNames.get(id);
    return text ? JSON.parse(text) : null;
  }

  isLive(id) {
    return this.taskNames.has(id) && !this.tombstones.has(id);
  }

  liveTasks() {
    const tasks = [];
    this.taskNames.forEach((_value, id) => {
      if (!this.tombstones.has(id)) tasks.push({ id, name: this.taskRecord(id).name });
    });
    return tasks.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  }

  findTaskByName(name, exceptId = null) {
    const key = DataStore.normalizeName(name);
    return (
      this.liveTasks().find(
        (task) => task.id !== exceptId && DataStore.normalizeName(task.name) === key,
      ) || null
    );
  }

  /** Creates a task, or returns the existing live task with the same name. */
  createTask(name) {
    const trimmed = String(name ?? "").trim();
    if (!trimmed) throw new Error("Task name is required.");
    const existing = this.findTaskByName(trimmed);
    if (existing) return existing.id;
    const id = this.idFactory();
    this.transact(() => {
      this.taskNames.set(
        id,
        JSON.stringify({ name: trimmed, createdAt: new Date().toISOString() }),
      );
    });
    return id;
  }

  renameTask(id, name) {
    const trimmed = String(name ?? "").trim();
    if (!trimmed) throw new Error("Task name is required.");
    if (this.findTaskByName(trimmed, id)) {
      throw new Error("A task with that name already exists.");
    }
    const current = this.taskRecord(id);
    if (!current) throw new Error("Unknown task.");
    this.transact(() =>
      this.taskNames.set(id, JSON.stringify({ ...current, name: trimmed })),
    );
  }

  /** Marks the task deleted. Its cells stay in the document but are never read. */
  deleteTask(id) {
    this.transact(() => this.tombstones.set(id, true));
  }

  // ── Days ─────────────────────────────────────────────────────────────────

  addTaskToDay(date, taskId) {
    const key = `${date}|${taskId}`;
    if (this.dayTasks.has(key)) return;
    const orders = this.dayOrders(date).map((entry) => entry.order);
    this.transact(() => this.dayTasks.set(key, Math.max(-1, ...orders) + 1));
  }

  removeTaskFromDay(date, taskId) {
    this.transact(() => {
      this.dayTasks.delete(`${date}|${taskId}`);
      for (let slot = 0; slot < this.slotCount; slot++)
        this.cells.delete(`${date}|${taskId}|${slot}`);
    });
  }

  dayOrders(date) {
    const prefix = `${date}|`;
    const entries = [];
    this.dayTasks.forEach((order, key) => {
      if (key.startsWith(prefix)) entries.push({ id: key.slice(prefix.length), order });
    });
    return entries;
  }

  setCell(date, taskId, slot, filled) {
    const key = `${date}|${taskId}|${slot}`;
    this.transact(() => {
      if (filled) {
        this.addTaskToDay(date, taskId);
        this.cells.set(key, true);
      } else {
        this.cells.delete(key);
      }
    });
  }

  setDayField(date, field, value) {
    const key = `${date}|${field}`;
    if ((this.dayFields.get(key) || "") === String(value || "")) return;
    this.transact(() => {
      if (value) this.dayFields.set(key, String(value));
      else this.dayFields.delete(key);
    });
  }

  /** Returns the day in the shape GridTaskTracker keeps in memory. */
  readDay(date) {
    const entries = this.dayOrders(date)
      .filter((entry) => this.isLive(entry.id))
      .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
    const gridData = entries.map((entry) => {
      const row = new Array(this.slotCount).fill(false);
      for (let slot = 0; slot < this.slotCount; slot++)
        if (this.cells.has(`${date}|${entry.id}|${slot}`)) row[slot] = true;
      return row;
    });
    return {
      date,
      startTime: this.dayFields.get(`${date}|startTime`) || "",
      memo: this.dayFields.get(`${date}|memo`) || "",
      notes: this.dayFields.get(`${date}|notes`) || "",
      taskIds: entries.map((entry) => entry.id),
      tasks: entries.map((entry) => this.taskRecord(entry.id).name),
      gridData,
    };
  }

  /** Clears every filled bubble on a day; the day's tasks stay. */
  clearDay(date) {
    this.transact(() => {
      [...this.cells.keys()]
        .filter((key) => key.startsWith(`${date}|`))
        .forEach((key) => this.cells.delete(key));
    });
  }

  /** Every filled bubble of one task, across all days. */
  taskIntervals(taskId) {
    const entries = [];
    this.cells.forEach((_value, key) => {
      const [date, id, slot] = key.split("|");
      if (id === taskId) entries.push({ date, slot: Number(slot) });
    });
    return entries;
  }

  taskCreatedAt(taskId) {
    return this.taskRecord(taskId)?.createdAt || null;
  }

  /** Every date that has a task, a filled bubble or a text field. */
  dates() {
    const dates = new Set();
    for (const map of [this.dayTasks, this.cells, this.dayFields])
      map.forEach((_value, key) => dates.add(key.split("|")[0]));
    return [...dates].sort();
  }

  // ── Totals (replace the task_totals / task_day_totals views) ─────────────

  dayTotals() {
    const totals = new Map();
    this.cells.forEach((_value, key) => {
      const [date, taskId] = key.split("|");
      if (!this.isLive(taskId)) return;
      const id = `${date}|${taskId}`;
      totals.set(id, (totals.get(id) || 0) + 1);
    });
    return [...totals].map(([id, count]) => {
      const [date, taskId] = id.split("|");
      return { date, task_id: taskId, interval_count: count };
    });
  }

  catalog() {
    const counts = new Map();
    for (const row of this.dayTotals())
      counts.set(row.task_id, (counts.get(row.task_id) || 0) + row.interval_count);
    return this.liveTasks().map((task) => ({
      ...task,
      interval_count: counts.get(task.id) || 0,
    }));
  }

  // ── Merging ──────────────────────────────────────────────────────────────

  /**
   * Two devices can each create the same task name while apart. After merging, the
   * task with the lowest id survives and the others' days and bubbles move onto it.
   * Every device picks the same survivor, so they converge.
   */
  dedupeTasks() {
    const groups = new Map();
    for (const task of this.liveTasks()) {
      const key = DataStore.normalizeName(task.name);
      groups.set(key, [...(groups.get(key) || []), task.id]);
    }
    const merges = [...groups.values()]
      .filter((ids) => ids.length > 1)
      .map((ids) => ids.sort());
    if (!merges.length) return false;
    this.doc.transact(() => {
      for (const [keeper, ...losers] of merges) {
        for (const loser of losers) this.moveTask(loser, keeper);
        for (const loser of losers) this.tombstones.set(loser, true);
      }
    }, "dedupe");
    return true;
  }

  moveTask(from, to) {
    const move = (map, suffixLength, value) => {
      [...map.keys()].forEach((key) => {
        const parts = key.split("|");
        if (parts[1] !== from || parts.length !== suffixLength) return;
        const target = [parts[0], to, ...parts.slice(2)].join("|");
        if (!map.has(target)) map.set(target, value ?? map.get(key));
        map.delete(key);
      });
    };
    move(this.dayTasks, 2);
    move(this.cells, 3);
  }

  // ── Export / import ──────────────────────────────────────────────────────

  encodeState() {
    return this.Y.encodeStateAsUpdate(this.doc);
  }

  /** Merges another device's exported state into this one. */
  applyState(bytes) {
    this.Y.applyUpdate(this.doc, bytes, "import");
  }

  isEmpty() {
    return this.dates().length === 0 && this.taskNames.size === 0;
  }

  /**
   * Writes one day in the old snapshot shape ({ date, tasks, taskIds, gridData, memo,
   * notes, startTime }) into the document. Used for the one-time migration from
   * localStorage and from Supabase. Returns a map of old task id -> new task id.
   */
  importSnapshot(snapshot, idMap = new Map()) {
    if (!snapshot?.date) return idMap;
    const tasks = snapshot.tasks || [];
    this.transact(() => {
      tasks.forEach((name, index) => {
        if (!String(name ?? "").trim()) return;
        const taskId = this.createTask(name);
        const oldId = snapshot.taskIds?.[index];
        if (oldId !== undefined && oldId !== null) idMap.set(String(oldId), taskId);
        const key = `${snapshot.date}|${taskId}`;
        if (!this.dayTasks.has(key)) this.dayTasks.set(key, index);
        const row = snapshot.gridData?.[index] || [];
        // Grids saved by the earliest versions had 60 slots starting at 9 AM (slot 36).
        const offset = row.length === 60 ? 36 : 0;
        row.forEach((filled, slot) => {
          if (filled && slot + offset < this.slotCount)
            this.cells.set(`${snapshot.date}|${taskId}|${slot + offset}`, true);
        });
      });
      for (const field of ["startTime", "memo", "notes"]) {
        const key = `${snapshot.date}|${field}`;
        if (snapshot[field] && !this.dayFields.has(key))
          this.dayFields.set(key, String(snapshot[field]));
      }
    });
    return idMap;
  }

  /**
   * Imports the JSON produced by the one-off Supabase export query (see README):
   * [{ date, memo, notes, start_time, tasks: [{ name, intervals: [slot, ...] }] }].
   * Several sessions on one date merge. Returns the number of sessions imported.
   */
  importSupabaseExport(rows) {
    if (!Array.isArray(rows)) throw new Error("Expected a JSON array of days.");
    let imported = 0;
    for (const row of rows) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(row?.date || "")) continue;
      const tasks = row.tasks || [];
      this.importSnapshot({
        date: row.date,
        memo: row.memo,
        notes: row.notes,
        startTime: row.start_time,
        tasks: tasks.map((task) => task.name),
        gridData: tasks.map((task) => {
          const slots = new Array(this.slotCount).fill(false);
          (task.intervals || []).forEach((slot) => {
            if (slot >= 0 && slot < this.slotCount) slots[slot] = true;
          });
          return slots;
        }),
      });
      imported++;
    }
    return imported;
  }

  /**
   * One-time migration of the pre-Yjs localStorage data (current day state plus
   * per-day history). Leaves the old keys in place as a backup. Returns the number of
   * days imported.
   */
  importLegacyStorage(storage) {
    const parse = (key, fallback) => {
      try {
        return JSON.parse(storage.getItem(key)) ?? fallback;
      } catch {
        return fallback;
      }
    };
    const snapshots = [
      ...Object.values(parse("ettGridHistory", {})),
      parse("ettGridState", null),
    ];
    const idMap = new Map();
    let days = 0;
    for (const snapshot of snapshots) {
      if (!snapshot?.date) continue;
      this.importSnapshot(snapshot, idMap);
      days++;
    }
    return days;
  }
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = DataStore;
}
