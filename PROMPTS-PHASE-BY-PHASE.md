# Custom Implementation Prompts (Ready for Phase 1+)

These prompts will guide step-by-step implementation after dev environment is set up and tested.

---

## PHASE 1: Rails API Core ✅ (Use after backend setup verified)

### Prompt 1.1: "Implement Session & Task Models"
**Use when**: Rails project skeleton exists, migrations created  
**Goal**: Create Rails models with associations and validations

```
I'm building an ETT API backend in Rails 7.1.

Create Session and Task models with these requirements:

Session:
- id (primary key, auto-increment)
- created_at, updated_at
- status (enum: active, completed)
- has_many :tasks

Task:
- id (primary key)
- session_id (foreign key)
- name (string, required)
- duration_minutes (integer, default 0)
- created_at, updated_at
- belongs_to :session

Add:
- Model validations (name presence, session presence)
- Database indexes on session_id
- Create migrations

Cost: Keep dependencies minimal (no external gems for this).
Output: models work, migrations run without errors, tests pass
```

### Prompt 1.2: "Build REST API Endpoints for Sessions & Tasks"
**Use when**: Models and migrations verified  
**Goal**: Create API controllers and JSON serializers

```
I need REST endpoints for the ETT API:

Controllers:
- Api::SessionsController (POST /api/sessions, PATCH /api/sessions/:id, GET /api/sessions/:id)
- Api::TasksController (POST /api/sessions/:session_id/tasks, PATCH /api/sessions/:session_id/tasks/:id)

Serializers:
- SessionSerializer (include: id, status, created_at, tasks)
- TaskSerializer (include: id, name, duration_minutes)

Error handling:
- 422 for validation errors
- 404 for not found
- 500 for server errors (log & report)

CORS: Already configured for localhost:3000, localhost:5000

Cost: Use active_model_serializers gem (already in Gemfile)
Output: curl commands successfully create/read/update sessions and tasks
```

### Prompt 1.3: "Add IntervalLog Model for Time Analytics"
**Use when**: Sessions & Tasks working  
**Goal**: Model time-series data for later analytics

```
I need an IntervalLog model to track 15-minute interval completions:

IntervalLog:
- id (primary key)
- session_id (foreign key, required)
- task_id (foreign key, optional)
- interval_number (integer, 1-15)
- completed_at (datetime)
- created_at

Add:
- belongs_to :session
- belongs_to :task (optional)
- Validations
- Migration
- Endpoint: POST /api/sessions/:id/intervals

Cost: Keep it minimal, no complex calculations yet
Output: intervals log successfully when API called, persists to database
```

---

## PHASE 2: Web Frontend ✅ (Use after backend is running)

### Prompt 2.1: "Implement 15-Minute Countdown Timer"
**Use when**: Web frontend HTML/JS loaded  
**Goal**: Functional timer with start/pause/reset

```
I have a static web app with a timer display. The timer should:

Logic:
- Display 15:00 initially
- Start: countdown 1 sec/tick using setInterval()
- Pause: stop the interval
- Reset: restore to 15:00
- Completion: when time reaches 0:00, trigger completeInterval()

UI:
- #timerDisplay shows MM:SS format
- #startBtn, #pauseBtn, #resetBtn buttons
- Disable buttons appropriately (start/pause toggle)

Accuracy:
- Timer must be within ±1 second per 15 minutes
- No drift between pauses/restarts

Cost: No external libraries (vanilla JS)
Output: Timer counts down accurately, buttons work, no console errors
```

### Prompt 2.2: "Build Task Logging & Local Storage"
**Use when**: Timer working  
**Goal**: Add tasks, persist state locally

```
I need task logging with localStorage persistence:

Features:
- #taskInput (text field) for task name
- #logTaskBtn to submit
- localStorage key 'ettState' saves: { tasks[], timeRemaining, intervalCount, bubbles[] }
- On page reload, restore all state from localStorage
- Update summary display with logged tasks

Storage Format:
{
  "sessionId": null,
  "currentTaskName": "Writing docs",
  "timeRemaining": 600,
  "intervalCount": 3,
  "tasks": [
    { "name": "Writing docs", "started_at": "2026-10-12T21:09:54Z" }
  ],
  "bubbles": [1, 2, 3]
}

Cost: No external libraries
Output: Tasks persist across page reloads, localStorage visible in DevTools
```

### Prompt 2.3: "Implement Bubble Grid & Visual Feedback"
**Use when**: Timer & tasks working  
**Goal**: 15-bubble grid showing interval completion

```
I need a 15-bubble grid (15-minute blocks):

Grid:
- 15 circular bubbles numbered 1-15
- CSS grid layout (responsive, 5 cols on mobile)
- Each bubble is clickable (toggle 'active' class for manual marking)
- When interval completes, mark bubble as 'completed' (green)
- When interval is current, bubble has 'active' class (blue)

Styling:
- .bubble: gray, 60x60px, centered number
- .bubble.active: blue background, white text
- .bubble.completed: green background, white text
- Hover effect: scale up, shadow

Cost: Pure CSS, no libraries
Output: Grid displays, bubbles fill as timer completes, colors are correct
```

### Prompt 2.4: "Add API Sync & Error Handling"
**Use when**: Web frontend complete locally  
**Goal**: Connect to Rails backend

```
I need to sync tasks and intervals to the Rails API:

API Client (api-client.js):
- POST /api/sessions → create session
- POST /api/sessions/:id/tasks → log task
- POST /api/sessions/:id/intervals → log interval
- PATCH /api/sessions/:id → update status

Sync Behavior:
- When online: sync automatically after task/interval completion
- When offline: queue in localStorage, retry when online
- Show notification: "Synced ✓" or "Offline (will sync later)"

Error Handling:
- 4xx errors: log and alert user
- 5xx errors: retry with exponential backoff (3 retries max)
- Connection timeout: treat as offline

Cost: No external HTTP libraries
Output: Tasks sync to backend, API returns 200 OK, logs show sync events
```

---

## PHASE 3: iOS App ✅ (Use after backend + web verified)

### Prompt 3.1: "Set Up Xcode Project & Realm Data Layer"
**Use when**: CocoaPods installed  
**Goal**: Xcode project with local persistence

```
I'm building a native iOS app in SwiftUI with Realm persistence:

Models (Swift + Realm):
- Session: id, createdAt, status (active/completed)
- Task: id, sessionId, name, durationMinutes, createdAt
- IntervalLog: id, sessionId, taskId, intervalNumber, completedAt

RealmManager:
- Singleton pattern
- CRUD methods: createSession(), addTask(), logInterval()
- Query methods: getCurrentSession(), getAllTasks()
- Thread-safe (use Realm on main thread for simplicity)

Cost: Use built-in Realm (free, no external paid services)
Output: Xcode builds without errors, Realm persists data locally
```

### Prompt 3.2: "Implement SwiftUI Timer & UI"
**Use when**: Project structure & Realm working  
**Goal**: Native timer UI with buttons

```
I need a SwiftUI timer interface:

Views:
- TimerView: displays timer (15:00 format), start/pause/reset buttons
- TaskInputView: text field for task name, log button
- BubbleGridView: 15 bubbles in 5-col grid (LazyVGrid)
- SummaryView: list of tasks with interval counts
- ContentView: combines all views

State Management (ViewModel):
- @ObservedRealmModel for session/tasks
- @State for timerRemaining, isRunning, intervalCount

Timer Logic:
- Timer.TimerTask or DispatchSourceTimer for 1-second tick
- Update @Published timerRemaining
- Trigger completeInterval() when 0:00 reached

Cost: All built-in iOS frameworks
Output: App compiles, UI displays, buttons respond
```

### Prompt 3.3: "Add Local API Client & Sync Manager"
**Use when**: iOS UI complete  
**Goal**: Connect to Rails backend

```
I need networking layer for iOS:

APIClient (Swift):
- Base URL configurable (default: http://localhost:3000/api)
- Methods: createSession(), addTask(), logInterval()
- Uses URLSession (no external HTTP lib)
- Error handling: decode JSON responses, throw errors

SyncManager:
- Detect online/offline (Reachability or similar)
- Queue offline operations in Realm
- On online: sync queued items automatically
- Show UI indicator: "Syncing...", "Synced ✓", "Offline"

Cost: Use built-in URLSession
Output: Tasks sync to backend, network requests logged
```

---

## Phase 4: Advanced Features (After 1-3 Complete)

### Prompt 4.1: "Add User Authentication"
### Prompt 4.2: "Build Analytics Endpoints"
### Prompt 4.3: "Implement CSV/PDF Export"
### Prompt 4.4: "Create Android App (Kotlin)"

---

## How to Use These Prompts

1. **Copy the prompt** from the section matching your current phase
2. **Paste into VS Code Copilot chat** (or this conversation)
3. **Follow AI-generated code** step-by-step
4. **Test using verification criteria** (Output section)
5. **Move to next prompt** when tests pass

Each prompt is **self-contained** and builds on previous phases.

---

## Verification Checklist Template

After each prompt, verify:
- [ ] Code compiles/runs without errors
- [ ] Tests pass (if applicable)
- [ ] Feature works as specified
- [ ] No console errors/warnings
- [ ] Data persists (localStorage/Realm)
- [ ] API calls succeed (if backend connected)

---

**Ready?** Start with PHASE 1.1 after rebuilding backend.
