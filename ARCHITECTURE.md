# Architecture

Squirrel Tracks is a time-tracking web app based on David Seah's Emergent Task
Timing. It is **local-first**: the vanilla JS frontend keeps all data on the device in
a Yjs document stored in IndexedDB. There is no backend, no account and no cloud
service. No framework, no build step for the app itself.

## Data flow

```
Browser (vanilla JS)
  → GridTaskTracker (in-memory copy of the selected day, rendering, UI)
  → DataStore (the only code that touches Yjs)
  → Y.Doc  ⇄  IndexedDB ("squirrel-tracks", via y-indexeddb)
```

Every edit is written to the Y.Doc immediately and persisted by y-indexeddb. Each
browser and address (for example `localhost:5000` and the GitHub Pages site) has its
own copy. Copies are combined by exporting a backup (`Y.encodeStateAsUpdate`) and
importing it elsewhere; importing merges, it never overwrites. Device-to-device sync
over WebRTC (`y-webrtc`, with an optional always-on relay) is planned but not built.

### Why Yjs

Yjs is a CRDT: two copies that have each been edited converge to the same data
after exchanging updates, in any order, with no conflict prompts. That is what makes
"merge, never overwrite" safe.

### Data model (`web-frontend/js/store.js`)

All collections are **flat** `Y.Map`s keyed by composite strings. Nested shared types
are avoided on purpose: if two devices each create the same nested map, one is
dropped along with its contents.

| Map          | Key                  | Value                         | Meaning                         |
| ------------ | -------------------- | ----------------------------- | ------------------------------- |
| `taskNames`  | `taskId`             | JSON text `{name, createdAt}` | A task (UUID from `randomUUID`) |
| `tombstones` | `taskId`             | `true`                        | The task was deleted            |
| `dayTasks`   | `date\|taskId`       | order number                  | The task appears on that day    |
| `cells`      | `date\|taskId\|slot` | `true`                        | A filled bubble (slot 0-95)     |
| `dayFields`  | `date\|field`        | string                        | `memo`, `notes`, `startTime`    |

Merge rules:

- Clearing a bubble deletes its key; concurrent fills and clears resolve per bubble.
- Deleting a task writes a tombstone instead of removing data. Its bubbles stay in the
  document but are never read.
- Renames and text fields are last-writer-wins.
- If two live tasks end up with the same trimmed, lower-cased name (two devices created
  "Email" while apart), `dedupeTasks` keeps the lowest id, moves the other task's days and
  bubbles onto it and tombstones the rest. Every device picks the same survivor.
- `onRemoteChange` fires only for updates that did not come from a local edit.

### Per-device settings (localStorage)

Not shared between devices: the selected date and "follow today" (`ettDeviceState`),
the reminder interval, bell and volume (`ettReminderSettings`).

### Startup

`index.html` opens the Y.Doc and IndexedDB persistence (loaded from the vendored
`vendor/yjs.js`), builds a `DataStore`, runs `dedupeTasks`, and on an empty store
imports the pre-Yjs localStorage keys (`ettGridState`, `ettGridHistory`; left in place
as a backup). It then fires `app-store-ready`, and `app-grid.js` creates the tracker.
It also asks the browser for persistent storage so data is not evicted under pressure.

### Changes arriving from elsewhere

`DataStore.onRemoteChange` → `GridTaskTracker.refreshFromRemoteChange` re-reads the
selected day, `RemoteChanges.diff` compares it with what is on screen, and a notice
summarizes the differences. Text being typed in memo/notes is kept unless the other
device changed the same field.

## Web frontend (`web-frontend/`)

No build step. Serve with any static HTTP server (`web-frontend/start-server.sh`).

| File                      | Purpose                                                             |
| ------------------------- | ------------------------------------------------------------------- |
| `index.html`              | Entry point, delete-task dialog, module script that opens the store |
| `js/store.js`             | `DataStore` - the Yjs data layer, merging, import/export            |
| `js/app-grid.js`          | `GridTaskTracker` - grid, tasks, dates, reminder, backup/import UI  |
| `js/time-calculations.js` | Date/time utilities, interval math, activity summaries              |
| `js/remote-changes.js`    | `RemoteChanges` - pure diff/summary of the screen vs the store      |
| `js/version.js`           | Build stamp (overwritten by the deploy workflow)                    |
| `vendor/yjs.js`           | Bundled Yjs + y-indexeddb. Generated: `npm run vendor`, then commit |
| `vendor-src/entry.js`     | Input for the vendor bundle                                         |
| `css/style.css`           | All styles                                                          |

### Tests

```bash
npm test      # node --test web-frontend/js/*.test.cjs
```

Node 18+. `yjs` is a dev dependency so the tests run against a real in-memory
`Y.Doc`. App tests load the browser scripts into a `vm` context with hand-built DOM
fakes; no jsdom.

## Supabase (retired)

Earlier versions synced through Supabase (Postgres, Auth, Realtime). That code is
removed. `supabase/migrations/` is kept only as a record of the old schema, and
`supabase/export-days.sql` exports the old data as JSON for **Advanced → Import**
(`DataStore.importSupabaseExport`).

## Backend (`backend/`) and other directories

`backend/` is an unused Rails API from the original plan. `ios-app/` is a placeholder
SwiftUI app. `.devcontainer/`, `bundle/` and `assets/` are tooling and static files.

## Conventions

- **No build step for the app** - vanilla JS and CSS. The one generated file is the
  vendored Yjs bundle.
- **Local-first** - every write hits the local store first; nothing needs a network.
- **Flat CRDT maps** - never nest shared types (see data model).
