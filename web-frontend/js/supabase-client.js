/**
 * Supabase Client - Replaces Rails API
 * Handles all database operations and authentication for ETT
 */

// Initialize Supabase client
// Can be set from config modal or localStorage
let SUPABASE_URL =
  localStorage.getItem("supabase_url") || "https://YOUR_PROJECT.supabase.co";
let SUPABASE_API_KEY = localStorage.getItem("supabase_key") || "YOUR_ANON_KEY";

const AUTH_SESSION_KEY = "ett_auth_session";

/**
 * Configure Supabase credentials (called from setup modal)
 */
function configureSupabase(url, apiKey) {
  SUPABASE_URL = url;
  SUPABASE_API_KEY = apiKey;
  localStorage.setItem("supabase_url", url);
  localStorage.setItem("supabase_key", apiKey);

  // Re-initialize client
  supabaseClient = null;
  return getSupabaseClient();
}

function hasSupabaseConfig() {
  return Boolean(
    SUPABASE_URL &&
    SUPABASE_API_KEY &&
    !SUPABASE_URL.includes("YOUR_PROJECT") &&
    SUPABASE_API_KEY !== "YOUR_ANON_KEY",
  );
}

/**
 * Auth helper — manages sign-in, sign-up, token refresh, and session storage.
 * Uses Supabase GoTrue REST API directly (no SDK).
 */
class SupabaseAuth {
  constructor(url, anonKey) {
    this.url = url;
    this.anonKey = anonKey;
    this.authURL = `${url}/auth/v1`;
    this._refreshTimer = null;
  }

  /** POST to a GoTrue endpoint. */
  async _authRequest(path, body, accessToken = null) {
    const headers = {
      "Content-Type": "application/json",
      apikey: this.anonKey,
    };
    if (accessToken) {
      headers.Authorization = `Bearer ${accessToken}`;
    }
    const res = await fetch(`${this.authURL}${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error_description || data.msg || data.error || `HTTP ${res.status}`);
    }
    return data;
  }

  /** Sign in with email + password. Returns session data. */
  async signIn(email, password) {
    const data = await this._authRequest(
      "/token?grant_type=password",
      { email, password },
    );
    this._saveSession(data);
    this._scheduleRefresh(data.expires_in);
    return data;
  }

  /** Create a new account. Returns session data (if email confirm disabled). */
  async signUp(email, password) {
    const data = await this._authRequest("/signup", { email, password });
    // If email confirmation is disabled the response includes tokens.
    if (data.access_token) {
      this._saveSession(data);
      this._scheduleRefresh(data.expires_in);
    }
    return data;
  }

  /** Refresh the access token using the stored refresh token. */
  async refreshSession() {
    const session = this.getSession();
    if (!session?.refresh_token) return null;
    try {
      const data = await this._authRequest(
        "/token?grant_type=refresh_token",
        { refresh_token: session.refresh_token },
      );
      this._saveSession(data);
      this._scheduleRefresh(data.expires_in);
      return data;
    } catch (err) {
      console.warn("Token refresh failed:", err.message);
      this.clearSession();
      return null;
    }
  }

  /** Sign out and clear local session. */
  async signOut() {
    const session = this.getSession();
    if (session?.access_token) {
      try {
        await this._authRequest("/logout", {}, session.access_token);
      } catch (_) {
        // Best-effort; clear locally regardless.
      }
    }
    this._clearRefreshTimer();
    this.clearSession();
  }

  /** Read stored session from localStorage. */
  getSession() {
    try {
      return JSON.parse(localStorage.getItem(AUTH_SESSION_KEY));
    } catch {
      return null;
    }
  }

  /** True if a session with an access token exists (may need refresh). */
  isAuthenticated() {
    return Boolean(this.getSession()?.access_token);
  }

  /** Restore session on page load: refresh if near expiry, else reuse. */
  async restoreSession() {
    const session = this.getSession();
    if (!session?.access_token) return null;

    const expiresAt = session.expires_at || 0;
    const needsRefresh = Date.now() / 1000 > expiresAt - 120; // 2 min buffer

    if (needsRefresh) {
      return this.refreshSession();
    }
    // Still valid — schedule next refresh.
    const remaining = expiresAt - Date.now() / 1000;
    this._scheduleRefresh(remaining);
    return session;
  }

  // ── Internal helpers ──────────────────────────────────────────────

  _saveSession(data) {
    const session = {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_in: data.expires_in,
      expires_at: Math.floor(Date.now() / 1000) + data.expires_in,
      user: data.user,
    };
    localStorage.setItem(AUTH_SESSION_KEY, JSON.stringify(session));
  }

  clearSession() {
    localStorage.removeItem(AUTH_SESSION_KEY);
    this._clearRefreshTimer();
  }

  _scheduleRefresh(expiresInSec) {
    this._clearRefreshTimer();
    // Refresh 60 s before expiry, minimum 5 s.
    const delay = Math.max((expiresInSec - 60) * 1000, 5000);
    this._refreshTimer = setTimeout(async () => {
      const refreshed = await this.refreshSession();
      if (refreshed && supabaseClient) {
        supabaseClient.setAccessToken(refreshed.access_token);
      }
    }, delay);
  }

  _clearRefreshTimer() {
    if (this._refreshTimer) {
      clearTimeout(this._refreshTimer);
      this._refreshTimer = null;
    }
  }
}

// Singleton auth instance (created once Supabase URL/key are known).
let supabaseAuth = null;

function getSupabaseAuth() {
  if (!supabaseAuth && hasSupabaseConfig()) {
    supabaseAuth = new SupabaseAuth(SUPABASE_URL, SUPABASE_API_KEY);
  }
  return supabaseAuth;
}

class SupabaseClient {
  constructor(url, key, accessToken = null) {
    this.url = url;
    this.key = key;
    this.baseURL = `${url}/rest/v1`;
    this.headers = {
      "Content-Type": "application/json",
      apikey: key,
      Authorization: `Bearer ${accessToken || key}`,
    };
  }

  /** Update the Authorization header after a token refresh. */
  setAccessToken(token) {
    this.headers.Authorization = `Bearer ${token}`;
  }

  /**
   * Generic fetch wrapper
   */
  async request(method, path, data = null, prefer = null) {
    const url = `${this.baseURL}${path}`;
    const options = {
      method,
      headers: { ...this.headers },
    };

    if (method === "POST") {
      options.headers.Prefer = "return=representation";
    }
    if (prefer) options.headers.Prefer = prefer;

    if (data) {
      options.body = JSON.stringify(data);
    }

    try {
      const response = await fetch(url, options);

      if (!response.ok) {
        const error = await response.json();
        console.error(`Supabase error: ${error.message}`, error);
        throw new Error(error.message || `HTTP ${response.status}`);
      }

      // DELETE requests return no content
      if (response.status === 204) {
        return null;
      }

      return await response.json();
    } catch (error) {
      console.error("Request failed:", error);
      throw error;
    }
  }

  /**
   * Sessions API
   */

  async createSession(data) {
    return this.request("POST", "/sessions", data);
  }

  async getSession(sessionId) {
    const result = await this.request(
      "GET",
      `/sessions?id=eq.${sessionId}&select=*,session_tasks(task:tasks(*))`,
    );
    return result?.[0] ? this.normalizeSession(result[0]) : null;
  }

  async getSessionsForDate(date) {
    const params = new URLSearchParams({
      date: `eq.${date}`,
      select: "*,session_tasks(task:tasks(*)),intervals(id)",
      order: "id.desc",
    });
    const sessions = await this.request("GET", `/sessions?${params}`);
    return sessions.map((session) => this.normalizeSession(session));
  }

  normalizeSession(session) {
    return {
      ...session,
      tasks: (session.session_tasks || []).map((link) => link.task),
    };
  }

  async getAllRows(table, select, order) {
    const rows = [];
    for (let offset = 0; ; offset += 1000) {
      const params = new URLSearchParams({
        select,
        order,
        limit: "1000",
        offset: String(offset),
      });
      const page = await this.request("GET", `/${table}?${params}`);
      rows.push(...page);
      if (page.length < 1000) return rows;
    }
  }

  getTaskCatalog() {
    return this.getAllRows(
      "task_totals",
      "id,name,interval_count",
      "name.asc,id.asc",
    );
  }

  getTaskDayTotals() {
    return this.getAllRows(
      "task_day_totals",
      "session_id,task_id,interval_count",
      "session_id.asc,task_id.asc",
    );
  }

  async updateSession(sessionId, data) {
    return this.request("PATCH", `/sessions?id=eq.${sessionId}`, data);
  }

  async deleteSession(sessionId) {
    return this.request("DELETE", `/sessions?id=eq.${sessionId}`);
  }

  /**
   * Tasks API
   */

  async createTask(sessionId, data) {
    const result = await this.request("POST", "/tasks", data);
    const task = result?.[0] || result;
    await this.attachTask(sessionId, task.id);
    return task;
  }

  attachTask(sessionId, taskId) {
    return this.request(
      "POST",
      "/session_tasks?on_conflict=session_id,task_id",
      {
        session_id: sessionId,
        task_id: taskId,
      },
      "resolution=ignore-duplicates,return=representation",
    );
  }

  async updateTask(sessionId, taskId, data) {
    return this.request("PATCH", `/tasks?id=eq.${taskId}`, data);
  }

  async deleteTask(sessionId, taskId) {
    return this.request(
      "DELETE",
      `/session_tasks?task_id=eq.${taskId}&session_id=eq.${sessionId}`,
    );
  }

  /**
   * Intervals API - Track which task in each 15-min interval
   */

  async createInterval(sessionId, taskId, intervalIndex) {
    const data = {
      session_id: sessionId,
      task_id: taskId,
      interval_index: intervalIndex,
    };
    return this.request("POST", "/intervals", data);
  }

  async setInterval(sessionId, taskId, intervalIndex) {
    // First, delete any existing interval at this position
    await this.deleteIntervalAtIndex(sessionId, intervalIndex);

    // If taskId is provided, create new interval
    if (taskId) {
      return this.createInterval(sessionId, taskId, intervalIndex);
    }
    return null;
  }

  async deleteIntervalAtIndex(sessionId, intervalIndex) {
    // Delete all intervals at this index for this session
    return this.request(
      "DELETE",
      `/intervals?session_id=eq.${sessionId}&interval_index=eq.${intervalIndex}`,
    );
  }

  async deleteInterval(sessionId, taskId, intervalIndex) {
    return this.request(
      "DELETE",
      `/intervals?session_id=eq.${sessionId}&task_id=eq.${taskId}&interval_index=eq.${intervalIndex}`,
    );
  }

  async getSessionIntervals(sessionId) {
    return this.request(
      "GET",
      `/intervals?session_id=eq.${sessionId}&select=task_id,interval_index,id`,
    );
  }

  async clearAllIntervals(sessionId) {
    return this.request("DELETE", `/intervals?session_id=eq.${sessionId}`);
  }

  /**
   * Sync - Get only changed data since last sync
   * Useful for local-first sync queue
   */

  async getSyncData(sessionId, lastSyncTime) {
    const params = new URLSearchParams();
    params.append("select", "*");
    params.append("session_id", `eq.${sessionId}`);

    if (lastSyncTime) {
      params.append("updated_at", `gt.${lastSyncTime}`);
    }

    return this.request("GET", `/intervals?${params.toString()}`);
  }
}

// Create singleton instance
let supabaseClient = null;

function initSupabaseClient(
  url = SUPABASE_URL,
  key = SUPABASE_API_KEY,
  accessToken = null,
) {
  supabaseClient = new SupabaseClient(url, key, accessToken);
  return supabaseClient;
}

function getSupabaseClient() {
  if (!supabaseClient) {
    const auth = getSupabaseAuth();
    const session = auth?.getSession();
    supabaseClient = new SupabaseClient(
      SUPABASE_URL,
      SUPABASE_API_KEY,
      session?.access_token || null,
    );
  }
  return supabaseClient;
}
