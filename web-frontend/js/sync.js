/**
 * PeerSync - pairs this device with others and syncs the Yjs document over WebRTC.
 *
 * Pairing is a room name plus a secret, created on one device and carried to the others
 * in a link (or QR code): `https://host/app/#pair=<room>.<secret>`. The secret lives in
 * the URL fragment, which browsers never send to servers. y-webrtc uses it as the room
 * password, so everything sent through the signaling server is encrypted; the server
 * only sees the room name and connection metadata. Devices must be open at the same
 * time to sync, and tabs of the same browser sync through BroadcastChannel.
 *
 * There is deliberately no default signaling server: the public demo servers that used to
 * be built into y-webrtc have gone away. Until one is configured, only tabs of the same
 * browser can find each other.
 *
 * The WebRTC provider is injected (a global from the vendored bundle in the browser, a
 * fake in the tests).
 */
class PeerSync {
  static STORAGE_KEY = "ettSyncPairing";
  constructor({ WebrtcProvider, doc, storage, randomBytes } = {}) {
    this.WebrtcProvider = WebrtcProvider;
    this.doc = doc;
    this.storage = storage;
    this.randomBytes =
      randomBytes ||
      ((count) => globalThis.crypto.getRandomValues(new Uint8Array(count)));
    this.provider = null;
    this.peers = 0;
    this.listeners = [];
  }

  // ── Pairing data ─────────────────────────────────────────────────────────

  static validSignaling(urls) {
    return (
      Array.isArray(urls) &&
      urls.length > 0 &&
      urls.every((url) => typeof url === "string" && /^wss?:\/\/[^\s/]+/.test(url))
    );
  }

  /** The saved pairing: { room, secret, signaling } or null. */
  get pairing() {
    try {
      const saved = JSON.parse(this.storage.getItem(PeerSync.STORAGE_KEY));
      if (!/^[0-9a-f]{32}$/.test(saved?.room || "")) return null;
      if (!/^[A-Za-z0-9_-]{16,}$/.test(saved?.secret || "")) return null;
      return {
        room: saved.room,
        secret: saved.secret,
        signaling: PeerSync.validSignaling(saved.signaling) ? saved.signaling : null,
      };
    } catch {
      return null;
    }
  }

  isPaired() {
    return this.pairing !== null;
  }

  savePairing(pairing) {
    this.storage.setItem(PeerSync.STORAGE_KEY, JSON.stringify(pairing));
  }

  /** Make a new pairing on this device and start syncing. */
  createPairing() {
    const bytes = this.randomBytes(32);
    const room = Array.from(bytes.slice(0, 16), (b) =>
      b.toString(16).padStart(2, "0"),
    ).join("");
    const secret = btoa(String.fromCharCode(...bytes.slice(16)))
      .replaceAll("+", "-")
      .replaceAll("/", "_")
      .replaceAll("=", "");
    this.savePairing({ room, secret, signaling: this.pairing?.signaling || null });
    this.start();
    return this.pairing;
  }

  /** The link another device opens to join. `base` is this page's URL without a hash. */
  link(base) {
    const pairing = this.pairing;
    if (!pairing) return null;
    const params = new URLSearchParams({ pair: `${pairing.room}.${pairing.secret}` });
    if (pairing.signaling) params.set("signaling", pairing.signaling.join(","));
    return `${base}#${params}`;
  }

  /** Join from a page's location.hash. Returns true when it held a valid pairing. */
  joinFromHash(hash) {
    const params = new URLSearchParams(String(hash || "").replace(/^#/, ""));
    const [room, secret] = (params.get("pair") || "").split(".");
    const signaling = (params.get("signaling") || "").split(",").filter(Boolean);
    if (!/^[0-9a-f]{32}$/.test(room || "") || !/^[A-Za-z0-9_-]{16,}$/.test(secret || ""))
      return false;
    this.stop();
    this.savePairing({
      room,
      secret,
      signaling: PeerSync.validSignaling(signaling) ? signaling : null,
    });
    this.start();
    return true;
  }

  /** Use another signaling server (or null for the default) and reconnect. */
  setSignaling(urls) {
    const pairing = this.pairing;
    if (!pairing) throw new Error("Pair a device first.");
    if (urls && !PeerSync.validSignaling(urls))
      throw new Error("Use a ws:// or wss:// address.");
    this.savePairing({ ...pairing, signaling: urls || null });
    this.stop();
    this.start();
  }

  // ── Connection ───────────────────────────────────────────────────────────

  start() {
    const pairing = this.pairing;
    if (!pairing || this.provider || !this.WebrtcProvider) return false;
    this.provider = new this.WebrtcProvider(pairing.room, this.doc, {
      signaling: this.signalingUrls,
      password: pairing.secret,
    });
    for (const conn of this.provider.signalingConns || []) {
      conn.on?.("connect", () => this.notify());
      conn.on?.("disconnect", () => this.notify());
    }
    this.provider.on("peers", (event) => {
      this.peers = event.webrtcPeers.length;
      this.notify();
    });
    this.provider.on("status", () => this.notify());
    this.notify();
    return true;
  }

  stop() {
    if (!this.provider) return;
    this.provider.destroy();
    // The provider only stops its awareness timer when the whole document is destroyed.
    this.provider.awareness?.destroy();
    this.provider = null;
    this.peers = 0;
    this.notify();
  }

  /** Forget the pairing on this device. Data stays; other devices are unaffected. */
  unpair() {
    this.stop();
    this.storage.removeItem(PeerSync.STORAGE_KEY);
    this.notify();
  }

  /** Signaling servers in use: the pairing's own, or none. */
  get signalingUrls() {
    return this.pairing?.signaling || [];
  }

  /** "no-server": nothing configured; "unreachable": none connected; otherwise "ok". */
  health() {
    const { servers } = this.details() || { servers: [] };
    if (!servers.length) return "no-server";
    return servers.some((server) => server.connected) ? "ok" : "unreachable";
  }

  /** What the pairing dialog shows, so problems are visible without the console. */
  details() {
    const pairing = this.pairing;
    if (!pairing) return null;
    const connections = this.provider?.signalingConns || [];
    return {
      room: pairing.room,
      servers: this.signalingUrls.map((url) => ({
        url,
        connected: Boolean(connections.find((conn) => conn.url === url)?.connected),
      })),
      devices: this.peers,
      tabs: this.provider?.room?.bcConns?.size ?? 0,
    };
  }

  /** Number of other devices connected right now (other tabs are not counted). */
  get peerCount() {
    return this.peers;
  }

  onChange(listener) {
    this.listeners.push(listener);
  }

  notify() {
    this.listeners.forEach((listener) => listener());
  }
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = PeerSync;
}
