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

const ensurePresenceTable = async db => {
  await db.prepare(`CREATE TABLE IF NOT EXISTS presence (room_id TEXT NOT NULL,author_id TEXT NOT NULL,pl_name TEXT NOT NULL,pl_icon TEXT NOT NULL DEFAULT '',is_typing INTEGER NOT NULL DEFAULT 0,last_seen TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,PRIMARY KEY (room_id,author_id))`).run();
  const info=await db.prepare("PRAGMA table_info(presence)").all();
  if(!(info.results||[]).some(column=>column.name==="is_typing")){try{await db.prepare("ALTER TABLE presence ADD COLUMN is_typing INTEGER NOT NULL DEFAULT 0").run()}catch(error){if(!String(error).includes("duplicate column"))throw error}}
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_presence_room_seen ON presence(room_id,last_seen)").run();
};
const ensureAnnotationColumns = async db => {
  const info=await db.prepare("PRAGMA table_info(annotations)").all(),names=new Set((info.results||[]).map(column=>column.name));
  if(!names.has("persona_icon")){try{await db.prepare("ALTER TABLE annotations ADD COLUMN persona_icon TEXT NOT NULL DEFAULT ''").run()}catch(error){if(!String(error).includes("duplicate column"))throw error}}
  if(!names.has("end_message_id")){try{await db.prepare("ALTER TABLE annotations ADD COLUMN end_message_id TEXT NOT NULL DEFAULT ''").run()}catch(error){if(!String(error).includes("duplicate column"))throw error}}
  if(!names.has("parent_id")){try{await db.prepare("ALTER TABLE annotations ADD COLUMN parent_id TEXT NOT NULL DEFAULT ''").run()}catch(error){if(!String(error).includes("duplicate column"))throw error}}
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
    await ensureAnnotationColumns(env.DB);
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
        (id,room_id,message_id,end_message_id,parent_id,start_offset,end_offset,quote,color,author_id,author_name,persona_name,persona_type,persona_icon,body)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(
          id, roomId, String(body.messageId), String(body.endMessageId || body.messageId), String(body.parentId||""), Number(body.startOffset) || 0, Number(body.endOffset) || 0,
          String(body.quote).slice(0, 2000), String(body.color || "yellow"), String(body.authorId || randomToken(12)).slice(0, 100),
          String(body.authorName).slice(0, 80), String(body.personaName).slice(0, 80), String(body.personaType).slice(0, 20), String(body.personaIcon || "").slice(0, 100_000),
          String(body.body).slice(0, 4000)
        ).run();
      const row = await env.DB.prepare("SELECT * FROM annotations WHERE id=?").bind(id).first();
      return json(row, 201);
    }
    if(method==="PATCH"&&parts[3]==="color"){
      const body=await safeBody(request),color=String(body?.color||"");
      if(!body?.authorId||!body?.personaName||!body?.personaType||!color)return json({error:"色の更新情報が足りません"},400);
      await env.DB.prepare("UPDATE annotations SET color=? WHERE room_id=? AND author_id=? AND persona_name=? AND persona_type=?").bind(color.slice(0,40),roomId,String(body.authorId).slice(0,100),String(body.personaName).slice(0,80),String(body.personaType).slice(0,20)).run();
      return json({ok:true});
    }
  }
  if (parts[0] === "rooms" && parts[1] && parts[2] === "presence") {
    const roomId=parts[1];
    await ensurePresenceTable(env.DB);
    if(method==="GET"){const result=await env.DB.prepare("SELECT pl_name,pl_icon,is_typing,last_seen FROM presence WHERE room_id=? AND last_seen >= datetime('now','-70 seconds') ORDER BY last_seen DESC").bind(roomId).all();return json({presence:result.results||[]})}
    if(method==="POST"){
      const body=await safeBody(request);if(!body?.authorId||!String(body.plName||"").trim())return json({error:"PL名が必要です"},400);
      await env.DB.prepare(`INSERT INTO presence (room_id,author_id,pl_name,pl_icon,is_typing,last_seen) VALUES (?,?,?,?,?,CURRENT_TIMESTAMP)
        ON CONFLICT(room_id,author_id) DO UPDATE SET pl_name=excluded.pl_name,pl_icon=excluded.pl_icon,is_typing=excluded.is_typing,last_seen=CURRENT_TIMESTAMP`).bind(roomId,String(body.authorId).slice(0,100),String(body.plName).slice(0,80),String(body.plIcon||"").slice(0,100000),body.isTyping?1:0).run();
      const result=await env.DB.prepare("SELECT pl_name,pl_icon,is_typing,last_seen FROM presence WHERE room_id=? AND last_seen >= datetime('now','-70 seconds') ORDER BY last_seen DESC").bind(roomId).all();return json({presence:result.results||[]})
    }
  }
  return json({ error: "Not found" }, 404);
}
