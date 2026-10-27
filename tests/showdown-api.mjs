import assert from 'node:assert/strict';
import {request as httpRequest} from 'node:http';
import {request as httpsRequest} from 'node:https';
const base=(process.argv.find(a=>a.startsWith('--base='))?.slice(7)||'http://127.0.0.1:5183').replace(/\/$/,'');
// Fresh sockets isolate deliberately rejected bodies; native HTTP exposes response
// completion directly and avoids long undici body waits in the local dev proxy.
function client(){
 let cookie='';
 return async(path,data,origin=base,chunked=false)=>{
  const payload=data?JSON.stringify(data):undefined;
  const url=new URL(base+path);
  const response=await new Promise((resolve,reject)=>{
   const request=(url.protocol==='https:'?httpsRequest:httpRequest)(url,{
    method:data?'POST':'GET',agent:false,
    headers:{Cookie:cookie,...(data?{'Content-Type':'application/json',Origin:origin,...(chunked?{'Transfer-Encoding':'chunked'}:{'Content-Length':Buffer.byteLength(payload)})}:{})},
   },res=>{
    const chunks=[];
    res.on('data',chunk=>chunks.push(chunk));res.on('error',reject);
    res.on('end',()=>resolve({status:res.statusCode,set:res.headers['set-cookie']||[],text:Buffer.concat(chunks).toString('utf8')}));
   });
   request.setTimeout(15000,()=>request.destroy(Error('HTTP check timed out: '+path)));
   request.on('error',reject);request.end(payload);
  });
  for(const c of response.set){const jar=new Map(cookie.split('; ').filter(Boolean).map(p=>[p.split('=',1)[0],p]));const pair=c.split(';',1)[0];jar.set(pair.split('=',1)[0],pair);cookie=[...jar.values()].join('; ');}
  let body;try{body=JSON.parse(response.text)}catch{body={error:response.text}}
  return {status:response.status,body};
 };
}
const host=client(),friend=client(),stranger=client();for(const c of [host,friend,stranger])assert.equal((await c('/api/session',{})).status,200);
let v=(await host('/api/rooms',{name:'ApiHost',mode:'human',pace:'relaxed'})).body;const path='/api/rooms/'+v.code;let f=(await friend('/api/rooms/join',{name:'ApiFriend',code:v.code})).body;
const action=async(c,p)=>{const current=(await c(path)).body;return c(path+'/action',{...p,requestId:crypto.randomUUID(),instanceId:current.instanceId,matchId:current.matchId,round:current.round,phase:current.phase})};
const epoch=crypto.randomUUID(),voice={epoch,instanceId:v.instanceId,op:'join'};
assert.equal((await stranger(path+'/voice',voice)).status,403);assert.equal((await host(path+'/voice',voice,'https://wrong.example')).status,403);
const voiceJoin=await host(path+'/voice',voice);assert.equal(voiceJoin.status,200,JSON.stringify(voiceJoin.body.error));assert.equal((await friend(path+'/voice',voice)).status,200);
const signal={...voice,op:'signal',target:f.viewerId,targetEpoch:epoch,description:{type:'offer',sdp:'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n'}};
assert.equal((await host(path+'/voice',signal)).status,200);assert.equal((await friend(path+'/voice',{...voice,op:'poll'})).body.signals.length,1);assert.equal((await host(path+'/voice',{...voice,op:'poll'})).body.signals.length,0);
assert.equal((await host(path+'/voice',{...signal,target:'stranger'})).status,409);assert.equal((await host(path+'/voice',{...signal,description:{type:'offer',sdp:'v=0'+ 'x'.repeat(18000)}})).status,413);
assert.equal((await host(path+'/voice',{...signal,description:{type:'offer',sdp:'v=0'+'x'.repeat(18000)}},base,true)).status,413);
assert.equal((await host(path)).status,200,'Rejected sized and chunked uploads must leave the room readable');
assert(!JSON.stringify((await friend(path)).body).includes('m=audio'));
assert.equal((await action(host,{type:'start'})).status,200);
assert.equal((await action(host,{type:'proof',test:'weigh'})).status,400);
assert.equal((await action(host,{type:'proof',test:'weigh',claim:true})).status,200);f=(await friend(path)).body;assert.equal(f.cases.find(c=>c.playerId===v.viewerId).proof,null);assert.equal(f.myReceipt,null);
assert.equal((await action(friend,{type:'proof',test:'scan',claim:false})).status,200);
assert.equal((await action(host,{type:'challenge',call:'trust',double:false,targetId:v.viewerId})).status,400);
assert.equal((await action(host,{type:'challenge',call:'trust',double:true})).status,200);assert.equal((await action(friend,{type:'challenge',call:'liar',double:false})).status,200);v=(await host(path)).body;assert.equal(v.phase,'reveal');assert(v.result.scores.every(s=>s.verdicts.length===1));
assert.equal((await action(friend,{type:'leave'})).status,200);assert.equal((await friend(path+'/voice',{...voice,op:'poll'})).status,403);
console.log(JSON.stringify({passed:true,base,checks:['Voice member/origin authorization, recipient privacy, SDP bounds, departed-member rejection','Claims hidden until sealed; no private answer leakage; targets fixed by server; challenge inputs strict','Live two-player claim/challenge/reveal'],limitation:'Synthetic SDP in API checks; media transport is tested separately by browser harness.'},null,2));

