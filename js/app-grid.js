/**
 * GridTaskTracker - Circle/bubble-based task time tracker
 * Implements a 15-hour × 60-interval grid matching the paper Emergent Task Timer
 * Uses Supabase for backend data storage and sync
 */
class GridTaskTracker {
  constructor() {
    this.tasks = [];
    this.taskIdMap = {}; // Map task name to Supabase ID
    this.gridData = []; // 2D array: tasks[taskIdx][intervalIdx] = true/false (filled or not)
    this.sessionId = null;
    this.startTime = "";
    this.memo = "";
    this.date = new Date().toISOString().split("T")[0];
    this.notes = "";

    // Supabase client
    this.db = getSupabaseClient();
    this.lastSyncTime = null;
    this.isSyncing = false;
    this.isFullSyncing = false;
    this.pendingWrites = new Set();
    this.sessionInitialization = null;

    this.timerState = {
      isRunning: false,
      timeRemaining: 15 * 60, // 15 minutes in seconds
      totalTime: 15 * 60,
      currentInterval: 0,
    };

    this.initializeUI();
    this.loadFromLocalStorage();
    if (hasSupabaseConfig()) {
      this.sessionInitialization = this.initializeSession();
    }
    this.renderGrid();
    this.bindEvents();
    this.updateTaskCount();
    this.updateTimeCalculations();

    // Update time calculations every minute
    setInterval(() => this.updateTimeCalculations(), 60000);

    // Auto-sync to Supabase every 30 seconds
    setInterval(() => this.syncToSupabase(), 30000);
  }

  /**
   * Initialize or load session from Supabase
   */
  async initializeSession() {
    // Check if we have a saved session ID
    if (this.sessionId) {
      try {
        const session = await this.db.getSession(this.sessionId);
        if (session) {
          console.log("Session loaded from Supabase:", this.sessionId);
          await this.loadSessionFromSupabase(session);
          return;
        }
      } catch (error) {
        console.warn("Failed to load session, creating new one:", error);
      }
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
      const message = error?.message || "Unknown Supabase error";
      window.showSupabaseSetupModal?.(
        `Failed to create session: ${message}. Check the database permissions or enter different project credentials.`,
      );
    }
  }

  /**
   * Restore session data from Supabase
   */
  restoreSessionData(session) {
    this.sessionId = session.id;
    this.startTime = session.start_time || "";
    this.memo = session.memo || "";
    this.date = session.date || this.date;
    this.notes = session.notes || "";

    // Update form fields
    const startTimeInput = document.getElementById("startTimeInput");
    const memoInput = document.getElementById("memoInput");
    const dateInput = document.getElementById("dateInput");
    const notesInput = document.getElementById("notesInput");

    if (startTimeInput) startTimeInput.value = this.startTime;
    if (memoInput) memoInput.value = this.memo;
    if (dateInput) dateInput.value = this.date;
    if (notesInput) notesInput.value = this.notes;

    const sessionTasks = session.tasks || [];
    this.tasks = sessionTasks.map((task) => task.name);
    this.taskIdMap = {};
    sessionTasks.forEach((task) => {
      this.taskIdMap[task.name] = task.id;
    });
    this.gridData = this.tasks.map(() => new Array(60).fill(false));
  }

  async loadSessionFromSupabase(session) {
    this.restoreSessionData(session);
    const intervals = await this.db.getSessionIntervals(this.sessionId);
    const taskIndexById = new Map(
      this.tasks.map((taskName, index) => [
        String(this.taskIdMap[taskName]),
        index,
      ]),
    );

    intervals.forEach((interval) => {
      const taskIndex = taskIndexById.get(String(interval.task_id));
      const intervalIndex = Number(interval.interval_index);
      if (taskIndex !== undefined && intervalIndex >= 0 && intervalIndex < 60) {
        this.gridData[taskIndex][intervalIndex] = true;
      }
    });

    this.renderGrid();
    this.updateTaskCount();
    this.updateSummary();
    this.updateTimeCalculations();
    this.saveToLocalStorage();
  }

  initializeUI() {
    // Timer buttons
    document
      .getElementById("startBtn")
      ?.addEventListener("click", () => this.timerStart());
    document
      .getElementById("pauseBtn")
      ?.addEventListener("click", () => this.timerPause());
    document
      .getElementById("resetBtn")
      ?.addEventListener("click", () => this.timerReset());

    // Header fields
    document
      .getElementById("startTimeInput")
      ?.addEventListener("change", () => {
        this.updateTimeCalculations();
        this.saveToLocalStorage();
      });
    document
      .getElementById("memoInput")
      ?.addEventListener("change", () => this.saveToLocalStorage());
    document
      .getElementById("dateInput")
      ?.addEventListener("change", () => this.saveToLocalStorage());
    document
      .getElementById("notesInput")
      ?.addEventListener("change", () => this.saveToLocalStorage());

    // Task input
    document
      .getElementById("addTaskBtn")
      .addEventListener("click", () => this.addTaskFromInput());
    document
      .getElementById("newTaskInput")
      .addEventListener("keypress", (e) => {
        if (e.key === "Enter") this.addTaskFromInput();
      });

    // Grid actions
    document
      .getElementById("autoFillBtn")
      .addEventListener("click", () => this.autoFillHour1());
    document
      .getElementById("clearGridBtn")
      .addEventListener("click", () => this.clearGrid());
    document
      .getElementById("syncReloadBtn")
      .addEventListener("click", () => this.syncAndReloadFromSupabase());

    // Export/Clear
    document
      .getElementById("exportBtn")
      .addEventListener("click", () => this.exportCSV());
    document
      .getElementById("clearBtn")
      .addEventListener("click", () => this.clearAll());
  }

  bindEvents() {
    // Bubble click handlers are attached in renderGrid()
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

    this.addTask(taskName);
    input.value = "";
    input.focus();
  }

  /**
   * Add task to grid and initialize its row
   */
  addTask(taskName) {
    this.tasks.push(taskName);
    this.gridData.push(new Array(60).fill(false)); // 60 intervals, all empty
    this.renderGrid();
    this.updateSummary();
    this.updateTaskCount();
    this.saveToLocalStorage();

    // Sync to Supabase asynchronously
    if (this.sessionId) {
      this.trackPendingWrite(this.createTaskInSupabase(taskName));
    }
  }

  /**
   * Create task in Supabase
   */
  async createTaskInSupabase(taskName) {
    try {
      const result = await this.db.createTask(this.sessionId, {
        name: taskName,
        duration_minutes: 0,
      });
      const taskId = result?.[0]?.id || result?.id;
      this.taskIdMap[taskName] = taskId;
      console.log("Task synced to Supabase:", taskName, taskId);
    } catch (error) {
      console.error("Failed to sync task to Supabase:", error);
    }
  }

  /**
   * Remove task by index
   */
  removeTask(taskIdx) {
    const taskName = this.tasks[taskIdx];
    const taskId = this.taskIdMap[taskName];

    this.tasks.splice(taskIdx, 1);
    this.gridData.splice(taskIdx, 1);
    delete this.taskIdMap[taskName];

    this.renderGrid();
    this.updateSummary();
    this.updateTaskCount();
    this.saveToLocalStorage();

    // Delete from Supabase asynchronously
    if (this.sessionId && taskId) {
      this.trackPendingWrite(this.deleteTaskFromSupabase(taskId));
    }
  }

  /**
   * Delete task from Supabase
   */
  async deleteTaskFromSupabase(taskId) {
    try {
      await this.db.deleteTask(this.sessionId, taskId);
      console.log("Task deleted from Supabase:", taskId);
    } catch (error) {
      console.error("Failed to delete task from Supabase:", error);
    }
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
   * Calculate and display end time, elapsed time, and current interval
   */
  updateTimeCalculations() {
    const startTimeInput = document.getElementById("startTimeInput")?.value;
    const dateInput = document.getElementById("dateInput")?.value;

    if (!startTimeInput) {
      // No start time set
      document.getElementById("endTimeDisplay").textContent = "--:--";
      document.getElementById("elapsedDisplay").textContent = "0h 0m";
      document.getElementById("currentIntervalDisplay").textContent = "-";
      return;
    }

    // Parse start time
    const [startHour, startMin] = startTimeInput.split(":").map(Number);
    const startDate = new Date(
      dateInput || new Date().toISOString().split("T")[0],
    );
    startDate.setHours(startHour, startMin, 0, 0);

    // Calculate end time (start + 15 hours)
    const endDate = new Date(startDate);
    endDate.setHours(endDate.getHours() + 15);

    // Display end time
    const endHour = String(endDate.getHours()).padStart(2, "0");
    const endMin = String(endDate.getMinutes()).padStart(2, "0");
    document.getElementById("endTimeDisplay").textContent =
      `${endHour}:${endMin}`;

    // Calculate elapsed time since start
    const now = new Date();
    const elapsed = now - startDate;
    const elapsedMinutes = Math.floor(elapsed / (1000 * 60));
    const elapsedHours = Math.floor(elapsedMinutes / 60);
    const elapsedMins = elapsedMinutes % 60;
    document.getElementById("elapsedDisplay").textContent =
      `${elapsedHours}h ${elapsedMins}m`;

    // Calculate current interval (0-59)
    // Each interval is 15 minutes
    const intervalsElapsed = Math.floor(elapsedMinutes / 15);
    const currentInterval = Math.min(intervalsElapsed, 59); // Cap at 59 (60 intervals total, 0-59)

    if (elapsedMinutes < 0) {
      // Start time is in the future
      document.getElementById("currentIntervalDisplay").textContent =
        "Not started";
    } else if (intervalsElapsed >= 60) {
      // Tracking complete or exceeded
      document.getElementById("currentIntervalDisplay").textContent =
        "Complete";
    } else {
      // Show current interval (1-indexed for display)
      const intervalNum = currentInterval + 1;
      const intervalHour = Math.floor(currentInterval / 4) + 1;
      const intervalInHour = (currentInterval % 4) + 1;
      document.getElementById("currentIntervalDisplay").textContent =
        `${intervalNum} (Hour ${intervalHour}.${intervalInHour})`;
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

      // Task name cell with checkboxes and remove button
      const taskCell = document.createElement("td");
      taskCell.className = "task-name-cell";

      // 3 checkboxes for task status
      const checkboxes = document.createElement("span");
      checkboxes.className = "task-checkboxes";
      for (let i = 0; i < 3; i++) {
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.className = "task-checkbox";
        checkbox.title = `Status ${i + 1}`;
        checkboxes.appendChild(checkbox);
      }

      taskCell.appendChild(checkboxes);
      taskCell.appendChild(document.createTextNode(taskName));

      // Remove button
      const removeBtn = document.createElement("span");
      removeBtn.className = "task-remove";
      removeBtn.textContent = "×";
      removeBtn.title = "Remove task";
      removeBtn.addEventListener("click", () => this.removeTask(taskIdx));
      taskCell.appendChild(removeBtn);

      row.appendChild(taskCell);

      // 60 interval cells with circles
      for (let intervalIdx = 0; intervalIdx < 60; intervalIdx++) {
        const hourIdx = Math.floor(intervalIdx / 4);

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

    this.saveToLocalStorage();
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
    });
    this.pendingWrites.add(pending);
    return pending;
  }

  async waitForPendingWrites() {
    while (this.pendingWrites.size > 0) {
      await Promise.all([...this.pendingWrites]);
    }
  }

  async syncAndReloadFromSupabase() {
    const button = document.getElementById("syncReloadBtn");
    if (this.isFullSyncing) return;
    if (!hasSupabaseConfig()) {
      window.showSupabaseSetupModal?.("Configure Supabase before syncing.");
      return;
    }

    this.isFullSyncing = true;
    if (button) {
      button.disabled = true;
      button.textContent = "Syncing...";
    }

    try {
      if (this.sessionInitialization) await this.sessionInitialization;
      if (!this.sessionId) await this.initializeSession();
      if (!this.sessionId) throw new Error("No Supabase session is available.");

      await this.waitForPendingWrites();

      this.startTime = document.getElementById("startTimeInput")?.value || "";
      this.memo = document.getElementById("memoInput")?.value || "";
      this.date = document.getElementById("dateInput")?.value || this.date;
      this.notes = document.getElementById("notesInput")?.value || "";
      await this.db.updateSession(this.sessionId, {
        start_time: this.startTime || null,
        memo: this.memo || null,
        date: this.date,
        notes: this.notes || null,
      });

      const session = await this.db.getSession(this.sessionId);
      if (!session)
        throw new Error("The Supabase session could not be loaded.");

      const remoteTasks = session.tasks || [];
      const usedTaskIds = new Set();
      const nextTaskIdMap = {};

      for (const taskName of this.tasks) {
        const knownId = this.taskIdMap[taskName];
        let remoteTask = remoteTasks.find(
          (task) =>
            String(task.id) === String(knownId) &&
            !usedTaskIds.has(String(task.id)),
        );
        if (!remoteTask) {
          remoteTask = remoteTasks.find(
            (task) =>
              task.name === taskName && !usedTaskIds.has(String(task.id)),
          );
        }

        let taskId = remoteTask?.id;
        if (!taskId) {
          const createdTask = await this.db.createTask(this.sessionId, {
            name: taskName,
            duration_minutes: 0,
          });
          taskId = createdTask?.id || createdTask?.[0]?.id;
          if (!taskId) throw new Error(`Could not sync task "${taskName}".`);
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

      const existingIntervals = await this.db.getSessionIntervals(
        this.sessionId,
      );
      const desiredIntervals = new Map();
      this.tasks.forEach((taskName, taskIndex) => {
        const taskId = this.taskIdMap[taskName];
        for (let intervalIndex = 0; intervalIndex < 60; intervalIndex++) {
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
      this.lastSyncTime = new Date().toISOString();
      if (button) button.textContent = "Synced";
      window.setTimeout(() => {
        if (button) button.textContent = "Sync & Reload";
      }, 1500);
    } catch (error) {
      console.error("Failed to sync and reload from Supabase:", error);
      alert(`Sync failed: ${error.message || "Unknown Supabase error"}`);
    } finally {
      this.isFullSyncing = false;
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
    const taskName = this.tasks[taskIdx];
    const taskId = this.taskIdMap[taskName];

    if (!taskId) {
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
      console.log(
        `Interval ${intervalIdx} for task ${taskName} synced (filled=${isFilled})`,
      );
    } catch (error) {
      console.error("Failed to sync interval to Supabase:", error);
    }
  }

  /**
   * Auto-fill: Copy Hour 1 (intervals 0-3) pattern to all other hours
   */
  autoFillHour1() {
    const hour1Pattern = [
      this.gridData.map((row) => row[0]),
      this.gridData.map((row) => row[1]),
      this.gridData.map((row) => row[2]),
      this.gridData.map((row) => row[3]),
    ];

    // Check if Hour 1 has any data
    const hasData = hour1Pattern.some((interval) => interval.some((v) => v));

    if (!hasData) {
      alert(
        "Hour 1 is empty. Fill in at least one task interval in Hour 1 first.",
      );
      return;
    }

    // Apply pattern to remaining 14 hours
    for (let hour = 1; hour < 15; hour++) {
      for (let intervalInHour = 0; intervalInHour < 4; intervalInHour++) {
        const sourceIntervalIdx = intervalInHour;
        const targetIntervalIdx = hour * 4 + intervalInHour;

        for (let taskIdx = 0; taskIdx < this.tasks.length; taskIdx++) {
          this.gridData[taskIdx][targetIntervalIdx] =
            this.gridData[taskIdx][sourceIntervalIdx];
        }
      }
    }

    this.renderGrid();
    this.updateSummary();
    alert("✅ Pattern from Hour 1 has been applied to all remaining hours!");
  }

  /**
   * Clear all grid data (but keep tasks)
   */
  clearGrid() {
    if (!confirm("Clear all interval assignments? (Tasks will remain)")) return;

    this.gridData = this.tasks.map(() => new Array(60).fill(false));
    this.renderGrid();
    this.updateSummary();
  }

  /**
   * Update summary with interval counts and time breakdowns per task
   */
  updateSummary() {
    const summaryContent = document.getElementById("summaryContent");
    summaryContent.innerHTML = "";

    let hasData = false;

    this.tasks.forEach((taskName, taskIdx) => {
      const intervalCount = this.gridData[taskIdx].filter((v) => v).length;

      if (intervalCount > 0) {
        hasData = true;
        const minutes = intervalCount * 15;
        const hours = Math.floor(minutes / 60);
        const mins = minutes % 60;

        let timeStr = "";
        if (hours > 0) {
          timeStr = `${hours}h ${mins}m`;
        } else {
          timeStr = `${mins}m`;
        }

        const item = document.createElement("div");
        item.className = "summary-item";

        const titleEl = document.createElement("div");
        titleEl.className = "task-title";
        titleEl.textContent = taskName;
        item.appendChild(titleEl);

        const statsEl = document.createElement("div");
        statsEl.className = "task-stats";
        statsEl.innerHTML = `<strong>${intervalCount}</strong> intervals = <strong>${timeStr}</strong>`;
        item.appendChild(statsEl);

        summaryContent.appendChild(item);
      }
    });

    if (!hasData) {
      summaryContent.innerHTML =
        '<div class="summary-item empty">No time tracked yet</div>';
    }
  }

  /**
   * Export grid as CSV
   */
  exportCSV() {
    const date = document.getElementById("dateInput")?.value || this.date;
    const startTime =
      document.getElementById("startTimeInput")?.value || this.startTime;

    let csv = "TASK,INTERVALS,MINUTES,TIME\n";

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

      csv += `"${taskName}",${intervalCount},${minutes},"${timeStr}"\n`;
    });

    // Add metadata
    csv += `\n\nMETADATA\n`;
    csv += `Date,${date}\n`;
    csv += `Start Time,${startTime}\n`;
    csv += `Memo,"${document.getElementById("memoInput")?.value || ""}"\n`;

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

  /**
   * Clear all tasks and grid
   */
  clearAll() {
    if (!confirm("This will delete all tasks and grid assignments. Continue?"))
      return;

    this.tasks = [];
    this.gridData = [];
    this.renderGrid();
    this.updateSummary();
    this.updateTaskCount();
  }

  /**
   * Timer: Start
   */
  timerStart() {
    if (this.timerState.isRunning) return;

    this.timerState.isRunning = true;
    document.getElementById("startBtn").disabled = true;
    document.getElementById("pauseBtn").disabled = false;

    const interval = setInterval(() => {
      this.timerState.timeRemaining--;
      this.updateTimerDisplay();

      if (this.timerState.timeRemaining <= 0) {
        clearInterval(interval);
        this.timerState.isRunning = false;
        this.timerState.timeRemaining = 0;
        this.timerState.currentInterval++;
        alert("⏰ Time interval complete! Move to next task.");
        this.updateTimerDisplay();
        document.getElementById("startBtn").disabled = false;
        document.getElementById("pauseBtn").disabled = true;
      }
    }, 1000);

    this.timerState.intervalHandle = interval;
  }

  /**
   * Timer: Pause
   */
  timerPause() {
    if (this.timerState.intervalHandle) {
      clearInterval(this.timerState.intervalHandle);
    }
    this.timerState.isRunning = false;
    document.getElementById("startBtn").disabled = false;
    document.getElementById("pauseBtn").disabled = true;
  }

  /**
   * Timer: Reset
   */
  timerReset() {
    if (this.timerState.intervalHandle) {
      clearInterval(this.timerState.intervalHandle);
    }
    this.timerState.isRunning = false;
    this.timerState.timeRemaining = this.timerState.totalTime;
    this.timerState.currentInterval = 0;
    this.updateTimerDisplay();
    document.getElementById("startBtn").disabled = false;
    document.getElementById("pauseBtn").disabled = true;
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

  /**
   * Save state to localStorage
   */
  saveToLocalStorage() {
    // Save form inputs
    this.startTime = document.getElementById("startTimeInput")?.value || "";
    this.memo = document.getElementById("memoInput")?.value || "";
    this.date = document.getElementById("dateInput")?.value || this.date;
    this.notes = document.getElementById("notesInput")?.value || "";

    const state = {
      tasks: this.tasks,
      gridData: this.gridData,
      sessionId: this.sessionId,
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
    if (this.isSyncing || !this.sessionId) return;

    this.isSyncing = true;

    try {
      // Save latest form values
      this.startTime = document.getElementById("startTimeInput")?.value || "";
      this.memo = document.getElementById("memoInput")?.value || "";
      this.date = document.getElementById("dateInput")?.value || this.date;
      this.notes = document.getElementById("notesInput")?.value || "";

      const sessionData = {
        start_time: this.startTime || null,
        memo: this.memo || null,
        date: this.date,
        notes: this.notes || null,
      };

      await this.db.updateSession(this.sessionId, sessionData);
      this.lastSyncTime = new Date().toISOString();
      console.log("Session synced to Supabase at", this.lastSyncTime);
    } catch (error) {
      console.error("Failed to sync session to Supabase:", error);
    } finally {
      this.isSyncing = false;
    }
  }

  /**
   * Load state from localStorage
   */
  loadFromLocalStorage() {
    const saved = localStorage.getItem("ettGridState");
    if (saved) {
      try {
        const state = JSON.parse(saved);
        this.tasks = state.tasks || [];
        this.gridData = state.gridData || [];
        this.sessionId = state.sessionId;
        this.startTime = state.startTime || "";
        this.memo = state.memo || "";
        this.date = state.date || new Date().toISOString().split("T")[0];
        this.notes = state.notes || "";

        // Restore form fields
        const startTimeInput = document.getElementById("startTimeInput");
        const memoInput = document.getElementById("memoInput");
        const dateInput = document.getElementById("dateInput");
        const notesInput = document.getElementById("notesInput");

        if (startTimeInput) startTimeInput.value = this.startTime;
        if (memoInput) memoInput.value = this.memo;
        if (dateInput) dateInput.value = this.date;
        if (notesInput) notesInput.value = this.notes;

        // Initialize grid data for tasks if not present
        if (this.gridData.length < this.tasks.length) {
          for (let i = this.gridData.length; i < this.tasks.length; i++) {
            this.gridData.push(new Array(60).fill(false));
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
  async setupSupabase() {
    this.db = getSupabaseClient();
    if (!hasSupabaseConfig()) {
      console.error("Supabase credentials are not configured");
      return;
    }

    this.sessionInitialization = this.initializeSession();
    await this.sessionInitialization;
  }
}

/**
 * Initialize tracker when DOM is ready
 */
document.addEventListener("DOMContentLoaded", () => {
  window.tracker = new GridTaskTracker();
});
