const $ = s => document.querySelector(s);
const state = { roomId: null, room: null, annotations: [], parsed: null, selection: null, profile: null, poller: null };
const uid = () => crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now();
const esc = value => String(value ?? "").replace(/[&<>\"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));

function loadProfile() {
  const saved = JSON.parse(localStorage.getItem("trpgMarkerProfile") || "null");
  state.profile = saved || { id: uid(), plName: "", personas: [] };
}
function saveProfile() { localStorage.setItem("trpgMarkerProfile", JSON.stringify(state.profile)); }
function currentPersona() {
  const value = $("#personaSelect").value;
  if (value === "PL") return { name: state.profile.plName, type: "PL" };
  return state.profile.personas[Number(value)] || { name: state.profile.plName, type: "PL" };
}

function parseTekey(html, filename) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const title = doc.querySelector("title")?.textContent.trim() || filename.replace(/\.html?$/i, "");
  const tabLabels = {};
  doc.querySelectorAll(".tab-checkbox").forEach(label => { const input = label.querySelector("input"); if (input) tabLabels[input.id] = label.textContent.trim(); });
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
    return { id: `m${i}`, speaker, text, time: (timeNode?.textContent || "").replace(/[\[\]]/g, ""), tab: tabLabels[tabClass] || tabClass, diceroll: row.classList.contains("diceroll"), system: speaker === "Tekey" };
  }).filter(m => m.speaker || m.text);
  return { title, tabs: [...new Set(messages.map(m => m.tab).filter(Boolean))], messages };
}

async function api(path, options = {}) {
  const response = await fetch(path, { headers: { "content-type": "application/json", ...(options.headers || {}) }, ...options });
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
    const result = await api("/api/rooms", { method: "POST", body: JSON.stringify(state.parsed) });
    localStorage.setItem(`admin:${result.id}`, result.adminToken);
    location.href = `/?room=${encodeURIComponent(result.id)}`;
  } catch (e) { $("#homeStatus").textContent = e.message; btn.disabled = false; btn.textContent = "秘密の部屋を作る"; }
}

async function openRoom(id) {
  state.roomId = id; $("#homeView").classList.add("hidden"); $("#roomView").classList.remove("hidden"); $("#profileBtn").classList.remove("hidden");
  $("#roomStatus").textContent = "ログを読み込んでいます…";
  try {
    state.room = await api(`/api/rooms/${encodeURIComponent(id)}`);
    $("#roomTitle").textContent = state.room.title; document.title = `${state.room.title} | TRPG LOG MARKER`;
    state.room.tabs.forEach(tab => $("#tabFilter").insertAdjacentHTML("beforeend", `<option>${esc(tab)}</option>`));
    await refreshAnnotations(); renderLog(); $("#roomStatus").textContent = "";
    state.poller = setInterval(refreshAnnotations, 3000);
    if (!state.profile.plName) openProfile();
  } catch (e) { $("#roomStatus").textContent = e.message; }
}

function groupAnnotations() {
  return state.annotations.reduce((map, a) => ((map[a.message_id] ||= []).push(a), map), {});
}
function markedText(message, anns) {
  if (!anns?.length) return esc(message.text);
  const ranges = anns.map(a => ({ start: Math.max(0, a.start_offset), end: Math.min(message.text.length, a.end_offset), id: a.id })).filter(r => r.end > r.start).sort((a,b)=>a.start-b.start);
  let out = "", pos = 0;
  ranges.forEach(r => { if (r.start < pos) return; out += esc(message.text.slice(pos, r.start)); out += `<mark data-ann="${esc(r.id)}">${esc(message.text.slice(r.start, r.end))}</mark>`; pos = r.end; });
  return out + esc(message.text.slice(pos));
}
function renderLog() {
  if (!state.room) return;
  const tab = $("#tabFilter").value, search = $("#searchInput").value.trim().toLowerCase(), grouped = groupAnnotations();
  $("#logPane").innerHTML = state.room.messages.filter(m => (!tab || m.tab === tab) && (!search || `${m.speaker} ${m.text}`.toLowerCase().includes(search))).map(m => {
    const anns = grouped[m.id] || [];
    return `<div class="log-message ${m.system ? "system-message" : ""} ${m.diceroll ? "diceroll" : ""}" data-message="${m.id}">
      <span class="speaker">${esc(m.speaker || "")}${m.speaker ? "：" : ""}</span><span class="message-text">${markedText(m, anns)}</span>
      ${m.time ? `<span class="timestamp">${esc(m.time)}</span>` : ""}${m.tab ? `<span class="tab-badge">${esc(m.tab)}</span>` : ""}
      ${anns.length ? `<button class="annotation-count" data-message-comments="${m.id}">${anns.length}</button>` : ""}</div>`;
  }).join("");
}
function renderComments() {
  $("#commentCount").textContent = state.annotations.length;
  $("#commentsList").innerHTML = state.annotations.length ? state.annotations.map(a => `<div class="comment-card" id="comment-${a.id}" data-target="${a.message_id}"><div class="comment-quote">${esc(a.quote)}</div><div class="comment-author">${esc(a.persona_name)}<span class="persona-type">${esc(a.persona_type)}</span></div><p class="comment-body">${esc(a.body)}</p></div>`).join("") : '<p class="empty">マーカーされた感想がここに並びます。</p>';
}
async function refreshAnnotations() {
  if (!state.roomId) return;
  try {
    const data = await api(`/api/rooms/${encodeURIComponent(state.roomId)}/annotations`);
    const changed = JSON.stringify(data.annotations) !== JSON.stringify(state.annotations);
    state.annotations = data.annotations;
    if (changed) { renderComments(); renderLog(); }
  } catch (e) { $("#roomStatus").textContent = e.message; }
}

function selectionInfo() {
  const selection = getSelection(); if (!selection || selection.isCollapsed || !selection.rangeCount) return null;
  const range = selection.getRangeAt(0), messageEl = range.commonAncestorContainer.nodeType === 1 ? range.commonAncestorContainer.closest?.(".log-message") : range.commonAncestorContainer.parentElement?.closest(".log-message");
  if (!messageEl || !$("#logPane").contains(messageEl)) return null;
  const textEl = messageEl.querySelector(".message-text"); if (!textEl || !textEl.contains(range.startContainer) || !textEl.contains(range.endContainer)) return null;
  const before = range.cloneRange(); before.selectNodeContents(textEl); before.setEnd(range.startContainer, range.startOffset);
  const quote = range.toString(); return { messageId: messageEl.dataset.message, startOffset: before.toString().length, endOffset: before.toString().length + quote.length, quote };
}
function showSelection() {
  state.selection = selectionInfo();
  if (state.selection?.quote.trim()) { $("#selectedQuote").textContent = `「${state.selection.quote.trim()}」`; $("#selectionBar").classList.remove("hidden"); }
  else $("#selectionBar").classList.add("hidden");
}
function fillPersonaSelect() {
  $("#personaSelect").innerHTML = `<option value="PL">${esc(state.profile.plName || "PL名を設定") }（PL）</option>` + state.profile.personas.map((p,i)=>`<option value="${i}">${esc(p.name)}（${esc(p.type)}）</option>`).join("");
}
function openCommentDialog() {
  if (!state.profile.plName) { openProfile(); return; }
  fillPersonaSelect(); $("#dialogQuote").textContent = state.selection.quote; $("#commentBody").value = ""; $("#commentDialog").showModal();
}
async function postComment(event) {
  event.preventDefault(); const persona = currentPersona(), body = $("#commentBody").value.trim(); if (!body) return;
  const payload = { ...state.selection, color: "yellow", authorId: state.profile.id, authorName: state.profile.plName, personaName: persona.name, personaType: persona.type, body };
  try { await api(`/api/rooms/${encodeURIComponent(state.roomId)}/annotations`, { method:"POST", body:JSON.stringify(payload) }); $("#commentDialog").close(); getSelection()?.removeAllRanges(); $("#selectionBar").classList.add("hidden"); await refreshAnnotations(); jumpToMessage(payload.messageId); } catch(e) { alert(e.message); }
}
function openProfile() {
  $("#plName").value = state.profile.plName; renderPersonas(); $("#profileDialog").showModal();
}
function renderPersonas() { $("#personaList").innerHTML = state.profile.personas.map((p,i)=>`<div class="persona-row"><span>${esc(p.name)}（${esc(p.type)}）</span><button type="button" class="icon-btn" data-remove-persona="${i}">×</button></div>`).join(""); }
function addPersona() { const name=$("#newPersonaName").value.trim(); if(!name)return; state.profile.personas.push({name,type:$("#newPersonaType").value}); $("#newPersonaName").value=""; renderPersonas(); }
function saveProfileForm(e) { e.preventDefault(); const name=$("#plName").value.trim(); if(!name)return; state.profile.plName=name; saveProfile(); $("#profileDialog").close(); fillPersonaSelect(); }
function jumpToMessage(id, annotationId) { const el=document.querySelector(`[data-message="${CSS.escape(id)}"]`); if(!el)return; el.scrollIntoView({behavior:"smooth",block:"center"}); el.classList.remove("flash"); requestAnimationFrame(()=>el.classList.add("flash")); if(annotationId)setTimeout(()=>document.querySelector(`[data-ann="${CSS.escape(annotationId)}"]`)?.classList.add("flash"),400); }
function jumpToComment(id) { const el=$("#comment-"+CSS.escape(id)); if(!el)return; if(innerWidth<=800)$("#commentsPane").classList.add("open"); el.scrollIntoView({behavior:"smooth",block:"center"}); el.classList.add("focused"); setTimeout(()=>el.classList.remove("focused"),1500); }

loadProfile();
$("#themeBtn").onclick=()=>{document.documentElement.classList.toggle("dark");localStorage.setItem("theme",document.documentElement.classList.contains("dark")?"dark":"light")};
if(localStorage.getItem("theme")==="dark")document.documentElement.classList.add("dark");
$("#fileInput").onchange=e=>e.target.files[0]&&handleFile(e.target.files[0]);
for(const ev of ["dragenter","dragover"]){$("#dropzone").addEventListener(ev,e=>{e.preventDefault();e.currentTarget.classList.add("drag")})}
for(const ev of ["dragleave","drop"]){$("#dropzone").addEventListener(ev,e=>{e.preventDefault();e.currentTarget.classList.remove("drag")})}
$("#dropzone").addEventListener("drop",e=>e.dataTransfer.files[0]&&handleFile(e.dataTransfer.files[0]));
$("#createRoomBtn").onclick=createRoom; $("#profileBtn").onclick=openProfile; $("#addPersonaBtn").onclick=openProfile; $("#savePersonaBtn").onclick=addPersona; $("#profileForm").onsubmit=saveProfileForm; $("#commentForm").onsubmit=postComment;
document.addEventListener("click",e=>{if(e.target.matches("[data-close]"))e.target.closest("dialog").close(); const rm=e.target.closest("[data-remove-persona]");if(rm){state.profile.personas.splice(Number(rm.dataset.removePersona),1);renderPersonas()} const mark=e.target.closest("mark[data-ann]");if(mark)jumpToComment(mark.dataset.ann); const card=e.target.closest(".comment-card");if(card)jumpToMessage(card.dataset.target,card.id.replace("comment-","")); const count=e.target.closest("[data-message-comments]");if(count){const a=state.annotations.find(x=>x.message_id===count.dataset.messageComments);if(a)jumpToComment(a.id)}});
document.addEventListener("mouseup",()=>setTimeout(showSelection)); document.addEventListener("touchend",()=>setTimeout(showSelection,50));
$("#markBtn").onclick=openCommentDialog; $("#tabFilter").onchange=renderLog; $("#searchInput").oninput=renderLog;
$("#shareBtn").onclick=async()=>{await navigator.clipboard.writeText(location.href);$("#roomStatus").textContent="共有URLをコピーしました";setTimeout(()=>$("#roomStatus").textContent="",1800)};
const roomId=new URLSearchParams(location.search).get("room"); if(roomId)openRoom(roomId);
