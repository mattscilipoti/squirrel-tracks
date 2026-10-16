/**
 * Supabase Client - Replaces Rails API
 * Handles all database operations for ETT
 */

// Initialize Supabase client
// Can be set from config modal or localStorage
let SUPABASE_URL =
  localStorage.getItem("supabase_url") || "https://YOUR_PROJECT.supabase.co";
let SUPABASE_API_KEY = localStorage.getItem("supabase_key") || "YOUR_ANON_KEY";

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

class SupabaseClient {
  constructor(url, key) {
    this.url = url;
    this.key = key;
    this.baseURL = `${url}/rest/v1`;
    this.headers = {
      "Content-Type": "application/json",
      apikey: key,
      Authorization: `Bearer ${key}`,
    };
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

function initSupabaseClient(url = SUPABASE_URL, key = SUPABASE_API_KEY) {
  supabaseClient = new SupabaseClient(url, key);
  return supabaseClient;
}

function getSupabaseClient() {
  if (!supabaseClient) {
    supabaseClient = new SupabaseClient(SUPABASE_URL, SUPABASE_API_KEY);
  }
  return supabaseClient;
}
