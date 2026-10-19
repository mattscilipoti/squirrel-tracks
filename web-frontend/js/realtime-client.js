// Watches the ETT tables for changes made elsewhere (other tabs or devices).
// Uses the supabase-js UMD build from the CDN for Realtime only; all data
// reads and writes still go through SupabaseClient. Row payloads are not used
// (RLS limits what DELETE events carry); a signal just means "re-check".
const REALTIME_TABLES = ["sessions", "tasks", "session_tasks", "intervals"];

class RealtimeWatcher {
  constructor(url, publishableKey, onSignal) {
    this.url = url;
    this.publishableKey = publishableKey;
    this.onSignal = onSignal;
    this.client = null;
    this.hasConnected = false;
  }

  /** Returns false (and stays inert) when the CDN library did not load. */
  start(accessToken) {
    if (this.client) return true;
    const library = globalThis.supabase;
    if (!library?.createClient) {
      console.warn("supabase-js not loaded; live updates are unavailable.");
      return false;
    }
    this.client = library.createClient(this.url, this.publishableKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    this.client.realtime.setAuth(accessToken);
    let channel = this.client.channel("ett-changes");
    for (const table of REALTIME_TABLES) {
      channel = channel.on(
        "postgres_changes",
        { event: "*", schema: "public", table },
        (payload) => this.onSignal({ table, type: payload.eventType }),
      );
    }
    channel.subscribe((status) => {
      if (status !== "SUBSCRIBED") return;
      // Changes made while disconnected were missed, so re-check after reconnecting.
      if (this.hasConnected) this.onSignal({ reconnected: true });
      this.hasConnected = true;
    });
    return true;
  }

  setAccessToken(token) {
    if (token) this.client?.realtime.setAuth(token);
  }

  stop() {
    this.client?.removeAllChannels();
    this.client = null;
    this.hasConnected = false;
  }
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = RealtimeWatcher;
}
