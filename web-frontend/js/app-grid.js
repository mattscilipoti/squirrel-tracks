/**
 * GridTaskTracker - Circle/bubble-based task time tracker
 * Implements a 15-hour × 60-interval grid matching the paper Emergent Task Timer
 * Each circle represents whether a task was done during that 15-minute interval
 */
class GridTaskTracker {
  constructor() {
    this.tasks = [];
    this.gridData = []; // 2D array: tasks[taskIdx][intervalIdx] = true/false (filled or not)
    this.sessionId = null;
    this.startTime = "";
    this.memo = "";
    this.date = new Date().toISOString().split("T")[0];
    this.notes = "";

    this.timerState = {
      isRunning: false,
      timeRemaining: 15 * 60, // 15 minutes in seconds
      totalTime: 15 * 60,
      currentInterval: 0,
    };

    this.initializeUI();
    this.loadFromLocalStorage();
    this.renderGrid();
    this.bindEvents();
    this.updateTaskCount();
    this.updateTimeCalculations();
    
    // Update time calculations every minute
    setInterval(() => this.updateTimeCalculations(), 60000);
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
  }

  /**
   * Remove task by index
   */
  removeTask(taskIdx) {
    this.tasks.splice(taskIdx, 1);
    this.gridData.splice(taskIdx, 1);
    this.renderGrid();
    this.updateSummary();
    this.updateTaskCount();
    this.saveToLocalStorage();
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
    const startDate = new Date(dateInput || new Date().toISOString().split("T")[0]);
    startDate.setHours(startHour, startMin, 0, 0);

    // Calculate end time (start + 15 hours)
    const endDate = new Date(startDate);
    endDate.setHours(endDate.getHours() + 15);

    // Display end time
    const endHour = String(endDate.getHours()).padStart(2, "0");
    const endMin = String(endDate.getMinutes()).padStart(2, "0");
    document.getElementById("endTimeDisplay").textContent = `${endHour}:${endMin}`;

    // Calculate elapsed time since start
    const now = new Date();
    const elapsed = now - startDate;
    const elapsedMinutes = Math.floor(elapsed / (1000 * 60));
    const elapsedHours = Math.floor(elapsedMinutes / 60);
    const elapsedMins = elapsedMinutes % 60;
    document.getElementById(
      "elapsedDisplay"
    ).textContent = `${elapsedHours}h ${elapsedMins}m`;

    // Calculate current interval (0-59)
    // Each interval is 15 minutes
    const intervalsElapsed = Math.floor(elapsedMinutes / 15);
    const currentInterval = Math.min(
      intervalsElapsed,
      59
    ); // Cap at 59 (60 intervals total, 0-59)

    if (elapsedMinutes < 0) {
      // Start time is in the future
      document.getElementById("currentIntervalDisplay").textContent =
        "Not started";
    } else if (intervalsElapsed >= 60) {
      // Tracking complete or exceeded
      document.getElementById("currentIntervalDisplay").textContent = "Complete";
    } else {
      // Show current interval (1-indexed for display)
      const intervalNum = currentInterval + 1;
      const intervalHour = Math.floor(currentInterval / 4) + 1;
      const intervalInHour = (currentInterval % 4) + 1;
      document.getElementById("currentIntervalDisplay").textContent = `${intervalNum} (Hour ${intervalHour}.${intervalInHour})`;
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
}

/**
 * Initialize tracker when DOM is ready
 */
document.addEventListener("DOMContentLoaded", () => {
  window.tracker = new GridTaskTracker();
});
