const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
});

const ensureRoomLifecycleColumns = async db => {
  const info = await db.prepare("PRAGMA table_info(rooms)").all();
  const names = new Set((info.results || []).map(column => column.name));
  if (!names.has("owner_id")) {
    try {
      await db.prepare("ALTER TABLE rooms ADD COLUMN owner_id TEXT NOT NULL DEFAULT ''").run();
    } catch (error) {
      if (!String(error).includes("duplicate column")) throw error;
    }
  }
  if (!names.has("last_activity_at")) {
    try {
      await db.prepare("ALTER TABLE rooms ADD COLUMN last_activity_at TEXT NOT NULL DEFAULT ''").run();
    } catch (error) {
      if (!String(error).includes("duplicate column")) throw error;
    }
  }
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_rooms_owner ON rooms(owner_id)").run();
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_rooms_activity ON rooms(last_activity_at)").run();

  // Existing rooms are not reset to 'now'. Preserve their real history as much as
  // possible by using the newest saved comment/like, otherwise the creation time.
  await db.prepare(`UPDATE rooms
    SET last_activity_at = COALESCE(
      (SELECT MAX(activity_at) FROM (
        SELECT a.created_at AS activity_at FROM annotations a WHERE a.room_id=rooms.id
        UNION ALL
        SELECT l.created_at AS activity_at
          FROM annotation_likes l
          JOIN annotations a ON a.id=l.annotation_id
         WHERE a.room_id=rooms.id
      )),
      created_at
    )
    WHERE last_activity_at='' OR last_activity_at IS NULL`).run();

  // The main room-creation handler still contains an older owner-count safety check.
  // Expired rooms must not be counted there while they wait for the hourly cleanup.
  await db.prepare(`UPDATE rooms
    SET owner_id=''
    WHERE owner_id<>''
      AND COALESCE(NULLIF(last_activity_at,''),created_at) <= datetime('now','-7 days')`).run();
};

const roomIdFromPath = pathname => {
  const match = pathname.match(/^\/api\/rooms\/([^/]+)(?:\/|$)/);
  return match ? decodeURIComponent(match[1]) : "";
};

const isContentMutation = (method, pathname) => {
  if (!["POST", "PATCH", "DELETE"].includes(method)) return false;
  return /^\/api\/rooms\/[^/]+\/annotations(?:\/[^/]+(?:\/like)?)?$/.test(pathname);
};

export async function onRequest(context) {
  const { request, env } = context;
  if (!env.DB) return context.next();

  await ensureRoomLifecycleColumns(env.DB);

  const url = new URL(request.url);
  const pathname = url.pathname;
  const method = request.method.toUpperCase();

  // Regular users may keep only one active cloud room. A room whose last
  // meaningful content update was more than seven days ago no longer counts.
  if (method === "POST" && pathname === "/api/rooms") {
    const body = await request.clone().json().catch(() => null);
    const ownerId = String(body?.creatorId || "").slice(0, 100);
    const isSiteOwner = !!env.SITE_OWNER_KEY && request.headers.get("x-site-owner-key") === env.SITE_OWNER_KEY;

    if (ownerId && !isSiteOwner) {
      const owned = await env.DB.prepare(
        "SELECT COUNT(*) AS count FROM rooms WHERE owner_id=? AND COALESCE(NULLIF(last_activity_at,''),created_at) > datetime('now','-7 days')"
      ).bind(ownerId).first();

      if (Number(owned?.count || 0) >= 1) {
        return json({
          error: "クラウドに作成できる部屋は1人1部屋までです。最終更新から7日で自動削除されます。必要なら先にログを保存してから削除してください。"
        }, 403);
      }
    }
  }

  // Expired rooms are unavailable immediately, even before the hourly physical
  // cleanup has removed their D1/R2 data.
  const roomId = roomIdFromPath(pathname);
  if (roomId) {
    const room = await env.DB.prepare(
      "SELECT COALESCE(NULLIF(last_activity_at,''),created_at) <= datetime('now','-7 days') AS expired FROM rooms WHERE id=?"
    ).bind(roomId).first();
    if (Number(room?.expired || 0) === 1) {
      return json({
        error: "この部屋は最終更新から7日が経過したため削除されました。保存済みのZIPがある場合はオフライン版として開けます。"
      }, 410);
    }
  }

  const response = await context.next();

  // Creating a room starts its seven-day clock. After that, only meaningful
  // content changes extend it; viewing, presence and typing do not.
  if (response.ok && method === "POST" && pathname === "/api/rooms") {
    try {
      const result = await response.clone().json();
      if (result?.id) {
        await env.DB.prepare("UPDATE rooms SET last_activity_at=CURRENT_TIMESTAMP WHERE id=?").bind(String(result.id)).run();
      }
    } catch {}
  } else if (response.ok && roomId && isContentMutation(method, pathname)) {
    await env.DB.prepare("UPDATE rooms SET last_activity_at=CURRENT_TIMESTAMP WHERE id=?").bind(roomId).run();
  }

  return response;
}
