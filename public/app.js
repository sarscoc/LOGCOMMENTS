const $ = s => document.querySelector(s);
const state = { roomId: null, room: null, annotations: [], presence: [], parsed: null, selection: null, pendingSelection: null, replyTo: null, activeTabIndex: 0, carouselPosition: 1, isSliding: false, slideQueue: 0, viewMode: localStorage.getItem("trpgMarkerViewMode") || "compact", mainTab: "", suggestionTimer: null, newPersonaIcon: "", profile: null, legacyPersonas: [], lastPersona: "PL", poller: null, presencePoller: null, isTyping: false, typingTimer: null };
const uid = () => crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now();
const esc = value => String(value ?? "").replace(/[&<>\"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));

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
  state.roomId = id; loadRoomPersonas(id); $("#homeView").classList.add("hidden"); $("#roomView").classList.remove("hidden"); $("#profileBtn").classList.remove("hidden");
  $("#roomStatus").textContent = "ログを読み込んでいます…";
  try {
    state.room = await api(`/api/rooms/${encodeURIComponent(id)}`);
    $("#roomTitle").textContent = state.room.title; document.title = `${state.room.title} | TRPG LOG MARKER`;
    state.room.tabs.forEach(tab => $("#tabFilter").insertAdjacentHTML("beforeend", `<option>${esc(tab)}</option>`));
    const savedMain=localStorage.getItem(`mainTab:${id}`);state.mainTab=state.room.tabs.includes(savedMain)?savedMain:(state.room.tabs.find(tab=>/^メイン$/i.test(tab))||state.room.tabs[0]||"");$("#tabFilter").value=state.mainTab;
    await refreshAnnotations(); renderLog(); $("#roomStatus").textContent = "";
    state.poller = setInterval(refreshAnnotations, 3000);
    await heartbeatPresence(); state.presencePoller=setInterval(heartbeatPresence,20000);
    if (!state.profile.plName) openProfile();
  } catch (e) { $("#roomStatus").textContent = e.message; }
}
function renderPresence(){$("#presenceBar").innerHTML=state.presence.map(person=>`<span class="presence-person ${person.is_typing?"typing":""}" title="${person.is_typing?"入力中":"入室中"}">${person.pl_icon?`<img src="${esc(person.pl_icon)}" alt="">`:`<i>${esc((person.pl_name||"?").slice(0,1))}</i>`}<b>${esc(person.pl_name)}</b>${person.is_typing?'<em>入力中…</em>':""}</span>`).join("")}
async function heartbeatPresence(){if(!state.roomId||!state.profile?.plName)return;const persona=state.isTyping?currentPersona():null;try{const data=await api(`/api/rooms/${encodeURIComponent(state.roomId)}/presence`,{method:"POST",body:JSON.stringify({authorId:state.profile.id,plName:state.profile.plName,plIcon:state.profile.plIcon||"",isTyping:state.isTyping,typingName:persona?.name||"",typingIcon:persona?.icon||"",typingMessageId:state.isTyping?state.pendingSelection?.messageId||"":""})});state.presence=data.presence||[];renderPresence();if(state.room)renderComments();if($("#roomStatus").textContent.includes("通信エラー"))$("#roomStatus").textContent=""}catch(e){$("#roomStatus").textContent=e.message}}
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
function pagePanelHtml(tab, realIndex, trackIndex, grouped, search, clone = "") {
  const messages = state.room.messages.filter(m => m.tab === tab && (!search || `${m.speaker} ${m.text}`.toLowerCase().includes(search)));
  const rows = messages.map(m => `<div class="page-row" data-time="${esc(m.time)}"><time>${esc(m.time)}</time>${messageHtml(m, grouped)}</div>`).join("");
  return `<section class="log-page" data-real-index="${realIndex}" data-track-index="${trackIndex}" data-clone="${clone}"><div class="page-scroll">${rows || '<p class="empty">このタブに表示できる発言がありません。</p>'}</div></section>`;
}
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
function revealInlineSuggestions(){hideTabSuggestions();if(activeTabName()!==state.mainTab||state.viewMode!=="timeline")return;const panel=document.querySelector(`.log-page[data-track-index="${state.carouselPosition}"]`),glimpses=[...(panel?.querySelectorAll(".foreign-glimpse")||[])];glimpses.forEach((glimpse,index)=>{glimpse.classList.remove("reveal");setTimeout(()=>glimpse.classList.add("reveal"),Math.min(index*45,420))})}
function showMainSuggestions(){revealInlineSuggestions()}
function tabRailHtml(){return `<div class="tab-navigation"><button class="tab-arrow prev" data-page="prev" aria-label="前のタブ">‹</button><nav class="tab-rail" aria-label="タブ一覧">${state.room.tabs.map((tab,index)=>`<button type="button" data-tab-index="${index}" class="${index===state.activeTabIndex?"active":""}">${esc(tab)}</button>`).join("")}</nav><button class="tab-arrow next" data-page="next" aria-label="次のタブ">›</button></div>`}
function syncPanelToTime(panel, time) {
  if (!panel || !time) return;
  const row = [...panel.querySelectorAll(".page-row[data-time]")].find(el => el.dataset.time === time);
  const scroll = panel.querySelector(".page-scroll");
  if (row && scroll) scroll.scrollTop = Math.max(0, row.offsetTop - scroll.clientHeight * .28);
}
function renderLog(anchorTime = "") {
  if (!state.room) return;
  if (state.viewMode === "timeline") { renderTimelineLog(anchorTime); return; }
  const tabs = state.room.tabs, search = $("#searchInput").value.trim().toLowerCase(), grouped = groupAnnotations();
  if (!tabs.length) return;
  const panels = [];
  panels.push(pagePanelHtml(tabs[tabs.length - 1], tabs.length - 1, 0, grouped, search, "last"));
  tabs.forEach((tab, index) => panels.push(pagePanelHtml(tab, index, index + 1, grouped, search)));
  panels.push(pagePanelHtml(tabs[0], 0, tabs.length + 1, grouped, search, "first"));
  state.carouselPosition = state.activeTabIndex + 1;
  state.isSliding = false; state.slideQueue = 0;
  $("#logPane").innerHTML = `${tabRailHtml()}<div class="carousel-viewport"><div class="page-track" id="pageTrack">${panels.join("")}</div></div>`;
  setTrackPosition(state.carouselPosition, false); updateCarouselNav();
  if (anchorTime) syncPanelToTime(document.querySelector(`.log-page[data-track-index="${state.carouselPosition}"]`), anchorTime);
  $("#pageTrack").addEventListener("transitionend", event => {
    if (event.target !== $("#pageTrack") || event.propertyName !== "transform") return;
    const n = state.room.tabs.length;
    if (state.carouselPosition === 0) state.carouselPosition = n;
    else if (state.carouselPosition === n + 1) state.carouselPosition = 1;
    setTrackPosition(state.carouselPosition, false);
    state.isSliding = false;
    if (state.slideQueue) { const queued = state.slideQueue; state.slideQueue = 0; requestAnimationFrame(() => switchLogPage(queued)); }
  });
  const viewport=$(".carousel-viewport"); let touchStart=null;
  viewport.addEventListener("touchstart",e=>{const t=e.touches[0];touchStart={x:t.clientX,y:t.clientY}},{passive:true});
  viewport.addEventListener("touchend",e=>{if(!touchStart)return;const t=e.changedTouches[0],dx=t.clientX-touchStart.x,dy=t.clientY-touchStart.y;touchStart=null;if(Math.abs(dx)>60&&Math.abs(dx)>Math.abs(dy)*1.2)switchLogPage(dx<0?1:-1)},{passive:true});
}
function sharedTimelineSlots(messages){const slots=[];messages.forEach((message,index)=>{const key=message.time||`untimed-${index}`;let slot=slots[slots.length-1];if(!slot||slot.key!==key){slot={key,time:message.time,byTab:new Map()};slots.push(slot)}const list=slot.byTab.get(message.tab)||[];list.push(message);slot.byTab.set(message.tab,list)});slots.forEach(slot=>{let units=1;slot.byTab.forEach(list=>{const size=list.reduce((sum,m)=>sum+1+Math.ceil((m.text.length+(m.speaker||"").length)/45),0);units=Math.max(units,size)});const foreignCount=slot.byTab.has(state.mainTab)?0:Math.min(3,[...slot.byTab.values()].reduce((sum,list)=>sum+list.length,0));slot.height=Math.max(38,units*19+10,foreignCount?foreignCount*32+12:0)});return slots}
function timelinePagePanelHtml(tab,realIndex,trackIndex,slots,grouped,search,clone=""){const rows=slots.map(slot=>{const list=(slot.byTab.get(tab)||[]).filter(m=>!search||`${m.speaker} ${m.text}`.toLowerCase().includes(search));const foreign=tab===state.mainTab?[...slot.byTab.entries()].filter(([otherTab])=>otherTab!==tab).flatMap(([otherTab,messages])=>messages.filter(m=>!search||`${m.speaker} ${m.text}`.toLowerCase().includes(search)).slice(0,2).map(m=>`<div class="foreign-glimpse"><b>${esc(otherTab)}</b><span>${esc(m.speaker||"")}${m.speaker?"：":""}${esc(m.text.slice(0,140))}</span></div>`)).slice(0,3).join(""):"";return `<div class="page-row timeline-slot ${list.length?"has-message":"empty-slot"}" data-time="${esc(slot.time)}" style="height:${slot.height}px"><time>${esc(slot.time)}</time><div class="timeline-slot-content">${list.map(m=>messageHtml(m,grouped)).join("")}${foreign?`<div class="foreign-glimpses">${foreign}</div>`:""}</div></div>`}).join("");return `<section class="log-page" data-real-index="${realIndex}" data-track-index="${trackIndex}" data-clone="${clone}"><div class="page-scroll timeline-page">${rows}</div></section>`}
function renderTimelineLog(anchorTime="") {
  const tabs=state.room.tabs,search=$("#searchInput").value.trim().toLowerCase(),grouped=groupAnnotations(),slots=sharedTimelineSlots(state.room.messages);if(!tabs.length)return;
  const panels=[timelinePagePanelHtml(tabs[tabs.length-1],tabs.length-1,0,slots,grouped,search,"last")];tabs.forEach((tab,index)=>panels.push(timelinePagePanelHtml(tab,index,index+1,slots,grouped,search)));panels.push(timelinePagePanelHtml(tabs[0],0,tabs.length+1,slots,grouped,search,"first"));
  state.carouselPosition=state.activeTabIndex+1;state.isSliding=false;state.slideQueue=0;
  $("#logPane").innerHTML=`${tabRailHtml()}<div class="carousel-viewport"><div class="page-track" id="pageTrack">${panels.join("")}</div></div>`;
  setTrackPosition(state.carouselPosition,false);updateCarouselNav();if(anchorTime)syncPanelToTime(document.querySelector(`.log-page[data-track-index="${state.carouselPosition}"]`),anchorTime);
  $("#pageTrack").addEventListener("transitionend",event=>{if(event.target!==$("#pageTrack")||event.propertyName!=="transform")return;const n=state.room.tabs.length;if(state.carouselPosition===0)state.carouselPosition=n;else if(state.carouselPosition===n+1)state.carouselPosition=1;setTrackPosition(state.carouselPosition,false);state.isSliding=false;if(state.slideQueue){const queued=state.slideQueue;state.slideQueue=0;requestAnimationFrame(()=>switchLogPage(queued))}});
  const viewport=$(".carousel-viewport");let touchStart=null;viewport.addEventListener("touchstart",e=>{const t=e.touches[0];touchStart={x:t.clientX,y:t.clientY}},{passive:true});viewport.addEventListener("touchend",e=>{if(!touchStart)return;const t=e.changedTouches[0],dx=t.clientX-touchStart.x,dy=t.clientY-touchStart.y;touchStart=null;if(Math.abs(dx)>60&&Math.abs(dx)>Math.abs(dy)*1.2)switchLogPage(dx<0?1:-1)},{passive:true});
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
  if (state.isSliding) { state.slideQueue = direction < 0 ? -1 : 1; return; }
  state.isSliding = true;
  const time = currentReadingTime(), n = state.room.tabs.length;
  state.carouselPosition += direction;
  state.activeTabIndex = (state.activeTabIndex + direction + n) % n;
  const target = document.querySelector(`.log-page[data-track-index="${state.carouselPosition}"]`);
  syncPanelToTime(target, time);
  if(state.carouselPosition===0)syncPanelToTime(document.querySelector(`.log-page[data-track-index="${n}"]`),time);
  if(state.carouselPosition===n+1)syncPanelToTime(document.querySelector(`.log-page[data-track-index="1"]`),time);
  updateCarouselNav(); setTrackPosition(state.carouselPosition, true);
  if(activeTabName()===state.mainTab)setTimeout(revealInlineSuggestions,80);else hideTabSuggestions();
}
function goToTab(index){if(!state.room?.tabs?.[index]||index===state.activeTabIndex)return;const time=currentReadingTime();state.isSliding=true;state.slideQueue=0;state.activeTabIndex=index;state.carouselPosition=index+1;syncPanelToTime(document.querySelector(`.log-page[data-track-index="${state.carouselPosition}"]`),time);updateCarouselNav();setTrackPosition(state.carouselPosition,true);if(activeTabName()===state.mainTab)setTimeout(revealInlineSuggestions,80);else hideTabSuggestions()}
function renderComments() {
  $("#commentCount").textContent = state.annotations.length;
  const order=new Map(state.room.messages.map((message,index)=>[message.id,index]));
  const annotations=[...state.annotations].sort((a,b)=>(order.get(a.message_id)??Infinity)-(order.get(b.message_id)??Infinity)||a.start_offset-b.start_offset||String(a.created_at).localeCompare(String(b.created_at)));
  const children=new Map();annotations.forEach(annotation=>{if(annotation.parent_id){const list=children.get(annotation.parent_id)||[];list.push(annotation);children.set(annotation.parent_id,list)}});
  const cardHtml=(a,depth=0)=>{const tab=state.room.messages.find(m=>m.id===a.message_id)?.tab||"",replies=children.get(a.id)||[];return `<div class="comment-thread ${depth?"is-reply":""}" style="--reply-depth:${Math.min(depth,3)}"><div class="comment-card" style="--comment-marker:${esc(markerColor(a.color))}" id="comment-${a.id}" data-target="${a.message_id}"><div class="comment-author">${a.persona_icon ? `<img class="comment-avatar" src="${esc(a.persona_icon)}" alt="">` : '<span class="comment-avatar empty-avatar"></span>'}<span>${esc(a.persona_name)}<span class="persona-type">${esc(a.persona_type)}</span></span><button class="comment-reply" type="button" data-reply-comment="${esc(a.id)}" title="返信">↩</button><time class="comment-date">${tab?`${esc(tab)} · `:""}${esc(formatCommentDate(a.created_at))}</time></div><p class="comment-body">${esc(a.body)}</p></div>${replies.map(reply=>cardHtml(reply,depth+1)).join("")}</div>`};
  const roots=annotations.filter(annotation=>!annotation.parent_id||!state.annotations.some(candidate=>candidate.id===annotation.parent_id));const typing=state.presence.filter(person=>person.is_typing&&person.typing_message_id).map(person=>({typing:true,message_id:person.typing_message_id,person}));const items=[...roots.map(annotation=>({annotation,message_id:annotation.message_id})),...typing].sort((a,b)=>(order.get(a.message_id)??Infinity)-(order.get(b.message_id)??Infinity));const typingHtml=item=>`<div class="typing-comment"><span class="comment-avatar">${item.person.typing_icon?`<img src="${esc(item.person.typing_icon)}" alt="">`:esc((item.person.typing_name||item.person.pl_name||"?").slice(0,1))}</span><b>${esc(item.person.typing_name||item.person.pl_name)}</b><em>入力中…</em><i></i><i></i><i></i></div>`;$("#commentsList").innerHTML=items.length?items.map(item=>item.typing?typingHtml(item):cardHtml(item.annotation)).join(""):'<p class="empty">マーカーされた感想がここに並びます。</p>';
}
function formatCommentDate(value){if(!value)return "";const normalized=/Z|[+-]\d\d:?\d\d$/.test(value)?value:value.replace(" ","T")+"Z";const date=new Date(normalized);return Number.isNaN(date.getTime())?String(value):new Intl.DateTimeFormat("ja-JP",{month:"numeric",day:"numeric",hour:"2-digit",minute:"2-digit"}).format(date)}
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
  const range=selection.getRangeAt(0), parent=node=>node.nodeType===1?node:node.parentElement, startMessage=parent(range.startContainer)?.closest?.(".log-message"), endMessage=parent(range.endContainer)?.closest?.(".log-message");
  if(!startMessage||!endMessage||!$("#logPane").contains(startMessage)||!$("#logPane").contains(endMessage))return null;
  const startText=startMessage.querySelector(".message-text"),endText=endMessage.querySelector(".message-text");if(!startText||!endText)return null;
  const textOffset=(textEl,node,offset,edge)=>{if(textEl.contains(node)){const partial=document.createRange();partial.selectNodeContents(textEl);partial.setEnd(node,offset);return partial.toString().length}if(parent(node)?.closest?.(".speaker"))return 0;return edge==="start"?0:textEl.textContent.length};
  const rects=[...range.getClientRects()].filter(r=>r.width||r.height),focusAtEnd=selection.focusNode===range.endContainer&&selection.focusOffset===range.endOffset,rect=(focusAtEnd?rects[rects.length-1]:rects[0])||range.getBoundingClientRect();return {messageId:startMessage.dataset.message,endMessageId:endMessage.dataset.message,startOffset:textOffset(startText,range.startContainer,range.startOffset,"start"),endOffset:textOffset(endText,range.endContainer,range.endOffset,"end"),quote:range.toString(),anchorLeft:rect.left,anchorRight:rect.right,anchorTop:rect.top,anchorBottom:rect.bottom};
}
function showSelection() {
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
  state.replyTo=null;
  state.pendingSelection = state.selection ? { ...state.selection } : null;
  if (!state.pendingSelection) return;
  if (!state.profile.plName) { openProfile(); return; }
  fillPersonaSelect(); $("#commentBody").value = ""; $("#commentDialog").show(); positionCommentDialog(); setTimeout(()=>$("#commentBody").focus(),0);
}
function openReplyDialog(annotation,anchor){if(!annotation)return;state.replyTo=annotation.id;state.pendingSelection={messageId:annotation.message_id,endMessageId:annotation.end_message_id||annotation.message_id,startOffset:annotation.start_offset,endOffset:annotation.end_offset,quote:annotation.quote,anchorLeft:anchor.left,anchorRight:anchor.right,anchorTop:anchor.top,anchorBottom:anchor.bottom};fillPersonaSelect();$("#commentBody").value="";$("#commentDialog").show();positionCommentDialog();setTimeout(()=>$("#commentBody").focus(),0)}
function positionCommentDialog(){const dialog=$("#commentDialog"),a=state.pendingSelection;if(!a||innerWidth<=800){dialog.style.left="";dialog.style.top="";return}const width=Math.min(390,innerWidth-24),height=Math.min(dialog.offsetHeight||430,innerHeight-24);let left=a.anchorRight+12;if(left+width>innerWidth-12)left=Math.max(12,a.anchorLeft-width-12);let top=Math.min(Math.max(12,a.anchorTop-24),innerHeight-height-12);dialog.style.left=`${left}px`;dialog.style.top=`${top}px`}
async function postComment(event) {
  event.preventDefault(); const persona = currentPersona(), body = $("#commentBody").value.trim(); if (!body) return;
  const payload = { ...state.pendingSelection, parentId:state.replyTo||"", color: persona.color || "#ffe66b", authorId: state.profile.id, authorName: state.profile.plName, personaName: persona.name, personaType: persona.type, personaIcon: persona.icon || "", body };
  try { await api(`/api/rooms/${encodeURIComponent(state.roomId)}/annotations`, { method:"POST", body:JSON.stringify(payload) }); setTyping(false); $("#commentDialog").close(); state.pendingSelection=null; state.selection=null; state.replyTo=null; getSelection()?.removeAllRanges(); $("#selectionBar").classList.add("hidden"); await refreshAnnotations(); if(!payload.parentId)jumpToMessage(payload.messageId); } catch(e) { alert(e.message); }
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
function jumpToMessage(id, annotationId) { const message=state.room?.messages.find(m=>m.id===id); if(!message)return; let el;if(state.viewMode==="timeline"){el=document.querySelector(`[data-message="${CSS.escape(id)}"]`)}else{const index=state.room.tabs.indexOf(message.tab);if(index!==state.activeTabIndex){state.activeTabIndex=index;renderLog(message.time)}const panel=document.querySelector(`.log-page[data-track-index="${state.activeTabIndex+1}"]`);el=panel?.querySelector(`[data-message="${CSS.escape(id)}"]`)}if(!el)return;el.scrollIntoView({behavior:"smooth",block:"center"});el.classList.remove("flash");requestAnimationFrame(()=>el.classList.add("flash"));if(annotationId)setTimeout(()=>el.querySelector(`[data-ann="${CSS.escape(annotationId)}"]`)?.classList.add("flash"),400);}

async function resizeIcon(file) {
  if (!file) return "";
  const bitmap = await createImageBitmap(file), size = 96, canvas = document.createElement("canvas"); canvas.width=size; canvas.height=size;
  const ctx=canvas.getContext("2d"), scale=Math.min(size/bitmap.width,size/bitmap.height), w=bitmap.width*scale, h=bitmap.height*scale;
  ctx.clearRect(0,0,size,size);
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
$("#createRoomBtn").onclick=createRoom; $("#profileBtn").onclick=openProfile; $("#savePersonaBtn").onclick=addPersona; $("#profileForm").onsubmit=saveProfileForm; $("#commentForm").onsubmit=postComment;
document.addEventListener("click",e=>{if(e.target.matches("[data-close]"))e.target.closest("dialog").close(); const rm=e.target.closest("[data-remove-persona]");if(rm){state.profile.personas.splice(Number(rm.dataset.removePersona),1);saveProfile();renderPersonas()} const mark=e.target.closest("mark[data-ann]");if(mark)jumpToComment(mark.dataset.ann);const reply=e.target.closest("[data-reply-comment]");if(reply){const annotation=state.annotations.find(item=>item.id===reply.dataset.replyComment);openReplyDialog(annotation,reply.closest(".comment-card").getBoundingClientRect())} const card=e.target.closest(".comment-card");if(card&&!reply)jumpToMessage(card.dataset.target,card.id.replace("comment-","")); const count=e.target.closest("[data-message-comments]");if(count){const a=state.annotations.find(x=>x.message_id===count.dataset.messageComments&&!x.parent_id);if(a)jumpToComment(a.id)} const page=e.target.closest("[data-page]");if(page)switchLogPage(page.dataset.page==="next"?1:-1)});
document.addEventListener("click",e=>{const tab=e.target.closest("[data-tab-index]");if(tab)goToTab(Number(tab.dataset.tabIndex))});
document.addEventListener("click",e=>{const suggestion=e.target.closest("[data-suggest-message]");if(!suggestion)return;hideTabSuggestions();jumpToMessage(suggestion.dataset.suggestMessage)});
document.addEventListener("change",async e=>{if(e.target.matches("[data-persona-icon]")){const i=Number(e.target.dataset.personaIcon);state.profile.personas[i].icon=await resizeIcon(e.target.files[0]);saveProfile();renderPersonas()}});
document.addEventListener("change",e=>{if(e.target.matches("[data-persona-color]")){const persona=state.profile.personas[Number(e.target.dataset.personaColor)];persona.color=e.target.value;saveProfile();syncPersonaColor(persona)}});
$("#personaSelect").onchange=()=>{if($("#personaSelect").value==="ADD"){$("#commentDialog").close();openProfile();return}state.lastPersona=$("#personaSelect").value;localStorage.setItem(`lastPersona:${state.roomId}`,state.lastPersona);updateCommentPersonaAvatar()};
$("#plIconInput").onchange=async e=>{state.profile.plIcon=await resizeIcon(e.target.files[0]);saveProfile();renderPlIcon()};
$("#newPersonaIcon").onchange=async e=>{state.newPersonaIcon=await resizeIcon(e.target.files[0])};
document.addEventListener("pointerdown",e=>{const dialog=$("#commentDialog");if(!dialog.open||dialog.contains(e.target))return;if($("#commentBody").value.trim())$("#commentForm").requestSubmit();else dialog.close()});
$("#commentBody").addEventListener("input",()=>setTyping(true));
$("#commentDialog").addEventListener("close",()=>setTyping(false));
document.addEventListener("keydown",e=>{if(e.defaultPrevented||e.altKey||e.ctrlKey||e.metaKey)return;const target=e.target;if(target?.matches?.("input, textarea, select")||target?.isContentEditable)return;if(e.key==="ArrowLeft"||e.key==="ArrowRight"){e.preventDefault();switchLogPage(e.key==="ArrowRight"?1:-1)}});
document.addEventListener("mouseup",()=>setTimeout(showSelection)); document.addEventListener("touchend",()=>setTimeout(showSelection,50));
$("#markBtn").onclick=openCommentDialog; $("#viewMode").value=state.viewMode; $("#viewMode").onchange=e=>{const time=currentReadingTime();state.viewMode=e.target.value;localStorage.setItem("trpgMarkerViewMode",state.viewMode);renderLog(time);setTimeout(revealInlineSuggestions,20)}; $("#tabFilter").onchange=e=>{const time=currentReadingTime();state.mainTab=e.target.value;localStorage.setItem(`mainTab:${state.roomId}`,state.mainTab);renderLog(time);setTimeout(revealInlineSuggestions,20)}; $("#searchInput").oninput=()=>{const time=currentReadingTime();renderLog(time);setTimeout(revealInlineSuggestions,20)};
$("#shareBtn").onclick=async()=>{await navigator.clipboard.writeText(location.href);$("#roomStatus").textContent="共有URLをコピーしました";setTimeout(()=>$("#roomStatus").textContent="",1800)};
const roomId=new URLSearchParams(location.search).get("room"); if(roomId)openRoom(roomId);
