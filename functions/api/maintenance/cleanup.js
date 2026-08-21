const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
});

const roomLogKey = roomId => `rooms/${roomId}/log.json`;

const notifyDeleted = (context, env, roomId) => {
  if (!env.ROOMS) return;
  try {
    const id = env.ROOMS.idFromName(roomId);
    const hub = env.ROOMS.get(id);
    context.waitUntil(hub.fetch("https://room/deleted", { method: "POST" }).catch(() => {}));
  } catch {}
};

const deleteExpiredRoom = async (context, env, room) => {
  let log = {};
  try { log = JSON.parse(room.log_json || "{}"); } catch {}

  if (log.storage === "r2") {
    if (!env.LOGS) throw new Error("R2 LOGS binding is missing");
    await env.LOGS.delete(log.key || roomLogKey(room.id));
  }

  await env.DB.batch([
    env.DB.prepare("DELETE FROM annotation_likes WHERE annotation_id IN (SELECT id FROM annotations WHERE room_id=?)").bind(room.id),
    env.DB.prepare("DELETE FROM annotations WHERE room_id=?").bind(room.id),
    env.DB.prepare("DELETE FROM presence WHERE room_id=?").bind(room.id),
    env.DB.prepare("DELETE FROM room_log_chunks WHERE room_id=?").bind(room.id),
    env.DB.prepare("DELETE FROM rooms WHERE id=?").bind(room.id)
  ]);

  notifyDeleted(context, env, room.id);
};

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!env.DB) return json({ error: "D1データベースが接続されていません" }, 500);
  if (!env.CLEANUP_SECRET || request.headers.get("x-cleanup-secret") !== env.CLEANUP_SECRET) {
    return json({ error: "Forbidden" }, 403);
  }

  const rows = await env.DB.prepare(
    "SELECT id,log_json,created_at FROM rooms WHERE created_at <= datetime('now','-7 days') ORDER BY created_at ASC LIMIT 100"
  ).all();

  let deleted = 0;
  const failed = [];
  for (const room of rows.results || []) {
    try {
      await deleteExpiredRoom(context, env, room);
      deleted++;
    } catch (error) {
      failed.push({ id: room.id, error: String(error?.message || error).slice(0, 180) });
    }
  }

  return json({ ok: failed.length === 0, deleted, failed });
}
