const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

function watcher(library) {
  const context = vm.createContext({ console: { warn() {} }, supabase: library });
  vm.runInContext(
    fs.readFileSync(path.join(__dirname, "realtime-client.js"), "utf8") +
      "\nglobalThis.Watcher = RealtimeWatcher;",
    context,
  );
  const signals = [];
  return {
    signals,
    watcher: new context.Watcher("https://x.supabase.co", "key", (s) => signals.push(s)),
  };
}

function fakeLibrary() {
  const state = { subscriptions: [], auth: [], statusCallback: null, removed: 0 };
  const channel = {
    on(type, filter, callback) {
      state.subscriptions.push({ type, ...filter, callback });
      return channel;
    },
    subscribe(callback) {
      state.statusCallback = callback;
      return channel;
    },
  };
  return {
    state,
    createClient: () => ({
      realtime: { setAuth: (token) => state.auth.push(token) },
      channel: () => channel,
      removeAllChannels: () => state.removed++,
    }),
  };
}

test("watcher subscribes to every ETT table with the user token and signals on events", () => {
  const library = fakeLibrary();
  const { watcher: w, signals } = watcher(library);
  assert.equal(w.start("token-1"), true);
  assert.deepEqual(
    library.state.subscriptions.map((s) => s.table),
    ["sessions", "tasks", "session_tasks", "intervals"],
  );
  assert.deepEqual(library.state.auth, ["token-1"]);
  library.state.subscriptions[3].callback({ eventType: "INSERT" });
  assert.deepEqual(JSON.parse(JSON.stringify(signals)), [
    { table: "intervals", type: "INSERT" },
  ]);
  w.setAccessToken("token-2");
  assert.deepEqual(library.state.auth, ["token-1", "token-2"]);
});

test("only a reconnect (not the first connection) triggers a catch-up signal", () => {
  const library = fakeLibrary();
  const { watcher: w, signals } = watcher(library);
  w.start("t");
  library.state.statusCallback("SUBSCRIBED");
  assert.equal(signals.length, 0);
  library.state.statusCallback("CHANNEL_ERROR");
  library.state.statusCallback("SUBSCRIBED");
  assert.deepEqual(JSON.parse(JSON.stringify(signals)), [{ reconnected: true }]);
});

test("missing CDN library leaves the watcher inert instead of throwing", () => {
  const { watcher: w } = watcher(undefined);
  assert.equal(w.start("t"), false);
  w.setAccessToken("t");
  w.stop();
});
