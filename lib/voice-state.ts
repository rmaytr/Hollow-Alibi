import {GameError} from './game-engine.ts';
import type {RoomState} from './game-types.ts';
const fail=(message:string)=>{throw new GameError('VOICE_INVALID',message,409)};
export function voiceUpdate(before:RoomState,playerId:string,input:Record<string,unknown>,now:number):RoomState {
  const room=structuredClone(before);
  if(input.instanceId!==room.instanceId)fail('This voice room has expired.');
  if(!room.players.some(p=>p.id===playerId&&!p.bot&&!p.left))fail('Join the game before joining voice.');
  if(typeof input.epoch!=='string'||!/^[a-zA-Z0-9-]{16,80}$/.test(input.epoch))fail('Invalid voice session.');
  const epoch=input.epoch as string;
  const voice=room.voice??={peers:{},signals:{}};
  for(const [id,p]of Object.entries(voice.peers))if(p.seen<now-20000||!room.players.some(v=>v.id===id&&!v.left&&!v.bot))delete voice.peers[id];
  if(input.op==='join')voice.peers[playerId]={epoch,seen:now};
  else if(input.op==='leave') {if(voice.peers[playerId]?.epoch===epoch)delete voice.peers[playerId];}
  else {
    if(voice.peers[playerId]?.epoch!==epoch)fail('Voice session expired. Leave voice and rejoin.');
    voice.peers[playerId].seen=now;
    if(input.op==='signal'){
      const target=String(input.target),peer=voice.peers[target];
      if(target===playerId||!peer||peer.epoch!==input.targetEpoch)fail('That voice participant has reconnected.');
      const d=input.description as Record<string,unknown>|undefined;
      if(!d||!['offer','answer'].includes(String(d.type))||typeof d.sdp!=='string'||d.sdp.length>12000||!d.sdp.startsWith('v=0')||!d.sdp.includes('m=audio')||d.sdp.includes('m=video')||d.sdp.includes('m=application'))fail('Invalid audio connection description.');
      voice.signals[playerId+':'+target]={from:playerId,to:target,fromEpoch:epoch,toEpoch:peer.epoch,description:{type:d!.type as 'offer'|'answer',sdp:d!.sdp as string},at:now};
    }else if(input.op!=='poll')fail('Unknown voice action.');
  }
  for(const [key,s]of Object.entries(voice.signals))if(s.at<now-20000||voice.peers[s.from]?.epoch!==s.fromEpoch||voice.peers[s.to]?.epoch!==s.toEpoch)delete voice.signals[key];
  room.version=before.version+1;
  return room;
}
export function voiceProjection(room:RoomState,playerId:string,epoch:string){
  return {peers:Object.entries(room.voice?.peers??{}).map(([id,p])=>({id,epoch:p.epoch})),signals:Object.values(room.voice?.signals??{}).filter(s=>s.to===playerId&&s.toEpoch===epoch)};
}
