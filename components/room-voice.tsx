"use client";
import {useEffect,useRef,useState} from 'react';
import type {RoomView} from '@/lib/game-types';
type Peer={id:string;epoch:string};
type Signal={from:string;fromEpoch:string;description:RTCSessionDescriptionInit;at:number};
type VoiceReply={peers:Peer[];signals:Signal[];iceServers:RTCIceServer[];relayConfigured:boolean};
type Link={pc:RTCPeerConnection;epoch:string;audio:HTMLAudioElement;handled:number};
export function RoomVoice({view}:{view:RoomView}){
 const [joined,setJoined]=useState(false),[busy,setBusy]=useState(false),[muted,setMuted]=useState(true),[error,setError]=useState(''),[peers,setPeers]=useState<Peer[]>([]),[status,setStatus]=useState<Record<string,string>>({}),[silenced,setSilenced]=useState<Record<string,boolean>>({}),[blocked,setBlocked]=useState(false),[relay,setRelay]=useState(false);
 const runtime=useRef<{stop:()=>void;stream:MediaStream;links:Map<string,Link>;send:(v:object)=>Promise<VoiceReply>}|null>(null),generation=useRef(0),alive=useRef(true);
 const silencedRef=useRef<Record<string,boolean>>({});
 const endpoint='/api/rooms/'+view.code+'/voice';
 function mic(on:boolean){runtime.current?.stream.getAudioTracks().forEach(t=>t.enabled=on);setMuted(!on);}
 function leave(){generation.current++;const r=runtime.current;runtime.current=null;if(r){r.stop();void r.send({op:'leave'}).catch(()=>{});}setJoined(false);setMuted(true);setPeers([]);setStatus({});setBusy(false);}
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;generation.current++;runtime.current?.stop();void runtime.current?.send({op:'leave'}).catch(()=>{});runtime.current=null;}},[view.instanceId]);
 async function join(){
   const gen=++generation.current;setBusy(true);setError('');
   let stream:MediaStream|undefined,stop:(()=>void)|undefined;
   try{
     if(!navigator.mediaDevices?.getUserMedia)throw Error('Voice needs HTTPS and a browser with microphone support.');
     stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true},video:false});
     if(gen!==generation.current||!alive.current){stream.getTracks().forEach(t=>t.stop());return;}
     stream.getAudioTracks().forEach(t=>t.enabled=false);
     let epoch=crypto.randomUUID();const links=new Map<string,Link>();let stopped=false,timer:ReturnType<typeof setTimeout>|undefined;
     let sending:Promise<unknown>=Promise.resolve();
     const request=async(data:object):Promise<VoiceReply>=>{const r=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...data,epoch,instanceId:view.instanceId}),signal:AbortSignal.timeout(10000)});const json=await r.json() as VoiceReply & {error?:{message?:string;code?:string}};if(!r.ok)throw Object.assign(Error(json.error?.message||'Voice connection failed.'),{code:json.error?.code});return json;};
     const send=(data:object):Promise<VoiceReply>=>{const next=sending.then(async()=>{for(let attempt=0;;attempt++){try{return await request(data);}catch(e){if(attempt>=3||!String((e as Error).message).includes("acted together"))throw e;await new Promise(r=>setTimeout(r,150+Math.random()*400));}}});sending=next.catch(()=>{});return next;};
     const close=(id:string)=>{const l=links.get(id);if(l){l.pc.close();l.audio.pause();l.audio.srcObject=null;l.audio.remove();links.delete(id);}};
     let resume=()=>{};
     stop=()=>{stopped=true;clearTimeout(timer);window.removeEventListener('online',resume);document.removeEventListener('visibilitychange',resume);stream!.getTracks().forEach(t=>t.stop());for(const id of links.keys())close(id);};
     runtime.current={stop,stream,links,send};
     const updateStatus=(id:string,s:string)=>{if(!stopped)setStatus(old=>({...old,[id]:s}));};
     const gather=async(pc:RTCPeerConnection)=>{if(pc.iceGatheringState==='complete')return;await new Promise<void>(resolve=>{const done=()=>{clearTimeout(t);pc.removeEventListener('icegatheringstatechange',change);resolve();};const change=()=>{if(pc.iceGatheringState==='complete')done();};const t=setTimeout(done,4000);pc.addEventListener('icegatheringstatechange',change);});};
     const signal=async(p:Peer,l:Link)=>{await gather(l.pc);if(stopped||l.pc.signalingState==='closed')return;await send({op:'signal',target:p.id,targetEpoch:p.epoch,description:l.pc.localDescription?.toJSON()});};
     function make(p:Peer,iceServers:RTCIceServer[]){
       const pc=new RTCPeerConnection({iceServers,bundlePolicy:'max-bundle'}),audio=document.createElement('audio');audio.autoplay=true;audio.setAttribute('playsinline','');audio.dataset.voicePeer=p.id;document.body.appendChild(audio);
       audio.muted=!!silencedRef.current[p.id];
       const l={pc,epoch:p.epoch,audio,handled:0};links.set(p.id,l);stream!.getTracks().forEach(t=>pc.addTrack(t,stream!));
       pc.ontrack=e=>{audio.srcObject=e.streams[0]??new MediaStream([e.track]);void audio.play().catch(()=>{if(!stopped)setBlocked(true)});};
       pc.onconnectionstatechange=()=>updateStatus(p.id,pc.connectionState);
       updateStatus(p.id,'connecting');return l;
     }
     const reconcile=async(data:VoiceReply)=>{
       if(stopped)return;setRelay(data.relayConfigured);setPeers(data.peers.filter(p=>p.id!==view.viewerId));
       for(const [id,l]of links)if(!data.peers.some(p=>p.id===id&&p.epoch===l.epoch))close(id);
       // One offerer per pair avoids glare. A new epoch cleanly replaces refresh/rejoin sessions.
       await Promise.all(data.peers.filter(p=>p.id!==view.viewerId).map(async p=>{
         if(stopped)return;let l=links.get(p.id);const fresh=!l;
         if(!l)l=make(p,data.iceServers);
         try{
           if(fresh&&view.viewerId<p.id){await l.pc.setLocalDescription(await l.pc.createOffer());await signal(p,l);}
           for(const s of data.signals.filter(s=>s.from===p.id&&s.fromEpoch===p.epoch&&s.at>l!.handled)){
             if(stopped)break;l.handled=s.at;
             if(s.description.type==='offer'&&view.viewerId>p.id){await l.pc.setRemoteDescription(s.description);await l.pc.setLocalDescription(await l.pc.createAnswer());await signal(p,l);}
             else if(s.description.type==='answer'&&l.pc.signalingState==='have-local-offer')await l.pc.setRemoteDescription(s.description);
           }
         }catch(e){updateStatus(p.id,'failed');if(!stopped)setError('A voice connection failed: '+(e as Error).message+' Reconnect voice to retry.');}
       }));
     };
     const first=await send({op:'join'});if(stopped)return;setJoined(true);setMuted(true);setBusy(false);await reconcile(first);
     let polling=false;
     const poll=async()=>{if(stopped||polling)return;polling=true;clearTimeout(timer);try{
       let data:VoiceReply;
       try{data=await send({op:'poll'});}catch(e){
         if(stopped||(e as Error & {code?:string}).code!=='VOICE_INVALID')throw e;
         // A sleeping tab or interrupted network can outlive its server lease.
         // Rejoin with a new epoch so both ends replace their old connections.
         setError('Reconnecting voice after an interruption…');
         for(const id of links.keys())close(id);
         epoch=crypto.randomUUID();data=await send({op:'join'});
       }
       if(!stopped){await reconcile(data);if([...links.values()].every(l=>l.pc.connectionState==='connected'))setError('');}
     }catch(e){if(!stopped)setError((e as Error).message+' Voice will retry; you can also reconnect manually.');}finally{polling=false;if(!stopped)timer=setTimeout(poll,2000);}};
     resume=()=>{if(!document.hidden)void poll();};
     window.addEventListener('online',resume);document.addEventListener('visibilitychange',resume);
     if(!stopped)timer=setTimeout(poll,500);
   }catch(e){stop?.();stream?.getTracks().forEach(t=>t.stop());if(gen===generation.current&&alive.current){runtime.current=null;setBusy(false);setJoined(false);setError((e as Error).name==='NotAllowedError'?'Microphone access was denied. Allow it in browser settings, then retry. Text play still works.':(e as Error).message);}}
 }
 const humans=view.players.filter(p=>!p.bot&&!p.left).length;
 return <section className="voice-room" aria-label="Room voice chat"><div className="voice-heading"><div><strong>◉ TABLE TALK</strong><small>{joined?muted?'Microphone muted':'MIC LIVE · everyone in voice can hear you':'Room voice · off until you join'}{humans<2?' · bots do not speak or hear':''}</small></div>{!joined?<button className="button outline" disabled={busy} onClick={()=>void join()}>{busy?'Connecting voice…':'Join voice'}</button>:<div className="voice-actions"><button className="button outline" aria-pressed={!muted} onClick={()=>mic(muted)}>{muted?'Unmute mic':'Mute mic'}</button><button className="button outline" onPointerDown={e=>{e.currentTarget.setPointerCapture(e.pointerId);mic(true)}} onPointerUp={()=>mic(false)} onPointerCancel={()=>mic(false)} onKeyDown={e=>{if(e.key===' '||e.key==='Enter'){e.preventDefault();mic(true)}}} onKeyUp={()=>mic(false)} onBlur={()=>mic(false)}>Hold to talk</button><button className="text-button" onClick={leave}>Leave voice</button></div>}</div>{error&&<p role="alert">{error}</p>}{joined&&<><div className="voice-peers">{peers.length?peers.map(p=><span key={p.id} data-peer-state={status[p.id]??'connecting'}><b>{view.players.find(v=>v.id===p.id)?.name??'Player'}</b> · {status[p.id]??'connecting'} <button aria-label={`Mute voice from ${view.players.find(v=>v.id===p.id)?.name??'player'}`} aria-pressed={!!silenced[p.id]} onClick={()=>{const value=!silencedRef.current[p.id];silencedRef.current={...silencedRef.current,[p.id]:value};setSilenced(silencedRef.current);const audio=runtime.current?.links.get(p.id)?.audio;if(audio)audio.muted=value;}}>{silenced[p.id]?'Unmute':'Mute'}</button></span>):<span>Waiting for another player to join voice.</span>}</div>{blocked&&<button className="text-button" onClick={()=>{runtime.current?.links.forEach(l=>void l.audio.play().catch(()=>{}));setBlocked(false)}}>Enable incoming audio</button>}<button className="text-button" onClick={()=>{leave();void join()}}>Reconnect voice</button></>}<small className="voice-note">Audio goes to other room participants, not a recording. Headphones recommended. {relay?'Audio relay available.':'Direct browser audio: some restrictive networks may fail; reconnect or use text.'}</small></section>;
}
