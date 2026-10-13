/**
 * GridTaskTracker - Radio button-based task time tracker
 * Implements a 15-hour × 60-interval grid with auto-fill pattern functionality
 */
class GridTaskTracker {
    constructor() {
        this.tasks = [];
        this.gridData = []; // 2D array: tasks[taskIdx][intervalIdx] = value (null or taskName)
        this.sessionId = null;
        this.timerState = {
            isRunning: false,
            timeRemaining: 15 * 60, // 15 minutes in seconds
            totalTime: 15 * 60,
            currentInterval: 0
        };

        this.initializeUI();
        this.loadFromLocalStorage();
        this.renderGrid();
        this.bindEvents();
    }

    initializeUI() {
        // Timer buttons
        document.getElementById('startBtn').addEventListener('click', () => this.timerStart());
        document.getElementById('pauseBtn').addEventListener('click', () => this.timerPause());
        document.getElementById('resetBtn').addEventListener('click', () => this.timerReset());

        // Task input
        document.getElementById('addTaskBtn').addEventListener('click', () => this.addTaskFromInput());
        document.getElementById('newTaskInput').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.addTaskFromInput();
        });

        // Export/Clear
        document.getElementById('exportBtn').addEventListener('click', () => this.exportCSV());
        document.getElementById('clearBtn').addEventListener('click', () => this.clearAll());

        // Grid actions
        document.getElementById('autoFillBtn').addEventListener('click', () => this.autoFillHour1());
        document.getElementById('clearGridBtn').addEventListener('click', () => this.clearGrid());
    }

    bindEvents() {
        // Radio button change handlers are attached in renderGrid()
    }

    /**
     * Add a new task to the tracker
     */
    addTaskFromInput() {
        const input = document.getElementById('newTaskInput');
        const taskName = input.value.trim();

        if (!taskName) {
            alert('Please enter a task name');
            return;
        }

        this.addTask(taskName);
        input.value = '';
        input.focus();
    }

    /**
     * Add task to grid and initialize its row
     */
    addTask(taskName) {
        this.tasks.push(taskName);
        this.gridData.push(new Array(60).fill(null)); // 60 intervals
        this.renderGrid();
        this.updateSummary();
    }

    /**
     * Remove task by index
     */
    removeTask(taskIdx) {
        this.tasks.splice(taskIdx, 1);
        this.gridData.splice(taskIdx, 1);
        this.renderGrid();
        this.updateSummary();
    }

    /**
     * Render the entire grid with radio buttons
     * Structure: One row per task, one column per 15-minute interval
     */
    renderGrid() {
        const tbody = document.getElementById('gridBody');
        tbody.innerHTML = '';

        this.tasks.forEach((taskName, taskIdx) => {
            const row = document.createElement('tr');

            // Task name cell with remove button
            const taskCell = document.createElement('td');
            taskCell.className = 'task-name-cell';
            taskCell.innerHTML = `${taskName} <span class="task-remove" title="Remove task">×</span>`;
            taskCell.querySelector('.task-remove').addEventListener('click', () => {
                this.removeTask(taskIdx);
            });
            row.appendChild(taskCell);

            // 60 interval cells with radio buttons
            for (let intervalIdx = 0; intervalIdx < 60; intervalIdx++) {
                const hourIdx = Math.floor(intervalIdx / 4);
                const isOddHour = hourIdx % 2 === 0; // 0-3 is hour 1 (index 0, even=odd-looking)

                const cell = document.createElement('td');
                cell.className = isOddHour ? 'hour-even' : 'hour-odd';
                cell.dataset.taskIdx = taskIdx;
                cell.dataset.intervalIdx = intervalIdx;

                // Radio button
                const radioId = `task-${taskIdx}-interval-${intervalIdx}`;
                const radio = document.createElement('input');
                radio.type = 'radio';
                radio.id = radioId;
                radio.name = `interval-${intervalIdx}`; // Same name for all tasks in same interval
                radio.value = taskIdx;

                // Check if this task is assigned to this interval
                if (this.gridData[taskIdx][intervalIdx] !== null) {
                    radio.checked = true;
                }

                radio.addEventListener('change', (e) => {
                    if (e.target.checked) {
                        this.assignInterval(intervalIdx, taskIdx);
                    }
                });

                cell.appendChild(radio);
                row.appendChild(cell);
            }

            tbody.appendChild(row);
        });

        this.saveToLocalStorage();
    }

    /**
     * Assign an interval to a task (only one task per interval allowed)
     */
    assignInterval(intervalIdx, taskIdx) {
        // Clear this interval from all other tasks
        for (let t = 0; t < this.tasks.length; t++) {
            this.gridData[t][intervalIdx] = null;
        }

        // Assign to this task
        this.gridData[taskIdx][intervalIdx] = this.tasks[taskIdx];

        this.updateSummary();
        this.saveToLocalStorage();
    }

    /**
     * Auto-fill: Copy Hour 1 (intervals 0-3) pattern to all other hours (2-15)
     */
    autoFillHour1() {
        const hour1Pattern = this.gridData.map(row => [row[0], row[1], row[2], row[3]]);

        if (hour1Pattern.every(pattern => pattern.every(cell => cell === null))) {
            alert('Hour 1 is empty. Fill in at least one interval in Hour 1 first.');
            return;
        }

        // Apply pattern to remaining 14 hours
        for (let hour = 1; hour < 15; hour++) {
            const startInterval = hour * 4;
            for (let i = 0; i < 4; i++) {
                const intervalIdx = startInterval + i;
                const taskIdx = this.gridData.findIndex(row => row[i] !== null);

                if (taskIdx !== -1) {
                    // Clear this interval from all tasks
                    for (let t = 0; t < this.tasks.length; t++) {
                        this.gridData[t][intervalIdx] = null;
                    }
                    // Assign to the same task that has it in Hour 1
                    this.gridData[taskIdx][intervalIdx] = this.tasks[taskIdx];
                }
            }
        }

        this.renderGrid();
        this.updateSummary();
        alert('✅ Pattern from Hour 1 has been applied to all remaining hours!');
    }

    /**
     * Clear all grid data (but keep tasks)
     */
    clearGrid() {
        if (!confirm('Clear all interval assignments? (Tasks will remain)')) return;

        this.gridData = this.tasks.map(() => new Array(60).fill(null));
        this.renderGrid();
        this.updateSummary();
    }

    /**
     * Update summary with interval counts and time breakdowns per task
     */
    updateSummary() {
        const summaryContent = document.getElementById('summaryContent');
        summaryContent.innerHTML = '';

        let hasData = false;

        this.tasks.forEach((taskName, taskIdx) => {
            const intervalCount = this.gridData[taskIdx].filter(cell => cell !== null).length;

            if (intervalCount > 0) {
                hasData = true;
                const minutes = intervalCount * 15;
                const hours = Math.floor(minutes / 60);
                const mins = minutes % 60;

                let timeStr = '';
                if (hours > 0) {
                    timeStr = `${hours}h ${mins}m`;
                } else {
                    timeStr = `${mins}m`;
                }

                const item = document.createElement('div');
                item.className = 'summary-item';
                item.innerHTML = `
                    <div class="task-title">${taskName}</div>
                    <div class="task-stats">
                        <strong>${intervalCount}</strong> intervals = <strong>${timeStr}</strong>
                    </div>
                `;
                summaryContent.appendChild(item);
            }
        });

        if (!hasData) {
            summaryContent.innerHTML = '<div class="summary-item empty">No tasks assigned yet. Fill in the grid to see summary.</div>';
        }
    }

    /**
     * Export grid as CSV
     */
    exportCSV() {
        let csv = 'Task,Intervals,Minutes,Time\n';

        this.tasks.forEach((taskName, taskIdx) => {
            const intervalCount = this.gridData[taskIdx].filter(cell => cell !== null).length;
            const minutes = intervalCount * 15;
            const hours = Math.floor(minutes / 60);
            const mins = minutes % 60;

            let timeStr = '';
            if (hours > 0) {
                timeStr = `${hours}h ${mins}m`;
            } else if (minutes > 0) {
                timeStr = `${mins}m`;
            } else {
                timeStr = '0m';
            }

            csv += `"${taskName}",${intervalCount},${minutes},"${timeStr}"\n`;
        });

        // Add timestamp
        const now = new Date();
        const timestamp = now.toISOString().slice(0, 10);
        const filename = `ett-tracker-${timestamp}.csv`;

        // Download
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
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
        if (!confirm('This will delete all tasks and grid assignments. Continue?')) return;

        this.tasks = [];
        this.gridData = [];
        this.renderGrid();
        this.updateSummary();
    }

    /**
     * Timer: Start
     */
    timerStart() {
        if (this.timerState.isRunning) return;

        this.timerState.isRunning = true;
        document.getElementById('startBtn').disabled = true;
        document.getElementById('pauseBtn').disabled = false;

        const interval = setInterval(() => {
            this.timerState.timeRemaining--;
            this.updateTimerDisplay();

            if (this.timerState.timeRemaining <= 0) {
                clearInterval(interval);
                this.timerState.isRunning = false;
                this.timerState.timeRemaining = 0;
                this.timerState.currentInterval++;
                alert('⏰ Time interval complete! Move to next task.');
                this.updateTimerDisplay();
                document.getElementById('startBtn').disabled = false;
                document.getElementById('pauseBtn').disabled = true;
            }
        }, 1000);

        this.timerState.intervalHandle = interval;
    }

    /**
     * Timer: Pause
     */
    timerPause() {
        clearInterval(this.timerState.intervalHandle);
        this.timerState.isRunning = false;
        document.getElementById('startBtn').disabled = false;
        document.getElementById('pauseBtn').disabled = true;
    }

    /**
     * Timer: Reset
     */
    timerReset() {
        clearInterval(this.timerState.intervalHandle);
        this.timerState.isRunning = false;
        this.timerState.timeRemaining = this.timerState.totalTime;
        this.timerState.currentInterval = 0;
        this.updateTimerDisplay();
        document.getElementById('startBtn').disabled = false;
        document.getElementById('pauseBtn').disabled = true;
    }

    /**
     * Update timer display
     */
    updateTimerDisplay() {
        const mins = Math.floor(this.timerState.timeRemaining / 60);
        const secs = this.timerState.timeRemaining % 60;
        document.getElementById('timerDisplay').textContent = `${mins}:${secs.toString().padStart(2, '0')}`;
    }

    /**
     * Save state to localStorage
     */
    saveToLocalStorage() {
        const state = {
            tasks: this.tasks,
            gridData: this.gridData,
            sessionId: this.sessionId,
            timerState: this.timerState
        };
        localStorage.setItem('ettGridState', JSON.stringify(state));
    }

    /**
     * Load state from localStorage
     */
    loadFromLocalStorage() {
        const saved = localStorage.getItem('ettGridState');
        if (saved) {
            try {
                const state = JSON.parse(saved);
                this.tasks = state.tasks || [];
                this.gridData = state.gridData || [];
                this.sessionId = state.sessionId;
                // Initialize grid data for tasks if not present
                if (this.gridData.length < this.tasks.length) {
                    for (let i = this.gridData.length; i < this.tasks.length; i++) {
                        this.gridData.push(new Array(60).fill(null));
                    }
                }
            } catch (e) {
                console.error('Error loading from localStorage:', e);
            }
        }
    }
}

/**
 * Initialize tracker when DOM is ready
 */
document.addEventListener('DOMContentLoaded', () => {
    window.tracker = new GridTaskTracker();
});
