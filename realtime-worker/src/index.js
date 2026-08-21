import { DurableObject } from "cloudflare:workers";

const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}});
const clean=(value,max=100)=>String(value||"").slice(0,max);

export class RoomHub extends DurableObject {
  constructor(ctx,env){super(ctx,env)}

  fetch(request){
    const url=new URL(request.url);
    if(url.pathname.endsWith("/realtime")){
      if(request.headers.get("Upgrade")?.toLowerCase()!=="websocket")return new Response("WebSocket required",{status:426});
      const pair=new WebSocketPair(),client=pair[0],server=pair[1];
      this.ctx.acceptWebSocket(server);
      server.serializeAttachment({client_id:"",author_id:"",pl_name:"",pl_icon:"",is_typing:false,typing_name:"",typing_icon:"",typing_message_id:""});
      return new Response(null,{status:101,webSocket:client});
    }
    if(url.pathname==="/notify"&&request.method==="POST")return request.json().then(message=>{this.broadcast({type:"refresh",action:clean(message?.action,30)},clean(message?.excludeClientId,100));return json({ok:true})}).catch(()=>json({error:"Invalid message"},400));
    if(url.pathname==="/deleted"&&request.method==="POST"){this.broadcast({type:"room-deleted"});return json({ok:true})}
    return new Response("Not found",{status:404});
  }

  webSocketMessage(socket,message){
    if(typeof message!=="string"||message.length>180000)return;
    let data;try{data=JSON.parse(message)}catch{return}
    if(data?.type!=="join"&&data?.type!=="presence")return;
    const previous=socket.deserializeAttachment()||{},next={
      client_id:clean(data.clientId||previous.client_id,100),
      author_id:clean(data.authorId||previous.author_id,100),
      pl_name:clean(data.plName||previous.pl_name,80),
      pl_icon:clean(data.plIcon||previous.pl_icon,100000),
      is_typing:!!data.isTyping,
      typing_name:data.isTyping?clean(data.typingName,80):"",
      typing_icon:data.isTyping?clean(data.typingIcon,100000):"",
      typing_message_id:data.isTyping?clean(data.typingMessageId,100):""
    };
    socket.serializeAttachment(next);this.broadcastPresence();
  }

  webSocketClose(socket){this.broadcastPresence(socket)}
  webSocketError(socket){this.broadcastPresence(socket)}

  participants(excludedSocket=null){
    const people=new Map();
    for(const socket of this.ctx.getWebSockets()){
      if(socket===excludedSocket)continue;
      const person=socket.deserializeAttachment()||{};if(!person.author_id||!person.pl_name)continue;
      const current=people.get(person.author_id);if(!current||person.is_typing)people.set(person.author_id,person);
    }
    return [...people.values()];
  }

  broadcastPresence(excludedSocket=null){this.broadcast({type:"presence",presence:this.participants(excludedSocket)},"",excludedSocket)}

  broadcast(payload,excludeClientId="",excludedSocket=null){
    const text=JSON.stringify(payload);
    for(const socket of this.ctx.getWebSockets()){
      if(socket===excludedSocket)continue;const person=socket.deserializeAttachment()||{};if(excludeClientId&&person.client_id===excludeClientId)continue;
      try{socket.send(text)}catch{}
    }
  }
}

export default {
  fetch(request){
    const url=new URL(request.url);
    if(url.pathname==="/health")return json({ok:true,service:"TRPG LOG MARKER realtime"});
    return new Response("This Worker is used through the Pages Durable Object binding.",{status:404});
  }
};
