const $ = s => document.querySelector(s);
const state = { roomId: null, room: null, annotations: [], parsed: null, selection: null, pendingSelection: null, activeTabIndex: 0, carouselPosition: 1, newPersonaIcon: "", profile: null, poller: null };
const uid = () => crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now();
const esc = value => String(value ?? "").replace(/[&<>\"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));

function loadProfile() {
  const saved = JSON.parse(localStorage.getItem("trpgMarkerProfile") || "null");
  state.profile = saved || { id: uid(), plName: "", personas: [] };
  if (!state.profile.id) state.profile.id = uid();
  if (!Array.isArray(state.profile.personas)) state.profile.personas = [];
  if (!state.profile.plIcon) state.profile.plIcon = "";
  saveProfile();
}
function saveProfile() { localStorage.setItem("trpgMarkerProfile", JSON.stringify(state.profile)); }
function currentPersona() {
  const value = $("#personaSelect").value;
  if (value === "PL") return { name: state.profile.plName, type: "PL", icon: state.profile.plIcon || "" };
  return state.profile.personas[Number(value)] || { name: state.profile.plName, type: "PL", icon: state.profile.plIcon || "" };
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
    return { id: `m${i}`, speaker, text, color: row.style.color || "", time: (timeNode?.textContent || "").replace(/[\[\]]/g, ""), tab: tabLabels[tabClass] || tabClass, diceroll: row.classList.contains("diceroll"), system: speaker === "Tekey" };
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
function pagePanelHtml(tab, realIndex, trackIndex, grouped, search, clone = "") {
  const messages = state.room.messages.filter(m => m.tab === tab && (!search || `${m.speaker} ${m.text}`.toLowerCase().includes(search)));
  const rows = messages.map(m => `<div class="page-row" data-time="${esc(m.time)}"><time>${esc(m.time)}</time>${messageHtml(m, grouped)}</div>`).join("");
  return `<section class="log-page" data-real-index="${realIndex}" data-track-index="${trackIndex}" data-clone="${clone}"><div class="page-scroll"><div class="page-title">${esc(tab)}</div>${rows || '<p class="empty">このタブに表示できる発言がありません。</p>'}</div></section>`;
}
function setTrackPosition(position, animate = false) {
  const track = $("#pageTrack"); if (!track) return;
  track.style.transition = animate ? "transform .42s cubic-bezier(.22,.75,.18,1)" : "none";
  track.style.transform = `translateX(${-position * 100}%)`;
}
function updateCarouselNav() {
  const tab = activeTabName();
  $("#carouselIndex").textContent = `${state.activeTabIndex + 1} / ${state.room.tabs.length}`;
  $("#carouselTitle").textContent = tab;
  $("#tabFilter").value = tab;
}
function syncPanelToTime(panel, time) {
  if (!panel || !time) return;
  const row = [...panel.querySelectorAll(".page-row[data-time]")].find(el => el.dataset.time === time);
  const scroll = panel.querySelector(".page-scroll");
  if (row && scroll) scroll.scrollTop = Math.max(0, row.offsetTop - scroll.clientHeight * .28);
}
function renderLog(anchorTime = "") {
  if (!state.room) return;
  const tabs = state.room.tabs, search = $("#searchInput").value.trim().toLowerCase(), grouped = groupAnnotations();
  if (!tabs.length) return;
  const panels = [];
  panels.push(pagePanelHtml(tabs[tabs.length - 1], tabs.length - 1, 0, grouped, search, "last"));
  tabs.forEach((tab, index) => panels.push(pagePanelHtml(tab, index, index + 1, grouped, search)));
  panels.push(pagePanelHtml(tabs[0], 0, tabs.length + 1, grouped, search, "first"));
  state.carouselPosition = state.activeTabIndex + 1;
  $("#logPane").innerHTML = `<div class="cylinder-nav"><button data-page="prev" aria-label="前のタブ">‹</button><div><small id="carouselIndex"></small><strong id="carouselTitle"></strong></div><button data-page="next" aria-label="次のタブ">›</button></div><div class="carousel-viewport"><div class="page-track" id="pageTrack">${panels.join("")}</div></div>`;
  setTrackPosition(state.carouselPosition, false); updateCarouselNav();
  if (anchorTime) syncPanelToTime(document.querySelector(`.log-page[data-track-index="${state.carouselPosition}"]`), anchorTime);
  $("#pageTrack").addEventListener("transitionend", () => {
    const n = state.room.tabs.length;
    if (state.carouselPosition === 0) state.carouselPosition = n;
    else if (state.carouselPosition === n + 1) state.carouselPosition = 1;
    setTrackPosition(state.carouselPosition, false);
  });
  const viewport=$(".carousel-viewport"); let touchStart=null;
  viewport.addEventListener("touchstart",e=>{const t=e.touches[0];touchStart={x:t.clientX,y:t.clientY}},{passive:true});
  viewport.addEventListener("touchend",e=>{if(!touchStart)return;const t=e.changedTouches[0],dx=t.clientX-touchStart.x,dy=t.clientY-touchStart.y;touchStart=null;if(Math.abs(dx)>60&&Math.abs(dx)>Math.abs(dy)*1.2)switchLogPage(dx<0?1:-1)},{passive:true});
}
function currentReadingTime() {
  const panel = document.querySelector(`.log-page[data-track-index="${state.carouselPosition}"]`);
  const scroll = panel?.querySelector(".page-scroll"); if (!scroll) return "";
  const rows = [...panel.querySelectorAll(".page-row[data-time]")];
  const targetY = scroll.getBoundingClientRect().top + scroll.clientHeight * .28;
  let best = null, distance = Infinity;
  rows.forEach(row => { const d = Math.abs(row.getBoundingClientRect().top - targetY); if (d < distance) { distance = d; best = row; } });
  return best?.dataset.time || "";
}
function switchLogPage(direction) {
  if (!state.room?.tabs?.length) return;
  const time = currentReadingTime(), n = state.room.tabs.length;
  state.carouselPosition += direction;
  state.activeTabIndex = (state.activeTabIndex + direction + n) % n;
  const target = document.querySelector(`.log-page[data-track-index="${state.carouselPosition}"]`);
  syncPanelToTime(target, time);
  if(state.carouselPosition===0)syncPanelToTime(document.querySelector(`.log-page[data-track-index="${n}"]`),time);
  if(state.carouselPosition===n+1)syncPanelToTime(document.querySelector(`.log-page[data-track-index="1"]`),time);
  updateCarouselNav(); setTrackPosition(state.carouselPosition, true);
}
function renderComments() {
  $("#commentCount").textContent = state.annotations.length;
  $("#commentsList").innerHTML = state.annotations.length ? state.annotations.map(a => `<div class="comment-card" id="comment-${a.id}" data-target="${a.message_id}"><div class="comment-quote">${esc(a.quote)}</div><div class="comment-author">${a.persona_icon ? `<img class="comment-avatar" src="${esc(a.persona_icon)}" alt="">` : '<span class="comment-avatar empty-avatar"></span>'}<span>${esc(a.persona_name)}<span class="persona-type">${esc(a.persona_type)}</span></span></div><p class="comment-body">${esc(a.body)}</p></div>`).join("") : '<p class="empty">マーカーされた感想がここに並びます。</p>';
}
async function refreshAnnotations() {
  if (!state.roomId) return;
  try {
    const data = await api(`/api/rooms/${encodeURIComponent(state.roomId)}/annotations`);
    const changed = JSON.stringify(data.annotations) !== JSON.stringify(state.annotations);
    state.annotations = data.annotations;
    if (changed) { const time=currentReadingTime(); renderComments(); renderLog(time); }
  } catch (e) { $("#roomStatus").textContent = e.message; }
}

function selectionInfo() {
  const selection = getSelection(); if (!selection || selection.isCollapsed || !selection.rangeCount) return null;
  const range = selection.getRangeAt(0), messageEl = range.commonAncestorContainer.nodeType === 1 ? range.commonAncestorContainer.closest?.(".log-message") : range.commonAncestorContainer.parentElement?.closest(".log-message");
  if (!messageEl || !$("#logPane").contains(messageEl)) return null;
  const textEl = messageEl.querySelector(".message-text"); if (!textEl || !textEl.contains(range.startContainer) || !textEl.contains(range.endContainer)) return null;
  const before = range.cloneRange(); before.selectNodeContents(textEl); before.setEnd(range.startContainer, range.startOffset);
  const quote = range.toString(), rect=range.getBoundingClientRect(); return { messageId: messageEl.dataset.message, startOffset: before.toString().length, endOffset: before.toString().length + quote.length, quote, anchorLeft:rect.left, anchorRight:rect.right, anchorTop:rect.top, anchorBottom:rect.bottom };
}
function showSelection() {
  const nextSelection = selectionInfo();
  if (nextSelection?.quote.trim()) { state.selection = nextSelection; $("#selectedQuote").textContent = `「${state.selection.quote.trim()}」`; $("#selectionBar").classList.add("hidden"); if(!$("#commentDialog").open&&!$("#profileDialog").open)openCommentDialog(); }
  else if (!$("#commentDialog").open) $("#selectionBar").classList.add("hidden");
}
function fillPersonaSelect() {
  $("#personaSelect").innerHTML = `<option value="PL">${esc(state.profile.plName || "PL名を設定") }（PL）</option>` + state.profile.personas.map((p,i)=>`<option value="${i}">${esc(p.name)}（${esc(p.type)}）</option>`).join("");
}
function openCommentDialog() {
  state.pendingSelection = state.selection ? { ...state.selection } : null;
  if (!state.pendingSelection) return;
  if (!state.profile.plName) { openProfile(); return; }
  fillPersonaSelect(); $("#dialogQuote").textContent = state.pendingSelection.quote; $("#commentBody").value = ""; $("#commentDialog").showModal(); positionCommentDialog(); setTimeout(()=>$("#commentBody").focus(),0);
}
function positionCommentDialog(){const dialog=$("#commentDialog"),a=state.pendingSelection;if(!a||innerWidth<=800){dialog.style.left="";dialog.style.top="";return}const width=Math.min(390,innerWidth-24),height=Math.min(dialog.offsetHeight||430,innerHeight-24);let left=a.anchorRight+12;if(left+width>innerWidth-12)left=Math.max(12,a.anchorLeft-width-12);let top=Math.min(Math.max(12,a.anchorTop-24),innerHeight-height-12);dialog.style.left=`${left}px`;dialog.style.top=`${top}px`}
async function postComment(event) {
  event.preventDefault(); const persona = currentPersona(), body = $("#commentBody").value.trim(); if (!body) return;
  const payload = { ...state.pendingSelection, color: "yellow", authorId: state.profile.id, authorName: state.profile.plName, personaName: persona.name, personaType: persona.type, personaIcon: persona.icon || "", body };
  try { await api(`/api/rooms/${encodeURIComponent(state.roomId)}/annotations`, { method:"POST", body:JSON.stringify(payload) }); $("#commentDialog").close(); getSelection()?.removeAllRanges(); $("#selectionBar").classList.add("hidden"); await refreshAnnotations(); jumpToMessage(payload.messageId); } catch(e) { alert(e.message); }
}
function openProfile() {
  $("#plName").value = state.profile.plName; renderPlIcon(); renderPersonas(); $("#profileDialog").showModal();
}
function avatarHtml(icon, fallback="＋") { return icon ? `<img src="${esc(icon)}" alt="">` : `<span>${fallback}</span>`; }
function renderPlIcon() { $("#plIconPreview").innerHTML=avatarHtml(state.profile.plIcon); }
function renderPersonas() { $("#personaList").innerHTML = state.profile.personas.map((p,i)=>`<div class="persona-row"><label class="persona-avatar">${avatarHtml(p.icon || "")}<input type="file" accept="image/*" data-persona-icon="${i}"></label><span>${esc(p.name)}（${esc(p.type)}）</span><button type="button" class="icon-btn" data-remove-persona="${i}">×</button></div>`).join(""); }
function addPersona() { const name=$("#newPersonaName").value.trim(); if(!name)return; state.profile.personas.push({name,type:$("#newPersonaType").value,icon:state.newPersonaIcon||""}); state.newPersonaIcon=""; $("#newPersonaName").value=""; $("#newPersonaIcon").value=""; renderPersonas(); }
function saveProfileForm(e) { e.preventDefault(); const name=$("#plName").value.trim(); if(!name)return; state.profile.plName=name; saveProfile(); $("#profileDialog").close(); fillPersonaSelect(); if(state.pendingSelection)setTimeout(()=>openCommentDialog(),0); }
function jumpToMessage(id, annotationId) { const message=state.room?.messages.find(m=>m.id===id); if(!message)return; const index=state.room.tabs.indexOf(message.tab); if(index!==state.activeTabIndex){state.activeTabIndex=index;renderLog(message.time)} const panel=document.querySelector(`.log-page[data-track-index="${state.activeTabIndex+1}"]`); const el=panel?.querySelector(`[data-message="${CSS.escape(id)}"]`); if(!el)return; el.scrollIntoView({behavior:"smooth",block:"center"}); el.classList.remove("flash"); requestAnimationFrame(()=>el.classList.add("flash")); if(annotationId)setTimeout(()=>el.querySelector(`[data-ann="${CSS.escape(annotationId)}"]`)?.classList.add("flash"),400); }

async function resizeIcon(file) {
  if (!file) return "";
  const bitmap = await createImageBitmap(file), size = 96, canvas = document.createElement("canvas"); canvas.width=size; canvas.height=size;
  const ctx=canvas.getContext("2d"), scale=Math.max(size/bitmap.width,size/bitmap.height), w=bitmap.width*scale, h=bitmap.height*scale;
  ctx.drawImage(bitmap,(size-w)/2,(size-h)/2,w,h); bitmap.close?.();
  return canvas.toDataURL("image/webp",.82);
}
function jumpToComment(id) { const el=$("#comment-"+CSS.escape(id)); if(!el)return; if(innerWidth<=800)$("#commentsPane").classList.add("open"); el.scrollIntoView({behavior:"smooth",block:"center"}); el.classList.add("focused"); setTimeout(()=>el.classList.remove("focused"),1500); }

loadProfile();
$("#themeBtn").onclick=()=>{document.documentElement.classList.toggle("dark");localStorage.setItem("theme",document.documentElement.classList.contains("dark")?"dark":"light")};
if(localStorage.getItem("theme")==="dark")document.documentElement.classList.add("dark");
$("#fileInput").onchange=e=>e.target.files[0]&&handleFile(e.target.files[0]);
for(const ev of ["dragenter","dragover"]){$("#dropzone").addEventListener(ev,e=>{e.preventDefault();e.currentTarget.classList.add("drag")})}
for(const ev of ["dragleave","drop"]){$("#dropzone").addEventListener(ev,e=>{e.preventDefault();e.currentTarget.classList.remove("drag")})}
$("#dropzone").addEventListener("drop",e=>e.dataTransfer.files[0]&&handleFile(e.dataTransfer.files[0]));
$("#createRoomBtn").onclick=createRoom; $("#profileBtn").onclick=openProfile; $("#addPersonaBtn").onclick=openProfile; $("#savePersonaBtn").onclick=addPersona; $("#profileForm").onsubmit=saveProfileForm; $("#commentForm").onsubmit=postComment;
document.addEventListener("click",e=>{if(e.target.matches("[data-close]"))e.target.closest("dialog").close(); const rm=e.target.closest("[data-remove-persona]");if(rm){state.profile.personas.splice(Number(rm.dataset.removePersona),1);renderPersonas()} const mark=e.target.closest("mark[data-ann]");if(mark)jumpToComment(mark.dataset.ann); const card=e.target.closest(".comment-card");if(card)jumpToMessage(card.dataset.target,card.id.replace("comment-","")); const count=e.target.closest("[data-message-comments]");if(count){const a=state.annotations.find(x=>x.message_id===count.dataset.messageComments);if(a)jumpToComment(a.id)} const page=e.target.closest("[data-page]");if(page)switchLogPage(page.dataset.page==="next"?1:-1)});
document.addEventListener("change",async e=>{if(e.target.matches("[data-persona-icon]")){const i=Number(e.target.dataset.personaIcon);state.profile.personas[i].icon=await resizeIcon(e.target.files[0]);saveProfile();renderPersonas()}});
$("#plIconInput").onchange=async e=>{state.profile.plIcon=await resizeIcon(e.target.files[0]);saveProfile();renderPlIcon()};
$("#newPersonaIcon").onchange=async e=>{state.newPersonaIcon=await resizeIcon(e.target.files[0])};
$("#commentDialog").addEventListener("click",e=>{if(e.target!==$("#commentDialog"))return;if($("#commentBody").value.trim())$("#commentForm").requestSubmit();else $("#commentDialog").close()});
document.addEventListener("mouseup",()=>setTimeout(showSelection)); document.addEventListener("touchend",()=>setTimeout(showSelection,50));
$("#markBtn").onclick=openCommentDialog; $("#tabFilter").onchange=e=>{const index=state.room.tabs.indexOf(e.target.value);if(index>=0){const time=currentReadingTime();state.activeTabIndex=index;renderLog(time)}}; $("#searchInput").oninput=()=>{const time=currentReadingTime();renderLog(time)};
$("#shareBtn").onclick=async()=>{await navigator.clipboard.writeText(location.href);$("#roomStatus").textContent="共有URLをコピーしました";setTimeout(()=>$("#roomStatus").textContent="",1800)};
const roomId=new URLSearchParams(location.search).get("room"); if(roomId)openRoom(roomId);
