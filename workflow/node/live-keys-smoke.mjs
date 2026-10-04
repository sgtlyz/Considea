// Opt-in verification of room-key isolation. Uses two disposable dev rooms.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {writeFile} from 'node:fs/promises';
const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
assert.equal(process.env.CONCLAVE_RUN_LIVE,'1');
const base=process.env.CONCLAVE_TEST_URL;
assert.equal(new URL(base).hostname,'considea-dev-api.onrender.com');
assert.ok(process.env.DEEPSEEK_API_KEY&&process.env.TAVILY_API_KEY,'Load the existing server keys');
const browser=await chromium.launch({headless:true,channel:'chrome'}),rooms=[],results=[];
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function api(room,path='',body){const r=await fetch(base+'/api/rooms/'+room.room_id+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+room.admin_token,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});assert.ok(r.ok,'room API failed');return r.json();}
async function until(fn){const end=Date.now()+150000;while(Date.now()<end){if(await fn())return;await delay(1500);}throw Error('Key isolation timed out');}
try{
 for(const valid of [false,true]){
  const context=await browser.newContext(),p=await context.newPage();await p.goto(base);await p.locator('.cover-login').click();
  await p.locator('#funding').waitFor();await p.locator('#funding').selectOption('own');
  await p.locator('#memberIds').fill('key-test-a,key-test-b');await p.locator('#context').fill('Synthetic key isolation smoke: a two-person team planning a small study checklist. Ask in English.');
  const value=valid?process.env.DEEPSEEK_API_KEY:'invalid-private-room-key-for-test';
  await p.locator('#create-deepseek').fill(value);await p.locator('#create-tavily').fill(process.env.TAVILY_API_KEY);
  const response=p.waitForResponse(r=>r.url().endsWith('/api/rooms')&&r.request().method()==='POST');await p.locator('#create').click();
  const room=await(await response).json();assert.ok(room.admin_token,'BYOK creation failed');rooms.push(room);
  assert.equal(await p.locator('#create-deepseek').inputValue(),'');
  assert.equal(await p.evaluate(key=>JSON.stringify({...sessionStorage,...localStorage}).includes(key),value),false);
  await until(async()=>{const v=await api(room);return valid?v.tasks.every(t=>t.status==='done'):v.tasks.every(t=>t.status==='failed');});
  const v=await api(room);assert.equal(v.access.funding,'own');assert.equal(v.access.keys_configured,true);
  assert.equal(JSON.stringify(v).includes(value),false);
  if(valid)assert.ok(Object.values(v.members).every(m=>m.stage==='awaiting_answers'));
  else assert.ok(v.tasks.every(t=>t.error.code==='MODEL_ERROR'),'Invalid room key must not fall back to shared key');
  results.push({valid_key:valid,task_states:v.tasks.map(t=>t.status),provider_calls_succeeded:valid});
  await api(room,'/stop',{});await context.close();
 }
 await writeFile('workflow/data/dev-live/key-isolation-result.json',JSON.stringify({tested_at:new Date().toISOString(),results},null,2));
 console.log('PASS: live own-key room works; invalid-key room fails despite working shared key; keys absent from browser storage and room views; both disposable rooms stopped');
}catch(e){console.error('Key isolation failed:',e.name);process.exitCode=1;}
finally{for(const room of rooms){try{await api(room,'/stop',{});}catch{}}await browser.close();}
