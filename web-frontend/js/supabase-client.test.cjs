const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

function client() {
  const context = vm.createContext({
    URLSearchParams,
    localStorage: { getItem: () => null },
  });
  vm.runInContext(
    fs.readFileSync(path.join(__dirname, "supabase-client.js"), "utf8") +
      '\nglobalThis.client = new SupabaseClient("https://example.supabase.co", "anon");',
    context,
  );
  return context.client;
}

test("sessions load global tasks through daily memberships", async () => {
  const db = client();
  db.request = async (method, route) => {
    assert.equal(method, "GET");
    assert.match(decodeURIComponent(route), /session_tasks\(task:tasks\(\*\)\)/);
    return [{ id: 1, session_tasks: [{ task: { id: 5, name: "Shared" } }] }];
  };
  const session = await db.getSession(1);
  assert.equal(session.tasks[0].id, 5);
  assert.equal((await db.getSessionsForDate("2026-10-16"))[0].tasks[0].name, "Shared");
});

test("creating a task attaches its stable ID without single-day ownership", async () => {
  const db = client();
  const calls = [];
  db.request = async (method, route, data) => {
    calls.push({ method, route, data });
    return route === "/tasks" ? [{ id: 5, name: data.name }] : [];
  };
  const task = await db.createTask(2, { name: "Shared" });
  assert.equal(task.id, 5);
  assert.equal(calls[0].data.session_id, undefined);
  assert.equal(calls[1].data.session_id, 2);
  assert.equal(calls[1].data.task_id, 5);
});

test("renaming is global and removing a task is day-specific", async () => {
  const db = client();
  const calls = [];
  db.request = async (method, route) => {
    calls.push({ method, route });
  };
  await db.updateTask(2, 5, { name: "Renamed" });
  await db.deleteTask(2, 5);
  assert.deepEqual(calls, [
    { method: "PATCH", route: "/tasks?id=eq.5" },
    { method: "DELETE", route: "/session_tasks?task_id=eq.5&session_id=eq.2" },
  ]);
});

test("catalog reads paginate rather than truncating reusable tasks", async () => {
  const db = client();
  let requests = 0;
  db.request = async (method, route) => {
    requests++;
    const params = new URL(route, "https://example.supabase.co").searchParams;
    return params.get("offset") === "0"
      ? Array.from({ length: 1000 }, (_, id) => ({ id }))
      : [{ id: 1000 }];
  };
  assert.equal((await db.getTaskCatalog()).length, 1001);
  assert.equal(requests, 2);
});
