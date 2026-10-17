/**
 * Emergent Task Tracker - Main App Logic
 * Handles timer, tasks, local storage, API sync
 */

class EmergenTaskTracker {
  constructor() {
    this.api = new APIClient("http://localhost:3000/api");
    this.sessionId = null;
    this.currentTaskName = "";
    this.timerInterval = null;
    this.timeRemaining = 15 * 60; // 15 minutes in seconds
    this.intervalCount = 0;
    this.tasks = []; // Array of { name, duration_minutes, completedAt }
    this.isInitializing = false;

    this.initializeUI();
    this.loadFromLocalStorage();
    this.initializeSession();
  }

  async initializeSession() {
    // Create a new session if one doesn't exist
    if (!this.sessionId) {
      try {
        this.isInitializing = true;
        const sessionData = {
          status: "active",
        };
        const response = await this.api.createSession(sessionData);
        this.sessionId = response.id;
        this.updateConnectionStatus(true);
        console.log("Session created:", this.sessionId);
        this.saveToLocalStorage();
      } catch (error) {
        console.error("Failed to create session:", error);
        this.updateConnectionStatus(false);
      } finally {
        this.isInitializing = false;
      }
    }
  }

  initializeUI() {
    this.elements = {
      timerDisplay: document.getElementById("timerDisplay"),
      startBtn: document.getElementById("startBtn"),
      pauseBtn: document.getElementById("pauseBtn"),
      resetBtn: document.getElementById("resetBtn"),
      taskInput: document.getElementById("taskInput"),
      logTaskBtn: document.getElementById("logTaskBtn"),
      bubbleGrid: document.getElementById("bubbleGrid"),
      summaryContent: document.getElementById("summaryContent"),
      exportBtn: document.getElementById("exportBtn"),
    };

    // Generate 15 bubbles
    for (let i = 1; i <= 15; i++) {
      const bubble = document.createElement("div");
      bubble.className = "bubble";
      bubble.textContent = i;
      bubble.dataset.interval = i;
      bubble.addEventListener("click", () => this.toggleBubble(i));
      this.elements.bubbleGrid.appendChild(bubble);
    }

    // Event listeners
    this.elements.startBtn.addEventListener("click", () => this.startTimer());
    this.elements.pauseBtn.addEventListener("click", () => this.pauseTimer());
    this.elements.resetBtn.addEventListener("click", () => this.resetTimer());
    this.elements.logTaskBtn.addEventListener("click", () => this.logTask());
    this.elements.exportBtn.addEventListener("click", () => this.exportCSV());

    this.updateTimerDisplay();
    this.updateSummary();
  }

  updateConnectionStatus(connected) {
    const statusText = connected ? "Connected to backend" : "Offline mode";

    // Update button visibility/state
    if (!connected) {
      // Disable certain features in offline mode if needed
    }

    console.log(`API Status: ${statusText}`);
  }

  startTimer() {
    if (this.timerInterval) return; // Already running

    this.elements.startBtn.disabled = true;
    this.elements.pauseBtn.disabled = false;

    this.timerInterval = setInterval(() => {
      this.timeRemaining--;
      this.updateTimerDisplay();

      if (this.timeRemaining <= 0) {
        this.completeInterval();
      }
    }, 1000);

    this.saveToLocalStorage();
  }

  pauseTimer() {
    clearInterval(this.timerInterval);
    this.timerInterval = null;

    this.elements.startBtn.disabled = false;
    this.elements.pauseBtn.disabled = true;

    this.saveToLocalStorage();
  }

  resetTimer() {
    this.pauseTimer();
    this.timeRemaining = 15 * 60;
    this.updateTimerDisplay();
    this.saveToLocalStorage();
  }

  completeInterval() {
    this.pauseTimer();
    this.intervalCount++;

    // Mark bubble as completed
    const bubble = document.querySelector(
      `[data-interval="${this.intervalCount}"]`,
    );
    if (bubble) {
      bubble.classList.add("completed");
    }

    // Update backend task with new duration
    if (this.sessionId && this.tasks.length > 0) {
      this.updateTaskDuration();
    }

    this.updateSummary();
    this.saveToLocalStorage();

    // Auto-restart
    setTimeout(() => {
      this.resetTimer();
      this.startTimer();
    }, 1000);
  }

  toggleBubble(intervalNum) {
    const bubble = document.querySelector(`[data-interval="${intervalNum}"]`);
    bubble.classList.toggle("active");
    this.saveToLocalStorage();
  }

  logTask() {
    const taskName = this.elements.taskInput.value.trim();
    if (!taskName) {
      alert("Please enter a task name");
      return;
    }

    this.currentTaskName = taskName;
    this.tasks.push({
      name: taskName,
      duration_minutes: 0,
      started_at: new Date().toISOString(),
      id: null, // Will be populated after API sync
    });

    this.elements.taskInput.value = "";
    this.updateSummary();
    this.saveToLocalStorage();

    // Sync to API if connected (session ready)
    if (this.sessionId && !this.isInitializing) {
      this.syncTask(taskName);
    } else if (!this.sessionId) {
      console.warn(
        "Session not ready yet, task will sync when backend connects",
      );
    }
  }

  updateTimerDisplay() {
    const minutes = Math.floor(this.timeRemaining / 60);
    const seconds = this.timeRemaining % 60;
    this.elements.timerDisplay.textContent = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  updateSummary() {
    if (this.tasks.length === 0) {
      this.elements.summaryContent.innerHTML =
        '<p style="color: #999;">No tasks logged yet.</p>';
      return;
    }

    let html = "";
    this.tasks.forEach((task, idx) => {
      const intervalsDone =
        this.intervalCount > 0
          ? Math.ceil(
              ((idx + 1) / (this.tasks.length || 1)) * this.intervalCount,
            )
          : 0;
      html += `
                <div class="summary-item">
                    <span class="task-name">${task.name}</span>
                    <span class="task-time">${intervalsDone} × 15 min</span>
                </div>
            `;
    });

    this.elements.summaryContent.innerHTML = html;
  }

  async syncTask(taskName) {
    try {
      const taskData = {
        name: taskName,
        duration_minutes: 0,
      };
      const result = await this.api.createTask(this.sessionId, taskData);
      // Store the task ID for later updates
      const currentTask = this.tasks[this.tasks.length - 1];
      if (currentTask && result.id) {
        currentTask.id = result.id;
      }
      console.log("Task synced:", result);
    } catch (error) {
      console.error("Failed to sync task:", error);
    }
  }

  async updateTaskDuration() {
    if (!this.tasks.length || !this.sessionId) return;

    try {
      const currentTask = this.tasks[this.tasks.length - 1];
      if (!currentTask.id) {
        console.log("Task not yet synced to backend, skipping duration update");
        return;
      }

      // Update duration: each interval is 15 minutes
      const duration = this.intervalCount * 15;
      const taskData = { duration_minutes: duration };

      const result = await this.api.updateTask(
        this.sessionId,
        currentTask.id,
        taskData,
      );
      console.log("Task duration updated:", result);
    } catch (error) {
      console.error("Failed to update task duration:", error);
    }
  }

  exportCSV() {
    if (this.tasks.length === 0) {
      alert("No tasks to export");
      return;
    }

    const headers = ["Task", "Intervals (15 min each)", "Total Time"];
    const rows = this.tasks.map((task, idx) => {
      const intervalsDone = Math.ceil(
        ((idx + 1) / this.tasks.length) * this.intervalCount,
      );
      const minutes = intervalsDone * 15;
      return [task.name, intervalsDone, `${minutes} min`];
    });

    const csvContent = [
      headers.join(","),
      ...rows.map((row) => row.map((cell) => `"${cell}"`).join(",")),
    ].join("\n");

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute(
      "download",
      `ett-session-${new Date().toISOString().split("T")[0]}.csv`,
    );
    link.style.visibility = "hidden";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  saveToLocalStorage() {
    const state = {
      sessionId: this.sessionId,
      currentTaskName: this.currentTaskName,
      timeRemaining: this.timeRemaining,
      intervalCount: this.intervalCount,
      tasks: this.tasks, // Now includes task IDs
      bubbles: Array.from(document.querySelectorAll(".bubble.completed")).map(
        (b) => parseInt(b.dataset.interval),
      ),
    };
    localStorage.setItem("ettState", JSON.stringify(state));
  }

  loadFromLocalStorage() {
    const saved = localStorage.getItem("ettState");
    if (!saved) return;

    const state = JSON.parse(saved);
    this.sessionId = state.sessionId;
    this.currentTaskName = state.currentTaskName;
    this.timeRemaining = state.timeRemaining;
    this.intervalCount = state.intervalCount;
    this.tasks = state.tasks;

    // Restore bubble states
    if (state.bubbles) {
      state.bubbles.forEach((intervalNum) => {
        const bubble = document.querySelector(
          `[data-interval="${intervalNum}"]`,
        );
        if (bubble) bubble.classList.add("completed");
      });
    }

    this.updateTimerDisplay();
    this.updateSummary();

    // If we have a sessionId, validate it still exists in backend
    if (this.sessionId) {
      this.validateSession();
    }
  }

  async validateSession() {
    try {
      const session = await this.api.getSession(this.sessionId);
      console.log("Session validated:", session.id);
      this.updateConnectionStatus(true);
    } catch (error) {
      console.log("Session no longer valid, will create new one");
      this.sessionId = null;
      this.saveToLocalStorage();
    }
  }
}

// Initialize when DOM is ready
document.addEventListener("DOMContentLoaded", () => {
  window.app = new EmergenTaskTracker();
});
