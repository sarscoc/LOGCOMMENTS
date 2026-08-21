const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
});

const ensureRoomOwnerColumn = async db => {
  const info = await db.prepare("PRAGMA table_info(rooms)").all();
  const names = new Set((info.results || []).map(column => column.name));
  if (!names.has("owner_id")) {
    try {
      await db.prepare("ALTER TABLE rooms ADD COLUMN owner_id TEXT NOT NULL DEFAULT ''").run();
    } catch (error) {
      if (!String(error).includes("duplicate column")) throw error;
    }
  }
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_rooms_owner ON rooms(owner_id)").run();
};

const roomIdFromPath = pathname => {
  const match = pathname.match(/^\/api\/rooms\/([^/]+)(?:\/|$)/);
  return match ? decodeURIComponent(match[1]) : "";
};

export async function onRequest(context) {
  const { request, env } = context;
  if (!env.DB) return context.next();

  const url = new URL(request.url);
  const pathname = url.pathname;
  const method = request.method.toUpperCase();

  // New rooms: regular users may keep only one active cloud room.
  // Expired rooms do not count, so an old room never blocks creation of a new one.
  if (method === "POST" && pathname === "/api/rooms") {
    const body = await request.clone().json().catch(() => null);
    const ownerId = String(body?.creatorId || "").slice(0, 100);
    const isSiteOwner = !!env.SITE_OWNER_KEY && request.headers.get("x-site-owner-key") === env.SITE_OWNER_KEY;

    if (ownerId && !isSiteOwner) {
      await ensureRoomOwnerColumn(env.DB);
      const owned = await env.DB.prepare(
        "SELECT COUNT(*) AS count FROM rooms WHERE owner_id=? AND created_at > datetime('now','-7 days')"
      ).bind(ownerId).first();

      if (Number(owned?.count || 0) >= 1) {
        return json({
          error: "クラウドに作成できる部屋は1人1部屋までです。部屋は作成から7日で自動削除されます。必要なら先に部屋をZIP保存してから削除してください。"
        }, 403);
      }
    }
  }

  // Once seven days have elapsed, the room is immediately unavailable even
  // before the hourly physical cleanup has run.
  const roomId = roomIdFromPath(pathname);
  if (roomId) {
    const room = await env.DB.prepare(
      "SELECT created_at <= datetime('now','-7 days') AS expired FROM rooms WHERE id=?"
    ).bind(roomId).first();
    if (Number(room?.expired || 0) === 1) {
      return json({
        error: "この部屋は作成から7日が経過したため削除されました。保存済みのZIPがある場合はオフライン版として開けます。"
      }, 410);
    }
  }

  return context.next();
}
