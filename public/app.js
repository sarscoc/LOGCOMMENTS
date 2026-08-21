const $ = s => document.querySelector(s);
const state = { roomId: null, room: null, annotations: [], annotationVersion: -1, presence: [], parsed: null, selection: null, pendingSelection: null, replyTo: null, editingCommentId: null, editingOriginalPersona: null, commentImage: "", activeTabIndex: 0, carouselPosition: 1, isSliding: false, slideQueue: 0, readingAnchor: "", syncingScrollUntil: 0, viewMode: localStorage.getItem("trpgMarkerViewMode") || "compact", mainTab: "", hiddenTabs: new Set(), timelineSlots: [], glimpseFrame: 0, glimpseTimer: 0, suggestionTimer: null, newPersonaIcon: "", profile: null, legacyPersonas: [], lastPersona: "PL", realtime: null, realtimeReconnectTimer: null, realtimeAttempts: 0, fallbackPoller: null, realtimeWanted: false, isTyping: false, typingTimer: null };
const uid = () => crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now();
state.realtimeClientId=uid();
const esc = value => String(value ?? "").replace(/[&<>\"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
function isImageUrl(url){return /\.(?:png|jpe?g|gif|webp|avif)(?:[?#]|$)/i.test(url)||/[?&]format=(?:png|jpe?g|gif|webp|avif)(?:&|$)/i.test(url)||/(?:i\.imgur\.com|cdn\.discordapp\.com|media\.discordapp\.net|pbs\.twimg\.com|files\.catbox\.moe|oaiusercontent\.com)/i.test(url)}
function commentBodyHtml(value){const urlPattern=/(https:\/\/[^\s<>"']+)/g;return String(value||"").split(urlPattern).map(part=>{if(!/^https:\/\//.test(part))return esc(part);const safe=esc(part),embedded=state.archiveImages?.[part];return isImageUrl(part)?`<img class="comment-image url-image" data-expand-image src="${esc(embedded||part)}" alt="引用画像" loading="lazy" referrerpolicy="no-referrer">`:`<a class="comment-link" href="${safe}" target="_blank" rel="noopener noreferrer">${safe}</a>`}).join("")}
state.archiveMode=false;state.deleteTarget=null;state.archiveImages={};
const safeFilename=value=>(String(value||"TRPGログ").replace(/[\\/:*?"<>|]/g,"_").trim()||"TRPGログ").slice(0,80);
function archiveData(room,annotations,personas=[]){return{format:"trpg-log-marker",version:2,exportedAt:new Date().toISOString(),theme:document.documentElement.classList.contains("dark")?"dark":"light",room:{title:room.title||"TRPG LOG",createdAt:room.createdAt||"",tabs:room.tabs||[],messages:room.messages||[]},annotations:(annotations||[]).map(({liked_by_me,...item})=>item),personas}}
function standaloneArchiveHtml(data){const tabs=data.room.tabs||[],messages=data.room.messages||[],annotations=data.annotations||[],byMessage=new Map();annotations.forEach(a=>{if(!a.parent_id){const list=byMessage.get(a.message_id)||[];list.push(a);byMessage.set(a.message_id,list)}});const tabButtons=tabs.map((tab,i)=>`<button data-tab="${i}">${esc(tab)}</button>`).join("");const pages=tabs.map((tab,i)=>`<section class="page" data-page="${i}"${i?' hidden':''}>${messages.filter(m=>m.tab===tab).map(m=>`<p style="color:${esc(m.color||'inherit')}"><time>${esc(m.time||'')}</time><b>${esc(m.speaker||'')}${m.speaker?'：':''}</b>${esc(m.text||'')}${(byMessage.get(m.id)||[]).map(a=>`<mark title="${esc(a.persona_name)}：${esc(a.body)}" style="--c:${esc(markerColor(a.color))}"></mark>`).join('')}</p>`).join('')}</section>`).join('');const comments=annotations.map(a=>`<article><header>${esc(a.persona_name)}［${esc(a.persona_type)}］ <small>${esc(a.created_at||'')} ${Number(a.like_count)||''}♥</small></header><div>${commentBodyHtml(a.body||'')}</div></article>`).join('');return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${esc(data.room.title)}</title><style>:root{color-scheme:light dark}*{box-sizing:border-box}body{margin:0;font:14px/1.7 system-ui;background:#f4f6fa;color:#171a20}nav{position:sticky;top:0;padding:10px;text-align:center;background:#ffffffdd;backdrop-filter:blur(10px)}button{border:0;border-radius:999px;padding:5px 12px;margin:2px}main{display:grid;grid-template-columns:1fr 320px;gap:12px;padding:12px}.log,.comments{background:#fff;border-radius:14px;padding:14px}.page p{position:relative;margin:3px 0;white-space:pre-wrap}.page time{float:right;color:#999;font-size:10px}.page b{margin-right:4px}.page mark{display:inline-block;width:7px;height:7px;margin-left:4px;border-radius:50%;background:var(--c)}article{border-left:3px solid #9ebcff;padding:8px;margin:8px 0;background:#f7f8fb;border-radius:8px}article header{font-weight:700}article small{float:right;color:#888;font-weight:400}article img{max-width:100%;max-height:360px}@media(max-width:760px){main{grid-template-columns:1fr}.comments{order:-1}}@media(prefers-color-scheme:dark){body{background:#303030;color:#eee}.log,.comments,nav{background:#424242}article{background:#383838}}</style></head><body><nav>${tabButtons}</nav><main><div class="log">${pages}</div><aside class="comments">${comments||'<p>コメントはありません。</p>'}</aside></main><script>document.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>{document.querySelectorAll('[data-page]').forEach(p=>p.hidden=p.dataset.page!==b.dataset.tab)})<\/script></body></html>`}
const blobDataUrl=blob=>new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(blob)});
async function collectArchiveImages(data){const images={};const urls=[...new Set((data.annotations||[]).flatMap(a=>(String(a.body||"").match(/https:\/\/[^\s<>"']+/g)||[]).filter(isImageUrl)))];await Promise.all(urls.map(async url=>{try{const response=await fetch(url);if(response.ok&&response.headers.get("content-type")?.startsWith("image/"))images[url]=await blobDataUrl(await response.blob())}catch{}}));await Promise.all((data.annotations||[]).map(async a=>{if(a.persona_icon&&!String(a.persona_icon).startsWith("data:image/")){try{const response=await fetch(a.persona_icon);if(response.ok)a.persona_icon=await blobDataUrl(await response.blob())}catch{}}if(a.has_image){try{const response=await fetch(`/api/rooms/${encodeURIComponent(state.roomId)}/annotations/${encodeURIComponent(a.id)}/image`);if(response.ok)images[`annotation:${a.id}`]=await blobDataUrl(await response.blob())}catch{}}}));data.archiveImages=images;return data}
async function fullArchiveHtml(data){const [markup,css,script]=await Promise.all(["index.html","style.css","app.js"].map(async path=>{const response=await fetch(path);if(!response.ok)throw new Error(`保存用ファイルを取得できません（${path}）`);return response.text()}));const payload=JSON.stringify(data).replace(/</g,"\\u003c"),safeCss=css.replace(/<\/style/gi,"<\\/style"),safeScript=script.replace(/<\/script/gi,"<\\/script");return markup.replace('<link rel="stylesheet" href="style.css">',`<style>${safeCss}</style>`).replace('<script src="app.js"></script>',`<script>window.__TRPG_ARCHIVE__=${payload};<\/script><script>${safeScript}<\/script>`)}
function crc32(bytes){let crc=-1;for(const byte of bytes){crc^=byte;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0)}return(crc^-1)>>>0}
function makeZip(files){const enc=new TextEncoder(),locals=[],centrals=[];let offset=0;for(const file of files){const name=enc.encode(file.name),data=typeof file.data==="string"?enc.encode(file.data):file.data,crc=crc32(data),local=new Uint8Array(30+name.length+data.length),lv=new DataView(local.buffer);lv.setUint32(0,0x04034b50,true);lv.setUint16(4,20,true);lv.setUint16(6,0x800,true);lv.setUint32(14,crc,true);lv.setUint32(18,data.length,true);lv.setUint32(22,data.length,true);lv.setUint16(26,name.length,true);local.set(name,30);local.set(data,30+name.length);locals.push(local);const central=new Uint8Array(46+name.length),cv=new DataView(central.buffer);cv.setUint32(0,0x02014b50,true);cv.setUint16(4,20,true);cv.setUint16(6,20,true);cv.setUint16(8,0x800,true);cv.setUint32(16,crc,true);cv.setUint32(20,data.length,true);cv.setUint32(24,data.length,true);cv.setUint16(28,name.length,true);cv.setUint32(42,offset,true);central.set(name,46);centrals.push(central);offset+=local.length}const centralSize=centrals.reduce((n,a)=>n+a.length,0),end=new Uint8Array(22),ev=new DataView(end.buffer);ev.setUint32(0,0x06054b50,true);ev.setUint16(8,files.length,true);ev.setUint16(10,files.length,true);ev.setUint32(12,centralSize,true);ev.setUint32(16,offset,true);return new Blob([...locals,...centrals,end],{type:"application/zip"})}
async function downloadArchive(room,annotations,personas=[]){const data=await collectArchiveImages(archiveData(room,annotations,personas)),json=JSON.stringify(data),html=await fullArchiveHtml(data),blob=makeZip([{name:"room.trpglog",data:json},{name:"index.html",data:html}]),link=document.createElement("a");link.href=URL.createObjectURL(blob);link.download=`${safeFilename(room.title)}.zip`;link.click();setTimeout(()=>URL.revokeObjectURL(link.href),1500)}
async function readArchiveFile(file){if(file.name.toLowerCase().endsWith(".zip")){const bytes=new Uint8Array(await file.arrayBuffer()),dec=new TextDecoder();let pos=0;while(pos+30<=bytes.length&&new DataView(bytes.buffer,bytes.byteOffset+pos).getUint32(0,true)===0x04034b50){const view=new DataView(bytes.buffer,bytes.byteOffset+pos),method=view.getUint16(8,true),size=view.getUint32(18,true),nameLen=view.getUint16(26,true),extraLen=view.getUint16(28,true),name=dec.decode(bytes.slice(pos+30,pos+30+nameLen)),start=pos+30+nameLen+extraLen;if(name.endsWith(".trpglog")){if(method!==0)throw new Error("この保存ZIPは読み込めません");return JSON.parse(dec.decode(bytes.slice(start,start+size)))}pos=start+size}throw new Error("保存データがZIP内にありません")}return JSON.parse(await file.text())}

function loadProfile() {
  const saved = JSON.parse(localStorage.getItem("trpgMarkerProfile") || "null");
  state.legacyPersonas=Array.isArray(saved?.personas)?saved.personas:[];
  state.profile = saved ? {id:saved.id,plName:saved.plName||"",plIcon:saved.plIcon||"",plColor:saved.plColor||"#ffe66b",personas:[]} : { id: uid(), plName: "", personas: [] };
  if (!state.profile.id) state.profile.id = uid();
  if (!Array.isArray(state.profile.personas)) state.profile.personas = [];
  if (!state.profile.plIcon) state.profile.plIcon = "";
  if (!state.profile.plColor) state.profile.plColor = "#ffe66b";
  state.profile.personas.forEach(persona=>{if(!persona.color)persona.color="#ffe66b"});
  saveProfile();
}
function saveProfile() { localStorage.setItem("trpgMarkerProfile", JSON.stringify({id:state.profile.id,plName:state.profile.plName,plIcon:state.profile.plIcon||"",plColor:state.profile.plColor||"#ffe66b"}));if(state.roomId)localStorage.setItem(`personas:${state.roomId}`,JSON.stringify(state.profile.personas)) }
function loadRoomPersonas(roomId){const key=`personas:${roomId}`,saved=localStorage.getItem(key);if(saved!==null)state.profile.personas=JSON.parse(saved)||[];else if(state.legacyPersonas.length){state.profile.personas=state.legacyPersonas.map(persona=>({...persona,color:persona.color||"#ffe66b"}));localStorage.setItem(key,JSON.stringify(state.profile.personas));state.legacyPersonas=[];saveProfile()}else state.profile.personas=[];state.profile.personas.forEach(persona=>{if(!persona.color)persona.color="#ffe66b"});state.lastPersona=localStorage.getItem(`lastPersona:${roomId}`)||"PL"}
function currentPersona() {
  const value = $("#personaSelect").value;
  if (value === "PL") return { name: state.profile.plName, type: "PL", icon: state.profile.plIcon || "", color: state.profile.plColor || "#ffe66b" };
  if (value === "ORIGINAL" && state.editingOriginalPersona) return state.editingOriginalPersona;
  return state.profile.personas[Number(value)] || { name: state.profile.plName, type: "PL", icon: state.profile.plIcon || "", color: state.profile.plColor || "#ffe66b" };
}

function parseTekey(html, filename) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const title = doc.querySelector("title")?.textContent.trim() || filename.replace(/\.html?$/i, "");
  const tabLabels = {}, tabOrder = [];
  doc.querySelectorAll(".tab-checkbox").forEach(label => { const input = label.querySelector("input"),name=label.textContent.trim(); if (input&&name) { tabLabels[input.id] = name; tabOrder.push(name); } });
  const rows = [...doc.querySelectorAll(".chatlog > div")];
  if (!rows.length) throw new Error("Tekeyのチャットログが見つかりませんでした");
  const messages = rows.map((row, i) => {
    const speakerNode = row.querySelector(":scope > b");
    const timeNode = row.querySelector(":scope > span");
    const speaker = (speakerNode?.textContent || "").replace(/：$/, "").trim();
    const clone = row.cloneNode(true);
    clone.querySelector(":scope > b")?.remove(); clone.querySelector(":scope > span")?.remove();
    const text = clone.textContent.replace(/\u00a0/g, " ").trimEnd();
    const tabClass = [...row.classList].find(c => /^tab\d+$/.test(c)) || "";
    const inlineColor = row.style.color || row.getAttribute("style")?.match(/(?:^|;)\s*color\s*:\s*([^;]+)/i)?.[1]?.trim() || "";
    return { id: `m${i}`, speaker, text, color: inlineColor, time: (timeNode?.textContent || "").replace(/[\[\]]/g, ""), tab: tabLabels[tabClass] || tabClass, diceroll: row.classList.contains("diceroll"), system: speaker === "Tekey" };
  }).filter(m => m.speaker || m.text);
  const encountered=[...new Set(messages.map(m=>m.tab).filter(Boolean))],ordered=[...new Set(tabOrder)].filter(tab=>encountered.includes(tab));
  encountered.forEach(tab=>{if(!ordered.includes(tab))ordered.push(tab)});
  return { title, tabs: ordered, messages };
}

async function api(path, options = {}) {
  const response = await fetch(path, { headers: { "content-type": "application/json", "x-realtime-client":state.realtimeClientId, ...(options.headers || {}) }, ...options });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `通信エラー (${response.status})`);
  return data;
}

async function handleFile(file) {
  $("#homeStatus").textContent = "ログを読み取っています…";
  try {
    state.parsed = parseTekey(await file.text(), file.name);
    $("#importTitle").textContent = state.parsed.title;
    $("#importCount").textContent = `${state.parsed.messages.length.toLocaleString()}件の発言 / ${state.parsed.tabs.length}タブ`;
    $("#importPreview").classList.remove("hidden"); $("#homeStatus").textContent = "";
  } catch (e) { $("#homeStatus").textContent = e.message; }
}

async function createRoom() {
  if (!state.parsed) return;
  const btn = $("#createRoomBtn"); btn.disabled = true; btn.textContent = "作成中…";
  try {
    const result = await api("/api/rooms", { method: "POST",headers:{"x-site-owner-key":localStorage.getItem("trpgMarkerSiteOwnerKey")||""}, body: JSON.stringify({...state.parsed,creatorId:state.profile.id}) });
    localStorage.setItem(`admin:${result.id}`, result.adminToken);
    const owned=JSON.parse(localStorage.getItem("trpgMarkerOwnedRooms")||"{}");owned[result.id]={title:state.parsed.title,createdAt:new Date().toISOString()};localStorage.setItem("trpgMarkerOwnedRooms",JSON.stringify(owned));
    location.href = `/?room=${encodeURIComponent(result.id)}`;
  } catch (e) { $("#homeStatus").textContent = e.message; btn.disabled = false; btn.textContent = "秘密の部屋を作る"; }
}
async function renderOwnedRooms(){const ids=[];for(let i=0;i<localStorage.length;i++){const key=localStorage.key(i);if(key?.startsWith("admin:"))ids.push(key.slice(6))}const box=$("#ownedRooms"),list=$("#ownedRoomList");if(!ids.length){box.classList.add("hidden");return}const saved=JSON.parse(localStorage.getItem("trpgMarkerOwnedRooms")||"{}"),rooms=await Promise.all(ids.map(async id=>{try{const room=await api(`/api/rooms/${encodeURIComponent(id)}?summary=1`);return{id,title:room.title,createdAt:room.createdAt,available:true}}catch{return{id,title:saved[id]?.title||"読み込めない部屋",createdAt:saved[id]?.createdAt||"",available:false}}}));rooms.sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt)));list.innerHTML=rooms.map(room=>`<div class="owned-room ${room.available?"":"unavailable"}" data-owned-room="${esc(room.id)}"><a href="/?room=${encodeURIComponent(room.id)}"><span><b>${esc(room.title)}</b><small>${room.createdAt?esc(formatCommentDate(room.createdAt)):""}</small></span><i>${room.available?"開く ›":"確認できません"}</i></a><button type="button" class="room-delete" data-delete-room="${esc(room.id)}" data-room-title="${esc(room.title)}" title="部屋を削除">×</button></div>`).join("");box.classList.remove("hidden")}
function rememberRecentRoom(room){const recent=JSON.parse(localStorage.getItem("trpgMarkerRecentRooms")||"[]").filter(item=>item.id!==room.id);recent.unshift({id:room.id,title:room.title,visitedAt:new Date().toISOString()});localStorage.setItem("trpgMarkerRecentRooms",JSON.stringify(recent.slice(0,20)))}
async function renderRecentRooms(){const saved=JSON.parse(localStorage.getItem("trpgMarkerRecentRooms")||"[]"),box=$("#recentRooms"),list=$("#recentRoomList");if(!saved.length){box.classList.add("hidden");return}const rooms=(await Promise.all(saved.slice(0,12).map(async item=>{try{const room=await api(`/api/rooms/${encodeURIComponent(item.id)}?summary=1`);return{...item,title:room.title,available:true}}catch{return{...item,available:false}}}))).filter(room=>room.available);if(!rooms.length){box.classList.add("hidden");return}list.innerHTML=rooms.map(room=>`<a class="recent-room" href="/?room=${encodeURIComponent(room.id)}"><span><b>${esc(room.title)}</b><small>${esc(formatCommentDate(room.visitedAt))}</small></span><i>開く ›</i></a>`).join("");box.classList.remove("hidden")}
async function deleteOwnedRoom(id,title){if(!confirm(`「${title}」を完全に削除しますか？\nログと感想も元に戻せなくなります。`))return;const token=localStorage.getItem(`admin:${id}`);if(!token)return alert("この部屋の管理情報がありません");const button=document.querySelector(`[data-delete-room="${CSS.escape(id)}"]`);if(button){button.disabled=true;button.textContent="…"}try{await api(`/api/rooms/${encodeURIComponent(id)}`,{method:"DELETE",headers:{"x-admin-token":token}});localStorage.removeItem(`admin:${id}`);localStorage.removeItem(`personas:${id}`);localStorage.removeItem(`mainTab:${id}`);localStorage.removeItem(`hiddenTabs:${id}`);const owned=JSON.parse(localStorage.getItem("trpgMarkerOwnedRooms")||"{}");delete owned[id];localStorage.setItem("trpgMarkerOwnedRooms",JSON.stringify(owned));document.querySelector(`[data-owned-room="${CSS.escape(id)}"]`)?.remove();if(!document.querySelector("[data-owned-room]"))$("#ownedRooms").classList.add("hidden")}catch(error){alert(error.message);if(button){button.disabled=false;button.textContent="×"}}}

async function openRoom(id) {
  state.roomId = id;applyTheme(localStorage.getItem(`theme:${id}`)||localStorage.getItem("theme")||"light"); loadRoomPersonas(id); $("#homeView").classList.add("hidden"); $("#roomView").classList.remove("hidden"); $("#profileBtn").classList.remove("hidden");
  $("#roomStatus").textContent = "ログを読み込んでいます…";
  try {
    state.room = await api(`/api/rooms/${encodeURIComponent(id)}`);
    rememberRecentRoom(state.room);
    state.hiddenTabs=new Set(JSON.parse(localStorage.getItem(`hiddenTabs:${id}`)||"[]").filter(tab=>state.room.tabs.includes(tab)));
    $("#roomTitle").textContent = state.room.title; document.title = `${state.room.title} | TRPG LOG MARKER`;
    state.room.tabs.forEach(tab => $("#tabFilter").insertAdjacentHTML("beforeend", `<option>${esc(tab)}</option>`));
    const savedMain=localStorage.getItem(`mainTab:${id}`);state.mainTab=state.room.tabs.includes(savedMain)?savedMain:(state.room.tabs.find(tab=>/^メイン$/i.test(tab))||state.room.tabs[0]||"");$("#tabFilter").value=state.mainTab;
    await refreshAnnotations(); renderLog(); $("#roomStatus").textContent = "";
    connectRealtime();
    if (!state.profile.plName) openProfile();
  } catch (e) { $("#roomStatus").textContent = e.message; }
}
function openArchiveData(data){if(data?.format!=="trpg-log-marker"||!data.room?.messages?.length)throw new Error("TRPG LOG MARKERの保存ファイルではありません");disconnectRealtime();state.archiveMode=true;state.archiveImages=data.archiveImages||{};state.roomId="archive";state.room={...data.room,id:"archive"};state.annotations=data.annotations||[];state.presence=[];state.profile.personas=data.personas||state.profile.personas;state.hiddenTabs=new Set();state.activeTabIndex=0;state.carouselPosition=1;state.mainTab=state.room.tabs[0]||"";if(data.theme==="dark"||data.theme==="light")applyTheme(data.theme);$("#homeView").classList.add("hidden");$("#roomView").classList.remove("hidden");$("#profileBtn").classList.add("hidden");$("#shareBtn").classList.add("hidden");$("#roomTitle").textContent=state.room.title;$("#roomStatus").textContent="";$("#tabFilter").innerHTML='<option value="">メインタブを選択</option>';state.room.tabs.forEach(tab=>$("#tabFilter").insertAdjacentHTML("beforeend",`<option>${esc(tab)}</option>`));$("#tabFilter").value=state.mainTab;renderComments();renderLog();document.title=`${state.room.title} | 保存版`}
async function openArchiveFile(file){try{openArchiveData(await readArchiveFile(file))}catch(error){$("#homeStatus").textContent=error.message}}
async function fetchArchiveForRoom(id){const room=await api(`/api/rooms/${encodeURIComponent(id)}`),data=await api(`/api/rooms/${encodeURIComponent(id)}/annotations?authorId=${encodeURIComponent(state.profile.id)}`),personas=JSON.parse(localStorage.getItem(`personas:${id}`)||"[]");return{room,annotations:data.annotations||[],personas}}
function askDeleteOwnedRoom(id,title){state.deleteTarget={id,title};$("#deleteRoomTitle").textContent=`「${title}」を削除しますか？`;$("#deleteRoomDialog").showModal()}
async function removeOwnedRoom(id){const token=localStorage.getItem(`admin:${id}`);if(!token)throw new Error("この部屋の管理情報がありません");await api(`/api/rooms/${encodeURIComponent(id)}`,{method:"DELETE",headers:{"x-admin-token":token}});for(const key of [`admin:${id}`,`personas:${id}`,`mainTab:${id}`,`hiddenTabs:${id}`,`theme:${id}`])localStorage.removeItem(key);const owned=JSON.parse(localStorage.getItem("trpgMarkerOwnedRooms")||"{}");delete owned[id];localStorage.setItem("trpgMarkerOwnedRooms",JSON.stringify(owned));document.querySelector(`[data-owned-room="${CSS.escape(id)}"]`)?.remove();if(!document.querySelector("[data-owned-room]"))$("#ownedRooms").classList.add("hidden")}
async function confirmDeleteRoom(saveFirst){const target=state.deleteTarget;if(!target)return;const saveButton=$("#saveDeleteRoomBtn"),deleteButton=$("#deleteOnlyRoomBtn");saveButton.disabled=deleteButton.disabled=true;try{if(saveFirst){const data=await fetchArchiveForRoom(target.id);await downloadArchive(data.room,data.annotations,data.personas)}await removeOwnedRoom(target.id);$("#deleteRoomDialog").close();state.deleteTarget=null}catch(error){alert(error.message)}finally{saveButton.disabled=deleteButton.disabled=false}}
function renderPresence(){$("#presenceBar").innerHTML=state.presence.map(person=>`<span class="presence-person ${person.is_typing?"typing":""}" title="${person.is_typing?"入力中":"入室中"}">${person.pl_icon?`<img src="${esc(person.pl_icon)}" alt="">`:`<i>${esc((person.pl_name||"?").slice(0,1))}</i>`}<b>${esc(person.pl_name)}</b>${person.is_typing?'<em>入力中…</em>':""}</span>`).join("")}
function realtimePresencePayload(type="presence"){const persona=state.isTyping?currentPersona():null;return{type,clientId:state.realtimeClientId,authorId:state.profile.id,plName:state.profile.plName,plIcon:state.profile.plIcon||"",isTyping:state.isTyping,typingName:persona?.name||"",typingIcon:persona?.icon||"",typingMessageId:state.isTyping?state.pendingSelection?.messageId||"":""}}
function sendRealtime(payload){if(state.realtime?.readyState!==WebSocket.OPEN)return false;try{state.realtime.send(JSON.stringify(payload));return true}catch{return false}}
function heartbeatPresence(){return sendRealtime(realtimePresencePayload("presence"))}
function startFallbackPolling(){clearInterval(state.fallbackPoller);state.fallbackPoller=setInterval(pollAnnotationVersion,60000)}
function stopFallbackPolling(){clearInterval(state.fallbackPoller);state.fallbackPoller=null}
function realtimeSocketUrl(){const protocol=location.protocol==="https:"?"wss:":"ws:";return `${protocol}//${location.host}/api/rooms/${encodeURIComponent(state.roomId)}/realtime`}
function scheduleRealtimeReconnect(){if(!state.realtimeWanted||state.archiveMode||state.realtimeReconnectTimer)return;startFallbackPolling();const delay=Math.min(30000,1000*2**Math.min(state.realtimeAttempts++,5));state.realtimeReconnectTimer=setTimeout(()=>{state.realtimeReconnectTimer=null;connectRealtime()},delay)}
function connectRealtime(){if(!state.roomId||state.archiveMode)return;state.realtimeWanted=true;clearTimeout(state.realtimeReconnectTimer);state.realtimeReconnectTimer=null;if(state.realtime?.readyState===WebSocket.OPEN||state.realtime?.readyState===WebSocket.CONNECTING)return;let socket;try{socket=new WebSocket(realtimeSocketUrl())}catch{scheduleRealtimeReconnect();return}state.realtime=socket;socket.addEventListener("open",async()=>{if(state.realtime!==socket)return;state.realtimeAttempts=0;stopFallbackPolling();sendRealtime(realtimePresencePayload("join"));await pollAnnotationVersion();if($("#roomStatus").textContent.includes("リアルタイム"))$("#roomStatus").textContent=""});socket.addEventListener("message",event=>{if(state.realtime!==socket)return;let data;try{data=JSON.parse(event.data)}catch{return}if(data.type==="presence"){state.presence=Array.isArray(data.presence)?data.presence:[];renderPresence();if(state.room)renderComments()}else if(data.type==="refresh")refreshAnnotations();else if(data.type==="room-deleted"){state.realtimeWanted=false;alert("この部屋は削除されました");location.href="/"}});socket.addEventListener("close",()=>{if(state.realtime!==socket)return;state.realtime=null;state.presence=[];renderPresence();if(state.room)renderComments();scheduleRealtimeReconnect()});socket.addEventListener("error",()=>socket.close())}
function disconnectRealtime(){state.realtimeWanted=false;clearTimeout(state.realtimeReconnectTimer);state.realtimeReconnectTimer=null;stopFallbackPolling();const socket=state.realtime;state.realtime=null;if(socket&&socket.readyState<2)socket.close();state.presence=[]}
function setTyping(value){clearTimeout(state.typingTimer);if(state.isTyping!==value){state.isTyping=value;heartbeatPresence()}if(value)state.typingTimer=setTimeout(()=>setTyping(false),1800)}

function groupAnnotations() {
  const map = {}, indexes = new Map(state.room.messages.map((m,i)=>[m.id,i]));
  state.annotations.forEach(a => { if(a.parent_id)return;const start=indexes.get(a.message_id), end=indexes.get(a.end_message_id || a.message_id); if(start==null)return; for(let i=start;i<=(end??start);i++)(map[state.room.messages[i].id] ||= []).push(a); });
  return map;
}
function markedText(message, anns) {
  if (!anns?.length) return esc(message.text);
  const indexes = new Map(state.room.messages.map((m,i)=>[m.id,i])), messageIndex=indexes.get(message.id);
  const ranges = anns.map(a => { const startIndex=indexes.get(a.message_id),endIndex=indexes.get(a.end_message_id||a.message_id)??startIndex;if(messageIndex<startIndex||messageIndex>endIndex)return null;return {start:messageIndex===startIndex?Math.max(0,a.start_offset):0,end:messageIndex===endIndex?Math.min(message.text.length,a.end_offset):message.text.length,id:a.id,color:markerColor(a.color)}; }).filter(r=>r&&r.end>r.start).sort((a,b)=>a.start-b.start);
  let out = "", pos = 0;
  ranges.forEach(r => { if (r.start < pos) return; out += esc(message.text.slice(pos, r.start)); out += `<mark data-ann="${esc(r.id)}" style="--marker:${esc(r.color)}">${esc(message.text.slice(r.start, r.end))}</mark>`; pos = r.end; });
  return out + esc(message.text.slice(pos));
}
function markerColor(value){return /^(#[0-9a-f]{3,8}|rgba?\([\d\s,.%]+\)|[a-z]+)$/i.test(value||"")?value:"#ffe66b"}
function messageHtml(m, grouped) {
  const anns = grouped[m.id] || [];
  const color = /^(#[0-9a-f]{3,8}|rgba?\([\d\s,.%]+\)|[a-z]+)$/i.test(m.color || "") ? m.color : "";
  return `<div class="log-message ${m.system ? "system-message" : ""} ${m.diceroll ? "diceroll" : ""}" data-message="${m.id}"${color ? ` style="color:${esc(color)}"` : ""}><span class="speaker">${esc(m.speaker || "")}${m.speaker ? "：" : ""}</span><span class="message-text">${markedText(m, anns)}</span>${anns.length ? `<button class="annotation-count" data-message-comments="${m.id}">${anns.length}</button>` : ""}</div>`;
}
function timelineGroups(messages) {
  const groups = [];
  messages.forEach((message, index) => {
    const key = message.time || `untimed-${index}`;
    let group = groups[groups.length - 1];
    if (!group || group.key !== key) { group = { key, time: message.time, tabs: [], tabMap: new Map() }; groups.push(group); }
    const tabName = message.tab || "LOG";
    let panel = group.tabMap.get(tabName);
    if (!panel) { panel = { name: tabName, messages: [] }; group.tabMap.set(tabName, panel); group.tabs.push(panel); }
    panel.messages.push(message);
  });
  return groups;
}
function activeTabName() {
  return state.room?.tabs?.[state.activeTabIndex] || state.room?.tabs?.[0] || "";
}
function visibleTabEntries(){const entries=(state.room?.tabs||[]).map((tab,index)=>({tab,index})).filter(item=>!state.hiddenTabs.has(item.tab));return entries.length?entries:(state.room?.tabs||[]).slice(0,1).map((tab,index)=>({tab,index}))}
function pagePanelHtml(tab, realIndex, trackIndex, grouped, search, clone = "") {
  const messages = state.room.messages.filter(m => m.tab === tab && (!search || `${m.speaker} ${m.text}`.toLowerCase().includes(search)));
  const rows = messages.map(m => `<div class="page-row" data-time="${esc(m.time)}"><time>${esc(m.time)}</time>${messageHtml(m, grouped)}</div>`).join("");
  return `<section class="log-page" data-real-index="${realIndex}" data-track-index="${trackIndex}" data-clone="${clone}"><div class="page-scroll">${rows || '<p class="empty">このタブに表示できる発言がありません。</p>'}</div></section>`;
}
function lazyPagePanelHtml(tab,realIndex,trackIndex,clone=""){return `<section class="log-page lazy-page" data-tab="${esc(tab)}" data-real-index="${realIndex}" data-track-index="${trackIndex}" data-clone="${clone}"></section>`}
function shouldHydratePosition(position,current,count){return position===current||position===current-1||position===current+1||(current===1&&position===0)||(current===count&&position===count+1)}
function hydratePanel(position){const panel=document.querySelector(`.log-page[data-track-index="${position}"]`);if(!panel||!panel.classList.contains("lazy-page")||!state.panelRender)return panel;const {mode,grouped,search,slots}=state.panelRender,tab=panel.dataset.tab,realIndex=Number(panel.dataset.realIndex),clone=panel.dataset.clone||"",html=mode==="timeline"?timelinePagePanelHtml(tab,realIndex,position,slots,grouped,search,clone):pagePanelHtml(tab,realIndex,position,grouped,search,clone),template=document.createElement("template");template.innerHTML=html;const fresh=template.content.firstElementChild;panel.replaceWith(fresh);fresh.querySelector(".page-scroll")?.addEventListener("scroll",scheduleVisibleGlimpses,{passive:true});return fresh}
function hydrateNearbyPanels(){const count=visibleTabEntries().length;[state.carouselPosition-1,state.carouselPosition,state.carouselPosition+1,state.carouselPosition===1?0:-1,state.carouselPosition===count?count+1:-1].filter(position=>position>=0&&position<=count+1).forEach(hydratePanel)}
function setTrackPosition(position, animate = false) {
  const track = $("#pageTrack"); if (!track) return;
  track.style.transition = animate ? "transform .52s cubic-bezier(.22,.8,.2,1)" : "none";
  track.style.transform = `translateX(${-position * 100}%)`;
}
function updateCarouselNav() {
  const tab = activeTabName();
  if($("#carouselIndex"))$("#carouselIndex").textContent = `${state.activeTabIndex + 1} / ${state.room.tabs.length}`;
  if($("#carouselTitle"))$("#carouselTitle").textContent = tab;
  document.querySelectorAll("[data-tab-index]").forEach(button=>button.classList.toggle("active",Number(button.dataset.tabIndex)===state.activeTabIndex));
  document.querySelector(".tab-rail [data-tab-index].active")?.scrollIntoView({behavior:"smooth",block:"nearest",inline:"center"});
}
function minuteValue(time){const match=String(time||"").match(/(\d{1,2}):(\d{2})/);return match?Number(match[1])*60+Number(match[2]):null}
function hideTabSuggestions(){clearTimeout(state.suggestionTimer);$("#tabSuggestions").classList.add("hidden");$("#tabSuggestions").innerHTML=""}
function visibleSuggestionTimes(){const panel=document.querySelector(`.log-page[data-track-index="${state.carouselPosition}"]`),scroll=panel?.querySelector(".page-scroll");if(!scroll)return[];const bounds=scroll.getBoundingClientRect();return [...panel.querySelectorAll(".page-row[data-time]")].filter(row=>{const rect=row.getBoundingClientRect();return rect.bottom>=bounds.top&&rect.top<=bounds.bottom&&(state.viewMode!=="timeline"||row.classList.contains("empty-slot"))}).map(row=>row.dataset.time).filter(Boolean)}
function glimpseHtml(slot,tab){const entries=visibleTabEntries(),currentPosition=entries.findIndex(item=>item.tab===tab),search=$("#searchInput").value.trim().toLowerCase();return [...slot.byTab.entries()].filter(([otherTab])=>otherTab!==tab).flatMap(([otherTab,messages])=>{const targetPosition=entries.findIndex(item=>item.tab===otherTab),direction=targetPosition<currentPosition?"left":"right";return messages.filter(m=>!search||`${m.speaker} ${m.text}`.toLowerCase().includes(search)).slice(0,2).map(m=>{const full=`${m.speaker||""}${m.speaker?"：":""}${m.text}`.replace(/\s+/g," ").trim(),preview=full.slice(0,20)+(full.length>20?"…":"");return `<div class="foreign-glimpse dir-${direction} reveal">${direction==="left"?'<i class="glimpse-arrow">‹</i>':""}<b>${esc(otherTab)}</b><span>${esc(preview)}</span>${direction==="right"?'<i class="glimpse-arrow">›</i>':""}</div>`})}).slice(0,3).join("")}
function renderVisibleGlimpses(){cancelAnimationFrame(state.glimpseFrame);state.glimpseFrame=requestAnimationFrame(()=>{if(state.viewMode!=="timeline")return;const panel=document.querySelector(`.log-page[data-track-index="${state.carouselPosition}"]`),scroll=panel?.querySelector(".page-scroll");if(!scroll)return;panel.querySelectorAll(".foreign-glimpses").forEach(el=>el.remove());const bounds=scroll.getBoundingClientRect(),x=Math.min(bounds.right-24,bounds.left+bounds.width*.72),rows=new Set();for(let y=bounds.top+8;y<bounds.bottom;y+=48){const row=document.elementFromPoint(x,y)?.closest?.(".timeline-slot.empty-slot[data-slot-index]");if(row&&panel.contains(row))rows.add(row)}const tab=activeTabName();rows.forEach(row=>{const slot=state.timelineSlots[Number(row.dataset.slotIndex)],html=slot&&glimpseHtml(slot,tab);if(html)row.querySelector(".timeline-slot-content")?.insertAdjacentHTML("beforeend",`<div class="foreign-glimpses">${html}</div>`)})})}
function scheduleVisibleGlimpses(){clearTimeout(state.glimpseTimer);state.glimpseTimer=setTimeout(()=>{if(Date.now()>=state.syncingScrollUntil)state.readingAnchor=currentReadingTime();renderVisibleGlimpses()},110)}
function revealInlineSuggestions(){hideTabSuggestions();renderVisibleGlimpses()}
function showMainSuggestions(){revealInlineSuggestions()}
function tabRailHtml(){return `<div class="tab-navigation"><button class="tab-arrow prev" data-page="prev" aria-label="前のタブ">‹</button><nav class="tab-rail" aria-label="タブ一覧" title="タブ名をダブルクリックで表示／非表示">${state.room.tabs.map((tab,index)=>`<button type="button" data-tab-index="${index}" class="${index===state.activeTabIndex?"active":""} ${state.hiddenTabs.has(tab)?"tab-hidden":""}" title="ダブルクリックで${state.hiddenTabs.has(tab)?"表示":"非表示"}">${esc(tab)}</button>`).join("")}</nav><button class="tab-arrow next" data-page="next" aria-label="次のタブ">›</button></div>`}
function syncPanelToTime(panel, time) {
  if (!panel || !time) return;
  const slotMatch=String(time).match(/^@slot:(\d+)\|(.*)$/),fallbackTime=slotMatch?decodeURIComponent(slotMatch[2]||""):time,row=(slotMatch&&panel.querySelector(`.page-row[data-slot-index="${slotMatch[1]}"]`))||[...panel.querySelectorAll(".page-row[data-time]")].find(el => el.dataset.time === fallbackTime);
  const scroll = panel.querySelector(".page-scroll");
  if (row && scroll) scroll.scrollTop = Math.max(0, row.offsetTop - scroll.clientHeight * .28);
}
function renderLog(anchorTime = "") {
  if (!state.room) return;
  if (state.viewMode === "timeline") { renderTimelineLog(anchorTime); return; }
  const entries=visibleTabEntries(),tabs=entries.map(item=>item.tab), search = $("#searchInput").value.trim().toLowerCase(), grouped = groupAnnotations();
  if (!entries.length) return;
  let visibleIndex=entries.findIndex(item=>item.index===state.activeTabIndex);if(visibleIndex<0){visibleIndex=0;state.activeTabIndex=entries[0].index}
  state.carouselPosition = visibleIndex + 1;
  state.panelRender={mode:"compact",grouped,search,slots:null};
  const panels = [];
  panels.push(shouldHydratePosition(0,state.carouselPosition,entries.length)?pagePanelHtml(entries.at(-1).tab,entries.at(-1).index,0,grouped,search,"last"):lazyPagePanelHtml(entries.at(-1).tab,entries.at(-1).index,0,"last"));
  entries.forEach((item,position)=>{const trackIndex=position+1;panels.push(shouldHydratePosition(trackIndex,state.carouselPosition,entries.length)?pagePanelHtml(item.tab,item.index,trackIndex,grouped,search):lazyPagePanelHtml(item.tab,item.index,trackIndex))});
  panels.push(shouldHydratePosition(entries.length+1,state.carouselPosition,entries.length)?pagePanelHtml(entries[0].tab,entries[0].index,entries.length+1,grouped,search,"first"):lazyPagePanelHtml(entries[0].tab,entries[0].index,entries.length+1,"first"));
  state.isSliding = false; state.slideQueue = 0;
  $("#logPane").innerHTML = `${tabRailHtml()}<div class="carousel-viewport"><div class="page-track" id="pageTrack">${panels.join("")}</div></div>`;
  setTrackPosition(state.carouselPosition, false); updateCarouselNav();
  if (anchorTime) syncPanelToTime(document.querySelector(`.log-page[data-track-index="${state.carouselPosition}"]`), anchorTime);
  $("#pageTrack").addEventListener("transitionend", event => {
    if (event.target !== $("#pageTrack") || event.propertyName !== "transform") return;
    const n = visibleTabEntries().length;
    if (state.carouselPosition === 0) state.carouselPosition = n;
    else if (state.carouselPosition === n + 1) state.carouselPosition = 1;
    setTrackPosition(state.carouselPosition, false);
    state.isSliding = false;
    hydrateNearbyPanels();
    if (state.slideQueue) { const queued = state.slideQueue; state.slideQueue = 0; requestAnimationFrame(() => switchLogPage(queued)); }
  });
  const viewport=$(".carousel-viewport"); let touchStart=null;
  viewport.addEventListener("touchstart",e=>{const t=e.touches[0];touchStart={x:t.clientX,y:t.clientY}},{passive:true});
  viewport.addEventListener("touchend",e=>{if(!touchStart)return;const t=e.changedTouches[0],dx=t.clientX-touchStart.x,dy=t.clientY-touchStart.y;touchStart=null;if(Math.abs(dx)>60&&Math.abs(dx)>Math.abs(dy)*1.2)switchLogPage(dx<0?1:-1)},{passive:true});
  document.querySelectorAll(".page-scroll").forEach(page=>page.addEventListener("scroll",scheduleVisibleGlimpses,{passive:true}));
}
function sharedTimelineSlots(messages){const slots=[];messages.filter(message=>!state.hiddenTabs.has(message.tab)).forEach((message,index)=>{const key=message.time||`untimed-${index}`;let slot=slots[slots.length-1];if(!slot||slot.key!==key){slot={key,time:message.time,byTab:new Map()};slots.push(slot)}const list=slot.byTab.get(message.tab)||[];list.push(message);slot.byTab.set(message.tab,list)});slots.forEach(slot=>{const previewCount=Math.min(3,[...slot.byTab.values()].reduce((sum,list)=>sum+list.length,0));slot.height=Math.min(110,Math.max(30,previewCount?previewCount*29+8:0))});return slots}
function timelinePagePanelHtml(tab,realIndex,trackIndex,slots,grouped,search,clone=""){const rows=slots.map((slot,slotIndex)=>{const list=(slot.byTab.get(tab)||[]).filter(m=>!search||`${m.speaker} ${m.text}`.toLowerCase().includes(search)),previewCount=list.length?0:Math.min(3,[...slot.byTab.entries()].filter(([otherTab])=>otherTab!==tab).reduce((sum,[,messages])=>sum+messages.filter(m=>!search||`${m.speaker} ${m.text}`.toLowerCase().includes(search)).length,0)),minHeight=list.length?24:previewCount?previewCount*24+6:20;return `<div class="page-row timeline-slot ${list.length?"has-message":"empty-slot"}" data-slot-index="${slotIndex}" data-time="${esc(slot.time)}" style="min-height:${minHeight}px"><time>${esc(slot.time)}</time><div class="timeline-slot-content">${list.map(m=>messageHtml(m,grouped)).join("")}</div></div>`}).join("");return `<section class="log-page" data-real-index="${realIndex}" data-track-index="${trackIndex}" data-clone="${clone}"><div class="page-scroll timeline-page">${rows}</div></section>`}
function renderTimelineLog(anchorTime="") {
  const entries=visibleTabEntries(),search=$("#searchInput").value.trim().toLowerCase(),grouped=groupAnnotations(),slots=sharedTimelineSlots(state.room.messages);state.timelineSlots=slots;if(!entries.length)return;let visibleIndex=entries.findIndex(item=>item.index===state.activeTabIndex);if(visibleIndex<0){visibleIndex=0;state.activeTabIndex=entries[0].index}
  state.carouselPosition=visibleIndex+1;state.isSliding=false;state.slideQueue=0;
  state.panelRender={mode:"timeline",grouped,search,slots};
  const panels=[shouldHydratePosition(0,state.carouselPosition,entries.length)?timelinePagePanelHtml(entries.at(-1).tab,entries.at(-1).index,0,slots,grouped,search,"last"):lazyPagePanelHtml(entries.at(-1).tab,entries.at(-1).index,0,"last")];entries.forEach((item,position)=>{const trackIndex=position+1;panels.push(shouldHydratePosition(trackIndex,state.carouselPosition,entries.length)?timelinePagePanelHtml(item.tab,item.index,trackIndex,slots,grouped,search):lazyPagePanelHtml(item.tab,item.index,trackIndex))});panels.push(shouldHydratePosition(entries.length+1,state.carouselPosition,entries.length)?timelinePagePanelHtml(entries[0].tab,entries[0].index,entries.length+1,slots,grouped,search,"first"):lazyPagePanelHtml(entries[0].tab,entries[0].index,entries.length+1,"first"));
  $("#logPane").innerHTML=`${tabRailHtml()}<div class="carousel-viewport"><div class="page-track" id="pageTrack">${panels.join("")}</div></div>`;
  setTrackPosition(state.carouselPosition,false);updateCarouselNav();if(anchorTime)syncPanelToTime(document.querySelector(`.log-page[data-track-index="${state.carouselPosition}"]`),anchorTime);
  $("#pageTrack").addEventListener("transitionend",event=>{if(event.target!==$("#pageTrack")||event.propertyName!=="transform")return;const n=visibleTabEntries().length;if(state.carouselPosition===0)state.carouselPosition=n;else if(state.carouselPosition===n+1)state.carouselPosition=1;setTrackPosition(state.carouselPosition,false);state.isSliding=false;hydrateNearbyPanels();if(state.slideQueue){const queued=state.slideQueue;state.slideQueue=0;requestAnimationFrame(()=>switchLogPage(queued))}});
  const viewport=$(".carousel-viewport");let touchStart=null;viewport.addEventListener("touchstart",e=>{const t=e.touches[0];touchStart={x:t.clientX,y:t.clientY}},{passive:true});viewport.addEventListener("touchend",e=>{if(!touchStart)return;const t=e.changedTouches[0],dx=t.clientX-touchStart.x,dy=t.clientY-touchStart.y;touchStart=null;if(Math.abs(dx)>60&&Math.abs(dx)>Math.abs(dy)*1.2)switchLogPage(dx<0?1:-1)},{passive:true});document.querySelectorAll(".timeline-page").forEach(page=>page.addEventListener("scroll",scheduleVisibleGlimpses,{passive:true}));setTimeout(renderVisibleGlimpses,20);
}
function currentReadingTime() {
  const panel = document.querySelector(`.log-page[data-track-index="${state.carouselPosition}"]`);
  const scroll = panel?.querySelector(".page-scroll"); if (!scroll) return "";
  const rows = [...panel.querySelectorAll(".page-row[data-time]")];
  const targetY = scroll.getBoundingClientRect().top + scroll.clientHeight * .28;
  let best = null, distance = Infinity;
  rows.forEach(row => { const d = Math.abs(row.getBoundingClientRect().top - targetY); if (d < distance) { distance = d; best = row; } });
  return state.viewMode==="timeline"&&best?.dataset.slotIndex!=null?`@slot:${best.dataset.slotIndex}|${encodeURIComponent(best.dataset.time||"")}`:best?.dataset.time||"";
}
function switchLogPage(direction) {
  const entries=visibleTabEntries();if (!entries.length) return;
  if (state.isSliding) { state.slideQueue = direction < 0 ? -1 : 1; return; }
  state.isSliding = true;
  const time = state.readingAnchor||currentReadingTime(), n = entries.length;state.readingAnchor=time;state.syncingScrollUntil=Date.now()+650;let visibleIndex=entries.findIndex(item=>item.index===state.activeTabIndex);if(visibleIndex<0)visibleIndex=0;
  state.carouselPosition += direction;
  visibleIndex=(visibleIndex+direction+n)%n;state.activeTabIndex=entries[visibleIndex].index;
  const target = hydratePanel(state.carouselPosition);
  syncPanelToTime(target, time);
  if(state.carouselPosition===0)syncPanelToTime(document.querySelector(`.log-page[data-track-index="${n}"]`),time);
  if(state.carouselPosition===n+1)syncPanelToTime(document.querySelector(`.log-page[data-track-index="1"]`),time);
  updateCarouselNav(); setTrackPosition(state.carouselPosition, true);setTimeout(revealInlineSuggestions,80);setTimeout(renderVisibleGlimpses,560);
}
function goToTab(index){const tab=state.room?.tabs?.[index],entries=visibleTabEntries();if(!tab||state.hiddenTabs.has(tab)||index===state.activeTabIndex)return;const position=entries.findIndex(item=>item.index===index);if(position<0)return;const time=state.readingAnchor||currentReadingTime();state.readingAnchor=time;state.syncingScrollUntil=Date.now()+650;state.isSliding=true;state.slideQueue=0;state.activeTabIndex=index;state.carouselPosition=position+1;syncPanelToTime(hydratePanel(state.carouselPosition),time);hydrateNearbyPanels();updateCarouselNav();setTrackPosition(state.carouselPosition,true);setTimeout(revealInlineSuggestions,80);setTimeout(renderVisibleGlimpses,560)}
function toggleTabVisibility(index){const tab=state.room?.tabs?.[index];if(!tab)return;if(state.hiddenTabs.has(tab)){state.hiddenTabs.delete(tab)}else{if(visibleTabEntries().length<=1)return;state.hiddenTabs.add(tab)}localStorage.setItem(`hiddenTabs:${state.roomId}`,JSON.stringify([...state.hiddenTabs]));if(state.hiddenTabs.has(activeTabName()))state.activeTabIndex=visibleTabEntries()[0].index;renderLog(currentReadingTime())}
function renderComments() {
  const commentsScroll=$("#commentsList").scrollTop;
  $("#commentCount").textContent = state.annotations.length;
  const order=new Map(state.room.messages.map((message,index)=>[message.id,index])),messageTabs=new Map(state.room.messages.map(message=>[message.id,message.tab])),annotationIds=new Set(state.annotations.map(annotation=>annotation.id));
  const annotations=[...state.annotations].sort((a,b)=>(order.get(a.message_id)??Infinity)-(order.get(b.message_id)??Infinity)||a.start_offset-b.start_offset||String(a.created_at).localeCompare(String(b.created_at)));
  const children=new Map();annotations.forEach(annotation=>{if(annotation.parent_id){const list=children.get(annotation.parent_id)||[];list.push(annotation);children.set(annotation.parent_id,list)}});
  const cardHtml=(a,depth=0)=>{const tab=messageTabs.get(a.message_id)||"",replies=children.get(a.id)||[],interactive=!state.archiveMode,mine=interactive&&a.author_id===state.profile.id,archivedImage=state.archiveImages?.[`annotation:${a.id}`];return `<div class="comment-thread ${depth?"is-reply":""}" style="--reply-depth:${Math.min(depth,3)}"><div class="comment-card" style="--comment-marker:${esc(markerColor(a.color))}" id="comment-${a.id}" data-target="${a.message_id}"><div class="comment-author">${a.persona_icon ? `<img class="comment-avatar" src="${esc(a.persona_icon)}" alt="" loading="lazy">` : '<span class="comment-avatar empty-avatar"></span>'}<span class="comment-name">${esc(a.persona_name)}<span class="persona-type">${esc(a.persona_type)}</span></span>${mine?`<button class="comment-edit" type="button" data-edit-comment="${esc(a.id)}" title="編集">✎</button>`:""}<time class="comment-date">${tab?`${esc(tab)} `:""}${esc(formatCommentDate(a.created_at))}</time>${interactive?`<button class="comment-like ${a.liked_by_me?"liked":""}" type="button" data-like-comment="${esc(a.id)}" aria-label="好き">${a.liked_by_me?"♥":"♡"}${Number(a.like_count)||""}</button><button class="comment-reply" type="button" data-reply-comment="${esc(a.id)}" title="返信">↩</button>`:""}</div>${a.body?`<p class="comment-body">${commentBodyHtml(a.body)}</p>`:""}${archivedImage?`<img class="comment-image" data-expand-image src="${esc(archivedImage)}" alt="添付画像" loading="lazy">`:a.has_image&&!state.archiveMode?`<img class="comment-image" data-expand-image src="/api/rooms/${encodeURIComponent(state.roomId)}/annotations/${encodeURIComponent(a.id)}/image" alt="添付画像" loading="lazy">`:""}</div>${replies.map(reply=>cardHtml(reply,depth+1)).join("")}</div>`};
  const roots=annotations.filter(annotation=>!annotation.parent_id||!annotationIds.has(annotation.parent_id));const typing=state.presence.filter(person=>person.is_typing&&person.typing_message_id).map(person=>({typing:true,message_id:person.typing_message_id,person}));const items=[...roots.map(annotation=>({annotation,message_id:annotation.message_id})),...typing].sort((a,b)=>(order.get(a.message_id)??Infinity)-(order.get(b.message_id)??Infinity));const typingHtml=item=>`<button type="button" class="typing-comment" data-typing-target="${esc(item.message_id)}" title="入力中のログへ移動"><span class="comment-avatar">${item.person.typing_icon?`<img src="${esc(item.person.typing_icon)}" alt="">`:esc((item.person.typing_name||item.person.pl_name||"?").slice(0,1))}</span><b>${esc(item.person.typing_name||item.person.pl_name)}</b><em>入力中…</em><i></i><i></i><i></i></button>`;$("#commentsList").innerHTML=items.length?items.map(item=>item.typing?typingHtml(item):cardHtml(item.annotation)).join(""):'<p class="empty">マーカーされた感想がここに並びます。</p>';$("#commentsList").scrollTop=commentsScroll;
}
async function deleteComment(id,confirmed=false){if(!confirmed&&!confirm("このコメントを削除しますか？\n返信もまとめて削除されます。"))return;try{await api(`/api/rooms/${encodeURIComponent(state.roomId)}/annotations/${encodeURIComponent(id)}`,{method:"DELETE",body:JSON.stringify({authorId:state.profile.id}),headers:{"x-admin-token":localStorage.getItem(`admin:${state.roomId}`)||""}});await refreshAnnotations()}catch(error){alert(error.message)}}
async function toggleLike(id,button){const annotation=state.annotations.find(item=>item.id===id);if(!annotation)return;const before=!!annotation.liked_by_me,count=Number(annotation.like_count)||0;annotation.liked_by_me=!before;annotation.like_count=Math.max(0,count+(before?-1:1));button?.classList.toggle("liked",!before);if(button){button.textContent=`${before?"♡":"♥"}${annotation.like_count||""}`;button.classList.remove("heart-pop");void button.offsetWidth;button.classList.add("heart-pop")}try{const result=await api(`/api/rooms/${encodeURIComponent(state.roomId)}/annotations/${encodeURIComponent(id)}/like`,{method:"POST",body:JSON.stringify({authorId:state.profile.id})});annotation.liked_by_me=!!result.liked}catch(error){annotation.liked_by_me=before;annotation.like_count=count;if(button){button.classList.toggle("liked",before);button.textContent=`${before?"♥":"♡"}${count||""}`}alert(error.message)}}
function formatCommentDate(value){if(!value)return "";const normalized=/Z|[+-]\d\d:?\d\d$/.test(value)?value:value.replace(" ","T")+"Z";const date=new Date(normalized);return Number.isNaN(date.getTime())?String(value):new Intl.DateTimeFormat("ja-JP",{month:"numeric",day:"numeric",hour:"2-digit",minute:"2-digit"}).format(date)}
async function refreshAnnotations() {
  if (!state.roomId) return;
  try {
    const data = await api(`/api/rooms/${encodeURIComponent(state.roomId)}/annotations?authorId=${encodeURIComponent(state.profile.id)}`);
    const changed = Number(data.version)!==state.annotationVersion;
    const markerFields=list=>list.map(a=>[a.id,a.message_id,a.end_message_id,a.start_offset,a.end_offset,a.color]);
    const markersChanged=JSON.stringify(markerFields(data.annotations))!==JSON.stringify(markerFields(state.annotations));
    state.annotations = data.annotations;state.annotationVersion=Number(data.version)||0;
    if (changed) { const time=currentReadingTime(); renderComments(); if(markersChanged)renderLog(time); }
  } catch (e) { $("#roomStatus").textContent = e.message; }
}
async function pollAnnotationVersion(){if(!state.roomId||state.archiveMode||document.hidden)return;try{const data=await api(`/api/rooms/${encodeURIComponent(state.roomId)}/annotations/version`);if(Number(data.version)!==state.annotationVersion)await refreshAnnotations()}catch(e){$("#roomStatus").textContent=e.message}}

function selectionInfo() {
  const selection = getSelection(); if (!selection || selection.isCollapsed || !selection.rangeCount) return null;
  const range=selection.getRangeAt(0), parent=node=>node.nodeType===1?node:node.parentElement, startMessage=parent(range.startContainer)?.closest?.(".log-message"), endMessage=parent(range.endContainer)?.closest?.(".log-message");
  if(!startMessage||!endMessage||!$("#logPane").contains(startMessage)||!$("#logPane").contains(endMessage))return null;
  const startText=startMessage.querySelector(".message-text"),endText=endMessage.querySelector(".message-text");if(!startText||!endText)return null;
  const textOffset=(textEl,node,offset,edge)=>{if(textEl.contains(node)){const partial=document.createRange();partial.selectNodeContents(textEl);partial.setEnd(node,offset);return partial.toString().length}if(parent(node)?.closest?.(".speaker"))return 0;return edge==="start"?0:textEl.textContent.length};
  const rects=[...range.getClientRects()].filter(r=>r.width||r.height),focusAtEnd=selection.focusNode===range.endContainer&&selection.focusOffset===range.endOffset,rect=(focusAtEnd?rects[rects.length-1]:rects[0])||range.getBoundingClientRect();return {messageId:startMessage.dataset.message,endMessageId:endMessage.dataset.message,startOffset:textOffset(startText,range.startContainer,range.startOffset,"start"),endOffset:textOffset(endText,range.endContainer,range.endOffset,"end"),quote:range.toString(),anchorLeft:rect.left,anchorRight:rect.right,anchorTop:rect.top,anchorBottom:rect.bottom};
}
function showSelection() {
  if(state.archiveMode)return;
  const nextSelection = selectionInfo();
  if (nextSelection?.quote.trim()) { state.selection = nextSelection; $("#selectedQuote").textContent = `「${state.selection.quote.trim()}」`; $("#selectionBar").classList.add("hidden"); if(!$("#commentDialog").open&&!$("#profileDialog").open)openCommentDialog(); }
  else if (!$("#commentDialog").open) $("#selectionBar").classList.add("hidden");
}
function fillPersonaSelect() {
  $("#personaSelect").innerHTML = `<option value="PL">${esc(state.profile.plName || "PL名を設定") }（PL）</option>` + state.profile.personas.map((p,i)=>`<option value="${i}">${esc(p.name)}（${esc(p.type)}）</option>`).join("") + `<option value="ADD">＋ キャラ追加</option>`;
  const valid=state.lastPersona==="PL"||(/^\d+$/.test(state.lastPersona)&&state.profile.personas[Number(state.lastPersona)]);$("#personaSelect").value=valid?state.lastPersona:"PL";state.lastPersona=$("#personaSelect").value;
  updateCommentPersonaAvatar();
}
function updateCommentPersonaAvatar(){const persona=currentPersona(),target=$("#commentPersonaAvatar");target.style.setProperty("--persona-marker",markerColor(persona.color));target.innerHTML=persona.icon?`<img src="${esc(persona.icon)}" alt="">`:`<span>${esc((persona.name||"?").slice(0,1))}</span>`}
function openCommentDialog() {
  state.replyTo=null;state.editingCommentId=null;state.editingOriginalPersona=null;$("#commentDeleteBtn").classList.add("hidden");
  state.pendingSelection = state.selection ? { ...state.selection } : null;
  if (!state.pendingSelection) return;
  if (!state.profile.plName) { openProfile(); return; }
  clearCommentImage();fillPersonaSelect(); $("#commentBody").value = ""; $("#commentDialog").show(); positionCommentDialog(); setTimeout(()=>$("#commentBody").focus(),0);
}
function openReplyDialog(annotation,anchor){if(!annotation)return;state.editingCommentId=null;state.editingOriginalPersona=null;$("#commentDeleteBtn").classList.add("hidden");state.replyTo=annotation.id;state.pendingSelection={messageId:annotation.message_id,endMessageId:annotation.end_message_id||annotation.message_id,startOffset:annotation.start_offset,endOffset:annotation.end_offset,quote:annotation.quote,anchorLeft:anchor.left,anchorRight:anchor.right,anchorTop:anchor.top,anchorBottom:anchor.bottom};clearCommentImage();fillPersonaSelect();$("#commentBody").value="";$("#commentDialog").show();positionCommentDialog();setTimeout(()=>$("#commentBody").focus(),0)}
function openEditDialog(annotation,anchor){if(!annotation)return;state.replyTo=annotation.parent_id||null;state.editingCommentId=annotation.id;state.pendingSelection={messageId:annotation.message_id,endMessageId:annotation.end_message_id||annotation.message_id,startOffset:annotation.start_offset,endOffset:annotation.end_offset,quote:annotation.quote,anchorLeft:anchor.left,anchorRight:anchor.right,anchorTop:anchor.top,anchorBottom:anchor.bottom};clearCommentImage();fillPersonaSelect();const personaIndex=state.profile.personas.findIndex(persona=>persona.name===annotation.persona_name&&persona.type===annotation.persona_type);$("#personaSelect").value=annotation.persona_type==="PL"?"PL":personaIndex>=0?String(personaIndex):$("#personaSelect").value;state.lastPersona=$("#personaSelect").value;updateCommentPersonaAvatar();$("#commentBody").value=annotation.body||"";state.commentImage=null;$("#commentDeleteBtn").classList.remove("hidden");$("#commentDialog").show();positionCommentDialog();setTimeout(()=>$("#commentBody").focus(),0)}
function positionCommentDialog(){const dialog=$("#commentDialog"),a=state.pendingSelection;if(!a||innerWidth<=800){dialog.style.left="";dialog.style.top="";return}const width=Math.min(390,innerWidth-24),height=Math.min(dialog.offsetHeight||430,innerHeight-24);let left=a.anchorRight+12;if(left+width>innerWidth-12)left=Math.max(12,a.anchorLeft-width-12);let top=Math.min(Math.max(12,a.anchorTop-24),innerHeight-height-12);dialog.style.left=`${left}px`;dialog.style.top=`${top}px`}
async function postComment(event) {
  event.preventDefault(); const persona = currentPersona(), body = $("#commentBody").value.trim(); if (!body&&!state.commentImage&&state.commentImage!==null) return;
  const payload = { ...state.pendingSelection, parentId:state.replyTo||"", color: persona.color || "#ffe66b", authorId: state.profile.id, authorName: state.profile.plName, personaName: persona.name, personaType: persona.type, personaIcon: persona.icon || "", body,imageData:state.commentImage };
  try { const editingId=state.editingCommentId;await api(editingId?`/api/rooms/${encodeURIComponent(state.roomId)}/annotations/${encodeURIComponent(editingId)}`:`/api/rooms/${encodeURIComponent(state.roomId)}/annotations`, { method:editingId?"PATCH":"POST", body:JSON.stringify(payload) }); setTyping(false); $("#commentDialog").close(); state.pendingSelection=null; state.selection=null; state.replyTo=null;state.editingCommentId=null; getSelection()?.removeAllRanges(); $("#selectionBar").classList.add("hidden"); await refreshAnnotations(); if(!payload.parentId)jumpToMessage(payload.messageId); } catch(e) { alert(e.message); }
}
function openProfile() {
  $("#plName").value = state.profile.plName; $("#plMarkerColor").value=markerColor(state.profile.plColor); renderPlIcon(); renderPersonas(); $("#profileDialog").showModal();
}
function avatarHtml(icon, fallback="＋") { return icon ? `<img src="${esc(icon)}" alt="">` : `<span>${fallback}</span>`; }
function renderPlIcon() { $("#plIconPreview").innerHTML=avatarHtml(state.profile.plIcon); }
function renderPersonas() { $("#personaList").innerHTML = state.profile.personas.map((p,i)=>`<div class="persona-row"><label class="persona-avatar">${avatarHtml(p.icon || "")}<input type="file" accept="image/*" data-persona-icon="${i}"></label><span>${esc(p.name)}（${esc(p.type)}）</span><input type="color" value="${esc(markerColor(p.color))}" data-persona-color="${i}" title="マーカー色"><button type="button" class="icon-btn" data-remove-persona="${i}">×</button></div>`).join(""); }
function addPersona() { const name=$("#newPersonaName").value.trim(); if(!name)return; state.profile.personas.push({name,type:$("#newPersonaType").value,icon:state.newPersonaIcon||"",color:$("#newPersonaColor").value||"#ffe66b"});state.lastPersona=String(state.profile.personas.length-1);localStorage.setItem(`lastPersona:${state.roomId}`,state.lastPersona);saveProfile(); state.newPersonaIcon=""; $("#newPersonaName").value=""; $("#newPersonaIcon").value=""; renderPersonas(); }
function saveProfileForm(e) { e.preventDefault(); const name=$("#plName").value.trim(); if(!name)return; state.profile.plName=name; state.profile.plColor=$("#plMarkerColor").value||"#ffe66b"; saveProfile(); syncPersonaColor({name:state.profile.plName,type:"PL",color:state.profile.plColor}); $("#profileDialog").close(); fillPersonaSelect(); heartbeatPresence(); if(state.pendingSelection)setTimeout(()=>openCommentDialog(),0); }
async function syncPersonaColor(persona){if(!state.roomId||!persona?.name)return;await api(`/api/rooms/${encodeURIComponent(state.roomId)}/annotations/color`,{method:"PATCH",body:JSON.stringify({authorId:state.profile.id,personaName:persona.name,personaType:persona.type,color:persona.color})});await refreshAnnotations()}
function jumpToMessage(id, annotationId) { const message=state.room?.messages.find(m=>m.id===id); if(!message)return;const index=state.room.tabs.indexOf(message.tab);if(state.hiddenTabs.has(message.tab)){state.hiddenTabs.delete(message.tab);localStorage.setItem(`hiddenTabs:${state.roomId}`,JSON.stringify([...state.hiddenTabs]));state.activeTabIndex=index;renderLog(message.time)}else if(index!==state.activeTabIndex){if(state.viewMode==="timeline")goToTab(index);else{state.activeTabIndex=index;renderLog(message.time)}}const panel=document.querySelector(`.log-page[data-track-index="${state.carouselPosition}"]`),el=panel?.querySelector(`[data-message="${CSS.escape(id)}"]`);if(!el)return;const annotation=annotationId&&state.annotations.find(item=>item.id===annotationId),color=markerColor(annotation?.color||"#ffe66b");el.style.setProperty("--flash-color",color);el.querySelector(".annotation-count")?.style.setProperty("--flash-color",color);el.scrollIntoView({behavior:"smooth",block:"center"});el.classList.remove("flash");requestAnimationFrame(()=>el.classList.add("flash"));if(annotationId)setTimeout(()=>{const mark=el.querySelector(`[data-ann="${CSS.escape(annotationId)}"]`);mark?.style.setProperty("--flash-color",color);mark?.classList.add("flash")},400);}

async function resizeIcon(file) {
  if (!file) return "";
  const bitmap = await createImageBitmap(file), size = 96, canvas = document.createElement("canvas"); canvas.width=size; canvas.height=size;
  const ctx=canvas.getContext("2d"), scale=Math.min(size/bitmap.width,size/bitmap.height), w=bitmap.width*scale, h=bitmap.height*scale;
  ctx.clearRect(0,0,size,size);
  ctx.drawImage(bitmap,(size-w)/2,(size-h)/2,w,h); bitmap.close?.();
  return canvas.toDataURL("image/webp",.82);
}
async function resizeCommentImage(file){if(!file)return"";const bitmap=await createImageBitmap(file),max=1000,scale=Math.min(1,max/Math.max(bitmap.width,bitmap.height)),canvas=document.createElement("canvas");canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));canvas.getContext("2d").drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close?.();let quality=.78,data="";do{data=canvas.toDataURL("image/webp",quality);quality-=.1}while(data.length>600000&&quality>=.38);if(data.length>600000){const small=document.createElement("canvas");small.width=Math.round(canvas.width*.72);small.height=Math.round(canvas.height*.72);small.getContext("2d").drawImage(canvas,0,0,small.width,small.height);data=small.toDataURL("image/webp",.55)}return data}
function clearCommentImage(){state.commentImage=""}
function jumpToComment(id) { const el=$("#comment-"+CSS.escape(id)); if(!el)return; if(innerWidth<=800)$("#commentsPane").classList.add("open"); el.scrollIntoView({behavior:"smooth",block:"center"}); el.classList.add("focused"); setTimeout(()=>el.classList.remove("focused"),1500); }

loadProfile();
function applyTheme(theme){document.documentElement.classList.toggle("dark",theme==="dark")}applyTheme(localStorage.getItem("theme")||"light");
$("#themeBtn").onclick=()=>{const theme=document.documentElement.classList.contains("dark")?"light":"dark";applyTheme(theme);localStorage.setItem(state.roomId?`theme:${state.roomId}`:"theme",theme)};
$("#fileInput").onchange=e=>e.target.files[0]&&handleFile(e.target.files[0]);
for(const ev of ["dragenter","dragover"]){$("#dropzone").addEventListener(ev,e=>{e.preventDefault();e.currentTarget.classList.add("drag")})}
for(const ev of ["dragleave","drop"]){$("#dropzone").addEventListener(ev,e=>{e.preventDefault();e.currentTarget.classList.remove("drag")})}
$("#dropzone").addEventListener("drop",e=>e.dataTransfer.files[0]&&handleFile(e.dataTransfer.files[0]));
$("#createRoomBtn").onclick=createRoom; $("#profileBtn").onclick=openProfile; $("#savePersonaBtn").onclick=addPersona; $("#profileForm").onsubmit=saveProfileForm; $("#commentForm").onsubmit=postComment;
document.addEventListener("click",e=>{if(e.target.matches("[data-close]"))e.target.closest("dialog").close();const image=e.target.closest("[data-expand-image]");if(image){e.stopPropagation();$("#expandedCommentImage").src=image.src;$("#imageDialog").showModal();return}const like=e.target.closest("[data-like-comment]");if(like){e.stopPropagation();toggleLike(like.dataset.likeComment,like);return}const edit=e.target.closest("[data-edit-comment]");if(edit){e.stopPropagation();const annotation=state.annotations.find(item=>item.id===edit.dataset.editComment);openEditDialog(annotation,edit.closest(".comment-card").getBoundingClientRect());return}const typing=e.target.closest("[data-typing-target]");if(typing){jumpToMessage(typing.dataset.typingTarget);return} const rm=e.target.closest("[data-remove-persona]");if(rm){state.profile.personas.splice(Number(rm.dataset.removePersona),1);saveProfile();renderPersonas()} const mark=e.target.closest("mark[data-ann]");if(mark)jumpToComment(mark.dataset.ann);const reply=e.target.closest("[data-reply-comment]");if(reply){const annotation=state.annotations.find(item=>item.id===reply.dataset.replyComment);openReplyDialog(annotation,reply.closest(".comment-card").getBoundingClientRect())} const card=e.target.closest(".comment-card");if(card&&!reply)jumpToMessage(card.dataset.target,card.id.replace("comment-","")); const count=e.target.closest("[data-message-comments]");if(count){const a=state.annotations.find(x=>x.message_id===count.dataset.messageComments&&!x.parent_id);if(a)jumpToComment(a.id)} const page=e.target.closest("[data-page]");if(page)switchLogPage(page.dataset.page==="next"?1:-1)});
document.addEventListener("click",e=>{const tab=e.target.closest("[data-tab-index]");if(tab)goToTab(Number(tab.dataset.tabIndex))});
document.addEventListener("dblclick",e=>{const tab=e.target.closest(".tab-rail [data-tab-index]");if(!tab)return;e.preventDefault();e.stopPropagation();toggleTabVisibility(Number(tab.dataset.tabIndex))});
document.addEventListener("click",e=>{const suggestion=e.target.closest("[data-suggest-message]");if(!suggestion)return;hideTabSuggestions();jumpToMessage(suggestion.dataset.suggestMessage)});
document.addEventListener("click",e=>{const button=e.target.closest("[data-delete-room]");if(button)askDeleteOwnedRoom(button.dataset.deleteRoom,button.dataset.roomTitle)});
document.addEventListener("change",async e=>{if(e.target.matches("[data-persona-icon]")){const i=Number(e.target.dataset.personaIcon);state.profile.personas[i].icon=await resizeIcon(e.target.files[0]);saveProfile();renderPersonas()}});
document.addEventListener("change",e=>{if(e.target.matches("[data-persona-color]")){const persona=state.profile.personas[Number(e.target.dataset.personaColor)];persona.color=e.target.value;saveProfile();syncPersonaColor(persona)}});
$("#personaSelect").onchange=()=>{if($("#personaSelect").value==="ADD"){$("#commentDialog").close();openProfile();return}state.lastPersona=$("#personaSelect").value;localStorage.setItem(`lastPersona:${state.roomId}`,state.lastPersona);updateCommentPersonaAvatar()};
$("#plIconInput").onchange=async e=>{state.profile.plIcon=await resizeIcon(e.target.files[0]);saveProfile();renderPlIcon()};
$("#newPersonaIcon").onchange=async e=>{state.newPersonaIcon=await resizeIcon(e.target.files[0])};
$("#commentDeleteBtn").onclick=async()=>{const id=state.editingCommentId;if(!id)return;if(!confirm("このコメントを削除しますか？\n返信もまとめて削除されます。"))return;$("#commentDialog").close();await deleteComment(id,true);state.editingCommentId=null};
$("#imageDialog").addEventListener("click",e=>{if(e.target===$("#imageDialog"))$("#imageDialog").close()});
$("#archiveInput").onchange=e=>e.target.files[0]&&openArchiveFile(e.target.files[0]);
$("#exportRoomBtn").onclick=async()=>{if(!state.room)return;const button=$("#exportRoomBtn"),label=button.textContent;button.disabled=true;button.textContent="保存中…";try{await downloadArchive(state.room,state.annotations,state.profile.personas)}catch(error){alert(error.message)}finally{button.disabled=false;button.textContent=label}};
$("#saveDeleteRoomBtn").onclick=()=>confirmDeleteRoom(true);$("#deleteOnlyRoomBtn").onclick=()=>confirmDeleteRoom(false);
document.addEventListener("pointerdown",e=>{const dialog=$("#commentDialog");if(!dialog.open||dialog.contains(e.target))return;if($("#commentBody").value.trim()||state.commentImage)$("#commentForm").requestSubmit();else dialog.close()});
$("#commentBody").addEventListener("input",()=>setTyping(true));
$("#commentDialog").addEventListener("close",()=>setTyping(false));
document.addEventListener("keydown",e=>{if(e.defaultPrevented||e.altKey||e.ctrlKey||e.metaKey)return;const target=e.target;if(target?.matches?.("input, textarea, select")||target?.isContentEditable)return;if(e.key==="ArrowLeft"||e.key==="ArrowRight"){e.preventDefault();switchLogPage(e.key==="ArrowRight"?1:-1);return}if(e.key==="ArrowUp"||e.key==="ArrowDown"){const panel=document.querySelector(`.log-page[data-track-index="${state.carouselPosition}"] .page-scroll`);if(!panel)return;e.preventDefault();const amount=(e.key==="ArrowDown"?1:-1)*Math.max(54,panel.clientHeight*.09);if(e.repeat)panel.scrollTop+=amount;else panel.scrollBy({top:amount,behavior:"smooth"})}});
document.addEventListener("mouseup",()=>setTimeout(showSelection)); document.addEventListener("touchend",()=>setTimeout(showSelection,50));
document.addEventListener("visibilitychange",()=>{if(!document.hidden&&state.realtimeWanted&&state.realtime?.readyState!==WebSocket.OPEN)connectRealtime()});
addEventListener("pagehide",disconnectRealtime);
addEventListener("pageshow",()=>{if(state.roomId&&state.roomId!=="archive"&&!state.archiveMode)connectRealtime()});
$("#markBtn").onclick=openCommentDialog; $("#viewMode").value=state.viewMode; $("#viewMode").onchange=e=>{const time=currentReadingTime();state.readingAnchor=time;state.viewMode=e.target.value;localStorage.setItem("trpgMarkerViewMode",state.viewMode);renderLog(time);setTimeout(revealInlineSuggestions,20)}; $("#tabFilter").onchange=e=>{const time=currentReadingTime();state.readingAnchor=time;state.mainTab=e.target.value;localStorage.setItem(`mainTab:${state.roomId}`,state.mainTab);renderLog(time);setTimeout(revealInlineSuggestions,20)}; $("#searchInput").oninput=()=>{const time=currentReadingTime();state.readingAnchor=time;renderLog(time);setTimeout(revealInlineSuggestions,20)};
$("#shareBtn").onclick=async()=>{await navigator.clipboard.writeText(location.href);$("#roomStatus").textContent="共有URLをコピーしました";setTimeout(()=>$("#roomStatus").textContent="",1800)};
function applyFontSize(value){const size=Math.min(20,Math.max(10,Number(value)||12.5));document.documentElement.style.setProperty("--log-font-size",`${size}px`);$("#fontSize").value=String(size);localStorage.setItem("trpgMarkerFontSize",String(size))}$("#fontSize").oninput=e=>applyFontSize(e.target.value);applyFontSize(localStorage.getItem("trpgMarkerFontSize")||12.5);
const startupUrl=new URL(location.href),siteOwnerKey=startupUrl.searchParams.get("owner");if(siteOwnerKey){localStorage.setItem("trpgMarkerSiteOwnerKey",siteOwnerKey);startupUrl.searchParams.delete("owner");history.replaceState(null,"",startupUrl.pathname+startupUrl.search)}const roomId=startupUrl.searchParams.get("room");if(window.__TRPG_ARCHIVE__)openArchiveData(window.__TRPG_ARCHIVE__);else if(roomId)openRoom(roomId);else{renderOwnedRooms();renderRecentRooms()}
