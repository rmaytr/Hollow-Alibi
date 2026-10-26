import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {chromium,browserOptions} from './browser-runtime.mjs';

const base=(process.env.TEST_BASE_URL||'http://127.0.0.1:5183').replace(/\/$/,'');
const browser=await chromium.launch(browserOptions), errors=[];
const output='test-results/smoke';
await mkdir(output,{recursive:true});
const contexts=[];
const read=p=>p.evaluate(async()=>{
  const saved=JSON.parse(localStorage.getItem('hollow-alibi-room-v1'));
  return (await fetch('/api/rooms/'+saved.code)).json();
});
try {
  for(const width of [1440,320]){
    const context=await browser.newContext({viewport:{width,height:1000}});
    contexts.push(context);
    const page=await context.newPage();
    page.on('pageerror',e=>errors.push(e.message));
    await page.goto(base);
    await page.waitForSelector('.hero');
  }
  const [host,friend]=contexts.map(c=>c.pages()[0]);
  await host.getByLabel('YOUR NAME').fill('SmokeHost');
  await host.getByLabel('TIME TO TALK').selectOption('relaxed');
  await host.getByRole('button',{name:'Open a room',exact:true}).click();
  await host.waitForSelector('.phase-lobby');
  const code=(await read(host)).code;
  await friend.getByRole('tab',{name:'Join a room'}).click();
  await friend.getByLabel('YOUR NAME').fill('SmokeFriend');
  await friend.getByLabel('ROOM CODE',{exact:true}).fill(code);
  await friend.getByRole('button',{name:'Enter the room',exact:true}).click();
  await friend.waitForSelector('.phase-lobby');
  await host.getByRole('button',{name:'Start the investigation'}).click();
  for(const page of [host,friend]){
    await page.waitForSelector('.phase-prepare');
    await page.getByRole('button',{name:'“My case is FULL.”',exact:true}).click();
    await page.getByRole('button',{name:'Seal my claim'}).click();
  }
  for(const page of [host,friend]){
    await page.waitForSelector('.phase-judge');
    const view=await read(page);
    assert.equal(view.myReceipt,null);
    assert(view.rivalId&&view.judgeId);
    if(page===host)await page.screenshot({path:`${output}/judgment.png`,fullPage:true});
    await page.getByRole('button',{name:'TRUST IT',exact:false}).click();
    await page.getByRole('button',{name:'Lock my judgment'}).click();
  }
  for(const [index,page]of [host,friend].entries()){
    await page.waitForSelector('.phase-reveal');
    const view=await read(page);
    assert.equal(view.result.scores.length,2);
    for(const score of view.result.scores){
      assert.equal(score.total,score.investigation+score.deception+(score.inactivityPenalty||0));
      assert.equal(score.verdicts.length,1);
    }
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
    await page.screenshot({path:`${output}/reveal-${index}.png`,fullPage:true});
  }
  await friend.reload();await friend.waitForSelector('.phase-reveal');
  assert.equal((await read(friend)).code,code);
  assert.deepEqual(errors,[]);
  await writeFile(`${output}/report.json`,JSON.stringify({passed:true,checks:['Two isolated players create/join/start','Claims and judgments complete a round','Authoritative scores and assigned judges','320px layout and refresh recovery'],errors},null,2));
  console.log('Browser smoke passed: two-player round, scores, mobile layout, refresh.');
}catch(error){
  for(const [i,context]of contexts.entries())await context.pages()[0]?.screenshot({path:`${output}/failure-${i}.png`,fullPage:true}).catch(()=>{});
  throw error;
}finally{await browser.close();}
