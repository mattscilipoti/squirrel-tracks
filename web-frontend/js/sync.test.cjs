const assert = require("node:assert/strict");
const { test } = require("node:test");
const Y = require("yjs");
const PeerSync = require("./sync.js");

function memoryStorage() {
  const map = new Map();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
  };
}

// Records what it was given; `emit` lets a test play the part of the network.
class FakeProvider {
  static instances = [];
  constructor(room, doc, options) {
    Object.assign(this, { room, doc, options, handlers: {}, destroyed: false });
    FakeProvider.instances.push(this);
  }
  on(name, handler) {
    this.handlers[name] = handler;
  }
  emit(name, event) {
    this.handlers[name]?.(event);
  }
  destroy() {
    this.destroyed = true;
  }
}

const counter = () => {
  let next = 1;
  return (count) => Uint8Array.from({ length: count }, () => (next++ * 37) % 256);
};

function make(storage = memoryStorage()) {
  FakeProvider.instances = [];
  return new PeerSync({
    WebrtcProvider: FakeProvider,
    doc: new Y.Doc(),
    storage,
    randomBytes: counter(),
  });
}

test("creating a pairing saves a valid room and secret and starts syncing", () => {
  const sync = make();
  assert.equal(sync.isPaired(), false);
  const pairing = sync.createPairing();
  assert.match(pairing.room, /^[0-9a-f]{32}$/);
  assert.match(pairing.secret, /^[A-Za-z0-9_-]{16,}$/);
  assert.equal(sync.isPaired(), true);
  const [provider] = FakeProvider.instances;
  assert.equal(provider.room, pairing.room);
  assert.equal(provider.options.password, pairing.secret);
  assert.deepEqual(provider.options.signaling, []);
});

test("each new pairing is different", () => {
  const sync = make();
  const first = sync.createPairing();
  sync.stop();
  const second = sync.createPairing();
  assert.notEqual(first.room, second.room);
  assert.notEqual(first.secret, second.secret);
});

test("a pairing link round-trips to another device, signaling server included", () => {
  const host = make();
  host.createPairing();
  host.setSignaling(["wss://relay.example.org:4444"]);
  const link = host.link("https://example.org/app/");
  assert.match(link, /^https:\/\/example\.org\/app\/#pair=/);

  const guest = make();
  assert.equal(guest.joinFromHash(link.slice(link.indexOf("#"))), true);
  assert.deepEqual(guest.pairing, host.pairing);
  assert.deepEqual(FakeProvider.instances[0].options.signaling, [
    "wss://relay.example.org:4444",
  ]);
});

test("garbage in the location hash is ignored and keeps the existing pairing", () => {
  const sync = make();
  const existing = sync.createPairing();
  for (const hash of [
    "",
    "#",
    "#pair=nope",
    "#pair=abc.def",
    `#pair=${"g".repeat(32)}.${"x".repeat(22)}`,
    "#something=else",
  ])
    assert.equal(sync.joinFromHash(hash), false, hash);
  assert.deepEqual(sync.pairing, existing);
  assert.equal(FakeProvider.instances.length, 1);
});

test("an invalid signaling address in a link is dropped", () => {
  const host = make();
  host.createPairing();
  const { room, secret } = host.pairing;
  const guest = make();
  assert.equal(
    guest.joinFromHash(`#pair=${room}.${secret}&signaling=javascript:alert(1)`),
    true,
  );
  assert.equal(guest.pairing.signaling, null);
  assert.deepEqual(FakeProvider.instances[0].options.signaling, []);
});

test("changing the signaling server reconnects and validates the address", () => {
  const sync = make();
  assert.throws(() => sync.setSignaling(["wss://x"]), /Pair a device/);
  sync.createPairing();
  assert.throws(() => sync.setSignaling(["https://nope"]), /ws:\/\/ or wss:\/\//);
  sync.setSignaling(["ws://192.168.1.5:4444"]);
  assert.equal(FakeProvider.instances.length, 2);
  assert.equal(FakeProvider.instances[0].destroyed, true);
  assert.deepEqual(FakeProvider.instances[1].options.signaling, [
    "ws://192.168.1.5:4444",
  ]);
  sync.setSignaling(null);
  assert.deepEqual(FakeProvider.instances[2].options.signaling, []);
});

test("peer count follows the provider and listeners are told", () => {
  const sync = make();
  let changes = 0;
  sync.onChange(() => changes++);
  sync.createPairing();
  const before = changes;
  FakeProvider.instances[0].emit("peers", { webrtcPeers: ["a", "b"], bcPeers: [] });
  assert.equal(sync.peerCount, 2);
  assert.equal(changes, before + 1);
  FakeProvider.instances[0].emit("peers", { webrtcPeers: [], bcPeers: ["tab"] });
  assert.equal(sync.peerCount, 0, "other tabs are not counted as devices");
});

test("unpairing stops syncing and forgets the pairing", () => {
  const storage = memoryStorage();
  const sync = make(storage);
  sync.createPairing();
  sync.unpair();
  assert.equal(FakeProvider.instances[0].destroyed, true);
  assert.equal(sync.isPaired(), false);
  assert.equal(make(storage).start(), false);
});

test("a saved pairing resumes on the next start; corrupt storage means unpaired", () => {
  const storage = memoryStorage();
  make(storage).createPairing();
  const again = make(storage);
  assert.equal(again.start(), true);
  assert.equal(again.start(), false, "starting twice does not open a second connection");
  assert.equal(FakeProvider.instances.length, 1);
  for (const bad of ["{", "null", '{"room":"x","secret":"y"}']) {
    storage.setItem(PeerSync.STORAGE_KEY, bad);
    assert.equal(make(storage).isPaired(), false, bad);
  }
});

test("health and details report missing, unreachable and connected signaling servers", () => {
  const sync = make();
  assert.equal(sync.details(), null);
  assert.equal(sync.health(), "no-server");
  sync.createPairing();
  assert.equal(sync.health(), "no-server");
  assert.deepEqual(sync.details().servers, []);

  const connections = [
    { url: "wss://a.example", connected: false, on() {} },
    { url: "wss://b.example", connected: false, on() {} },
  ];
  sync.setSignaling(["wss://a.example", "wss://b.example"]);
  FakeProvider.instances.at(-1).signalingConns = connections;
  assert.equal(sync.health(), "unreachable");
  connections[1].connected = true;
  assert.equal(sync.health(), "ok");
  const details = sync.details();
  assert.deepEqual(details.servers, [
    { url: "wss://a.example", connected: false },
    { url: "wss://b.example", connected: true },
  ]);
  assert.equal(details.room, sync.pairing.room);
  assert.equal(details.devices, 0);
  FakeProvider.instances.at(-1).room = { bcConns: new Set(["tab"]) };
  assert.equal(sync.details().tabs, 1);
});

test("connection changes on a signaling server notify listeners", () => {
  const sync = make();
  sync.createPairing();
  const handlers = {};
  sync.stop();
  FakeProvider.prototype.signalingConns = [
    { url: "wss://a.example", connected: false, on: (name, fn) => (handlers[name] = fn) },
  ];
  try {
    sync.setSignaling(["wss://a.example"]);
  } finally {
    delete FakeProvider.prototype.signalingConns;
  }
  let notified = 0;
  sync.onChange(() => notified++);
  handlers.connect();
  handlers.disconnect();
  assert.equal(notified, 2);
});

// Each "device" runs in its own worker thread: y-webrtc keeps one global room table per
// JavaScript realm, and workers get their own. They find each other over
// BroadcastChannel, the same path two tabs of one browser use, with the real
// encryption and sync protocol (WebRTC itself needs a browser). Terminating the workers
// also releases the library's channels, which would otherwise keep Node alive.
const DEVICE = `
const { parentPort, workerData } = require("node:worker_threads");
(async () => {
  const Y = await import("yjs");
  const { WebrtcProvider } = await import("y-webrtc");
  const DataStore = require(workerData.root + "/store.js");
  const PeerSync = require(workerData.root + "/sync.js");
  class LocalOnly extends WebrtcProvider {
    constructor(room, doc, options) {
      super(room, doc, { ...options, signaling: [] });
    }
  }
  const items = new Map();
  const storage = {
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => items.set(key, String(value)),
    removeItem: (key) => items.delete(key),
  };
  const store = new DataStore(Y, new Y.Doc(), { idFactory: () => workerData.name + "-task" });
  const sync = new PeerSync({ WebrtcProvider: LocalOnly, doc: store.doc, storage });
  sync.joinFromHash(workerData.hash);
  const day = "2026-11-22";
  store.setCell(day, store.createTask(workerData.name), workerData.slot, true);
  const slots = () =>
    store.readDay(day).gridData.flatMap((row) => row.flatMap((f, slot) => (f ? [slot] : [])));
  // Done when both devices' tasks and bubbles have arrived.
  while (store.readDay(day).tasks.length < 2 || slots().length < 2)
    await new Promise((resolve) => setTimeout(resolve, 20));
  parentPort.postMessage({ tasks: store.readDay(day).tasks, slots: slots().sort((a, b) => a - b) });
})().catch((error) => { throw error; });
`;

test("two devices with the same pairing converge through the real provider", async () => {
  const { Worker } = require("node:worker_threads");
  const link = (() => {
    const pairing = new PeerSync({ doc: null, storage: memoryStorage() });
    pairing.createPairing();
    return pairing.link("https://example.org/");
  })();
  const hash = link.slice(link.indexOf("#"));
  const start = (name, slot) =>
    new Promise((resolve, reject) => {
      const worker = new Worker(DEVICE, {
        eval: true,
        workerData: { root: __dirname, hash, name, slot },
      });
      worker.once("message", (result) => resolve({ worker, result }));
      worker.once("error", reject);
    });
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error("devices never synced")), 8000);
  });
  const devices = await Promise.race([
    Promise.all([start("alpha", 12), start("beta", 13)]),
    timeout,
  ]);
  try {
    for (const { result } of devices) {
      assert.deepEqual(result.tasks.sort(), ["alpha", "beta"]);
      assert.deepEqual(result.slots, [12, 13]);
    }
  } finally {
    clearTimeout(timer);
    await Promise.all(devices.map(({ worker }) => worker.terminate()));
  }
});
