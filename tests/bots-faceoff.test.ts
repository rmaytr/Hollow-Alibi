import {test} from "node:test";
import assert from "node:assert/strict";
import {createRoom,joinRoom,applyAction,advanceRoom,projectRoom,chooseBotAction,inferBotProbabilities,GameError} from "../lib/game-engine.ts";
import {PROFILES} from "../lib/game-content.ts";
import type {RoomState,ActionPayload,BotDifficulty} from "../lib/game-types.ts";
let seq=0;
const time=100000;
function room(n=1,seed=10){let r=createRoom({code:"ABCDE",instanceId:"bot-test-instance",sessionHash:"s0",name:"Human 0",mode:"human",pace:"standard",seed,now:time});for(let i=1;i<n;i++)r=joinRoom(r,"s"+i,"Human "+i,time);return r;}
function act(r:RoomState,i:number,p:ActionPayload,now=r.phaseStartedAt+100){return applyAction(r,"s"+i,{...p,requestId:"bot-test-"+(++seq),instanceId:r.instanceId,matchId:r.matchId,round:r.round,phase:r.phase},now);}
const fails=(fn:()=>unknown,code:string)=>assert.throws(fn,e=>e instanceof GameError&&e.code===code);
function play(r:RoomState,humans:number){
  r=act(r,0,{type:r.phase==="finale"?"rematch":"start"});
  for(let round=1;round<=5;round++){
    for(let i=0;i<humans;i++)r=act(r,i,{type:"proof",test:"weigh"});
    r=advanceRoom(r,r.phaseStartedAt+2000);assert.equal(r.phase,"judge");
    for(let i=0;i<humans;i++){
      const v=projectRoom(r,"s"+i,r.phaseStartedAt+100);
      const ids=v.cases.filter(c=>c.playerId!==v.viewerId).map(c=>c.playerId);
      r=act(r,i,{type:"verdict",inspectId:ids[0],clearId:ids.length<3?"":ids[1],bold:"inspect"});
    }
    r=advanceRoom(r,r.phaseStartedAt+2000);assert.equal(r.phase,"reveal");
    assert.equal(r.current!.result!.scores.length,r.current!.seats.length);
    for(const s of r.current!.result!.scores){assert.equal(s.verdicts.length,r.current!.seats.length<4?1:2);assert(Number.isFinite(s.total));}
    for(let i=0;i<humans;i++)r=act(r,i,{type:"ready"},r.phaseStartedAt+2100);
    assert.equal(r.phase,round===5?"finale":"prepare");
  }return r;
}
test("two/three humans complete five Face-off rounds, rematch and zero bot identities",()=>{for(const n of [2,3]){let r=play(room(n),n);assert.equal(r.history.length,5);r=play(r,n);assert.equal(r.history.length,5);assert(!r.players.some(p=>p.bot));}});
test("small deals allow every two-seat status pair, independent of your own case",()=>{const pairs=new Set<string>();for(let seed=0;seed<100;seed++){const r=act(room(2,seed),0,{type:"start"});pairs.add(Object.values(r.current!.profiles).map(id=>Number(PROFILES[id].full)).join(""));}assert.deepEqual(pairs,new Set(["00","01","10","11"]));});
test("Face-off rejects double verdict, self, blank, invalid bold and keeps its format after a departure",()=>{let r=act(room(3),0,{type:"start"});for(let i=0;i<3;i++)r=act(r,i,{type:"proof",test:"listen"});const [a,b,c]=r.current!.seats;fails(()=>act(r,0,{type:"verdict",inspectId:b,clearId:c,bold:null}),"INVALID_TARGET");fails(()=>act(r,0,{type:"verdict",inspectId:"",clearId:"",bold:null}),"INVALID_TARGET");fails(()=>act(r,0,{type:"verdict",inspectId:a,clearId:"",bold:null}),"INVALID_TARGET");fails(()=>act(r,0,{type:"verdict",inspectId:b,clearId:"",bold:"clear"}),"INVALID_TARGET");r=act(r,2,{type:"leave"});r=act(r,0,{type:"verdict",inspectId:c,clearId:"",bold:null});assert.equal(r.current!.seats.length,3);});
test("bot configuration is host-only, bounded, locked during a match and visible",()=>{let r=room(2);fails(()=>act(r,1,{type:"bots",count:3,difficulty:"expert"}),"HOST_ONLY");fails(()=>act(r,0,{type:"bots",count:9,difficulty:"expert"}),"ROOM_FULL");r=act(r,0,{type:"bots",count:8,difficulty:"mixed"});assert.equal(r.players.length,10);assert.deepEqual(r.players.filter(p=>p.bot).slice(0,3).map(p=>p.difficulty),["casual","sharp","expert"]);assert.equal(projectRoom(r,"s0",time).players.filter(p=>p.difficulty).length,8);fails(()=>joinRoom(r,"extra","Extra",time),"ROOM_FULL");r=act(r,0,{type:"bots",count:1,difficulty:"casual"});assert.equal(r.players.length,3);r=joinRoom(r,"s2","Friend",time);r=act(r,0,{type:"start"});fails(()=>act(r,0,{type:"bots",count:0,difficulty:"mixed"}),"STALE_PHASE");});
test("solo plus bots of all difficulties completes both formats and a ten-seat match",()=>{for(const difficulty of ["casual","sharp","expert","mixed"] as const){for(const count of [1,2,3,9]){let r=act(room(),0,{type:"bots",count,difficulty});r=play(r,1);assert.equal(r.phase,"finale");const old=structuredClone(r.history);r=act(r,0,{type:"bots",count:1,difficulty:"expert"});assert.deepEqual(r.history,old);r=play(r,1);assert.equal(r.players.length,2);}}});
test("expert deduces unseen party cases only from own projection and receipt",()=>{let r=act(room(4),0,{type:"start"});const ids=r.current!.seats;r.current!.profiles[ids[0]]="key";r.current!.profiles[ids[1]]="moon";r.current!.profiles[ids[2]]="latch";r.current!.profiles[ids[3]]="liner";for(let i=0;i<4;i++)r=act(r,i,{type:"proof",test:"weigh"});const v=projectRoom(r,"s0",time);v.myReceipt={subjectId:ids[1],test:"scan",result:true,conclusion:"proved full"};v.players[0].difficulty="expert";const probabilities=inferBotProbabilities(v);assert.equal(probabilities[ids[1]],1);assert.equal(probabilities[ids[2]],0);assert.equal(probabilities[ids[3]],0);const decision=chooseBotAction(v,()=>.4);assert.equal(decision?.type,"verdict");if(decision?.type==="verdict"){assert.equal(decision.inspectId,ids[1]);assert([ids[2],ids[3]].includes(decision.clearId));}});
test("difficulty policies differ without access to other private profiles",()=>{let r=act(room(2),0,{type:"start"});for(let i=0;i<2;i++)r=act(r,i,{type:"proof",test:"scan"});const v=projectRoom(r,"s0",time);const target=r.current!.seats[1];v.myReceipt={subjectId:target,test:"weigh",result:false,conclusion:"proved empty"};for(const difficulty of ["casual","sharp","expert"] as BotDifficulty[]){v.players[0].difficulty=difficulty;const d=chooseBotAction(v,()=>.1);assert.equal(d?.type,"verdict");if(d?.type==="verdict"){assert.equal(difficulty==="casual"?d.inspectId:d.clearId,target);assert.equal(d.bold,difficulty==="casual"?null:"clear");}}});
