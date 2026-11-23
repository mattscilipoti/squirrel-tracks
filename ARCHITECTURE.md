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
          ⇄  a private GitHub repository (encrypted files, github-sync.js)
          ⇄  live paired devices (optional, via y-webrtc)
```

Every edit is written to the Y.Doc immediately and persisted by y-indexeddb. Each
browser and address (for example `localhost:5000` and the GitHub Pages site) has its
own copy. Copies are combined in three ways: through a private GitHub repository (below, the main
way), live over WebRTC between devices that are open together (optional), and by exporting a backup
(`Y.encodeStateAsUpdate`) and importing it elsewhere. Every path merges; none overwrites.

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

### GitHub sync (`web-frontend/js/github-sync.js`)

`GitHubSync` stores each device's full Yjs state as one encrypted file, `devices/<deviceId>.bin`, in a
private repository, using the REST contents API directly from the browser (api.github.com allows
CORS, including `Authorization`, `If-None-Match` and `PUT`). Devices never write each other's files, so
there are no write conflicts; each merges the others' files with `Y.applyUpdate`.

- **Settings** (localStorage `ettGithubSync`, per device): `repo`, `secret`, `token`, `deviceId`.
  The `token` (fine-grained, one repository, Contents read/write) never leaves the device. The link
  `…/#github=<owner/name>&secret=<secret>` carries repo and secret only, and the device asks for its own
  token. The fragment is not sent to servers.
- **Encryption:** AES-GCM, key = PBKDF2-SHA256 (200k iterations) of the secret. File layout is
  `[1][12-byte IV][ciphertext]`. A file that fails to decrypt is skipped and reported (key mismatch or
  tampering); it never reaches the document.
- **Pull:** list `devices/` with `If-None-Match` (a 304 is cheap), download only files whose `sha` is not
  already merged, decrypt, apply with origin `"github"`. A missing own file marks the device dirty so its
  existing data is published.
- **Push:** `PUT` the own file with the last known `sha`. A 409/422 means another tab of the same device
  wrote it: pull (merging that), then retry once. Updates with origin `"github"` never mark the document
  dirty, so pulled data is not pushed back.
- **Schedule:** push 10 s after the last local change; poll every 60 s while the page is visible, on
  `visibilitychange`, and on `online`. Offline errors keep the document dirty and recover on their own.
- **Status:** `status()` returns `off`, `needs-token`, `syncing`, `ok`, `offline` or `error` with a plain
  message; the footer prefers GitHub problems, then live peers, then GitHub's own state.
- Every push is a commit. Sizes and timestamps are visible to anyone who can read the repository;
  contents are not.

### Live pairing (`web-frontend/js/sync.js`)

Switched off by default: `LIVE_PAIRING_ENABLED` in the module script of `index.html` is `false`, so no
`PeerSync` is created, nothing connects, and the Live pairing button is hidden (the tracker accepts
`sync = null`). Setting it to `true` restores everything, including a saved pairing.

`PeerSync` wraps y-webrtc's `WebrtcProvider`. A pairing is a random room name (16 bytes, hex)
and secret (16 bytes, base64url) created on one device and saved in localStorage
(`ettSyncPairing`, per device). It travels as a link `…/#pair=<room>.<secret>[&signaling=<urls>]`,
also drawn as a QR code (`qrcode-generator`). The fragment is never sent to a server. The secret is
the provider's `password`, so signaling and data messages are encrypted. On load, `index.html`
joins from `location.hash` (then clears it) or resumes the saved pairing.

- Devices find each other through signaling servers, then connect peer to peer. There is no default
  server (the public y-webrtc demo servers are gone); one must be configured per pairing and travels in
  the link. Self-host with `y-webrtc-signaling`. Tabs of one browser also sync over BroadcastChannel
  without any server. `PeerSync.health()` reports `no-server`, `unreachable` or `ok`, and
  `details()` feeds the "Sync details" list in the pairing dialog.
- Both devices must be open at the same time; nothing is stored on a server. A future always-on
  peer would speak the same protocol.
- Yjs merges whatever each side missed when two devices meet, so offline edits are not lost.
- Peers = other devices only (`webrtcPeers`, not tabs); the footer shows the count, and
  `DataStore.onRemoteChange` records the last time another device sent changes.
- `stop()` also destroys the provider's awareness (its timer otherwise outlives the provider).

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

| File                      | Purpose                                                                           |
| ------------------------- | --------------------------------------------------------------------------------- |
| `index.html`              | Entry point, delete-task dialog, module script that opens the store               |
| `js/store.js`             | `DataStore` - the Yjs data layer, merging, import/export                          |
| `js/github-sync.js`       | `GitHubSync` - encrypted sync through a private GitHub repository                 |
| `js/sync.js`              | `PeerSync` - live pairing links and the WebRTC provider                           |
| `js/app-grid.js`          | `GridTaskTracker` - grid, tasks, dates, reminder, backup/import, pairing UI       |
| `js/time-calculations.js` | Date/time utilities, interval math, activity summaries                            |
| `js/remote-changes.js`    | `RemoteChanges` - pure diff/summary of the screen vs the store                    |
| `js/version.js`           | Build stamp (overwritten by the deploy workflow)                                  |
| `vendor/yjs.js`           | Bundled Yjs, y-indexeddb, y-webrtc, qrcode-generator. `npm run vendor`; commit it |
| `vendor-src/entry.js`     | Input for the vendor bundle                                                       |
| `css/style.css`           | All styles                                                                        |

### Tests

```bash
npm test      # node --test web-frontend/js/*.test.cjs
```

Node 18+. `yjs` and `y-webrtc` are dev dependencies so the tests run against a real in-memory
`Y.Doc`. `sync.test.cjs` starts two devices in worker threads (y-webrtc keeps one room table per
realm) that sync over BroadcastChannel with the real encryption and protocol; WebRTC itself
needs a browser and is only checked by hand. App tests load the browser scripts into a `vm` context with hand-built DOM
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
