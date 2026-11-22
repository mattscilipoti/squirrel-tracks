/**
 * GridTaskTracker - Circle/bubble-based task time tracker
 * Implements a 24-hour grid of 15-minute intervals.
 * Data lives in a DataStore (a Yjs document persisted in IndexedDB). This class keeps
 * the selected day in memory for rendering and writes every edit through to the store.
 */
class GridTaskTracker {
  constructor(store, sync = null, github = null) {
    this.store = store;
    this.sync = sync;
    this.github = github;
    const storedSyncTime = localStorage.getItem("ettLastSyncTime");
    this.lastSyncTime =
      storedSyncTime && !Number.isNaN(Date.parse(storedSyncTime)) ? storedSyncTime : null;
    this.tasks = [];
    this.taskIds = [];
    this.taskCatalog = [];
    this.gridData = []; // 2D array: tasks[taskIdx][intervalIdx] = true/false (filled or not)
    this.startTime = "";
    this.memo = "";
    this.date = TimeCalculations.localDate(new Date());
    this.followToday = true;
    this.notes = "";
    this.autoCenterPausedUntil = 0;
    this.autoCenterScrollLeft = null;

    this.timerState = {
      isRunning: true,
      timeRemaining: 15 * 60, // 15 minutes in seconds
      totalTime: 15 * 60,
      currentInterval: 0,
    };

    this.initializeUI();
    this.loadDeviceState();
    this.loadDay(this.date);
    this.rolloverDailySession();
    this.initializeReminder();
    this.updateDateControl();
    this.renderGrid();
    this.bindEvents();
    this.updateTaskCount();
    this.updateSummary();
    this.updateTimeCalculations();
    this.updateTaskPicker();
    this.renderSyncStatus();
    this.initializeSquirrelTrails();
    this.store.onRemoteChange((origin) => {
      if (origin !== "import") this.recordSyncTime();
      this.scheduleRemoteRefresh();
    });
    this.sync?.onChange(() => {
      this.renderSyncStatus();
      this.renderPairDialog();
    });
    this.github?.onChange(() => {
      if (this.github.lastSuccess) this.recordSyncTime(this.github.lastSuccess);
      else this.renderSyncStatus();
      this.renderGithubDialog();
    });
    window.addEventListener?.("online", () => this.renderSyncStatus());
    window.addEventListener?.("offline", () => this.renderSyncStatus());

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
    setInterval(() => {
      if (this.autoCenterPausedUntil && !this.updateAutoCenterStatus()) {
        this.resumeAutoCentering();
      }
    }, 1000);
  }

  renderSyncStatus() {
    const status = document.getElementById("syncStatus");
    const statusIcon = document.getElementById("syncStatusIcon");
    const statusText = document.getElementById("syncStatusText");
    const lastSync = document.getElementById("lastCloudSync");
    if (!status || !statusIcon || !statusText || !lastSync) return;
    const { state, icon, message } = this.syncStatusInfo();
    status.dataset.state = state;
    statusIcon.textContent = icon;
    statusText.textContent = message;
    if (this.lastSyncTime) {
      lastSync.dateTime = this.lastSyncTime;
      lastSync.textContent = new Date(this.lastSyncTime).toLocaleString();
      lastSync.title = this.lastSyncTime;
    } else {
      lastSync.removeAttribute("datetime");
      lastSync.textContent = "Never";
      lastSync.removeAttribute("title");
    }
  }

  /** Footer status: GitHub problems first, then live peers, then GitHub's own state. */
  syncStatusInfo() {
    const github = this.github?.status();
    const peers = this.sync?.isPaired() ? this.sync.peerCount : 0;
    if (github?.state === "error")
      return { state: "error", icon: "⚠", message: github.message };
    if (github?.state === "needs-token")
      return { state: "needs-token", icon: "⚠", message: github.message };
    if (peers > 0 || !github || github.state === "off") return this.peerStatusInfo();
    if (github.state === "offline")
      return {
        state: "offline",
        icon: "⚠",
        message: "Offline: changes will sync when reconnected",
      };
    if (github.state === "syncing")
      return { state: "syncing", icon: "↻", message: github.message };
    return { state: "synced", icon: "✓", message: github.message };
  }

  /** Status of live device-to-device pairing alone. */
  peerStatusInfo() {
    if (!this.sync?.isPaired())
      return { state: "local-only", icon: "✓", message: "Saved on this device" };
    if (globalThis.navigator?.onLine === false)
      return {
        state: "offline",
        icon: "⚠",
        message: "Offline: changes will sync when reconnected",
      };
    const peers = this.sync.peerCount;
    if (peers > 0)
      return {
        state: "synced",
        icon: "✓",
        message: `Syncing with ${peers} other device${peers === 1 ? "" : "s"}`,
      };
    const health = this.sync.health();
    if (health === "no-server")
      return {
        state: "needs-server",
        icon: "⚠",
        message:
          "Paired, but no signaling server is set: other devices can't find this one",
      };
    if (health === "unreachable")
      return {
        state: "error",
        icon: "⚠",
        message: "Can't reach the signaling server: check its address in Live pairing",
      };
    return {
      state: "waiting",
      icon: "↻",
      message: "Paired: open the app on another device to sync",
    };
  }

  /** Remember when another device last sent us changes. */
  recordSyncTime(now = new Date()) {
    this.lastSyncTime = now.toISOString();
    localStorage.setItem("ettLastSyncTime", this.lastSyncTime);
    this.renderSyncStatus();
  }

  // ── GitHub sync dialog ──────────────────────────────────────────────────────

  openGithubDialog() {
    document.getElementById("githubModal").classList.remove("hidden");
    this.renderGithubDialog();
  }

  closeGithubDialog() {
    document.getElementById("githubModal").classList.add("hidden");
    document.getElementById("githubToken").value = "";
  }

  renderGithubDialog() {
    const dialog = document.getElementById("githubModal");
    if (!dialog || dialog.classList.contains("hidden") || !this.github) return;
    const settings = this.github.settings;
    const connected = Boolean(settings?.token);
    document.getElementById("githubSetup").hidden = connected;
    document.getElementById("githubConnected").hidden = !connected;
    document.getElementById("githubPublicWarning").hidden = !this.githubPublic;
    document.getElementById("githubJoinNote").hidden = !(settings && !settings.token);
    if (!connected) {
      const repoInput = document.getElementById("githubRepo");
      if (settings && !repoInput.value) repoInput.value = settings.repo;
      return;
    }
    document.getElementById("githubRepoName").textContent = settings.repo;
    document.getElementById("githubStatus").textContent = this.github.status().message;
    const last = this.github.lastSuccess;
    document.getElementById("githubLastSync").textContent = last
      ? `Last synced ${last.toLocaleString()}`
      : "Not synced yet";
    document.getElementById("githubLink").value =
      this.github.link(`${location.origin}${location.pathname}`) || "";
  }

  async connectGithub() {
    const error = document.getElementById("githubError");
    const button = document.getElementById("githubSaveBtn");
    const token = document.getElementById("githubToken");
    error.hidden = true;
    button.disabled = true;
    try {
      const result = await this.github.connect({
        repo: document.getElementById("githubRepo").value,
        token: token.value,
      });
      this.githubPublic = !result.private;
      token.value = "";
    } catch (problem) {
      error.textContent = problem.message || "Could not connect to GitHub.";
      error.hidden = false;
    } finally {
      button.disabled = false;
      this.renderSyncStatus();
      this.renderGithubDialog();
    }
  }

  async copyGithubLink() {
    const input = document.getElementById("githubLink");
    try {
      await navigator.clipboard.writeText(input.value);
    } catch {
      input.select();
    }
  }

  async githubSyncNow() {
    await this.github.sync();
  }

  disconnectGithub() {
    if (
      !confirm(
        "Disconnect this device from GitHub? Your data stays here, but it will stop syncing. The repository and other devices are not changed.",
      )
    )
      return;
    this.github.disconnect();
    this.githubPublic = false;
    this.renderSyncStatus();
    this.renderGithubDialog();
  }

  // ── Pairing dialog ──────────────────────────────────────────────────────────

  openPairDialog() {
    this.renderPairDialog();
    document.getElementById("pairModal").classList.remove("hidden");
  }

  closePairDialog() {
    document.getElementById("pairModal").classList.add("hidden");
  }

  pairLink() {
    return this.sync?.link(`${location.origin}${location.pathname}`) || "";
  }

  renderPairDialog() {
    const dialog = document.getElementById("pairModal");
    if (!dialog || dialog.classList.contains("hidden")) return;
    const paired = Boolean(this.sync?.isPaired());
    document.getElementById("pairUnpaired").hidden = paired;
    document.getElementById("pairPaired").hidden = !paired;
    if (!paired) return;
    const link = this.pairLink();
    const linkInput = document.getElementById("pairLink");
    if (linkInput.value !== link) {
      linkInput.value = link;
      this.renderPairQr(link);
    }
    document.getElementById("pairStatus").textContent = this.peerStatusInfo().message;
    const signalingInput = document.getElementById("pairSignaling");
    if (document.activeElement !== signalingInput)
      signalingInput.value = this.sync.pairing.signaling?.join(", ") || "";
    const needsServer = this.sync.health() === "no-server";
    document.getElementById("pairWarning").hidden = !needsServer;
    if (needsServer) document.getElementById("pairServerSettings").open = true;
    this.renderPairDetails();
  }

  /** The "Sync details" list: everything needed to tell why devices are not connecting. */
  renderPairDetails() {
    const details = this.sync.details();
    const list = document.getElementById("pairDetails");
    if (!details || !list) return;
    const rows = [
      ["Pairing code", `${details.room.slice(0, 8)}… (must match on every device)`],
      ...(details.servers.length
        ? details.servers.map((server) => [
            "Signaling server",
            `${server.url}: ${server.connected ? "connected" : "not connected"}`,
          ])
        : [["Signaling server", "none set"]]),
      ["Other devices connected", String(details.devices)],
      ["Other tabs in this browser", String(details.tabs)],
    ];
    list.replaceChildren();
    for (const [term, value] of rows) {
      const dt = document.createElement("dt");
      dt.textContent = term;
      const dd = document.createElement("dd");
      dd.textContent = value;
      list.append(dt, dd);
    }
  }

  renderPairQr(link) {
    const target = document.getElementById("pairQr");
    target.replaceChildren();
    if (typeof qrcode === "undefined") return;
    try {
      const code = qrcode(0, "M");
      code.addData(link);
      code.make();
      target.innerHTML = code.createSvgTag({ scalable: true });
      target.firstElementChild?.setAttribute("role", "img");
      target.firstElementChild?.setAttribute("aria-label", "QR code of the pairing link");
    } catch (error) {
      console.warn("Could not draw the pairing QR code:", error);
    }
  }

  createPairing() {
    this.sync.createPairing();
    this.renderSyncStatus();
    this.renderPairDialog();
  }

  async copyPairLink() {
    const input = document.getElementById("pairLink");
    try {
      await navigator.clipboard.writeText(input.value);
    } catch {
      input.select();
    }
  }

  savePairSignaling() {
    const text = document.getElementById("pairSignaling").value;
    const urls = text
      .split(/[\s,]+/)
      .map((url) => url.trim())
      .filter(Boolean);
    try {
      this.sync.setSignaling(urls.length ? urls : null);
    } catch (error) {
      alert(error.message);
      return;
    }
    this.renderPairDialog();
  }

  unpair() {
    if (
      !confirm(
        "Unpair this device? Your data stays here, but it will stop syncing until you pair again. Other devices keep their pairing.",
      )
    )
      return;
    this.sync.unpair();
    this.renderSyncStatus();
    this.renderPairDialog();
  }

  /** Per-device settings that are not part of the shared data. */
  loadDeviceState() {
    let state = null;
    try {
      state =
        JSON.parse(localStorage.getItem("ettDeviceState")) ||
        JSON.parse(localStorage.getItem("ettGridState")); // pre-Yjs location
    } catch {
      state = null;
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(state?.date || "")) this.date = state.date;
    this.followToday = state?.followToday !== false;
  }

  saveDeviceState() {
    localStorage.setItem(
      "ettDeviceState",
      JSON.stringify({ date: this.date, followToday: this.followToday }),
    );
  }

  /** Replace the in-memory day with the store's copy of `date`. */
  loadDay(date) {
    const day = this.store.readDay(date);
    this.date = date;
    this.tasks = day.tasks;
    this.taskIds = day.taskIds;
    this.gridData = day.gridData;
    this.startTime = day.startTime;
    this.memo = day.memo;
    this.notes = day.notes;
    const memoInput = document.getElementById("memoInput");
    const notesInput = document.getElementById("notesInput");
    if (memoInput) memoInput.value = this.memo;
    if (notesInput) notesInput.value = this.notes;
    this.refreshTaskCatalog();
    this.updateDateControl();
  }

  /** Write the day's text fields to the store and remember this device's selection. */
  saveDayFields() {
    this.updateActivitySummary();
    this.memo = document.getElementById("memoInput")?.value || "";
    this.notes = document.getElementById("notesInput")?.value || "";
    this.store.transact(() => {
      this.store.setDayField(this.date, "memo", this.memo);
      this.store.setDayField(this.date, "notes", this.notes);
      this.store.setDayField(this.date, "startTime", this.startTime);
    });
    this.saveDeviceState();
  }

  refreshTaskCatalog() {
    this.taskCatalog = this.store.catalog();
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
      option.textContent = `${isOnDay ? "\u{1F6AB} " : ""}${task.name}`;
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
      ?.addEventListener("change", () => this.saveDayFields());
    document
      .getElementById("notesInput")
      ?.addEventListener("change", () => this.saveDayFields());

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
      .getElementById("exportBackupBtn")
      .addEventListener("click", () => this.exportBackup());
    const importInput = document.getElementById("importFileInput");
    document
      .getElementById("importBtn")
      .addEventListener("click", () => importInput.click());
    importInput.addEventListener("change", async () => {
      const [file] = importInput.files;
      importInput.value = "";
      if (!file) return;
      try {
        alert(await this.importFile(file));
      } catch (error) {
        alert(`Could not import ${file.name}: ${error.message || "Unknown error"}`);
      }
    });

    // GitHub sync
    document
      .getElementById("githubBtn")
      .addEventListener("click", () => this.openGithubDialog());
    document
      .getElementById("githubCloseBtn")
      .addEventListener("click", () => this.closeGithubDialog());
    document
      .getElementById("githubSaveBtn")
      .addEventListener("click", () => this.connectGithub());
    document
      .getElementById("githubCopyBtn")
      .addEventListener("click", () => this.copyGithubLink());
    document
      .getElementById("githubSyncNowBtn")
      .addEventListener("click", () => this.githubSyncNow());
    document
      .getElementById("githubDisconnectBtn")
      .addEventListener("click", () => this.disconnectGithub());

    // Pairing
    document
      .getElementById("pairBtn")
      .addEventListener("click", () => this.openPairDialog());
    document
      .getElementById("pairCloseBtn")
      .addEventListener("click", () => this.closePairDialog());
    document
      .getElementById("pairCreateBtn")
      .addEventListener("click", () => this.createPairing());
    document
      .getElementById("pairCopyBtn")
      .addEventListener("click", () => this.copyPairLink());
    document
      .getElementById("pairSignalingSaveBtn")
      .addEventListener("click", () => this.savePairSignaling());
    document
      .getElementById("pairUnpairBtn")
      .addEventListener("click", () => this.unpair());

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

  getTaskId(index) {
    return this.taskIds[index];
  }

  findTaskNameConflict(name, exceptId = null) {
    return this.store.findTaskByName(name, exceptId);
  }

  addTask(taskName) {
    const name = taskName.trim();
    if (!name) throw new Error("Enter a task name.");
    if (this.findTaskNameConflict(name)) {
      throw new Error(
        'A task with this name already exists. Choose it from "Reuse a task..." instead.',
      );
    }
    const id = this.store.createTask(name);
    this.store.addTaskToDay(this.date, id);
    this.tasks.push(name);
    this.taskIds.push(id);
    this.gridData.push(new Array(TimeCalculations.intervalCount).fill(false));
    this.refreshTaskCatalog();
    this.renderGrid();
    this.updateSummary();
    this.updateTaskCount();
    this.updateTaskPicker();
  }

  reuseTask(id) {
    if (this.taskIds.some((taskId) => String(taskId) === String(id))) return;
    const task = this.taskCatalog.find((entry) => String(entry.id) === String(id));
    if (!task) throw new Error("Choose an existing task.");
    this.store.addTaskToDay(this.date, task.id);
    this.tasks.push(task.name);
    this.taskIds.push(task.id);
    this.gridData.push(new Array(TimeCalculations.intervalCount).fill(false));
    this.renderGrid();
    this.updateTaskCount();
    this.updateSummary();
    this.updateTaskPicker();
  }

  renameTask(taskIdx, value) {
    const name = value.trim();
    const previousName = this.tasks[taskIdx];
    if (!name) throw new Error("Enter a task name.");
    if (previousName === undefined) throw new Error("This task no longer exists.");
    if (name === previousName) return;
    const taskId = this.getTaskId(taskIdx);
    if (this.findTaskNameConflict(name, taskId)) {
      throw new Error(
        'A task with this name already exists. Choose it from "Reuse a task..." instead.',
      );
    }
    this.store.renameTask(taskId, name);
    this.tasks[taskIdx] = name;
    this.refreshTaskCatalog();
    this.updateTaskPicker();
    this.renderGrid();
    this.updateSummary();
  }

  spliceTaskRow(taskIdx) {
    this.tasks.splice(taskIdx, 1);
    this.taskIds.splice(taskIdx, 1);
    this.gridData.splice(taskIdx, 1);
  }

  /**
   * Remove a task from this day only; the task and other days keep it.
   */
  removeTask(taskIdx) {
    this.store.removeTaskFromDay(this.date, this.getTaskId(taskIdx));
    this.spliceTaskRow(taskIdx);
    this.refreshTaskCatalog();
    this.renderGrid();
    this.updateSummary();
    this.updateTaskCount();
    this.updateTaskPicker();
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
    addRow("Intervals", String(description.count));
    if (description.last.length) {
      addRow("First 5", description.first);
      addRow("Last 5", description.last);
    } else if (description.first.length) {
      addRow("All intervals", description.first);
    }
  }

  async confirmDeleteTask(taskId) {
    const task = this.taskCatalog.find((entry) => String(entry.id) === taskId);
    if (!task) throw new Error("Choose an existing task.");
    const details = { created_at: this.store.taskCreatedAt(taskId) };
    const description = TimeCalculations.describeTaskIntervals(
      this.store.taskIntervals(taskId),
    );
    const confirmed = await window.chooseDeleteTask((container) =>
      this.renderDeleteTaskDetails(container, task, details, description),
    );
    if (!confirmed) return false;
    this.deleteTaskEverywhere(taskId);
    const count = description.count;
    alert(
      `Deleted task "${task.name}" and its ${count} interval${count === 1 ? "" : "s"}.`,
    );
    return true;
  }

  deleteTaskEverywhere(taskId) {
    this.store.deleteTask(taskId);
    const index = this.taskIds.findIndex((id) => String(id) === String(taskId));
    if (index >= 0) this.spliceTaskRow(index);
    this.refreshTaskCatalog();
    this.updateTaskPicker();
    this.renderGrid();
    this.updateSummary();
    this.updateTaskCount();
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

  changeSessionDate(date) {
    this.updateDateControl();
    if (date === this.date) return true;
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      TimeCalculations.localDate(new Date(`${date}T00:00:00`)) !== date
    )
      return false;
    this.saveDayFields();
    this.loadDay(date);
    this.followToday = date === TimeCalculations.localDate(new Date());
    this.renderGrid();
    this.updateTaskCount();
    this.updateSummary();
    this.updateTimeCalculations();
    this.saveDeviceState();
    this.updateTaskPicker();
    return true;
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

        bubble.addEventListener("click", (event) => {
          this.handleIntervalClick(intervalIdx, taskIdx, event.shiftKey);
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
    this.updateTaskPicker();
  }

  handleIntervalClick(intervalIdx, taskIdx, shiftKey) {
    const row = this.gridData[taskIdx];
    const anchor = this.intervalClickAnchor;
    if (shiftKey && anchor?.row === row && anchor.date === this.date) {
      const start = Math.min(anchor.intervalIdx, intervalIdx);
      const end = Math.max(anchor.intervalIdx, intervalIdx);
      const changed = [];
      for (let index = start; index <= end; index++) {
        if (!row[index]) {
          row[index] = true;
          changed.push(index);
        }
      }
      if (!changed.length) return;
      const taskId = this.getTaskId(taskIdx);
      this.store.transact(() => {
        for (const index of changed) this.store.setCell(this.date, taskId, index, true);
      });
      this.renderGrid();
      this.updateSummary();
      this.saveDayFields();
      return;
    }

    this.toggleInterval(intervalIdx, taskIdx);
    this.intervalClickAnchor = { row, date: this.date, intervalIdx };
  }

  toggleInterval(intervalIdx, taskIdx) {
    const filled = !this.gridData[taskIdx][intervalIdx];
    this.gridData[taskIdx][intervalIdx] = filled;
    this.store.setCell(this.date, this.getTaskId(taskIdx), intervalIdx, filled);
    this.renderGrid();
    this.updateSummary();
    this.saveDayFields();
  }

  clearGrid() {
    if (!confirm("Clear all interval assignments? (Tasks will remain)")) return;

    this.store.clearDay(this.date);
    this.gridData = this.tasks.map(() =>
      new Array(TimeCalculations.intervalCount).fill(false),
    );
    this.renderGrid();
    this.updateSummary();
    this.saveDayFields();
  }

  /** All-days total for a task, from the store (the live day is already written). */
  taskAllDayIntervals(taskIndex) {
    const id = this.getTaskId(taskIndex);
    const entry = this.taskCatalog.find((task) => String(task.id) === String(id));
    return entry
      ? entry.interval_count
      : (this.gridData[taskIndex] || []).filter(Boolean).length;
  }

  /**
   * Update summary with interval counts and time breakdowns per task
   */
  updateSummary() {
    this.refreshTaskCatalog();
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
    rows.forEach((row, index) => {
      row.allIntervals = this.taskAllDayIntervals(index);
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
    if (this.followToday === false || this.date === today) return false;
    this.saveDayFields();
    this.loadDay(today);
    this.updateDateControl(now);
    this.saveDeviceState();
    this.updateTaskPicker();
    return true;
  }

  // ── Changes arriving from other devices or imports ─────────────────────────

  scheduleRemoteRefresh(delay = 300) {
    clearTimeout(this.remoteRefreshTimer);
    this.remoteRefreshTimer = setTimeout(() => this.refreshFromRemoteChange(), delay);
  }

  /** Comparable view of the selected day as this device currently shows it. */
  remoteComparableState() {
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

  /** The store changed under us: summarize what differs from the screen, then apply it. */
  refreshFromRemoteChange() {
    const before = this.remoteComparableState();
    const day = this.store.readDay(this.date);
    const intervals = day.gridData.flatMap((row, index) =>
      row.flatMap((filled, slot) =>
        filled ? [{ task_id: day.taskIds[index], interval_index: slot }] : [],
      ),
    );
    const changes = RemoteChanges.diff(before, {
      memo: day.memo,
      notes: day.notes,
      tasks: day.taskIds.map((id, index) => ({ id, name: day.tasks[index] })),
      intervals,
    });
    this.refreshTaskCatalog();
    this.updateTaskPicker();
    if (changes.isEmpty) {
      this.updateSummary();
      return;
    }
    const memoInput = document.getElementById("memoInput");
    const notesInput = document.getElementById("notesInput");
    const typed = { memo: memoInput?.value, notes: notesInput?.value };
    this.loadDay(this.date);
    // Keep text being typed when the other device did not change that field.
    if (!changes.memoChanged && memoInput) memoInput.value = typed.memo;
    if (!changes.notesChanged && notesInput) notesInput.value = typed.notes;
    this.renderGrid();
    this.updateTaskCount();
    this.updateSummary();
    this.updateTimeCalculations();
    this.showRemoteNotice("Updated from another device", RemoteChanges.describe(changes));
  }

  // ── Backup, restore and import ──────────────────────────────────────────────

  download(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  /** Full copy of all data. Importing it on another device merges rather than replaces. */
  exportBackup() {
    this.saveDayFields();
    this.download(
      new Blob([this.store.encodeState()], { type: "application/octet-stream" }),
      `squirrel-tracks-${TimeCalculations.localDate(new Date())}.ettbackup`,
    );
  }

  /** Accepts a .ettbackup file (merged) or the JSON from the Supabase export query. */
  async importFile(file) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    let summary;
    if (bytes[0] === 0x5b /* [ */) {
      const rows = JSON.parse(new TextDecoder().decode(bytes));
      summary = `Imported ${this.store.importSupabaseExport(rows)} days.`;
    } else {
      this.store.applyState(bytes);
      summary = "Backup merged.";
    }
    clearTimeout(this.remoteRefreshTimer);
    this.loadDay(this.date);
    this.renderGrid();
    this.updateTaskCount();
    this.updateSummary();
    this.updateTaskPicker();
    return summary;
  }

  showRemoteNotice(title, lines, { problem = false } = {}) {
    const notice = document.getElementById("remoteChangeNotice");
    if (!notice) return;
    document.getElementById("remoteChangeTitle").textContent = title;
    const list = document.getElementById("remoteChangeList");
    list.replaceChildren();
    const maxLines = 6;
    const shown = lines.slice(0, maxLines);
    if (lines.length > maxLines) shown.push(`\u2026and ${lines.length - maxLines} more`);
    for (const line of shown) {
      const item = document.createElement("li");
      item.textContent = line;
      list.appendChild(item);
    }
    notice.classList.toggle("remote-notice-problem", problem);
    notice.setAttribute("role", problem ? "alert" : "status");
    notice.hidden = false;
    clearTimeout(this.remoteNoticeTimer);
    // Problems stay until resolved or dismissed; change summaries fade away.
    if (!problem)
      this.remoteNoticeTimer = setTimeout(() => (notice.hidden = true), 20000);
  }
}

/**
 * Start the tracker once the page has opened the data store (see index.html).
 */
window.addEventListener?.("app-store-ready", (event) => {
  window.tracker = new GridTaskTracker(
    event.detail.store,
    event.detail.sync,
    event.detail.github,
  );
  // Arrived from a sync link: ask for this device's token straight away.
  if (window.tracker.github?.needsToken()) window.tracker.openGithubDialog();
});
