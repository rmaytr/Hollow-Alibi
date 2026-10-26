import test from 'node:test';
import assert from 'node:assert/strict';
import {enforceLimit} from '../lib/game-store.ts';
import {sqliteD1} from './sqlite-d1.ts';
import {voiceIceConfiguration} from '../lib/voice-config.ts';

test('relay status requires a valid TURN URL and scoped credentials, not extra STUN',()=>{
  assert.equal(voiceIceConfiguration(undefined).relayConfigured,false);
  assert.equal(voiceIceConfiguration('invalid').iceServers.length,1);
  assert.equal(voiceIceConfiguration(JSON.stringify([{urls:'stun:example.com:3478'}])).relayConfigured,false);
  assert.equal(voiceIceConfiguration(JSON.stringify([{urls:'turn:example.com:3478'}])).relayConfigured,false);
  const configured=voiceIceConfiguration(JSON.stringify([{urls:['turn:example.com:3478','turns:example.com:5349'],username:'scoped-user',credential:'scoped-password',apiKey:'never-expose'}]));
  assert.equal(configured.relayConfigured,true);
  assert(!JSON.stringify(configured).includes('apiKey'));
  assert.equal(voiceIceConfiguration(JSON.stringify([{urls:'https://example.com',username:'user',credential:'pass'}])).iceServers.length,1);
});

test('new voice quota buckets clean expired records without new room creation',async()=>{
  const {binding,sqlite}=sqliteD1();
  try{
    const add=sqlite.prepare('INSERT INTO game_limits (key,hits,expires_at) VALUES (?,1,?)');
    for(let i=0;i<100;i++)add.run('expired-'+i,1000);
    add.run('still-live',999999);
    await enforceLimit(binding,'voice','player-0',120,60000,120000);
    assert.equal((sqlite.prepare('SELECT COUNT(*) AS count FROM game_limits WHERE expires_at <= 120000').get() as {count:number}).count,68);
    // Same bucket does not repeatedly perform maintenance on every voice poll.
    await enforceLimit(binding,'voice','player-0',120,60000,120001);
    assert.equal((sqlite.prepare('SELECT COUNT(*) AS count FROM game_limits WHERE expires_at <= 120000').get() as {count:number}).count,68);
    for(let i=1;i<4;i++)await enforceLimit(binding,'voice','player-'+i,120,60000,120000);
    assert.equal((sqlite.prepare('SELECT COUNT(*) AS count FROM game_limits WHERE expires_at <= 120000').get() as {count:number}).count,0);
    assert(sqlite.prepare("SELECT * FROM game_limits WHERE key='still-live'").get());
  }finally{sqlite.close();}
});
