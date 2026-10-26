import test from 'node:test';import assert from 'node:assert/strict';
import {createRoom,joinRoom,applyAction,advanceRoom,projectRoom} from '../lib/game-engine.ts';
import {SCENES,sceneFor,showdownBot} from '../lib/showdown.ts';
import {PROFILES} from '../lib/game-content.ts';
import {voiceUpdate,voiceProjection} from '../lib/voice-state.ts';
import type {RoomState,ActionPayload} from '../lib/game-types.ts';
let serial=0;
function room(n=2){let r=createRoom({code:'ABCDE',instanceId:'showdown-test',sessionHash:'s0',name:'Host',mode:'human',pace:'relaxed',seed:14,now:1000,rules:'showdown'});for(let i=1;i<n;i++)r=joinRoom(r,'s'+i,'Player'+i,1000);return r;}
const act=(r:RoomState,i:number,a:ActionPayload,now=r.phaseStartedAt+100)=>applyAction(r,'s'+i,{...a,requestId:'request-'+(++serial),instanceId:r.instanceId,matchId:r.matchId,round:r.round,phase:r.phase},now);
for(const truth of [false,true])for(const call of ['trust','liar']as const)for(const double of [false,true])test(`showdown matrix truth=${truth}, ${call}, double=${double}`,()=>{
 let r=act(room(),0,{type:'start'});for(let i=0;i<2;i++){const full=PROFILES[r.current!.profiles[r.players[i].id]].full;r=act(r,i,{type:'proof',test:'weigh',claim:truth?full:!full});}
 for(let i=0;i<2;i++)r=act(r,i,{type:'challenge',call,double});
 assert.equal(r.phase,'reveal');const expected=call==='trust'?(truth?[1,2]:[-1,3]):truth?[-2,3]:[3,-2];
 for(const s of r.current!.result!.scores){assert.equal(s.investigation,expected[0]*(double?2:1));assert.equal(s.deception,expected[1]);assert.equal(s.total,s.investigation+s.deception);assert.equal(s.verdicts.length,1);}
});
test('all sizes/difficulties finish five rounds, chips exhaust and rematch resets',()=>{
 for(const n of [2,3,4,10])for(const difficulty of ['casual','sharp','expert','mixed']as const){let r=act(room(1),0,{type:'bots',count:n-1,difficulty});r=act(r,0,{type:'start'});
 for(let round=1;round<=5;round++){
 r=act(r,0,{type:'proof',test:'scan',claim:round%2===0});r=advanceRoom(r,r.phaseStartedAt+2500);assert.equal(r.phase,'judge');
 const v=projectRoom(r,'s0',r.phaseStartedAt+10);assert.equal(v.myReceipt,null);assert(v.rivalId);assert.equal(v.doublesLeft,Math.max(0,3-round));assert(!('voice'in v));
 if(round>2)assert.throws(()=>act(r,0,{type:'challenge',call:'liar',double:true}),/chips/);
 r=act(r,0,{type:'challenge',call:round%2?'trust':'liar',double:round<=2});r=advanceRoom(r,r.phaseStartedAt+2500);assert.equal(r.phase,'reveal');
 assert.equal(r.current!.result!.scores.length,n);assert(r.current!.result!.scores.every(s=>s.verdicts.length===1));r=act(r,0,{type:'ready'},r.phaseStartedAt+2500);
 }assert.equal(r.phase,'finale');r=act(r,0,{type:'rematch'});assert.equal(r.players[0].doublesLeft,2);assert.equal(r.history.length,0);}
});
test('claims private until all sealed, challenge cannot target arbitrary people, required claim and bounded inputs',()=>{
 let r=act(room(),0,{type:'start'});assert.throws(()=>act(r,0,{type:'proof',test:'scan'}),/claim/);r=act(r,0,{type:'proof',test:'scan',claim:true});assert.equal(projectRoom(r,'s1',r.phaseStartedAt+100).cases[0].proof,null);
 r=act(r,1,{type:'proof',test:'weigh',claim:false});assert.throws(()=>act(r,0,{type:'verdict',inspectId:r.players[1].id,clearId:'',bold:null}),/LIAR/);
 assert.throws(()=>act(r,0,{type:'challenge',call:'trust',double:false,targetId:r.players[0].id} as ActionPayload),/unsupported/);
 const v=projectRoom(r,'s0',r.phaseStartedAt+100);assert.equal(v.rivalId,r.players[1].id);assert.equal(v.myReceipt,null);
});
test('idle claims are neutral and never consume a double-down chip',()=>{
 let r=act(room(),0,{type:'start'});r=act(r,0,{type:'proof',test:'scan',claim:true});r=advanceRoom(r,r.deadline!);assert.equal(r.phase,'judge');
 const a={type:'challenge' as const,call:'liar' as const,double:true,requestId:'same-challenge',instanceId:r.instanceId,matchId:r.matchId,round:r.round,phase:r.phase};r=applyAction(r,'s0',a,r.phaseStartedAt+10);r=applyAction(r,'s0',a,r.phaseStartedAt+20);assert.equal(r.players[0].doublesLeft,2);assert.equal(r.current!.ballots[r.players[0].id]!.bold,null);r=advanceRoom(r,r.deadline!);assert.equal(r.current!.result!.scores[0].investigation,0);assert.equal(r.current!.result!.scores[1].deception,0);
});
test('voice is authenticated by member, scoped to epochs/recipient, bounded and expires',()=>{
 let r=room(3),[a,b,c]=r.players.map(p=>p.id);const epoch='12345678-1234-1234-1234-123456789abc',input={instanceId:r.instanceId,epoch};
 assert.throws(()=>voiceUpdate(r,'stranger',{...input,op:'join'},1000));
 for(const id of [a,b,c])r=voiceUpdate(r,id,{...input,op:'join'},1000);
 r=voiceUpdate(r,a,{...input,op:'signal',target:b,targetEpoch:epoch,description:{type:'offer',sdp:'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n'}},1100);
 assert.equal(voiceProjection(r,b,epoch).signals.length,1);assert.equal(voiceProjection(r,c,epoch).signals.length,0);assert.equal(voiceProjection(r,b,'wrong').signals.length,0);
 assert.throws(()=>voiceUpdate(r,a,{...input,op:'signal',target:b,targetEpoch:epoch,description:{type:'offer',sdp:'v=0\r\nm=video'}},1200));
 r=voiceUpdate(r,b,{...input,op:'leave'},1300);assert.equal(Object.keys(r.voice!.signals).length,0);
 r=voiceUpdate(r,c,{...input,op:'join'},25000);assert.equal(Object.keys(r.voice!.peers).length,1);
 assert(!JSON.stringify(projectRoom(r,'s2',25000)).includes('sdp'));
});


test('withholding a judgment cannot deny a rival their claim payout or beat submitting TRUST',()=>{
 let r=act(room(),0,{type:'start'});
 for(let i=0;i<2;i++)r=act(r,i,{type:'proof',test:'weigh',claim:PROFILES[r.current!.profiles[r.players[i].id]].full});
 r=act(r,1,{type:'challenge',call:'trust',double:false});
 const active=act(r,0,{type:'challenge',call:'trust',double:false});
 const idle=advanceRoom(r,r.deadline!);
 assert.equal(idle.current!.ballots[idle.players[0].id]!.automatic,true);
 assert.equal(idle.current!.ballots[idle.players[0].id]!.call,'trust');
 assert.equal(idle.players[0].doublesLeft,2);
 const [host,guest]=idle.current!.result!.scores;
 assert.equal(host.inactivityPenalty,-2);assert.equal(host.total,1);assert.equal(guest.total,3);
 assert.equal(active.current!.result!.scores[0].total,3);
 assert.equal(guest.deception,active.current!.result!.scores[1].deception);
});

test('a departing judge cannot suppress a valid claim payout',()=>{
 let r=act(room(),0,{type:'start'});
 for(let i=0;i<2;i++)r=act(r,i,{type:'proof',test:'scan',claim:PROFILES[r.current!.profiles[r.players[i].id]].full});
 r=act(r,0,{type:'leave'});r=act(r,1,{type:'challenge',call:'trust',double:false});
 assert.equal(r.phase,'reveal');assert.equal(r.current!.result!.scores[1].deception,2);
 assert.equal(r.current!.result!.scores[0].inactivityPenalty,-2);
});

test('shared shuffled scenes survive persistence and avoid previous match; judge mapping is inverse',()=>{
 let r=act(room(4),0,{type:'start'});
 assert.equal(new Set(r.sceneOrder).size,5);assert(r.sceneOrder!.every(i=>i>=0&&i<SCENES.length));
 const previous=r.sceneOrder!;
 const restored=JSON.parse(JSON.stringify(r)) as RoomState;
 assert.equal(projectRoom(restored,'s0',1001).sceneIndex,projectRoom(r,'s1',1001).sceneIndex);
 assert.equal(projectRoom(r,'s0',1001).judgeId,undefined);
 for(let i=0;i<4;i++)r=act(r,i,{type:'proof',test:'weigh',claim:true});
 for(let i=0;i<4;i++){
  const view=projectRoom(r,'s'+i,r.phaseStartedAt+100);
  assert.notEqual(view.judgeId,view.viewerId);
  const judgeIndex=r.players.findIndex(p=>p.id===view.judgeId);
  assert.equal(projectRoom(r,'s'+judgeIndex,r.phaseStartedAt+100).rivalId,view.viewerId);
 }
 // Finish through timeouts to also exercise repeated automatic judgment handling.
 while(r.phase!=='finale')r=advanceRoom(r,r.deadline!);
 r=act(r,0,{type:'rematch'});
 assert(r.sceneOrder!.every(i=>!previous.includes(i)));
 assert.equal(sceneFor(1,r.sceneOrder![0]),SCENES[r.sceneOrder![0]]);
});

test('expert optimizes expected judgment value and saves doubles on weak evidence',()=>{
 let r=act(room(3),0,{type:'start'});
 for(let i=0;i<3;i++)r=act(r,i,{type:'proof',test:'weigh',claim:true});
 const view=projectRoom(r,'s0',r.phaseStartedAt+100);
 view.players.find(p=>p.id===view.viewerId)!.difficulty='expert';
 view.cases.find(c=>c.playerId===view.rivalId)!.proof!.result=true;
 const action=showdownBot(view,()=>.99);
 assert.equal(action?.type,'challenge');
 if(action?.type==='challenge'){assert.equal(action.call,'liar');assert.equal(action.double,false);}
});
