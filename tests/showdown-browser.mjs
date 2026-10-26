import assert from 'node:assert/strict';import {mkdir,writeFile} from 'node:fs/promises';import {resolve} from 'node:path';
import {chromium,browserOptions} from './browser-runtime.mjs';
const base=process.argv.find(a=>a.startsWith('--base='))?.slice(7)||'http://127.0.0.1:5183',voiceCount=Number(process.argv.find(a=>a.startsWith('--voice-count='))?.slice(14)||4);
const output=resolve('test-results',base.startsWith('https:')?'showdown-hosted':'showdown-local');await mkdir(output,{recursive:true});
const browser=await chromium.launch(browserOptions);
const pages=[],errors=[],checks=[];
const phase=(p,s)=>p.waitForSelector('.phase-'+s,{timeout:40000});
const read=p=>p.evaluate(async()=>{const s=JSON.parse(localStorage.getItem('hollow-alibi-room-v1'));return(await fetch('/api/rooms/'+s.code)).json()});
async function page(i){const c=await browser.newContext({viewport:{width:i===0?1440:i===1?320:800,height:1000},permissions:['microphone']});await c.addInitScript(()=>{window.testPCs=[];const Original=window.RTCPeerConnection;window.RTCPeerConnection=new Proxy(Original,{construct(target,args){const pc=new target(...args);window.testPCs.push(pc);return pc}})});const p=await c.newPage();p.on('pageerror',e=>errors.push(e.message));pages.push(p);await p.goto(base);await p.waitForSelector('.hero');return p;}
async function save(p,name){await p.locator('h1').first().click();await p.screenshot({path:resolve(output,name+'.png'),fullPage:true});assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),name+' overflow');}
async function round(ps,n){for(const [i,p] of ps.entries()){await phase(p,'prepare');await p.getByRole('button',{name:`“My case is ${i%2?'EMPTY':'FULL'}.”`,exact:true}).click();await p.getByLabel('03 / YOUR RIDICULOUS DEFENSE (OPTIONAL)').fill('My lawyer is a moth.');await p.getByRole('button',{name:'Seal my claim'}).click();}
 for(const p of ps){await phase(p,'judge');if(n===1)await save(p,'judge-'+ps.length+'-'+pages.indexOf(p));await p.getByRole('button',{name:n%2?'LIAR!':'TRUST IT',exact:false}).click();if(n<=2)await p.getByLabel('Double down',{exact:false}).check();await p.getByRole('button',{name:'Lock my judgment'}).click();}
 for(const p of ps){await phase(p,'reveal');const v=await read(p);assert.equal(v.rules,'showdown');assert.equal(v.myReceipt,null);for(const s of v.result.scores){const b=v.result.verdicts[s.playerId];if(b){const target=v.result.cases.find(c=>c.playerId===(b.inspectId||b.clearId));const truth=target.proof.claim===target.profile.full;const score=b.call==='trust'?(truth?1:-1):(truth?-2:3);assert.equal(s.investigation,score*(b.bold?2:1));}assert.equal(s.total,s.deception+s.investigation);}if(n===1)await save(p,'reveal-'+ps.length+'-'+pages.indexOf(p));}
 for(const p of ps)await p.getByRole('button',{name:n===5?'Ready for the final scores':'Ready for the next round'}).click();}
try{
 const host=await page(0);await host.getByLabel('YOUR NAME').fill('Host');await host.getByLabel('TIME TO TALK').selectOption('relaxed');await host.getByRole('button',{name:'Open a room'}).click();await phase(host,'lobby');const code=(await read(host)).code;
 for(let i=1;i<voiceCount;i++){const p=await page(i);await p.getByRole('tab',{name:'Join a room'}).click();await p.getByLabel('YOUR NAME').fill('Friend'+i);await p.getByLabel('ROOM CODE',{exact:true}).fill(code);await p.getByRole('button',{name:'Enter the room'}).click();await phase(p,'lobby');}
 for(const p of pages)await p.getByRole('button',{name:'Join voice',exact:true}).click();console.log("Voice joined",voiceCount);
 await Promise.all(pages.map(p=>p.waitForFunction(n=>document.querySelectorAll('[data-peer-state="connected"]').length===n,voiceCount-1,{timeout:45000})));console.log("All peer links connected");
 for(const p of pages)await p.getByRole('button',{name:'Unmute mic',exact:true}).click();
 for(const p of pages)await p.waitForFunction(async n=>{let heard=0;for(const pc of window.testPCs.filter(pc=>pc.connectionState==='connected')){const stats=await pc.getStats();if([...stats.values()].some(s=>s.type==='inbound-rtp'&&s.kind==='audio'&&s.bytesReceived>0))heard++;}return heard===n;},voiceCount-1,{timeout:20000});
 await pages[1].getByRole('button',{name:'Mute mic',exact:true}).click();assert(await pages[1].evaluate(()=>window.testPCs.filter(pc=>pc.connectionState==='connected').every(pc=>pc.getSenders().every(s=>!s.track||!s.track.enabled))));
 await save(host,'voice-connected');await save(pages[1],'voice-phone');checks.push(`${voiceCount} browsers: all ${voiceCount*(voiceCount-1)} directed audio paths received RTP; microphone mute disables tracks`);
 const friendId=(await read(pages[1])).viewerId;
 await host.getByRole('button',{name:'Mute voice from Friend1',exact:true}).click();
 const checkMuted=async()=>{await host.waitForFunction(id=>document.querySelector(`audio[data-voice-peer="${id}"]`)?.muted===true,friendId);assert.equal(await host.getByRole('button',{name:'Mute voice from Friend1',exact:true}).getAttribute('aria-pressed'),'true');};
 await checkMuted();
 await pages[1].getByRole('button',{name:'Leave voice',exact:true}).click();assert(await pages[1].evaluate(()=>window.testPCs.every(pc=>pc.connectionState==='closed')));await pages[1].getByRole('button',{name:'Join voice',exact:true}).click();await pages[1].waitForFunction(n=>document.querySelectorAll('[data-peer-state="connected"]').length===n,voiceCount-1,{timeout:60000});await checkMuted();checks.push('Voice leave closes connections; remote rejoin preserves incoming mute');
 await host.getByRole('button',{name:'Reconnect voice',exact:true}).click();await host.waitForFunction(n=>document.querySelectorAll('[data-peer-state="connected"]').length===n,voiceCount-1,{timeout:60000});await checkMuted();checks.push('Local reconnect also preserves incoming mute');
 // Block signaling long enough for another peer to expire this session. On
 // restoration, recover automatically without requesting the microphone again.
 const pcsBefore=await host.evaluate(()=>window.testPCs.length);
 await host.route('**/voice',route=>route.abort('internetdisconnected'));
 await new Promise(resolve=>setTimeout(resolve,23000));
 await host.unroute('**/voice');await host.evaluate(()=>window.dispatchEvent(new Event('online')));
 await host.waitForFunction(n=>window.testPCs.length>n,pcsBefore,{timeout:30000});
 await host.waitForFunction(n=>document.querySelectorAll('[data-peer-state="connected"]').length===n,voiceCount-1,{timeout:60000});await checkMuted();checks.push('Expired voice lease automatically rejoins after signaling interruption and retains mute');
 for(const p of pages.slice(2)){await p.getByRole('button',{name:'Leave',exact:true}).click();await p.getByRole('button',{name:'Leave this room'}).click();await p.waitForSelector('.hero');}
 await host.getByRole('button',{name:'Start the investigation'}).click();await phase(host,'prepare');await save(host,'prepare-desktop');await save(pages[1],'prepare-phone');await pages[1].reload();await phase(pages[1],'prepare');
 for(let n=1;n<=5;n++)await round(pages.slice(0,2),n);
 await phase(host,'finale');await save(host,'finale');await host.getByRole('button',{name:'Reopen the case files'}).click();assert.equal(await host.locator('.recap-list>section').count(),5);await host.getByRole('button',{name:'Close dialog'}).click();await host.getByRole('button',{name:'One more alibi?'}).click();await phase(host,'prepare');assert.equal((await read(host)).doublesLeft,2);checks.push('Full 1v1 five-round showdown, independent scoring oracle, refresh, recap and rematch');
 const solo=await page(1);await solo.getByLabel('BOT DIFFICULTY',{exact:true}).selectOption('mixed');await solo.getByRole('button',{name:'Try solo',exact:false}).click();for(let n=1;n<=5;n++)await round([solo],n);await phase(solo,'finale');checks.push('Full solo match with mixed bot difficulties on 320px viewport');
 assert.deepEqual(errors,[]);await writeFile(resolve(output,'report.json'),JSON.stringify({passed:true,base,checks,errors,limitation:'Synthetic microphone transport, not human speech quality or cross-network TURN testing.'},null,2));console.log(JSON.stringify({passed:true,checks,output},null,2));
}catch(e){console.log(await Promise.all(pages.map(p=>p.locator(".voice-room").innerText().catch(()=>"no voice"))));for(let i=0;i<pages.length;i++)await pages[i].screenshot({path:resolve(output,'failure-'+i+'.png'),fullPage:true}).catch(()=>{});throw e;}finally{await browser.close();}
