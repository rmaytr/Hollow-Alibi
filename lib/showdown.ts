import type { ActionPayload, RoomView } from './game-types.ts';

export const SCENES = [
  {title:'Nothing to declare. Probably.',prompt:'Explain your case like a terrible airport lawyer.',line:'My client is a suitcase and will not be answering questions.'},
  {title:'The museum wants a refund.',prompt:'Sell this as the most expensive exhibit in the world.',line:'It is priceless. Mostly because nobody will give me a price.'},
  {title:'Definitely not haunted.',prompt:'Explain the suspicious evidence without mentioning ghosts.',line:'The screaming is a standard feature.'},
  {title:'A gift for your worst friend.',prompt:'Pitch the contents as a thoughtful birthday present.',line:'I kept the receipt. You will need it emotionally.'},
  {title:'Your final, terrible alibi.',prompt:'Give your most dramatic courtroom defense.',line:'If this case is suspicious, why does it have a handle?'},
  {title:'The suitcase is running for mayor.',prompt:'Give a campaign promise on behalf of your case.',line:'More handles. Fewer questions. A brighter tomorrow.'},
  {title:'Five stars. Probably purchased.',prompt:'Give this case a suspiciously glowing review.',line:'Changed my life. My lawyer says I cannot explain how.'},
  {title:'An extremely normal job interview.',prompt:'Explain why this case deserves the promotion.',line:'Its biggest weakness is caring too much about hinges.'},
  {title:'The cooking show has gone wrong.',prompt:'Describe your case as an expensive restaurant dish.',line:'Locally sourced confusion with a reduction of evidence.'},
  {title:'Customer support is on hold.',prompt:'Explain the case as a completely expected product feature.',line:'Have you tried turning the accusation off and on again?'},
  {title:'The case has joined a band.',prompt:'Pitch your case as the next musical superstar.',line:'The silence is experimental. You would not understand.'},
  {title:'A very questionable wedding toast.',prompt:'Give a heartfelt toast to your suspicious case.',line:'I knew it was the one when it refused to open up emotionally.'},
  {title:'Breaking news from the baggage claim.',prompt:'Report on your case as a dramatic news anchor.',line:'Sources close to the handle deny everything.'},
  {title:'Space customs has questions.',prompt:'Explain your case to an alien with no patience.',line:'On my planet, this is what innocence looks like.'},
  {title:'A tiny business empire.',prompt:'Sell investors on your case with enormous confidence.',line:'We are disrupting the concept of having things inside.'},
  {title:'The royal inspection.',prompt:'Defend the case as an outrageously offended aristocrat.',line:'My family has been suspicious for seven generations.'},
  {title:'Your case needs a dating profile.',prompt:'Explain why somebody should trust this charming disaster.',line:'Emotionally available. Physically locked. Loves long conveyor belts.'},
  {title:'The school science fair.',prompt:'Explain the case as a breakthrough scientific discovery.',line:'The results are reproducible. The excuses are peer reviewed.'},
  {title:'A suspiciously cheap magic trick.',prompt:'Convince the table you meant for this to happen.',line:'For my next trick, I will make the accountability disappear.'},
  {title:'The insurance claim.',prompt:'Explain why this case deserves a very large payout.',line:'The damage is mostly to my reputation.'},
].map(scene => ({...scene,lines:[scene.line,'The paperwork is real. The explanation is a work in progress.','My witness is a suitcase. It has chosen to remain closed.']}));
export const sceneFor = (round:number,sceneIndex?:number) => SCENES[sceneIndex !== undefined && Number.isInteger(sceneIndex) && sceneIndex >= 0 && sceneIndex < SCENES.length ? sceneIndex : Math.max(0,round-1)%SCENES.length];
export const FUNNY_CONTENTS:Record<string,string> = {ballast:'An emotional-support brick. Built into the case. Still empty.',latch:'A latch auditioning for a maraca band. Empty.',liner:'A portrait of contraband. Legally just wallpaper. Empty.',key:'A tiny key to a very disappointing kingdom. Full.',moon:'The moon. Travel size. Probably stolen. Full.',moth:'A glass moth with a suspiciously good lawyer. Full.'};
export const PAYOFFS = [
  ['Trust an honest claim','You +1','They +2'],
  ['Trust a lie','You −1','They +3'],
  ['Catch a lie','You +3','They −2'],
  ['Accuse an honest player','You −2','They +3'],
];
export function showdownPayoff(truth:boolean,call:'trust'|'liar',double=false){
  const judgment = call==='trust' ? truth?1:-1 : truth?-2:3;
  return {judgment:judgment*(double?2:1),claim:call==='trust'?truth?2:3:truth?3:-2,
    story:call==='trust'?truth?'HONEST BUSINESS':'BLUFF SOLD':truth?'FALSE ACCUSATION':'CAUGHT LYING'};
}
/** Same public view as a human. No receipt or hidden profiles are consulted. */
export function showdownBot(view:RoomView,rng:()=>number):ActionPayload|null {
  const level=view.players.find(p=>p.id===view.viewerId)?.difficulty??'sharp';
  if(view.phase==='prepare'&&!view.myProof&&view.myCase){
    const truth = rng() < (level==='casual'?.65:.5);
    const claim=truth?view.myCase.full:!view.myCase.full;
    const keys=['weigh','listen','scan'] as const;
    const matching=keys.filter(k=>view.myCase!.tests[k]===claim);
    const pool=level==='casual'||rng()<.25?keys:matching;
    return {type:'proof',test:pool[Math.floor(rng()*pool.length)],claim,pitch:[sceneFor(view.round,view.sceneIndex).line,'That noise is my legal team.','I swear on my entirely fictional credentials.','Ask the case. It has nothing to hide.'][Math.floor(rng()*4)]};
  }
  if(view.phase==='judge'&&!view.myVerdict){
    const target=view.cases.find(c=>c.playerId===view.rivalId), proof=target?.proof;
    if(!proof)return null;
    if (proof.automatic) return {type:'challenge',call:'trust',double:false};
    let honest=.5;
    if(level!=='casual')honest=proof.result===proof.claim ? .6 : .4;
    if(level==='expert'){
      // Learn only revealed behavior, with four neutral prior observations.
      const past=view.history.flatMap(r=>r.cases.filter(c=>c.playerId===view.rivalId&&!c.proof.automatic));
      const prior=(past.filter(c=>c.proof.claim===c.profile.full).length+2)/(past.length+4);
      // Selectively chosen evidence is weak: never treat a matching clue as proof.
      const likelihood=proof.result===proof.claim ? 1.1 : .5;
      honest=prior*likelihood/(prior*likelihood+1-prior);
      const trust=2*honest-1, liar=3-5*honest;
      // In a duel, points awarded to the opponent matter as much as our own.
      const duel=view.cases.length===2;
      const trustUtility=trust-(duel?3-honest:0);
      const liarUtility=liar-(duel?5*honest-2:0);
      const call=trustUtility>=liarUtility?'trust':'liar';
      const gain=call==='trust'?trust:liar;
      const chips=view.doublesLeft??0, roundsLeft=view.maxRounds-view.round+1;
      const double=chips>0&&gain>0&&(gain>=.65||chips>=roundsLeft);
      return {type:'challenge',call,double};
    }
    const call=rng()<honest?'trust':'liar';
    return {type:'challenge',call,double:(view.doublesLeft??0)>0&&level==='sharp'&&rng()<.2};
  }
  return null;
}
