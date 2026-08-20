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
  await db.prepare(`CREATE TABLE IF NOT EXISTS presence (room_id TEXT NOT NULL,author_id TEXT NOT NULL,pl_name TEXT NOT NULL,pl_icon TEXT NOT NULL DEFAULT '',is_typing INTEGER NOT NULL DEFAULT 0,typing_name TEXT NOT NULL DEFAULT '',typing_icon TEXT NOT NULL DEFAULT '',typing_message_id TEXT NOT NULL DEFAULT '',last_seen TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,PRIMARY KEY (room_id,author_id))`).run();
  const info=await db.prepare("PRAGMA table_info(presence)").all();
  const names=new Set((info.results||[]).map(column=>column.name));for(const [name,type] of [["is_typing","INTEGER NOT NULL DEFAULT 0"],["typing_name","TEXT NOT NULL DEFAULT ''"],["typing_icon","TEXT NOT NULL DEFAULT ''"],["typing_message_id","TEXT NOT NULL DEFAULT ''"]])if(!names.has(name)){try{await db.prepare(`ALTER TABLE presence ADD COLUMN ${name} ${type}`).run()}catch(error){if(!String(error).includes("duplicate column"))throw error}}
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_presence_room_seen ON presence(room_id,last_seen)").run();
};
const ensureAnnotationColumns = async db => {
  const info=await db.prepare("PRAGMA table_info(annotations)").all(),names=new Set((info.results||[]).map(column=>column.name));
  if(!names.has("persona_icon")){try{await db.prepare("ALTER TABLE annotations ADD COLUMN persona_icon TEXT NOT NULL DEFAULT ''").run()}catch(error){if(!String(error).includes("duplicate column"))throw error}}
  if(!names.has("end_message_id")){try{await db.prepare("ALTER TABLE annotations ADD COLUMN end_message_id TEXT NOT NULL DEFAULT ''").run()}catch(error){if(!String(error).includes("duplicate column"))throw error}}
  if(!names.has("parent_id")){try{await db.prepare("ALTER TABLE annotations ADD COLUMN parent_id TEXT NOT NULL DEFAULT ''").run()}catch(error){if(!String(error).includes("duplicate column"))throw error}}
  if(!names.has("image_data")){try{await db.prepare("ALTER TABLE annotations ADD COLUMN image_data TEXT NOT NULL DEFAULT ''").run()}catch(error){if(!String(error).includes("duplicate column"))throw error}}
};
const ensureAnnotationLikes = async db => {
  await db.prepare("CREATE TABLE IF NOT EXISTS annotation_likes (annotation_id TEXT NOT NULL,author_id TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,PRIMARY KEY(annotation_id,author_id))").run();
};
const ensureLogChunksTable = async db => {
  await db.prepare(`CREATE TABLE IF NOT EXISTS room_log_chunks (room_id TEXT NOT NULL,chunk_index INTEGER NOT NULL,messages_json TEXT NOT NULL,PRIMARY KEY (room_id,chunk_index),FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE)`).run();
};
const ensureRoomOwnerColumn = async db => {
  const info=await db.prepare("PRAGMA table_info(rooms)").all(),names=new Set((info.results||[]).map(column=>column.name));
  if(!names.has("owner_id")){try{await db.prepare("ALTER TABLE rooms ADD COLUMN owner_id TEXT NOT NULL DEFAULT ''").run()}catch(error){if(!String(error).includes("duplicate column"))throw error}}
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_rooms_owner ON rooms(owner_id)").run();
};
const splitMessages = (messages,maxChars=300000) => {
  const chunks=[];let current=[],size=2;
  for(const message of messages){const text=JSON.stringify(message),next=size+text.length+(current.length?1:0);if(current.length&&next>maxChars){chunks.push(current);current=[];size=2}current.push(message);size+=text.length+(current.length>1?1:0)}
  if(current.length)chunks.push(current);return chunks;
};

export async function onRequest(context) {
  const { request, env, params } = context;
  if (!env.DB) return json({ error: "D1データベースが接続されていません" }, 500);
  const parts = Array.isArray(params.path) ? params.path : String(params.path || "").split("/").filter(Boolean);
  const method = request.method;

  if (method === "POST" && parts[0] === "rooms" && parts.length === 1) {
    const body = await safeBody(request);
    if (!body || !Array.isArray(body.messages) || !body.messages.length) return json({ error: "ログが空です" }, 400);
    const ownerId=String(body.creatorId||"").slice(0,100);if(!ownerId)return json({error:"作成者情報がありません"},400);
    await ensureRoomOwnerColumn(env.DB);const isSiteOwner=!!env.SITE_OWNER_KEY&&request.headers.get("x-site-owner-key")===env.SITE_OWNER_KEY;
    if(!isSiteOwner){const owned=await env.DB.prepare("SELECT COUNT(*) AS count FROM rooms WHERE owner_id=?").bind(ownerId).first();if(Number(owned?.count||0)>=5)return json({error:"クラウドに保存できる部屋は5件までです。部屋を保存して、使わない部屋を削除してください。"},403)}
    if (JSON.stringify(body.messages).length > 25_000_000) return json({ error: "ログが大きすぎます（25MBまで）" }, 413);
    const id = randomToken(20);
    const adminToken = randomToken(24);
    const chunks=splitMessages(body.messages);
    try{
      await ensureLogChunksTable(env.DB);
      await env.DB.prepare("INSERT INTO rooms (id,title,log_json,admin_token,owner_id) VALUES (?,?,?,?,?)").bind(id,String(body.title||"TRPG LOG").slice(0,200),JSON.stringify({tabs:body.tabs||[],chunked:true,messageCount:body.messages.length}),adminToken,ownerId).run();
      for(let index=0;index<chunks.length;index++)await env.DB.prepare("INSERT INTO room_log_chunks (room_id,chunk_index,messages_json) VALUES (?,?,?)").bind(id,index,JSON.stringify(chunks[index])).run();
      return json({id,adminToken},201);
    }catch(error){try{await env.DB.prepare("DELETE FROM room_log_chunks WHERE room_id=?").bind(id).run();await env.DB.prepare("DELETE FROM rooms WHERE id=?").bind(id).run()}catch{}return json({error:`ログの保存に失敗しました: ${String(error?.message||error).slice(0,180)}`},500)}
  }

  if (method === "GET" && parts[0] === "rooms" && parts[1] && parts.length === 2) {
    const room = await env.DB.prepare("SELECT id,title,log_json,created_at FROM rooms WHERE id=?").bind(parts[1]).first();
    if (!room) return json({ error: "部屋が見つかりません" }, 404);
    if(new URL(request.url).searchParams.get("summary")==="1")return json({id:room.id,title:room.title,createdAt:room.created_at});
    const log = JSON.parse(room.log_json);
    if(log.chunked){await ensureLogChunksTable(env.DB);const indexRows=await env.DB.prepare("SELECT chunk_index FROM room_log_chunks WHERE room_id=? ORDER BY chunk_index").bind(parts[1]).all();log.messages=[];for(const item of indexRows.results||[]){const row=await env.DB.prepare("SELECT messages_json FROM room_log_chunks WHERE room_id=? AND chunk_index=?").bind(parts[1],item.chunk_index).first();if(row?.messages_json)log.messages.push(...JSON.parse(row.messages_json))}}
    return json({ id: room.id, title: room.title, createdAt: room.created_at, ...log });
  }

  if(method==="DELETE"&&parts[0]==="rooms"&&parts[1]&&parts.length===2){const room=await env.DB.prepare("SELECT admin_token FROM rooms WHERE id=?").bind(parts[1]).first();if(!room)return json({error:"部屋が見つかりません"},404);if(!request.headers.get("x-admin-token")||request.headers.get("x-admin-token")!==room.admin_token)return json({error:"部屋主だけが削除できます"},403);await ensureLogChunksTable(env.DB);await ensurePresenceTable(env.DB);await env.DB.batch([env.DB.prepare("DELETE FROM annotations WHERE room_id=?").bind(parts[1]),env.DB.prepare("DELETE FROM presence WHERE room_id=?").bind(parts[1]),env.DB.prepare("DELETE FROM room_log_chunks WHERE room_id=?").bind(parts[1]),env.DB.prepare("DELETE FROM rooms WHERE id=?").bind(parts[1])]);return json({ok:true})}

  if (parts[0] === "rooms" && parts[1] && parts[2] === "annotations") {
    await ensureAnnotationColumns(env.DB);
    await ensureAnnotationLikes(env.DB);
    const roomId = parts[1];
    if(method==="GET"&&parts[3]&&parts[4]==="image"){
      const row=await env.DB.prepare("SELECT image_data FROM annotations WHERE room_id=? AND id=?").bind(roomId,parts[3]).first();
      if(!row?.image_data)return new Response("Not found",{status:404});
      const match=String(row.image_data).match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
      if(!match)return new Response("Invalid image",{status:415});
      const binary=atob(match[2]),bytes=new Uint8Array(binary.length);for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);
      return new Response(bytes,{headers:{"content-type":match[1],"cache-control":"private, max-age=31536000, immutable"}});
    }
    if (method === "GET") {
      const viewer=new URL(request.url).searchParams.get("authorId")||"";
      const result = await env.DB.prepare("SELECT a.id,a.room_id,a.message_id,a.end_message_id,a.parent_id,a.start_offset,a.end_offset,a.quote,a.color,a.author_id,a.author_name,a.persona_name,a.persona_type,a.persona_icon,a.body,a.created_at,CASE WHEN a.image_data<>'' THEN 1 ELSE 0 END AS has_image,(SELECT COUNT(*) FROM annotation_likes l WHERE l.annotation_id=a.id) AS like_count,EXISTS(SELECT 1 FROM annotation_likes l WHERE l.annotation_id=a.id AND l.author_id=?) AS liked_by_me FROM annotations a WHERE a.room_id=? ORDER BY a.created_at,a.id").bind(viewer,roomId).all();
      return json({ annotations: result.results || [] });
    }
    if (method === "POST" && parts.length === 3) {
      const body = await safeBody(request);
      const required = ["messageId", "quote", "authorName", "personaName", "personaType"];
      const missing = !body ? required : required.filter(key => body[key] == null || String(body[key]).trim() === "");
      if (missing.length) return json({ error: `入力が足りません（${missing.join(", ")}）` }, 400);
      if(!String(body.body||"").trim())return json({error:"感想を入力してください"},400);
      const exists = await env.DB.prepare("SELECT id FROM rooms WHERE id=?").bind(roomId).first();
      if (!exists) return json({ error: "部屋が見つかりません" }, 404);
      const id = randomToken(16);
      await env.DB.prepare(`INSERT INTO annotations
        (id,room_id,message_id,end_message_id,parent_id,start_offset,end_offset,quote,color,author_id,author_name,persona_name,persona_type,persona_icon,body,image_data)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(
          id, roomId, String(body.messageId), String(body.endMessageId || body.messageId), String(body.parentId||""), Number(body.startOffset) || 0, Number(body.endOffset) || 0,
          String(body.quote).slice(0, 2000), String(body.color || "yellow"), String(body.authorId || randomToken(12)).slice(0, 100),
          String(body.authorName).slice(0, 80), String(body.personaName).slice(0, 80), String(body.personaType).slice(0, 20), String(body.personaIcon || "").slice(0, 100_000),
          String(body.body||"").slice(0, 4000),""
        ).run();
      const row = await env.DB.prepare("SELECT * FROM annotations WHERE id=?").bind(id).first();
      return json(row, 201);
    }
    if(method==="POST"&&parts[3]&&parts[4]==="like"){const body=await safeBody(request),authorId=String(body?.authorId||"").slice(0,100);if(!authorId)return json({error:"参加者情報が必要です"},400);const exists=await env.DB.prepare("SELECT id FROM annotations WHERE room_id=? AND id=?").bind(roomId,parts[3]).first();if(!exists)return json({error:"コメントが見つかりません"},404);const liked=await env.DB.prepare("SELECT 1 FROM annotation_likes WHERE annotation_id=? AND author_id=?").bind(parts[3],authorId).first();if(liked)await env.DB.prepare("DELETE FROM annotation_likes WHERE annotation_id=? AND author_id=?").bind(parts[3],authorId).run();else await env.DB.prepare("INSERT INTO annotation_likes(annotation_id,author_id) VALUES(?,?)").bind(parts[3],authorId).run();return json({liked:!liked})}
    if(method==="DELETE"&&parts[3]){const body=await safeBody(request),annotation=await env.DB.prepare("SELECT author_id FROM annotations WHERE room_id=? AND id=?").bind(roomId,parts[3]).first();if(!annotation)return json({error:"コメントが見つかりません"},404);const room=await env.DB.prepare("SELECT admin_token FROM rooms WHERE id=?").bind(roomId).first(),isAdmin=room&&request.headers.get("x-admin-token")===room.admin_token;if(!isAdmin&&(!body?.authorId||String(body.authorId)!==annotation.author_id))return json({error:"自分のコメントだけ削除できます"},403);await env.DB.prepare("DELETE FROM annotation_likes WHERE annotation_id IN (WITH RECURSIVE descendants(id) AS (SELECT id FROM annotations WHERE room_id=? AND id=? UNION ALL SELECT a.id FROM annotations a JOIN descendants d ON a.parent_id=d.id WHERE a.room_id=?) SELECT id FROM descendants)").bind(roomId,parts[3],roomId).run();await env.DB.prepare(`WITH RECURSIVE descendants(id) AS (SELECT id FROM annotations WHERE room_id=? AND id=? UNION ALL SELECT a.id FROM annotations a JOIN descendants d ON a.parent_id=d.id WHERE a.room_id=?) DELETE FROM annotations WHERE room_id=? AND id IN (SELECT id FROM descendants)`).bind(roomId,parts[3],roomId,roomId).run();return json({ok:true})}
    if(method==="PATCH"&&parts[3]&&parts[3]!=="color"){
      const body=await safeBody(request),annotation=await env.DB.prepare("SELECT author_id,image_data FROM annotations WHERE room_id=? AND id=?").bind(roomId,parts[3]).first();if(!annotation)return json({error:"コメントが見つかりません"},404);if(!body?.authorId||String(body.authorId)!==annotation.author_id)return json({error:"自分のコメントだけ編集できます"},403);
      const imageData=body.imageData===null?annotation.image_data:String(body.imageData||"").slice(0,700000),text=String(body.body||"").trim();if(!text&&!imageData)return json({error:"感想または画像を入力してください"},400);
      await env.DB.prepare("UPDATE annotations SET body=?,color=?,persona_name=?,persona_type=?,persona_icon=?,image_data=? WHERE room_id=? AND id=?").bind(text.slice(0,4000),String(body.color||"yellow").slice(0,40),String(body.personaName||"").slice(0,80),String(body.personaType||"").slice(0,20),String(body.personaIcon||"").slice(0,100000),imageData,roomId,parts[3]).run();return json({ok:true});
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
    if(method==="GET"){const result=await env.DB.prepare("SELECT pl_name,pl_icon,is_typing,typing_name,typing_icon,typing_message_id,last_seen FROM presence WHERE room_id=? AND last_seen >= datetime('now','-70 seconds') ORDER BY last_seen DESC").bind(roomId).all();return json({presence:result.results||[]})}
    if(method==="POST"){
      const body=await safeBody(request);if(!body?.authorId||!String(body.plName||"").trim())return json({error:"PL名が必要です"},400);
      await env.DB.prepare(`INSERT INTO presence (room_id,author_id,pl_name,pl_icon,is_typing,typing_name,typing_icon,typing_message_id,last_seen) VALUES (?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)
        ON CONFLICT(room_id,author_id) DO UPDATE SET pl_name=excluded.pl_name,pl_icon=excluded.pl_icon,is_typing=excluded.is_typing,typing_name=excluded.typing_name,typing_icon=excluded.typing_icon,typing_message_id=excluded.typing_message_id,last_seen=CURRENT_TIMESTAMP`).bind(roomId,String(body.authorId).slice(0,100),String(body.plName).slice(0,80),String(body.plIcon||"").slice(0,100000),body.isTyping?1:0,String(body.typingName||"").slice(0,80),String(body.typingIcon||"").slice(0,100000),String(body.typingMessageId||"").slice(0,100)).run();
      const result=await env.DB.prepare("SELECT pl_name,pl_icon,is_typing,typing_name,typing_icon,typing_message_id,last_seen FROM presence WHERE room_id=? AND last_seen >= datetime('now','-70 seconds') ORDER BY last_seen DESC").bind(roomId).all();return json({presence:result.results||[]})
    }
  }
  return json({ error: "Not found" }, 404);
}
