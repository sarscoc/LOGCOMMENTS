const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
});

const randomToken = (bytes = 18) => {
  const data = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...data)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
};

const safeBody = async request => {
  try { return await request.json(); } catch { return null; }
};

export async function onRequest(context) {
  const { request, env, params } = context;
  if (!env.DB) return json({ error: "D1データベースが接続されていません" }, 500);
  const parts = Array.isArray(params.path) ? params.path : String(params.path || "").split("/").filter(Boolean);
  const method = request.method;

  if (method === "POST" && parts[0] === "rooms" && parts.length === 1) {
    const body = await safeBody(request);
    if (!body || !Array.isArray(body.messages) || !body.messages.length) return json({ error: "ログが空です" }, 400);
    if (JSON.stringify(body.messages).length > 8_000_000) return json({ error: "ログが大きすぎます" }, 413);
    const id = randomToken(20);
    const adminToken = randomToken(24);
    await env.DB.prepare("INSERT INTO rooms (id,title,log_json,admin_token) VALUES (?,?,?,?)")
      .bind(id, String(body.title || "TRPG LOG").slice(0, 200), JSON.stringify({ messages: body.messages, tabs: body.tabs || [] }), adminToken).run();
    return json({ id, adminToken }, 201);
  }

  if (method === "GET" && parts[0] === "rooms" && parts[1] && parts.length === 2) {
    const room = await env.DB.prepare("SELECT id,title,log_json,created_at FROM rooms WHERE id=?").bind(parts[1]).first();
    if (!room) return json({ error: "部屋が見つかりません" }, 404);
    const log = JSON.parse(room.log_json);
    return json({ id: room.id, title: room.title, createdAt: room.created_at, ...log });
  }

  if (parts[0] === "rooms" && parts[1] && parts[2] === "annotations") {
    const roomId = parts[1];
    if (method === "GET") {
      const result = await env.DB.prepare("SELECT * FROM annotations WHERE room_id=? ORDER BY created_at,id").bind(roomId).all();
      return json({ annotations: result.results || [] });
    }
    if (method === "POST") {
      const body = await safeBody(request);
      const required = ["messageId", "quote", "authorName", "personaName", "personaType", "body"];
      const missing = !body ? required : required.filter(key => body[key] == null || String(body[key]).trim() === "");
      if (missing.length) return json({ error: `入力が足りません（${missing.join(", ")}）` }, 400);
      const exists = await env.DB.prepare("SELECT id FROM rooms WHERE id=?").bind(roomId).first();
      if (!exists) return json({ error: "部屋が見つかりません" }, 404);
      const id = randomToken(16);
      await env.DB.prepare(`INSERT INTO annotations
        (id,room_id,message_id,end_message_id,start_offset,end_offset,quote,color,author_id,author_name,persona_name,persona_type,persona_icon,body)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(
          id, roomId, String(body.messageId), String(body.endMessageId || body.messageId), Number(body.startOffset) || 0, Number(body.endOffset) || 0,
          String(body.quote).slice(0, 2000), String(body.color || "yellow"), String(body.authorId || randomToken(12)).slice(0, 100),
          String(body.authorName).slice(0, 80), String(body.personaName).slice(0, 80), String(body.personaType).slice(0, 20), String(body.personaIcon || "").slice(0, 100_000),
          String(body.body).slice(0, 4000)
        ).run();
      const row = await env.DB.prepare("SELECT * FROM annotations WHERE id=?").bind(id).first();
      return json(row, 201);
    }
  }
  return json({ error: "Not found" }, 404);
}
