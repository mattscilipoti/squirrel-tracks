/**
 * GridTaskTracker - Circle/bubble-based task time tracker
 * Implements a 24-hour grid of 15-minute intervals
 * Uses Supabase for backend data storage and sync
 */
class GridTaskTracker {
  constructor() {
    this.tasks = [];
    this.taskIdMap = {}; // Map task name to Supabase ID
    this.taskIds = [];
    this.taskCatalog = [];
    this.taskDayTotals = [];
    this.gridData = []; // 2D array: tasks[taskIdx][intervalIdx] = true/false (filled or not)
    this.sessionId = null;
    this.startTime = "";
    this.memo = "";
    this.date = TimeCalculations.localDate(new Date());
    this.followToday = true;
    this.notes = "";

    // Supabase client
    this.db = getSupabaseClient();
    const storedSyncTime = localStorage.getItem("ettLastSyncTime");
    this.lastSyncTime =
      storedSyncTime && !Number.isNaN(Date.parse(storedSyncTime)) ? storedSyncTime : null;
    this.isSyncing = false;
    this.isFullSyncing = false;
    this.pendingWrites = new Set();
    this.sessionInitialization = null;
    this.isInitializingSession = false;
    this.cloudAuthenticated = false;
    this.pendingInitialSyncAction = null;
    this.syncPausedForConflict = false;
    this.cloudReachable = null;
    this.autoCenterPausedUntil = 0;
    this.autoCenterScrollLeft = null;

    this.timerState = {
      isRunning: true,
      timeRemaining: 15 * 60, // 15 minutes in seconds
      totalTime: 15 * 60,
      currentInterval: 0,
    };

    this.initializeUI();
    this.loadFromLocalStorage();
    this.rolloverDailySession();
    this.initializeReminder();
    this.updateDateControl();
    this.renderGrid();
    this.bindEvents();
    this.updateTaskCount();
    this.updateSummary();
    this.updateTimeCalculations();
    this.renderSyncStatus();
    this.initializeSquirrelTrails();

    window.addEventListener?.("app-cloud-connectivity", (event) => {
      this.setCloudReachability(event.detail);
    });
    window.addEventListener?.("online", () => this.setCloudReachability(null));
    window.addEventListener?.("offline", () => this.setCloudReachability(false));

    this.currentTimeObserver = new ResizeObserver(() => this.updateCurrentTimeLine());
    this.currentTimeObserver.observe(document.getElementById("timeGrid"));
    document.addEventListener("visibilitychange", () => {
      this.updateTimeCalculations();
      this.timerTick();
    });
    const unlockBellAudio = (event) => {
      if (!event.target.closest?.("#enableBellBtn")) this.enableBellAudio();
    };
    document.addEventListener("pointerdown", unlockBellAudio, {
      passive: true,
    });
    document.addEventListener("keydown", unlockBellAudio);
    this.reminderIntervalHandle = setInterval(() => this.timerTick(), 1000);

    // Update time calculations every minute
    setInterval(() => this.updateTimeCalculations(), 60000);

    // Auto-sync to Supabase every 30 seconds
    setInterval(() => this.syncToSupabase(), 30000);
    setInterval(() => {
      if (this.autoCenterPausedUntil && !this.updateAutoCenterStatus()) {
        this.resumeAutoCentering();
      }
    }, 1000);
  }

  /**
   * Initialize or load session from Supabase
   */
  hasAuthenticatedCloud() {
    const clientAuth = this.db?.isAuthenticated?.();
    return Boolean(
      this.cloudAuthenticated && hasSupabaseConfig() && clientAuth !== false,
    );
  }

  isCloudReady() {
    return this.hasAuthenticatedCloud() && !this.syncPausedForConflict;
  }

  setCloudReachability(reachable) {
    this.cloudReachable = reachable;
    this.renderSyncStatus();
  }

  renderSyncStatus() {
    const status = document.getElementById("syncStatus");
    const statusIcon = document.getElementById("syncStatusIcon");
    const statusText = document.getElementById("syncStatusText");
    const lastCloudSync = document.getElementById("lastCloudSync");
    if (!status || !statusIcon || !statusText || !lastCloudSync) return;

    let state;
    let message;
    let icon = "⚠";
    if (!hasSupabaseConfig()) {
      state = "local-only";
      message = "Local only: data stays on this browser";
    } else if (this.syncPausedForConflict) {
      state = "paused";
      message = "Sync paused: choose a sync action to continue";
    } else if (globalThis.navigator?.onLine === false || this.cloudReachable === false) {
      state = "offline";
      message = "Offline: changes will sync when reconnected";
    } else if (!this.hasAuthenticatedCloud()) {
      state = "sign-in";
      message = "Local only until you sign in";
    } else if (
      this.isSyncing ||
      this.isFullSyncing ||
      this.isInitializingSession ||
      this.pendingWrites.size > 0
    ) {
      state = "syncing";
      message = "Syncing…";
    } else if (this.cloudReachable !== true) {
      state = "checking";
      message = "Checking sync connection…";
      icon = "↻";
    } else if (this.lastSyncTime) {
      state = "synced";
      message = "Connected for syncing";
      icon = "✓";
    } else {
      state = "connected";
      message = "Connected for syncing";
      icon = "✓";
    }

    status.dataset.state = state;
    statusIcon.textContent = state === "syncing" ? "↻" : icon;
    statusText.textContent = message;
    if (this.lastSyncTime) {
      lastCloudSync.dateTime = this.lastSyncTime;
      lastCloudSync.textContent = new Date(this.lastSyncTime).toLocaleString();
      lastCloudSync.title = this.lastSyncTime;
    } else {
      lastCloudSync.removeAttribute("datetime");
      lastCloudSync.textContent = "Never";
      lastCloudSync.removeAttribute("title");
    }
  }

  recordSyncSuccess(timestamp = new Date()) {
    this.lastSyncTime = timestamp.toISOString();
    localStorage.setItem("ettLastSyncTime", this.lastSyncTime);
    this.renderSyncStatus();
  }

  async initializeSession() {
    if (!this.isCloudReady()) return;
    this.isInitializingSession = true;
    this.renderSyncStatus();
    try {
      await this.loadOrCreateSession();
    } finally {
      this.isInitializingSession = false;
      this.renderSyncStatus();
    }
  }

  async loadOrCreateSession() {
    if (!this.isCloudReady()) return;
    try {
      const localSnapshot = this.captureLocalSnapshot();
      const hasLocalData = this.hasSessionData(localSnapshot);
      await this.refreshTaskCatalog();
      const sessions = await this.db.getSessionsForDate(this.date);
      const session = this.selectCloudSession(sessions);
      if (session) {
        const cloudSnapshot = await this.getCloudSnapshot(session);
        const hasCloudData = this.hasSessionData(cloudSnapshot);
        if (!hasLocalData) {
          await this.loadSessionFromSupabase(session);
          return;
        }

        if (!hasCloudData || this.snapshotsMatch(localSnapshot, cloudSnapshot)) {
          this.sessionId = session.id;
          this.pendingInitialSyncAction = hasCloudData ? null : "upload";
          if (hasCloudData) await this.loadSessionFromSupabase(session);
          return;
        }

        const choice = await window.chooseSyncConflict?.({
          date: this.date,
          localTaskCount: localSnapshot.tasks.length,
          cloudTaskCount: cloudSnapshot.tasks.length,
        });
        if (choice === "load") {
          this.saveLocalBackup("ettGridBeforeCloudLoad");
          await this.loadSessionFromSupabase(session);
        } else if (choice === "upload") {
          this.sessionId = session.id;
          this.pendingInitialSyncAction = "upload";
        } else if (choice === "merge") {
          this.saveLocalBackup("ettGridBeforeCloudMerge");
          this.mergeSnapshots(localSnapshot, cloudSnapshot, session.id);
          this.pendingInitialSyncAction = "upload";
        } else {
          this.syncPausedForConflict = true;
          this.renderSyncStatus();
        }
        return;
      }
      this.sessionId = null;
      this.pendingInitialSyncAction = hasLocalData ? "upload" : null;
    } catch (error) {
      console.warn("Failed to load session; keeping local data:", error);
      return;
    }

    // Create new session
    try {
      const sessionData = {
        status: "active",
        start_time: this.startTime || null,
        memo: this.memo || null,
        date: this.date,
        notes: this.notes || null,
      };

      const result = await this.db.createSession(sessionData);
      this.sessionId = result?.[0]?.id || result?.id;
      console.log("New session created:", this.sessionId);
      this.saveToLocalStorage();
    } catch (error) {
      console.error("Failed to create session:", error);
    }
  }

  captureLocalSnapshot() {
    return {
      date: this.date,
      startTime: this.startTime || "",
      memo: document.getElementById("memoInput")?.value ?? this.memo ?? "",
      notes: document.getElementById("notesInput")?.value ?? this.notes ?? "",
      tasks: [...this.tasks],
      taskIds: [...(this.taskIds || [])],
      gridData: this.tasks.map((_, index) =>
        Array.from(
          this.gridData[index] || new Array(TimeCalculations.intervalCount).fill(false),
        ).slice(0, TimeCalculations.intervalCount),
      ),
    };
  }

  hasSessionData(snapshot) {
    return Boolean(
      snapshot.tasks.length ||
      snapshot.gridData.some((row) => row.some(Boolean)) ||
      snapshot.startTime ||
      snapshot.memo ||
      snapshot.notes,
    );
  }

  async getCloudSnapshot(session) {
    const intervals = await this.db.getSessionIntervals(session.id);
    const tasks = session.tasks || [];
    const taskIndexById = new Map(tasks.map((task, index) => [String(task.id), index]));
    const gridData = tasks.map(() =>
      new Array(TimeCalculations.intervalCount).fill(false),
    );
    for (const interval of intervals) {
      const taskIndex = taskIndexById.get(String(interval.task_id));
      const intervalIndex = Number(interval.interval_index);
      if (
        taskIndex !== undefined &&
        intervalIndex >= 0 &&
        intervalIndex < TimeCalculations.intervalCount
      ) {
        gridData[taskIndex][intervalIndex] = true;
      }
    }
    return {
      date: session.date,
      startTime: session.start_time || "",
      memo: session.memo || "",
      notes: session.notes || "",
      tasks: tasks.map((task) => task.name),
      taskIds: tasks.map((task) => task.id),
      gridData,
    };
  }

  snapshotsMatch(left, right) {
    const signature = (snapshot) => {
      const normalize = (name) => name.trim().toLocaleLowerCase();
      const tasks = snapshot.tasks.map(normalize).sort();
      const intervals = [];
      snapshot.tasks.forEach((name, taskIndex) => {
        snapshot.gridData[taskIndex]?.forEach((filled, intervalIndex) => {
          if (filled) intervals.push(`${normalize(name)}:${intervalIndex}`);
        });
      });
      intervals.sort();
      return JSON.stringify({
        tasks,
        intervals,
        startTime: snapshot.startTime,
        memo: snapshot.memo,
        notes: snapshot.notes,
      });
    };
    return signature(left) === signature(right);
  }

  saveLocalBackup(keyPrefix) {
    this.saveToLocalStorage();
    localStorage.setItem(
      `${keyPrefix}:${this.date}`,
      localStorage.getItem("ettGridState"),
    );
  }

  mergeSnapshots(localSnapshot, cloudSnapshot, sessionId) {
    const normalize = (name) => name.trim().toLocaleLowerCase();
    const merged = new Map();
    const addTask = (name, id, intervals) => {
      const key = normalize(name);
      const existing = merged.get(key);
      if (existing) {
        if (id !== undefined && id !== null) existing.id = id;
        intervals.forEach((filled, index) => {
          existing.intervals[index] ||= Boolean(filled);
        });
      } else {
        merged.set(key, {
          name,
          id,
          intervals: Array.from(
            intervals || new Array(TimeCalculations.intervalCount).fill(false),
          ).slice(0, TimeCalculations.intervalCount),
        });
      }
    };

    localSnapshot.tasks.forEach((name, index) =>
      addTask(name, localSnapshot.taskIds[index], localSnapshot.gridData[index]),
    );
    cloudSnapshot.tasks.forEach((name, index) =>
      addTask(name, cloudSnapshot.taskIds[index], cloudSnapshot.gridData[index]),
    );

    this.tasks = [...merged.values()].map((task) => task.name);
    this.taskIds = [...merged.values()].map((task) => task.id);
    this.taskIdMap = Object.fromEntries(
      [...merged.values()].map((task) => [task.name, task.id]),
    );
    this.gridData = [...merged.values()].map((task) => task.intervals);
    this.sessionId = sessionId;
    this.startTime = localSnapshot.startTime || cloudSnapshot.startTime;
    this.memo = this.mergeTextField("memo", localSnapshot.memo, cloudSnapshot.memo);
    this.notes = this.mergeTextField("notes", localSnapshot.notes, cloudSnapshot.notes);
    document.getElementById("memoInput").value = this.memo;
    document.getElementById("notesInput").value = this.notes;
    this.renderGrid();
    this.updateTaskCount();
    this.updateSummary();
    this.saveToLocalStorage();
  }

  mergeTextField(label, localValue, cloudValue) {
    if (localValue && cloudValue && localValue !== cloudValue) {
      return confirm(
        `Local and cloud ${label} differ. Keep the local ${label}? Choose Cancel to use the cloud value.`,
      )
        ? localValue
        : cloudValue;
    }
    return localValue || cloudValue || "";
  }

  selectCloudSession(sessions) {
    const populated = (session) => session.tasks?.length || session.intervals?.length;
    const current = sessions.find(
      (session) => String(session.id) === String(this.sessionId),
    );
    return (
      (current && populated(current) ? current : null) ||
      sessions.find(populated) ||
      current ||
      sessions[0]
    );
  }

  /**
   * Restore session data from Supabase
   */
  restoreSessionData(session, expectedDate = this.date) {
    if (session.date !== expectedDate) {
      throw new Error(
        "Cannot restore a session from a different day into the selected date.",
      );
    }

    this.sessionId = session.id;
    this.startTime = session.start_time || "";
    this.memo = session.memo || "";
    this.date = expectedDate;
    this.notes = session.notes || "";

    // Update form fields
    const memoInput = document.getElementById("memoInput");
    const notesInput = document.getElementById("notesInput");

    if (memoInput) memoInput.value = this.memo;
    this.updateDateControl();
    if (notesInput) notesInput.value = this.notes;

    const sessionTasks = session.tasks || [];
    this.tasks = sessionTasks.map((task) => task.name);
    this.taskIds = sessionTasks.map((task) => task.id);
    this.taskIdMap = {};
    sessionTasks.forEach((task) => {
      this.taskIdMap[task.name] = task.id;
    });
    this.gridData = this.tasks.map(() =>
      new Array(TimeCalculations.intervalCount).fill(false),
    );
  }

  async loadSessionFromSupabase(session, expectedDate = this.date) {
    if (!this.isCloudReady()) return;
    const intervals = await this.db.getSessionIntervals(session.id);
    await this.refreshTaskCatalog();
    this.restoreSessionData(session, expectedDate);
    const taskIndexById = new Map(
      this.tasks.map((taskName, index) => [String(this.getTaskId(index)), index]),
    );

    intervals.forEach((interval) => {
      const taskIndex = taskIndexById.get(String(interval.task_id));
      const intervalIndex = Number(interval.interval_index);
      if (
        taskIndex !== undefined &&
        intervalIndex >= 0 &&
        intervalIndex < TimeCalculations.intervalCount
      ) {
        this.gridData[taskIndex][intervalIndex] = true;
      }
    });

    this.renderGrid();
    this.updateTaskCount();
    this.updateSummary();
    this.updateTimeCalculations();
    this.saveToLocalStorage();
    this.cloudWriteFailed = false;
    this.recordSyncSuccess();
  }

  async refreshTaskCatalog() {
    if (!this.isCloudReady() || !this.db.getTaskCatalog) return;
    const [catalog, totals] = await Promise.all([
      this.db.getTaskCatalog(),
      this.db.getTaskDayTotals(),
    ]);
    const local = (this.taskCatalog || []).filter((task) => !this.isCloudTaskId(task.id));
    this.taskCatalog = [...catalog, ...local];
    this.taskDayTotals = totals;
    localStorage.setItem("ettTaskCatalog", JSON.stringify(this.taskCatalog));
    localStorage.setItem("ettTaskDayTotals", JSON.stringify(totals));
    this.applyCatalogNames();
    this.updateTaskPicker();
  }

  applyCatalogNames() {
    this.tasks = this.tasks.map(
      (name, index) =>
        this.taskCatalog?.find(
          (task) => String(task.id) === String(this.getTaskId(index)),
        )?.name || name,
    );
  }

  updateTaskPicker() {
    const select = document.getElementById("existingTaskSelect");
    if (!select) return;
    const previous = select.value;
    select.replaceChildren();
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "Reuse a task...";
    select.appendChild(placeholder);
    const available = document.createElement("optgroup");
    available.label = "Available to add";
    const onDay = document.createElement("optgroup");
    onDay.label = "Already on this day";
    for (const task of this.taskCatalog || []) {
      const isOnDay = this.taskIds?.some((id) => String(id) === String(task.id));
      const option = document.createElement("option");
      option.value = String(task.id);
      option.textContent = `${isOnDay ? "\u{1F6AB} " : ""}${task.name} (#${task.id})`;
      if (isOnDay) option.dataset.onDay = "true";
      (isOnDay ? onDay : available).appendChild(option);
    }
    for (const group of [available, onDay]) {
      if (group.children.length) select.appendChild(group);
    }
    select.value = previous;
    this.updatePickerButtons();
  }

  updatePickerButtons() {
    const select = document.getElementById("existingTaskSelect");
    const selected = select.selectedOptions[0];
    document.getElementById("reuseTaskBtn").disabled =
      !select.value || selected?.dataset.onDay === "true";
    document.getElementById("deleteTaskBtn").disabled = !select.value;
  }

  async reuseTask(id) {
    this.ensureTaskIds();
    if (this.taskIds.some((taskId) => String(taskId) === String(id))) return;
    const task = this.taskCatalog?.find((entry) => String(entry.id) === String(id));
    if (!task) throw new Error("Choose an existing task.");
    if (this.isFullSyncing || this.isInitializingSession || this.isSyncing)
      throw new Error("Wait for syncing to finish.");
    this.isFullSyncing = true;
    this.renderSyncStatus();
    const container = document.querySelector(".container");
    const wasInert = container.inert;
    container.inert = true;
    try {
      if (this.isCloudReady() && this.sessionId && this.isCloudTaskId(task.id)) {
        await this.db.attachTask(this.sessionId, task.id);
        this.recordSyncSuccess();
      }
      this.tasks.push(task.name);
      this.taskIds.push(task.id);
      this.gridData.push(new Array(TimeCalculations.intervalCount).fill(false));
      this.renderGrid();
      this.updateTaskCount();
      this.updateSummary();
      this.updateTaskPicker();
      this.saveToLocalStorage();
    } finally {
      this.isFullSyncing = false;
      this.renderSyncStatus();
      container.inert = wasInert;
    }
  }

  initializeUI() {
    document.getElementById("existingTaskSelect").addEventListener("change", () => {
      this.updatePickerButtons();
    });
    document.getElementById("remoteChangeDismiss")?.addEventListener("click", () => {
      document.getElementById("remoteChangeNotice").hidden = true;
    });
    document.getElementById("deleteTaskBtn").addEventListener("click", async () => {
      try {
        await this.confirmDeleteTask(document.getElementById("existingTaskSelect").value);
      } catch (error) {
        alert(error.message || "Could not delete the task.");
      }
    });
    document.getElementById("reuseTaskBtn").addEventListener("click", async () => {
      try {
        await this.reuseTask(document.getElementById("existingTaskSelect").value);
      } catch (error) {
        alert(error.message || "Could not reuse the task.");
      }
    });
    document.getElementById("dateInput").addEventListener("change", (event) => {
      this.changeSessionDate(event.target.value);
    });
    document.getElementById("todayBtn").addEventListener("click", () => {
      this.changeSessionDate(TimeCalculations.localDate(new Date()));
    });
    this.initializeGridHeader();
    const container = document.querySelector(".grid-container");
    container.tabIndex = 0;
    container.setAttribute("aria-label", "Daily time grid");
    container.addEventListener(
      "scroll",
      () => {
        if (
          this.autoCenterScrollLeft !== null &&
          Math.abs(container.scrollLeft - this.autoCenterScrollLeft) < 1
        )
          return;
        this.autoCenterScrollLeft = null;
        this.autoCenterPausedUntil = Date.now() + 120000;
        this.updateAutoCenterStatus();
        this.updateCurrentTimeLine(new Date(), false);
      },
      { passive: true },
    );
    document.getElementById("resumeAutoCenterBtn").addEventListener("click", () => {
      this.resumeAutoCentering();
    });

    document
      .getElementById("reminderMinutesInput")
      .addEventListener("change", (event) => {
        const minutes = Number(event.target.value);
        if (!Number.isInteger(minutes) || minutes < 1 || minutes > 120) {
          event.target.value = this.timerState.totalTime / 60;
          return;
        }
        this.timerState.totalTime = minutes * 60;
        this.nextReminderAt = Date.now() + this.timerState.totalTime * 1000;
        this.timerTick();
        this.saveReminderSettings();
      });
    document.getElementById("bellEnabledInput").addEventListener("change", (event) => {
      this.bellEnabled = event.target.checked;
      this.updateBellVolume();
      this.updateBellControl();
      this.saveReminderSettings();
      if (this.bellEnabled) this.enableBellAudio();
    });
    document.getElementById("bellVolumeInput").addEventListener("input", (event) => {
      this.setBellVolume(Number(event.target.value));
    });
    document.getElementById("enableBellBtn").addEventListener("click", async () => {
      await this.enableBellAudio();
      this.playReminderBell();
    });

    // Header fields
    document
      .getElementById("memoInput")
      ?.addEventListener("change", () => this.saveToLocalStorage());
    document
      .getElementById("notesInput")
      ?.addEventListener("change", () => this.saveToLocalStorage());

    // Task input
    document
      .getElementById("addTaskBtn")
      .addEventListener("click", () => this.addTaskFromInput());
    document.getElementById("newTaskInput").addEventListener("keypress", (e) => {
      if (e.key === "Enter") this.addTaskFromInput();
    });

    // Grid actions
    document
      .getElementById("clearGridBtn")
      .addEventListener("click", () => this.clearGrid());
    document
      .getElementById("syncReloadBtn")
      .addEventListener("click", () => this.syncAndReloadFromSupabase());
    document
      .getElementById("refreshDbBtn")
      .addEventListener("click", () => this.refreshFromSupabase());

    // Export
    document
      .getElementById("exportBtn")
      .addEventListener("click", () => this.exportCSV());
  }

  bindEvents() {
    // Bubble click handlers are attached in renderGrid()
  }

  initializeSquirrelTrails() {
    const decor = document.getElementById("squirrelTrailDecor");
    if (!decor || decor.childElementCount) return;
    const fragmentCount = 5;
    const positions = Array.from(
      { length: fragmentCount },
      (_, index) => ((index + 0.5 + (Math.random() - 0.5) * 0.38) / fragmentCount) * 100,
    );
    for (const top of positions) {
      const fragment = document.createElement("div");
      fragment.className = `squirrel-print-fragment ${Math.random() < 0.5 ? "is-left" : "is-right"}`;
      fragment.dataset.trailPosition = String(top / 100);
      for (let printIndex = 0; printIndex < 3; printIndex++) {
        const print = document.createElement("span");
        print.textContent = "🐾";
        print.style.setProperty("--print-index", printIndex);
        print.style.setProperty("--print-offset", `${2 + Math.random() * 4}px`);
        const angle = (Math.random() < 0.5 ? -1 : 1) * (12 + Math.random() * 18);
        print.style.setProperty("--print-angle", `${angle}deg`);
        fragment.appendChild(print);
      }
      decor.appendChild(fragment);
    }
    this.positionSquirrelTrails();
    if (typeof ResizeObserver !== "undefined") {
      this.squirrelTrailObserver = new ResizeObserver(() =>
        this.positionSquirrelTrails(),
      );
      this.squirrelTrailObserver.observe(document.querySelector(".container"));
    }
    window.addEventListener("resize", () => this.positionSquirrelTrails());
  }

  positionSquirrelTrails() {
    const decor = document.getElementById("squirrelTrailDecor");
    const container = document.querySelector(".container");
    if (!decor || !container) return;
    const height = decor.clientHeight || container.clientHeight || container.scrollHeight;
    const fragments = [...decor.children];
    for (const fragment of fragments) {
      const fragmentHeight = fragment.offsetHeight || 72;
      const fraction = Number(fragment.dataset.trailPosition);
      const top = Math.round(Math.max(0, height - fragmentHeight) * fraction);
      fragment.style.top = `${top}px`;
    }
  }

  /**
   * Add a new task from input field
   */
  addTaskFromInput() {
    const input = document.getElementById("newTaskInput");
    const taskName = input.value.trim();

    if (!taskName) {
      alert("Please enter a task name");
      return;
    }

    try {
      this.addTask(taskName);
    } catch (error) {
      alert(error.message);
      input.focus();
      return;
    }
    input.value = "";
    input.focus();
  }

  /**
   * Add task to grid and initialize its row
   */
  ensureTaskIds() {
    this.taskIds = this.tasks.map(
      (name, index) =>
        this.taskIds?.[index] ??
        this.taskIdMap[name] ??
        `local:${globalThis.crypto?.randomUUID?.() || `${Date.now()}:${Math.random().toString(36).slice(2)}`}`,
    );
  }

  getTaskId(index) {
    return this.taskIds?.[index] ?? this.taskIdMap[this.tasks[index]];
  }

  isCloudTaskId(id) {
    return id !== undefined && id !== null && !String(id).startsWith("local:");
  }

  findTaskNameConflict(name, exceptId = null) {
    const normalized = name.trim().toLocaleLowerCase();
    return (this.taskCatalog || []).find(
      (task) =>
        String(task.id) !== String(exceptId) &&
        task.name.trim().toLocaleLowerCase() === normalized,
    );
  }

  addTask(taskName) {
    const name = taskName.trim();
    if (!name) throw new Error("Enter a task name.");
    if (this.findTaskNameConflict(name)) {
      throw new Error(
        'A task with this name already exists. Choose it from "Reuse a task..." instead.',
      );
    }
    this.ensureTaskIds();
    const localId = `local:${globalThis.crypto?.randomUUID?.() || `${Date.now()}:${Math.random().toString(36).slice(2)}`}`;
    this.tasks.push(name);
    this.taskIds.push(localId);
    this.taskCatalog = [
      ...(this.taskCatalog || []),
      { id: localId, name, interval_count: 0 },
    ];
    this.gridData.push(new Array(TimeCalculations.intervalCount).fill(false));
    this.renderGrid();
    this.updateSummary();
    this.updateTaskCount();
    this.saveToLocalStorage();

    // Sync to Supabase asynchronously
    if (this.isCloudReady() && this.sessionId) {
      this.trackPendingWrite(this.createTaskInSupabase(name, localId));
    }
  }

  /**
   * Create task in Supabase
   */
  async createTaskInSupabase(taskName, localId) {
    if (!this.isCloudReady() || !this.sessionId) return;
    const sessionId = this.sessionId;
    try {
      const result = await this.db.createTask(sessionId, {
        name: taskName,
        duration_minutes: 0,
      });
      const taskId = result?.[0]?.id || result?.id;
      this.taskIdMap[taskName] = taskId;
      const index = this.taskIds?.findIndex((id) => String(id) === String(localId));
      if (index >= 0) this.taskIds[index] = taskId;
      else if (localId !== undefined) await this.db.deleteTask(sessionId, taskId);
      this.replaceCachedTaskId(localId, taskId, taskName);
      await this.refreshTaskCatalog();
      this.updateTaskPicker();
      this.updateSummary();
      this.saveToLocalStorage();
      this.recordSyncSuccess();
      console.log("Task synced to Supabase:", taskName, taskId);
    } catch (error) {
      console.error("Failed to sync task to Supabase:", error);
      if (/duplicate|already exists/i.test(error.message || "")) {
        const index = this.taskIds.findIndex((id) => String(id) === String(localId));
        if (index >= 0) {
          this.tasks.splice(index, 1);
          this.taskIds.splice(index, 1);
          this.gridData.splice(index, 1);
          this.taskCatalog = this.taskCatalog.filter(
            (task) => String(task.id) !== String(localId),
          );
          this.renderGrid();
          this.updateTaskCount();
          this.updateSummary();
          this.saveToLocalStorage();
        }
        alert(
          'A task with this name already exists. Choose it from "Reuse a task..." instead.',
        );
      }
    }
  }

  editTaskName(taskIdx, button) {
    const input = document.createElement("input");
    input.type = "text";
    input.className = "task-name-editor";
    input.value = this.tasks[taskIdx];
    input.setAttribute("aria-label", "Task name");
    input.title = "Rename this task across all days. Enter to save; Escape to cancel";
    let finished = false;
    const save = async () => {
      if (finished) return;
      finished = true;
      try {
        await this.renameTask(taskIdx, input.value);
        if (input.isConnected) input.replaceWith(button);
      } catch (error) {
        finished = false;
        input.setCustomValidity(error.message || "Could not rename this task.");
        input.reportValidity();
        input.focus();
      }
    };
    input.addEventListener("input", () => input.setCustomValidity(""));
    input.addEventListener("blur", save);
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        save();
      } else if (event.key === "Escape") {
        event.preventDefault();
        finished = true;
        input.replaceWith(button);
        button.focus();
      }
    });
    button.replaceWith(input);
    input.focus();
    input.select();
  }

  async renameTask(taskIdx, value) {
    this.ensureTaskIds();
    const name = value.trim();
    const previousName = this.tasks[taskIdx];
    if (!name) throw new Error("Enter a task name.");
    if (previousName === undefined) throw new Error("This task no longer exists.");
    if (name === previousName) return;
    if (this.findTaskNameConflict(name, this.getTaskId(taskIdx))) {
      throw new Error(
        'A task with this name already exists. Choose it from "Reuse a task..." instead.',
      );
    }
    if (this.isFullSyncing || this.isSyncing || this.isInitializingSession) {
      throw new Error("Wait for the current sync to finish, then try again.");
    }
    const container = document.querySelector(".container");
    const wasInert = container.inert;
    this.isFullSyncing = true;
    container.inert = true;
    try {
      await this.waitForPendingWrites();
      const taskId = this.getTaskId(taskIdx);
      if (this.isCloudReady() && this.sessionId && this.isCloudTaskId(taskId)) {
        await this.db.updateTask(this.sessionId, taskId, { name });
        this.recordSyncSuccess();
      }
      this.tasks[taskIdx] = name;
      delete this.taskIdMap[previousName];
      if (taskId) this.taskIdMap[name] = taskId;
      this.renameCachedTask(taskId, name);
      this.updateTaskPicker();
      this.renderGrid();
      this.updateSummary();
      this.saveToLocalStorage();
    } finally {
      this.isFullSyncing = false;
      container.inert = wasInert;
    }
  }

  spliceTaskRow(taskIdx) {
    const taskName = this.tasks[taskIdx];
    this.tasks.splice(taskIdx, 1);
    this.taskIds.splice(taskIdx, 1);
    this.gridData.splice(taskIdx, 1);
    delete this.taskIdMap[taskName];
  }

  /**
   * Remove task by index
   */
  removeTask(taskIdx) {
    this.ensureTaskIds();
    const taskId = this.getTaskId(taskIdx);

    this.spliceTaskRow(taskIdx);

    this.renderGrid();
    this.updateSummary();
    this.updateTaskCount();
    this.saveToLocalStorage();

    // Delete from Supabase asynchronously
    if (this.isCloudReady() && this.sessionId && this.isCloudTaskId(taskId)) {
      this.trackPendingWrite(this.deleteTaskFromSupabase(taskId));
    }
  }

  /**
   * Delete task from Supabase
   */
  async deleteTaskFromSupabase(taskId) {
    if (!this.isCloudReady() || !this.sessionId) return;
    try {
      await this.db.deleteTask(this.sessionId, taskId);
      this.recordSyncSuccess();
      console.log("Task removed from this session:", taskId);
    } catch (error) {
      console.error("Failed to delete task from Supabase:", error);
    }
  }

  /** Filled intervals for a task from local snapshots, including the live day. */
  localTaskIntervals(taskId) {
    const history = JSON.parse(localStorage.getItem("ettGridHistory") || "{}");
    history[this.date] = this.captureLocalSnapshot();
    const entries = [];
    for (const [key, state] of Object.entries(history)) {
      const ids =
        state.taskIds || (state.tasks || []).map((name) => state.taskIdMap?.[name]);
      ids.forEach((id, index) => {
        if (String(id) !== String(taskId)) return;
        (state.gridData?.[index] || []).forEach((filled, slot) => {
          if (filled) entries.push({ date: state.date || key, slot });
        });
      });
    }
    return entries;
  }

  renderDeleteTaskDetails(container, task, details, description) {
    const when = (value) => (value ? new Date(value).toLocaleString() : "Not recorded");
    const addRow = (term, value) => {
      const dt = document.createElement("dt");
      dt.textContent = term;
      const dd = document.createElement("dd");
      if (Array.isArray(value)) {
        const list = document.createElement("ul");
        for (const line of value) {
          const item = document.createElement("li");
          item.textContent = line;
          list.appendChild(item);
        }
        dd.appendChild(list);
      } else dd.textContent = value;
      container.append(dt, dd);
    };
    container.replaceChildren();
    addRow("Task", task.name);
    addRow("Created", when(details?.created_at));
    addRow("Last updated", when(details?.updated_at));
    addRow("Intervals", String(description.count));
    if (description.last.length) {
      addRow("First 5", description.first);
      addRow("Last 5", description.last);
    } else if (description.first.length) {
      addRow("All intervals", description.first);
    }
  }

  async confirmDeleteTask(taskId) {
    const task = (this.taskCatalog || []).find((entry) => String(entry.id) === taskId);
    if (!task) throw new Error("Choose an existing task.");
    if (this.isFullSyncing || this.isSyncing || this.isInitializingSession)
      throw new Error("Wait for the current sync to finish, then try again.");
    const isCloud = this.isCloudTaskId(taskId);
    if (isCloud && !this.isCloudReady())
      throw new Error("Sign in and connect to Supabase to delete a saved task.");
    await this.waitForPendingWrites();
    let details = null;
    let entries;
    if (isCloud) {
      [details, entries] = await Promise.all([
        this.db.getTaskDetails(taskId),
        this.db.getTaskIntervals(taskId),
      ]);
    } else {
      entries = this.localTaskIntervals(taskId);
    }
    const description = TimeCalculations.describeTaskIntervals(entries);
    const confirmed = await window.chooseDeleteTask((container) =>
      this.renderDeleteTaskDetails(container, task, details, description),
    );
    if (!confirmed) return false;
    await this.deleteTaskEverywhere(taskId);
    const count = description.count;
    alert(
      `Deleted task "${task.name}" and its ${count} interval${count === 1 ? "" : "s"}.`,
    );
    return true;
  }

  async deleteTaskEverywhere(taskId) {
    if (this.isFullSyncing || this.isSyncing || this.isInitializingSession)
      throw new Error("Wait for the current sync to finish, then try again.");
    const container = document.querySelector(".container");
    const wasInert = container.inert;
    this.isFullSyncing = true;
    container.inert = true;
    try {
      await this.waitForPendingWrites();
      if (this.isCloudTaskId(taskId)) {
        if (!this.isCloudReady())
          throw new Error("Sign in and connect to Supabase to delete a saved task.");
        await this.db.deleteTaskEverywhere(taskId);
        this.recordSyncSuccess();
      }
      this.scrubDeletedTask(taskId);
      this.ensureTaskIds();
      const index = this.taskIds.findIndex((id) => String(id) === String(taskId));
      if (index >= 0) this.spliceTaskRow(index);
      this.updateTaskPicker();
      this.renderGrid();
      this.updateSummary();
      this.updateTaskCount();
      this.saveToLocalStorage();
    } finally {
      this.isFullSyncing = false;
      container.inert = wasInert;
    }
  }

  /** Drop a deleted task from every local cache so sync cannot recreate it. */
  scrubDeletedTask(taskId) {
    const history = JSON.parse(localStorage.getItem("ettGridHistory") || "{}");
    for (const state of Object.values(history)) {
      const ids =
        state.taskIds || (state.tasks || []).map((name) => state.taskIdMap?.[name]);
      const keep = ids.map((id) => String(id) !== String(taskId));
      for (const [index, name] of (state.tasks || []).entries()) {
        if (!keep[index]) delete state.taskIdMap?.[name];
      }
      state.tasks = (state.tasks || []).filter((_, index) => keep[index]);
      state.gridData = (state.gridData || []).filter((_, index) => keep[index]);
      state.taskIds = ids.filter((_, index) => keep[index]);
    }
    localStorage.setItem("ettGridHistory", JSON.stringify(history));
    this.taskCatalog = (this.taskCatalog || []).filter(
      (task) => String(task.id) !== String(taskId),
    );
    this.taskDayTotals = (this.taskDayTotals || []).filter(
      (row) => String(row.task_id) !== String(taskId),
    );
    localStorage.setItem("ettTaskCatalog", JSON.stringify(this.taskCatalog));
    localStorage.setItem("ettTaskDayTotals", JSON.stringify(this.taskDayTotals));
  }

  renameCachedTask(taskId, name) {
    const history = JSON.parse(localStorage.getItem("ettGridHistory") || "{}");
    for (const state of Object.values(history)) {
      const ids =
        state.taskIds || (state.tasks || []).map((task) => state.taskIdMap?.[task]);
      state.tasks?.forEach((task, index) => {
        if (String(ids[index]) === String(taskId)) {
          state.tasks[index] = name;
          if (state.taskIdMap) {
            delete state.taskIdMap[task];
            state.taskIdMap[name] = taskId;
          }
        }
      });
      state.taskIds = ids;
    }
    localStorage.setItem("ettGridHistory", JSON.stringify(history));
    const catalog = this.taskCatalog || [];
    const task = catalog.find((entry) => String(entry.id) === String(taskId));
    if (task) task.name = name;
    else catalog.push({ id: taskId, name, interval_count: 0 });
    this.taskCatalog = catalog;
    localStorage.setItem("ettTaskCatalog", JSON.stringify(catalog));
  }

  replaceCachedTaskId(previousId, taskId, name) {
    const history = JSON.parse(localStorage.getItem("ettGridHistory") || "{}");
    for (const state of Object.values(history)) {
      state.taskIds = (state.taskIds || []).map((id) =>
        String(id) === String(previousId) ? taskId : id,
      );
    }
    localStorage.setItem("ettGridHistory", JSON.stringify(history));
    this.taskCatalog = (this.taskCatalog || []).filter(
      (task) => String(task.id) !== String(previousId),
    );
    if (!this.taskCatalog.some((task) => String(task.id) === String(taskId)))
      this.taskCatalog.push({ id: taskId, name, interval_count: 0 });
    localStorage.setItem("ettTaskCatalog", JSON.stringify(this.taskCatalog));
  }

  /**
   * Update task count in header
   */
  updateTaskCount() {
    const countEl = document.getElementById("tasksValue");
    if (countEl) {
      countEl.textContent = this.tasks.length;
    }
  }

  /**
   * Update activity summaries and the clock-based current slot
   */
  updateTimeCalculations() {
    const now = new Date();
    if (this.rolloverDailySession(now)) {
      this.renderGrid();
      this.updateTaskCount();
      this.updateSummary();
      if (this.isCloudReady()) {
        this.sessionInitialization = this.initializeSession();
      }
    }
    this.updateCurrentTimeLine(now);
    this.updateActivitySummary();
    this.updateDateControl(now);
    document.getElementById("currentSlotDisplay").textContent =
      this.date === TimeCalculations.localDate(now)
        ? `${TimeCalculations.currentSlot(now)} / ${TimeCalculations.intervalCount}`
        : "--";
  }

  updateDateControl(now = new Date()) {
    const otherDay = this.date !== TimeCalculations.localDate(now);
    const input = document.getElementById("dateInput");
    input.value = this.date;
    input.classList.toggle("is-other-day", otherDay);
    const warning = document.getElementById("dateWarning");
    warning.textContent = otherDay ? `Not today: editing ${this.date}` : "";
    warning.hidden = !otherDay;
    document.getElementById("todayBtn").hidden = !otherDay;
  }

  async changeSessionDate(date) {
    this.updateDateControl();
    if (date === this.date) return true;
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      TimeCalculations.localDate(new Date(`${date}T00:00:00`)) !== date
    )
      return false;
    if (this.isFullSyncing || this.isSyncing || this.isInitializingSession) {
      alert("Wait for the current sync to finish before changing days.");
      return false;
    }
    const container = document.querySelector(".container");
    const wasInert = container.inert;
    this.isFullSyncing = true;
    container.inert = true;
    let previousState;
    try {
      await this.waitForPendingWrites();
      this.saveToLocalStorage();
      previousState = localStorage.getItem("ettGridState");
      const history = JSON.parse(localStorage.getItem("ettGridHistory") || "{}");
      history[`${this.date}:${this.sessionId || "local"}`] = JSON.parse(previousState);
      localStorage.setItem("ettGridHistory", JSON.stringify(history));
      const cached = this.selectCloudSession(
        Object.values(history)
          .reverse()
          .filter((state) => state.date === date),
      );
      if (cached) {
        this.loadFromLocalStorage(JSON.stringify(cached));
        await this.refreshTaskCatalog();
      } else if (this.isCloudReady()) {
        const sessions = await this.db.getSessionsForDate(date);
        const session = this.selectCloudSession(sessions);
        if (session) {
          await this.loadSessionFromSupabase(session, date);
        } else {
          const result = await this.db.createSession({
            status: "active",
            date,
          });
          const created = result?.[0] || result;
          if (!created?.id) throw new Error("Could not create a session for this day.");
          this.restoreSessionData({ ...created, date, tasks: [] }, date);
        }
      } else {
        this.restoreSessionData({ id: null, date, tasks: [] }, date);
      }
      this.followToday = date === TimeCalculations.localDate(new Date());
      this.renderGrid();
      this.updateTaskCount();
      this.updateSummary();
      this.updateTimeCalculations();
      this.saveToLocalStorage();
      this.updateTaskPicker();
      return true;
    } catch (error) {
      if (previousState) this.loadFromLocalStorage(previousState);
      this.updateDateControl();
      alert(
        `Could not change days: ${error.message || "Unknown error"}. The previous session was kept.`,
      );
      return false;
    } finally {
      this.isFullSyncing = false;
      container.inert = wasInert;
    }
  }

  updateActivitySummary() {
    const summary = TimeCalculations.activitySummary(this.gridData);
    this.startTime = summary.firstActivity === "--" ? "" : summary.firstActivity;
    document.getElementById("firstActivityDisplay").textContent = summary.firstActivity;
    document.getElementById("lastActivityDisplay").textContent = summary.lastActivity;
    document.getElementById("sessionSpanDisplay").textContent = summary.sessionSpan;
    document.getElementById("trackedTimeDisplay").textContent = summary.trackedTime;
  }

  initializeGridHeader() {
    const table = document.getElementById("timeGrid");
    const columns = document.createElement("colgroup");
    const taskColumn = document.createElement("col");
    taskColumn.className = "task-grid-column";
    columns.appendChild(taskColumn);
    const hourRow = document.createElement("tr");
    const intervalRow = document.createElement("tr");
    hourRow.className = "hour-header";
    intervalRow.className = "interval-header";
    for (const row of [hourRow, intervalRow]) {
      const heading = document.createElement("th");
      heading.className = "task-column";
      heading.textContent = row === hourRow ? "TASK" : "";
      row.appendChild(heading);
    }
    for (let hour = 0; hour < 24; hour++) {
      const heading = document.createElement("th");
      heading.colSpan = 4;
      heading.className = "hour-label";
      heading.textContent = `${String(hour).padStart(2, "0")}:00`;
      hourRow.appendChild(heading);
    }
    for (let index = 0; index < TimeCalculations.intervalCount; index++) {
      const column = document.createElement("col");
      column.className = "interval-grid-column";
      columns.appendChild(column);
      const heading = document.createElement("th");
      heading.className = "interval-number";
      heading.dataset.interval = index;
      heading.textContent = String((index % 4) * 15).padStart(2, "0");
      intervalRow.appendChild(heading);
    }
    table.prepend(columns);
    table.tHead.replaceChildren(hourRow, intervalRow);
  }

  updateAutoCenterStatus(now = Date.now()) {
    const seconds = TimeCalculations.autoCenterSeconds(this.autoCenterPausedUntil, now);
    document.getElementById("autoCenterStatus").hidden = seconds === 0;
    document.getElementById("autoCenterCountdown").textContent =
      `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
    return seconds;
  }

  resumeAutoCentering() {
    this.autoCenterPausedUntil = 0;
    this.updateAutoCenterStatus();
    this.updateCurrentTimeLine();
  }

  updateCurrentTimeLine(now = new Date(), autoCenter = true) {
    const line = document.getElementById("currentTimeLine");
    if (this.date !== TimeCalculations.localDate(now)) {
      line.hidden = true;
      return;
    }
    const table = document.getElementById("timeGrid");
    const container = table.parentElement;
    const body = table.tBodies[0];
    const columns = table.querySelectorAll(".interval-number");
    const startHour = 0;
    const position = TimeCalculations.gridPosition(now, startHour, columns.length);

    line.hidden = !body.rows.length || !position;
    if (!position) return;

    const { intervalIndex, fraction } = position;
    const columnRect = columns[intervalIndex].getBoundingClientRect();
    const bodyRect = body.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    const timeOffset =
      columnRect.left +
      columnRect.width * fraction -
      containerRect.left -
      container.clientLeft +
      container.scrollLeft;
    line.style.left = `${timeOffset}px`;
    line.style.top = `${bodyRect.top - containerRect.top - container.clientTop + container.scrollTop}px`;
    line.style.height = `${bodyRect.height}px`;
    if (autoCenter && !this.updateAutoCenterStatus()) {
      const stickyWidth = table
        .querySelector(".task-column")
        .getBoundingClientRect().width;
      container.scrollLeft = TimeCalculations.centeredScrollLeft(
        timeOffset,
        container.clientWidth,
        stickyWidth,
        container.scrollWidth,
      );
      this.autoCenterScrollLeft = container.scrollLeft;
    }
  }

  /**
   * Render the entire grid with circles
   */
  renderGrid() {
    const tbody = document.getElementById("gridBody");
    tbody.innerHTML = "";

    this.tasks.forEach((taskName, taskIdx) => {
      const row = document.createElement("tr");

      const taskCell = document.createElement("td");
      taskCell.className = "task-name-cell";

      const nameButton = document.createElement("button");
      nameButton.type = "button";
      nameButton.className = "task-name-button";
      nameButton.textContent = taskName;
      nameButton.title = `Rename task across all days: ${taskName}`;
      nameButton.setAttribute("aria-label", `Rename task: ${taskName}`);
      nameButton.addEventListener("click", () => this.editTaskName(taskIdx, nameButton));
      taskCell.appendChild(nameButton);

      // Remove button
      const removeBtn = document.createElement("span");
      removeBtn.className = "task-remove";
      removeBtn.textContent = "×";
      removeBtn.title =
        "Remove from this day; keep the reusable task and other days' time";
      removeBtn.addEventListener("click", () => this.removeTask(taskIdx));
      taskCell.appendChild(removeBtn);

      row.appendChild(taskCell);

      // One cell for each 15-minute interval of the day
      for (
        let intervalIdx = 0;
        intervalIdx < TimeCalculations.intervalCount;
        intervalIdx++
      ) {
        const cell = document.createElement("td");
        cell.dataset.taskIdx = taskIdx;
        cell.dataset.intervalIdx = intervalIdx;

        // Create circle/bubble
        const bubble = document.createElement("div");
        bubble.className = "interval-bubble";

        // Set filled state
        if (this.gridData[taskIdx][intervalIdx]) {
          bubble.classList.add("filled");
        }

        bubble.addEventListener("click", () => {
          this.toggleInterval(intervalIdx, taskIdx);
        });

        bubble.addEventListener("dblclick", (e) => {
          e.stopPropagation();
          // Double click to clear
          this.gridData[taskIdx][intervalIdx] = false;
          this.renderGrid();
          this.updateSummary();
        });

        cell.appendChild(bubble);
        row.appendChild(cell);
      }

      tbody.appendChild(row);
    });

    this.updateCurrentTimeLine();
    this.saveToLocalStorage();
    this.updateTaskPicker();
  }

  /**
   * Toggle interval for a task (can have multiple tasks per interval)
   */
  toggleInterval(intervalIdx, taskIdx) {
    this.gridData[taskIdx][intervalIdx] = !this.gridData[taskIdx][intervalIdx];
    this.renderGrid();
    this.updateSummary();
    this.saveToLocalStorage();

    // Sync to Supabase asynchronously
    if (this.sessionId) {
      this.trackPendingWrite(
        this.syncIntervalToSupabase(
          intervalIdx,
          taskIdx,
          this.gridData[taskIdx][intervalIdx],
        ),
      );
    }
  }

  trackPendingWrite(write) {
    const pending = Promise.resolve(write).finally(() => {
      this.pendingWrites.delete(pending);
      this.renderSyncStatus();
    });
    this.pendingWrites.add(pending);
    this.renderSyncStatus();
    return pending;
  }

  async waitForPendingWrites() {
    while (this.pendingWrites.size > 0) {
      await Promise.all([...this.pendingWrites]);
    }
  }

  async refreshFromSupabase() {
    if (this.isFullSyncing || this.isSyncing) return;
    if (!this.hasAuthenticatedCloud()) {
      alert("Sign in to Supabase before refreshing cloud data.");
      return;
    }
    this.syncPausedForConflict = false;
    const button = document.getElementById("refreshDbBtn");
    const container = document.querySelector(".container");
    const wasInert = container.inert;
    this.isFullSyncing = true;
    this.renderSyncStatus();
    container.inert = true;
    button.disabled = true;
    button.textContent = "Loading...";
    try {
      if (this.sessionInitialization) await this.sessionInitialization;
      await this.waitForPendingWrites();
      const selectedDate = this.date;
      const sessions = await this.db.getSessionsForDate(selectedDate);
      if (!sessions.length)
        throw new Error(
          "No saved session was found for the selected date. Local data was kept.",
        );
      const session = this.selectCloudSession(sessions);
      if (
        !confirm(
          `Load cloud session ${session.id} for ${selectedDate} (${session.tasks?.length || 0} tasks, ${session.intervals?.length || 0} bubbles)?\n\nThis replaces local tasks, bubbles, memo, and notes without uploading local changes. Changes already synced cannot be undone. Other cloud sessions will not be modified.`,
        )
      )
        return;
      this.saveToLocalStorage();
      localStorage.setItem("ettGridBeforeRefresh", localStorage.getItem("ettGridState"));
      await this.loadSessionFromSupabase(session);
      this.recordSyncSuccess();
    } catch (error) {
      console.error("Failed to refresh from Supabase:", error);
      alert(`Refresh failed: ${error.message || "Unknown error"}`);
    } finally {
      this.isFullSyncing = false;
      this.renderSyncStatus();
      container.inert = wasInert;
      button.disabled = false;
      button.textContent = "Refresh from DB";
    }
  }

  async syncAndReloadFromSupabase() {
    const button = document.getElementById("syncReloadBtn");
    if (this.isFullSyncing) return;
    if (!this.hasAuthenticatedCloud()) {
      alert("Sign in to Supabase before syncing cloud data.");
      return;
    }
    this.syncPausedForConflict = false;

    this.isFullSyncing = true;
    this.renderSyncStatus();
    const container = document.querySelector(".container");
    const wasInert = container.inert;
    container.inert = true;
    if (button) {
      button.disabled = true;
      button.textContent = "Syncing...";
    }

    try {
      if (this.sessionInitialization) await this.sessionInitialization;
      if (!this.sessionId) await this.initializeSession();
      if (!this.sessionId) throw new Error("No Supabase session is available.");

      await this.waitForPendingWrites();

      this.updateActivitySummary();
      this.memo = document.getElementById("memoInput")?.value || "";
      this.notes = document.getElementById("notesInput")?.value || "";
      await this.db.updateSession(this.sessionId, {
        start_time: this.startTime || null,
        memo: this.memo || null,
        date: this.date,
        notes: this.notes || null,
      });

      const session = await this.db.getSession(this.sessionId);
      if (!session) throw new Error("The Supabase session could not be loaded.");

      const remoteTasks = session.tasks || [];
      const usedTaskIds = new Set();
      const nextTaskIdMap = {};
      this.ensureTaskIds();

      for (const [taskIndex, taskName] of this.tasks.entries()) {
        const knownId = this.getTaskId(taskIndex);
        let taskId = knownId;
        if (!this.isCloudTaskId(taskId)) {
          const normalizedName = taskName.trim().toLocaleLowerCase();
          const reusableTask = (this.taskCatalog || []).find(
            (task) =>
              this.isCloudTaskId(task.id) &&
              task.name.trim().toLocaleLowerCase() === normalizedName,
          );
          if (reusableTask) {
            taskId = reusableTask.id;
            await this.db.attachTask(this.sessionId, taskId);
          } else {
            const createdTask = await this.db.createTask(this.sessionId, {
              name: taskName,
              duration_minutes: 0,
            });
            taskId = createdTask?.id || createdTask?.[0]?.id;
            if (!taskId) throw new Error(`Could not sync task "${taskName}".`);
          }
          this.replaceCachedTaskId(knownId, taskId, taskName);
          this.taskIds[taskIndex] = taskId;
        } else if (!remoteTasks.some((task) => String(task.id) === String(taskId))) {
          await this.db.attachTask(this.sessionId, taskId);
        }

        nextTaskIdMap[taskName] = taskId;
        usedTaskIds.add(String(taskId));
      }

      for (const task of remoteTasks) {
        if (!usedTaskIds.has(String(task.id))) {
          await this.db.deleteTask(this.sessionId, task.id);
        }
      }
      this.taskIdMap = nextTaskIdMap;

      const existingIntervals = await this.db.getSessionIntervals(this.sessionId);
      const desiredIntervals = new Map();
      this.tasks.forEach((taskName, taskIndex) => {
        const taskId = this.getTaskId(taskIndex);
        for (
          let intervalIndex = 0;
          intervalIndex < TimeCalculations.intervalCount;
          intervalIndex++
        ) {
          if (this.gridData[taskIndex]?.[intervalIndex]) {
            desiredIntervals.set(`${taskId}:${intervalIndex}`, {
              taskId,
              intervalIndex,
            });
          }
        }
      });

      const existingIntervalKeys = new Set();
      for (const interval of existingIntervals) {
        const key = `${interval.task_id}:${interval.interval_index}`;
        existingIntervalKeys.add(key);
        if (!desiredIntervals.has(key)) {
          await this.db.deleteInterval(
            this.sessionId,
            interval.task_id,
            interval.interval_index,
          );
        }
      }

      for (const [key, interval] of desiredIntervals) {
        if (!existingIntervalKeys.has(key)) {
          await this.db.createInterval(
            this.sessionId,
            interval.taskId,
            interval.intervalIndex,
          );
        }
      }

      const refreshedSession = await this.db.getSession(this.sessionId);
      if (!refreshedSession)
        throw new Error("The Supabase session could not be reloaded.");
      await this.loadSessionFromSupabase(refreshedSession);
      this.recordSyncSuccess();
      if (button) button.textContent = "Synced";
      window.setTimeout(() => {
        if (button) button.textContent = "Sync & Reload";
      }, 1500);
    } catch (error) {
      console.error("Failed to sync and reload from Supabase:", error);
      alert(`Sync failed: ${error.message || "Unknown Supabase error"}`);
    } finally {
      this.isFullSyncing = false;
      this.renderSyncStatus();
      container.inert = wasInert;
      if (button) {
        button.disabled = false;
        if (button.textContent === "Syncing...") {
          button.textContent = "Sync & Reload";
        }
      }
    }
  }

  /**
   * Sync interval toggle to Supabase
   */
  async syncIntervalToSupabase(intervalIdx, taskIdx, isFilled) {
    if (!this.isCloudReady() || !this.sessionId) return;
    const taskName = this.tasks[taskIdx];
    const taskId = this.getTaskId(taskIdx);

    if (!this.isCloudTaskId(taskId)) {
      console.warn("Task ID not found, skipping interval sync");
      return;
    }

    try {
      if (isFilled) {
        // Create interval entry
        await this.db.createInterval(this.sessionId, taskId, intervalIdx);
      } else {
        // Delete interval entry
        await this.db.deleteInterval(this.sessionId, taskId, intervalIdx);
      }
      this.recordSyncSuccess();
      console.log(
        `Interval ${intervalIdx} for task ${taskName} synced (filled=${isFilled})`,
      );
    } catch (error) {
      console.error("Failed to sync interval to Supabase:", error);
      this.cloudWriteFailed = true;
    }
  }

  /**
   * Clear all grid data (but keep tasks)
   */
  clearGrid() {
    if (!confirm("Clear all interval assignments? (Tasks will remain)")) return;

    this.gridData = this.tasks.map(() =>
      new Array(TimeCalculations.intervalCount).fill(false),
    );
    this.renderGrid();
    this.updateSummary();
  }

  taskAllDayIntervals(
    taskIndex,
    snapshots = Object.values(JSON.parse(localStorage.getItem("ettGridHistory") || "{}")),
  ) {
    return TimeCalculations.taskIntervalTotal(
      this.getTaskId(taskIndex),
      String(this.sessionId ?? `local:${this.date}`),
      (this.gridData[taskIndex] || []).filter(Boolean).length,
      this.taskDayTotals || [],
      snapshots,
    );
  }

  /**
   * Update summary with interval counts and time breakdowns per task
   */
  updateSummary() {
    this.ensureTaskIds();
    const summaryContent = document.getElementById("summaryContent");
    const rows = this.tasks.map((name, index) => ({
      name,
      intervals: (this.gridData[index] || []).filter(Boolean).length,
      taskId: this.getTaskId(index),
    }));
    const totalIntervals = rows.reduce((total, row) => total + row.intervals, 0);
    const table = document.createElement("table");
    table.className = "summary-table";
    table.setAttribute("aria-label", "Task summary");
    const head = table.createTHead();
    const body = table.createTBody();
    const snapshots = Object.values(
      JSON.parse(localStorage.getItem("ettGridHistory") || "{}"),
    );
    rows.forEach((row, index) => {
      row.allIntervals = this.taskAllDayIntervals(index, snapshots);
    });
    const appendRow = (
      section,
      values,
      { className = "", columnHeadings = false } = {},
    ) => {
      const row = section.insertRow();
      row.className = className;
      values.forEach((value, index) => {
        const isHeading = columnHeadings || index === 0;
        const cell = document.createElement(isHeading ? "th" : "td");
        if (isHeading) cell.scope = columnHeadings ? "col" : "row";
        cell.textContent = value;
        row.appendChild(cell);
      });
      return row;
    };
    const duration = (intervals) => {
      const minutes = intervals * 15;
      const time =
        minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${minutes}m`;
      return time;
    };
    const totalRow = appendRow(
      head,
      [
        "Totals",
        duration(totalIntervals),
        duration(rows.reduce((total, row) => total + row.allIntervals, 0)),
      ],
      {
        className: "summary-header",
      },
    );
    totalRow.title =
      "Sum of bubble time for the tasks shown. Overlapping tasks count separately; no overlap compensation.";
    appendRow(head, ["Task", "Day", "All days"], {
      className: "summary-header",
      columnHeadings: true,
    });
    rows.forEach((row) =>
      appendRow(body, [row.name, duration(row.intervals), duration(row.allIntervals)]),
    );
    if (!rows.length) {
      const empty = body.insertRow().insertCell();
      empty.colSpan = 3;
      empty.className = "summary-empty";
      empty.textContent = "No time tracked yet";
    }
    summaryContent.replaceChildren(table);
  }

  /**
   * Export grid as CSV
   */
  exportCSV() {
    const date = this.date;
    const activity = TimeCalculations.activitySummary(this.gridData);

    let csv = "TASK_ID,TASK,INTERVALS,MINUTES,TIME,ALL_DAYS_MINUTES\n";
    const csvField = (value) => `"${String(value).replaceAll('"', '""')}"`;

    this.tasks.forEach((taskName, taskIdx) => {
      const intervalCount = this.gridData[taskIdx].filter((v) => v).length;
      const minutes = intervalCount * 15;
      const hours = Math.floor(minutes / 60);
      const mins = minutes % 60;

      let timeStr = "";
      if (hours > 0) {
        timeStr = `${hours}h ${mins}m`;
      } else if (minutes > 0) {
        timeStr = `${mins}m`;
      } else {
        timeStr = "0m";
      }

      csv += `${csvField(this.getTaskId(taskIdx))},${csvField(taskName)},${intervalCount},${minutes},${csvField(timeStr)},${this.taskAllDayIntervals(taskIdx) * 15}\n`;
    });

    // Add metadata
    csv += `\n\nMETADATA\n`;
    csv += `Date,${date}\n`;
    csv += `First Activity,${activity.firstActivity}\n`;
    csv += `Last Activity,${activity.lastActivity}\n`;
    csv += `Session Span,${activity.sessionSpan}\n`;
    csv += `Tracked Time,${activity.trackedTime}\n`;
    csv += `Memo,${csvField(document.getElementById("memoInput")?.value || "")}\n`;

    // Download
    const filename = `ETT-${date}.csv`;
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  initializeReminder(now = Date.now()) {
    let settings = {};
    try {
      settings = JSON.parse(localStorage.getItem("ettReminderSettings") || "{}") || {};
    } catch (error) {
      console.warn("Could not load reminder settings:", error);
    }
    const minutes = Number(settings.minutes);
    this.timerState.totalTime =
      Number.isInteger(minutes) && minutes >= 1 && minutes <= 120 ? minutes * 60 : 900;
    this.bellEnabled = settings.bellEnabled !== false;
    this.bellVolume =
      Number.isFinite(settings.volume) && settings.volume >= 0 && settings.volume <= 1
        ? settings.volume
        : 1;
    this.nextReminderAt =
      Number.isFinite(settings.nextReminderAt) &&
      settings.nextReminderAt <= now + this.timerState.totalTime * 1000
        ? settings.nextReminderAt
        : now + this.timerState.totalTime * 1000;
    document.getElementById("reminderMinutesInput").value =
      this.timerState.totalTime / 60;
    document.getElementById("bellEnabledInput").checked = this.bellEnabled;
    this.updateBellVolume();
    this.timerTick(now, false);
    this.updateBellControl();
    this.saveReminderSettings();
  }

  saveReminderSettings() {
    localStorage.setItem(
      "ettReminderSettings",
      JSON.stringify({
        minutes: this.timerState.totalTime / 60,
        bellEnabled: this.bellEnabled,
        volume: this.bellVolume,
        nextReminderAt: this.nextReminderAt,
      }),
    );
  }

  timerTick(now = Date.now(), ring = true) {
    const previousDeadline = this.nextReminderAt;
    const result = TimeCalculations.reminderTick(
      now,
      previousDeadline,
      this.timerState.totalTime,
    );
    this.nextReminderAt = result.nextReminderAt;
    this.timerState.isRunning = true;
    this.timerState.timeRemaining = result.timeRemaining;
    this.updateTimerDisplay();
    if (result.elapsedIntervals) {
      if (this.bellEnabled && ring && now - previousDeadline < 10000)
        this.playReminderBell();
      this.saveReminderSettings();
    }
  }

  updateBellControl() {
    document.getElementById("enableBellBtn").hidden =
      !this.bellEnabled || this.audioContext?.state === "running";
  }

  setBellVolume(percent) {
    if (!Number.isFinite(percent)) return;
    this.bellVolume = Math.max(0, Math.min(100, percent)) / 100;
    this.updateBellVolume();
    this.saveReminderSettings();
  }

  updateBellVolume() {
    const percent = Math.round(this.bellVolume * 100);
    document.getElementById("bellVolumeInput").value = percent;
    document.getElementById("bellVolumeValue").textContent = `${percent}%`;
    if (this.bellOutput) {
      this.bellOutput.gain.setTargetAtTime(
        this.bellEnabled ? this.bellVolume : 0,
        this.audioContext.currentTime,
        0.02,
      );
    }
  }

  async enableBellAudio() {
    if (!this.bellEnabled) return;
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;
      if (!this.audioContext || this.audioContext.state === "closed") {
        this.audioContext = new AudioContext();
        this.bellOutput = this.audioContext.createGain();
        this.bellOutput.gain.setValueAtTime(
          this.bellEnabled ? this.bellVolume : 0,
          this.audioContext.currentTime,
        );
        this.bellOutput.connect(this.audioContext.destination);
        this.audioContext.onstatechange = () => this.updateBellControl();
      }
      if (this.audioContext.state !== "running") await this.audioContext.resume();
    } catch (error) {
      console.warn("Bell audio is unavailable:", error);
    }
    this.updateBellControl();
  }

  playReminderBell() {
    if (!this.bellEnabled || this.audioContext?.state !== "running") return;
    const context = this.audioContext;
    const start = context.currentTime;
    for (const [frequency, volume, decay] of [
      [440, 0.04, 4.5],
      [881, 0.012, 3.2],
      [1323, 0.005, 2.2],
    ]) {
      const oscillator = context.createOscillator();
      const envelope = context.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = frequency;
      envelope.gain.setValueAtTime(0.0001, start);
      envelope.gain.exponentialRampToValueAtTime(volume, start + 0.03);
      envelope.gain.exponentialRampToValueAtTime(0.0001, start + decay);
      oscillator.connect(envelope);
      envelope.connect(this.bellOutput);
      oscillator.onended = () => {
        oscillator.disconnect();
        envelope.disconnect();
      };
      oscillator.start(start);
      oscillator.stop(start + decay);
    }
  }

  /**
   * Update timer display
   */
  updateTimerDisplay() {
    const mins = Math.floor(this.timerState.timeRemaining / 60);
    const secs = this.timerState.timeRemaining % 60;
    const display = document.getElementById("timerDisplay");
    if (display) {
      display.textContent = `${mins}:${secs.toString().padStart(2, "0")}`;
    }
  }

  rolloverDailySession(now = new Date()) {
    const today = TimeCalculations.localDate(now);
    if (
      this.followToday === false ||
      this.date === today ||
      this.isInitializingSession ||
      this.isSyncing ||
      this.isFullSyncing ||
      this.pendingWrites.size > 0
    )
      return false;

    this.saveToLocalStorage();
    const previousState = JSON.parse(localStorage.getItem("ettGridState"));
    const history = JSON.parse(localStorage.getItem("ettGridHistory") || "{}");
    history[`${this.date}:${this.sessionId || "local"}`] = previousState;
    localStorage.setItem("ettGridHistory", JSON.stringify(history));

    this.tasks = [];
    this.taskIds = [];
    this.taskIdMap = {};
    this.gridData = [];
    this.sessionId = null;
    this.startTime = "";
    this.memo = "";
    this.notes = "";
    this.date = today;
    for (const field of ["memoInput", "notesInput"]) {
      document.getElementById(field).value = "";
    }
    this.updateDateControl(now);
    this.saveToLocalStorage();
    this.updateTaskPicker();
    return true;
  }

  /**
   * Save state to localStorage
   */
  saveToLocalStorage() {
    this.ensureTaskIds();
    this.taskCatalog ||= [];
    this.tasks.forEach((name, index) => {
      const id = this.getTaskId(index);
      if (!this.taskCatalog.some((task) => String(task.id) === String(id)))
        this.taskCatalog.push({ id, name, interval_count: 0 });
    });
    localStorage.setItem("ettTaskCatalog", JSON.stringify(this.taskCatalog));
    // Save form inputs
    this.updateActivitySummary();
    this.memo = document.getElementById("memoInput")?.value || "";
    this.notes = document.getElementById("notesInput")?.value || "";

    const state = {
      tasks: this.tasks,
      taskIds: this.taskIds,
      gridData: this.gridData,
      sessionId: this.sessionId,
      taskIdMap: this.taskIdMap,
      followToday: this.followToday,
      timerState: this.timerState,
      startTime: this.startTime,
      memo: this.memo,
      date: this.date,
      notes: this.notes,
    };
    localStorage.setItem("ettGridState", JSON.stringify(state));
  }

  /**
   * Sync session metadata to Supabase
   */
  async syncToSupabase() {
    if (!this.isCloudReady()) return;
    if (
      this.followToday !== false &&
      this.date !== TimeCalculations.localDate(new Date())
    ) {
      this.updateTimeCalculations();
      return;
    }
    if (
      this.isSyncing ||
      this.isFullSyncing ||
      this.isInitializingSession ||
      !this.sessionId
    )
      return;

    this.isSyncing = true;
    this.renderSyncStatus();

    try {
      // Save latest form values
      this.updateActivitySummary();
      this.memo = document.getElementById("memoInput")?.value || "";
      this.notes = document.getElementById("notesInput")?.value || "";

      const sessionData = {
        start_time: this.startTime || null,
        memo: this.memo || null,
        date: this.date,
        notes: this.notes || null,
      };

      await this.db.updateSession(this.sessionId, sessionData);
      this.recordSyncSuccess();
      console.log("Session synced to Supabase at", this.lastSyncTime);
    } catch (error) {
      console.error("Failed to sync session to Supabase:", error);
    } finally {
      this.isSyncing = false;
      this.renderSyncStatus();
    }
  }

  /**
   * Load state from localStorage
   */
  loadFromLocalStorage(saved = localStorage.getItem("ettGridState")) {
    this.taskCatalog = JSON.parse(localStorage.getItem("ettTaskCatalog") || "[]");
    this.taskDayTotals = JSON.parse(localStorage.getItem("ettTaskDayTotals") || "[]");
    if (saved) {
      try {
        const state = JSON.parse(saved);
        this.tasks = state.tasks || [];
        this.gridData = (state.gridData || []).map((row) =>
          TimeCalculations.normalizeGridRow(row),
        );
        this.sessionId = state.sessionId;
        this.taskIdMap = state.taskIdMap || {};
        this.taskIds = state.taskIds || [];
        this.ensureTaskIds();
        this.applyCatalogNames();
        this.followToday = state.followToday !== false;
        this.startTime = state.startTime || "";
        this.memo = state.memo || "";
        this.date = state.date || TimeCalculations.localDate(new Date());
        this.notes = state.notes || "";

        // Restore form fields
        const memoInput = document.getElementById("memoInput");
        const notesInput = document.getElementById("notesInput");

        if (memoInput) memoInput.value = this.memo;
        this.updateDateControl();
        if (notesInput) notesInput.value = this.notes;

        // Initialize grid data for tasks if not present
        if (this.gridData.length < this.tasks.length) {
          for (let i = this.gridData.length; i < this.tasks.length; i++) {
            this.gridData.push(new Array(TimeCalculations.intervalCount).fill(false));
          }
        }
      } catch (e) {
        console.error("Error loading from localStorage:", e);
      }
    }
  }

  /**
   * Re-initialize Supabase connection
   * Called when user configures Supabase credentials
   */
  async setupSupabase(accessToken) {
    this.db = getSupabaseClient();
    if (!hasSupabaseConfig() || !accessToken || !this.db) {
      this.cloudAuthenticated = false;
      this.renderSyncStatus();
      return false;
    }
    this.db.setAccessToken(accessToken);
    this.cloudAuthenticated = this.db.isAuthenticated();
    if (!this.cloudAuthenticated) {
      this.renderSyncStatus();
      return false;
    }
    this.syncPausedForConflict = false;
    this.renderSyncStatus();
    this.sessionInitialization = this.initializeSession();
    await this.sessionInitialization;
    if (this.pendingInitialSyncAction === "upload") {
      this.pendingInitialSyncAction = null;
      await this.syncAndReloadFromSupabase();
    }
    this.startRealtime(accessToken);
    return true;
  }

  startRealtime(accessToken) {
    this.stopRealtime();
    if (typeof RealtimeWatcher === "undefined") return;
    const config = globalThis.SUPABASE_CONFIG || {};
    this.realtime = new RealtimeWatcher(config.url, config.publishableKey, () =>
      this.scheduleRemoteRefresh(),
    );
    if (!this.realtime.start(accessToken)) {
      this.realtime = null;
      return;
    }
    this.db.onAccessTokenChange = (token) => this.realtime?.setAccessToken(token);
  }

  stopRealtime() {
    clearTimeout(this.remoteRefreshTimer);
    this.realtime?.stop();
    this.realtime = null;
    if (this.db) this.db.onAccessTokenChange = null;
  }

  scheduleRemoteRefresh(delay = 700) {
    clearTimeout(this.remoteRefreshTimer);
    this.remoteRefreshTimer = setTimeout(() => this.refreshFromRemoteChange(), delay);
  }

  /** Comparable view of the selected day, ignoring tasks not yet in the cloud. */
  remoteComparableState() {
    this.ensureTaskIds();
    return {
      memo: this.memo || "",
      notes: this.notes || "",
      tasks: this.tasks.map((name, index) => ({
        id: this.getTaskId(index),
        name,
        slots: (this.gridData[index] || [])
          .slice(0, TimeCalculations.intervalCount)
          .flatMap((filled, slot) => (filled ? [slot] : [])),
      })),
    };
  }

  /** A change signal arrived: fetch the day, summarize what differs, and apply it. */
  async refreshFromRemoteChange() {
    if (!this.isCloudReady() || !this.sessionId) return;
    if (
      this.isFullSyncing ||
      this.isSyncing ||
      this.isInitializingSession ||
      this.pendingWrites.size > 0
    ) {
      this.scheduleRemoteRefresh(1000);
      return;
    }
    if (this.remoteRefreshRunning) {
      this.remoteRefreshAgain = true;
      return;
    }
    this.remoteRefreshRunning = true;
    const sessionId = this.sessionId;
    try {
      const before = this.remoteComparableState();
      const [session, intervals] = await Promise.all([
        this.db.getSession(sessionId),
        this.db.getSessionIntervals(sessionId),
      ]);
      const changed =
        this.sessionId !== sessionId ||
        this.pendingWrites.size > 0 ||
        JSON.stringify(before) !== JSON.stringify(this.remoteComparableState());
      if (changed) {
        // Local edits landed while fetching; compare again once they have synced.
        this.remoteRefreshAgain = true;
        return;
      }
      if (!session) return;
      const changes = RemoteChanges.diff(before, {
        memo: session.memo,
        notes: session.notes,
        tasks: session.tasks,
        intervals,
      });
      if (changes.isEmpty) {
        await this.refreshTaskCatalog();
        this.updateSummary();
        return;
      }
      if (this.cloudWriteFailed) {
        this.showRemoteNotice("Changed on another device", [
          "This device has edits that did not reach the cloud, so nothing was applied.",
          "Use Sync & Reload to keep this device's version, or Refresh from DB to take the cloud's.",
        ]);
        return;
      }
      const memoInput = document.getElementById("memoInput");
      const notesInput = document.getElementById("notesInput");
      const typed = { memo: memoInput?.value, notes: notesInput?.value };
      await this.loadSessionFromSupabase(session, this.date);
      // Keep text being typed when the other device did not change that field.
      if (!changes.memoChanged && memoInput) memoInput.value = typed.memo;
      if (!changes.notesChanged && notesInput) notesInput.value = typed.notes;
      this.showRemoteNotice(
        "Updated from another device",
        RemoteChanges.describe(changes),
      );
    } catch (error) {
      console.error("Failed to apply remote changes:", error);
    } finally {
      this.remoteRefreshRunning = false;
      if (this.remoteRefreshAgain) {
        this.remoteRefreshAgain = false;
        this.scheduleRemoteRefresh(300);
      }
    }
  }

  showRemoteNotice(title, lines, maxLines = 6) {
    const notice = document.getElementById("remoteChangeNotice");
    if (!notice) return;
    document.getElementById("remoteChangeTitle").textContent = title;
    const list = document.getElementById("remoteChangeList");
    list.replaceChildren();
    const shown = lines.slice(0, maxLines);
    if (lines.length > maxLines) shown.push(`\u2026and ${lines.length - maxLines} more`);
    for (const line of shown) {
      const item = document.createElement("li");
      item.textContent = line;
      list.appendChild(item);
    }
    notice.hidden = false;
    clearTimeout(this.remoteNoticeTimer);
    this.remoteNoticeTimer = setTimeout(() => (notice.hidden = true), 20000);
  }

  disableSupabase() {
    this.stopRealtime();
    this.cloudAuthenticated = false;
    this.syncPausedForConflict = false;
    this.db = null;
    this.renderSyncStatus();
  }
}

/**
 * Initialize tracker when DOM is ready
 */
document.addEventListener("DOMContentLoaded", () => {
  window.tracker = new GridTaskTracker();
});
