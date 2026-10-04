// Explicit opt-in: real paid model/retrieval calls, synthetic participants, dev only.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
assert.equal(process.env.CONCLAVE_RUN_LIVE,'1','Set CONCLAVE_RUN_LIVE=1 to authorize paid API calls');
const base=process.env.CONCLAVE_TEST_URL;
assert.ok(base && ['considea-dev-api.onrender.com','localhost','127.0.0.1'].includes(new URL(base).hostname),'Use an isolated dev deployment');
const root=resolve('workflow/data'),output=join(root,'dev-live');await mkdir(output,{recursive:true});
const infra=JSON.parse(await readFile(join(root,'dev-infra.json'),'utf8'));
const sessionFile=join(output,'session.json');
let session;try{session=JSON.parse(await readFile(sessionFile,'utf8'));}catch{}
const save=()=>writeFile(sessionFile,JSON.stringify(session,null,2));
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function api(path,body,token){
 const r=await fetch(base+'/api'+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(45000)});
 const d=await r.json();if(!r.ok)throw Error('HTTP '+r.status+' '+(d.error?.code||''));return d;
}
const cap=await api('/capabilities');assert.equal(cap.live,true);assert.equal(cap.storage,'postgres');
const browser=await chromium.launch({headless:true,channel:'chrome'}),contexts=[],pages={},errors=[],scenes=[];
const start=Date.now(),capture=join(output,'capture-'+start);await mkdir(capture,{recursive:true});let videoStart=start;
async function newPage(name,auth,record=false){
 const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce',...(record?{recordVideo:{dir:capture,size:{width:1440,height:1000}}}:{})});contexts.push(context);
 const page=await context.newPage();if(record)videoStart=Date.now();pages[name]=page;page.setDefaultTimeout(25000);
 page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(({auth})=>{localStorage.setItem('considea-study-lang','en');localStorage.setItem('considea-study-theme','light');if(auth)sessionStorage.setItem('conclave-auth',JSON.stringify(auth));
 document.addEventListener('DOMContentLoaded',()=>{const n=document.createElement('div');n.id='capture-note';n.textContent='Live API run · Synthetic test participants';n.style.cssText='position:fixed;right:12px;bottom:10px;background:#173b32;color:white;padding:8px 12px;border-radius:6px;font:13px system-ui;z-index:9999';document.body.append(n);});},{auth});
 await page.goto(base,{waitUntil:'domcontentloaded'});return page;
}
async function until(fn,ms=240000){const end=Date.now()+ms;while(Date.now()<end){if(await fn())return;await delay(1500);}throw Error('Timed out waiting for live workflow');}
const view=m=>api('/rooms/'+session.created.room_id,undefined,m==='admin'?session.created.admin_token:session.members[m].token);
async function sync(page){await page.locator('#refresh').click();await until(()=>page.locator('#refresh').isEnabled(),30000);if(await page.locator('#error').isVisible())throw Error('UI: '+await page.locator('#error').innerText());}
async function click(page,name){await page.getByRole('button',{name,exact:true}).click();await until(()=>page.locator('#refresh').isEnabled(),30000);if(await page.locator('#error').isVisible())throw Error('UI: '+await page.locator('#error').innerText());}
async function checkFailures(){const v=await view('admin');const failed=v.tasks.filter(t=>t.status==='failed');if(failed.length)throw Error('Live task failed: '+failed.map(t=>t.operation+':'+t.error?.code).join(','));if(v.paused_reason)throw Error('Paused: '+v.paused_reason);}
async function waitState(member,check){await until(async()=>{await checkFailures();return check(await view(member));});}
async function scene(name,page=pages.alice){scenes.push({name,at_seconds:(Date.now()-videoStart)/1000});await writeFile(join(capture,'scenes.json'),JSON.stringify(scenes,null,2));console.log(name);if(page){await page.locator('#desk').scrollIntoViewIfNeeded();await delay(800);await page.screenshot({path:join(capture,'scene-'+scenes.length+'.png')});}}
const answers={
 alice:'I want to help university study groups turn agreed assignments into a shared text-only checklist. I can build the Python backend and database in 24 hours. No paid datasets, hardware, model training or calendar integration. I prefer a reliable small demo over many features. I can accept manual entry, one team and one shared board.',
 bob:'I want university study groups to see a clear shared plan with owners and deadlines. I can build the JavaScript interface in 24 hours. I prefer a simple mobile-friendly text interface, no social network, notifications or model training. I can accept a single board and manual entry; Alice handles the backend and I handle the frontend.'
};
try{
 if(!session){
  const admin=await newPage('admin',null);
  await admin.locator('.cover-login').click();
  await until(async()=>(await admin.locator('#connection-status').innerText()).includes('Live workspace'));
  await admin.locator('#memberIds').fill('alice,bob');
  await admin.locator('#context').fill('Recorded live integration test with synthetic participants: a two-person university hackathon team planning a small study-group project in 24 hours. Use English for all questions, profiles, candidates and reports. All decisions are scripted test events, not claims about real users.');
  await admin.locator('#projectTime select').selectOption('duration');await admin.locator('#projectTime input[type=number]').fill('24');
  await admin.locator('#demo-code').fill(infra.demo_access_code);
  const response=admin.waitForResponse(r=>r.url().endsWith('/api/rooms')&&r.request().method()==='POST');await admin.locator('#create').click();
  const created=await (await response).json();assert.ok(created.admin_token,'Room creation failed');session={created,members:{},started_at:new Date().toISOString(),base};await save();
  await admin.getByRole('button',{name:'Open administrator view',exact:true}).click();await admin.locator('#app').waitFor({state:'visible'});
 }else await newPage('admin',{room_id:session.created.room_id,token:session.created.admin_token});
 for(const member of ['alice','bob']){
  const saved=session.members[member];const p=await newPage(member,saved,member==='alice');
  if(!saved){
   await p.goto(base+'/#'+new URLSearchParams({room:session.created.room_id,invitation:session.created.invitations[member]}));
   await p.locator('#join').click();await p.locator('#app').waitFor({state:'visible'});
   session.members[member]=JSON.parse(await p.evaluate(()=>sessionStorage.getItem('conclave-auth')));await save();
  }else await p.locator('#app').waitFor({state:'visible'});
 }
 if(process.argv.includes('--retry-failed')){
  const failed=(await view('admin')).tasks.filter(t=>t.status==='failed');
  if(failed.length){
   const page=pages.admin;await page.locator('#app').waitFor({state:'visible'});await sync(page);
   await page.locator('.activity-panel:has(#tasks)').evaluate(n=>n.open=true);
   session.manual_retries=(session.manual_retries||0)+failed.length;assert.ok(session.manual_retries<=3,'Manual retry cap reached');await save();
   for(const task of failed){await page.locator('#tasks .task').filter({hasText:task.operation}).getByRole('button',{name:'Retry this task',exact:true}).first().click();await until(()=>page.locator('#refresh').isEnabled());}
   await scene('Explicit retry of rejected evaluation output');
  }
 }
 await scene('Continue saved live room');
 let completed=false,lastPhase='';
 for(let step=0;step<150&&!completed;step++){
  await checkFailures();const v=await view('alice');
  const tag='Round '+v.discussion_round+' · '+v.phase;if(tag!==lastPhase){console.log(tag);lastPhase=tag;}
  if(v.phase==='interviewing'){
   for(const member of ['alice','bob']){
    const current=await view(member),p=current.private,page=pages[member];
    if(p.stage==='awaiting_answers'){
     await sync(page);await page.locator('[data-view=interview]').click();
     for(const input of await page.locator('#private textarea').all())await input.fill(answers[member]+' Round '+current.discussion_round+': I accept the shared manual-entry MVP and the backend/frontend split. Explain any remaining tradeoff in English.');
     if(member==='alice')await scene('Round '+current.discussion_round+' private answer',page);
     await click(page,'Submit private answers');
    }else if(p.stage==='awaiting_profile_approval'){
     await sync(page);await page.locator('[data-view=interview]').click();
     if(member==='alice')await scene('Round '+current.discussion_round+' approve shared summary',page);
     await click(page,'Approve and share this summary');
    }
   }
  }else if(v.phase==='awaiting_difference_answers'){
   assert.equal(Object.keys(v.candidates).length,0);
   for(const member of v.difference.content.affected_member_ids){
    if((await view(member)).answers[member])continue;
    const page=pages[member];await sync(page);await page.locator('[data-view=studio]').click();
    if(await page.locator('#discussion select').count())await page.locator('#discussion select').selectOption({index:1});
    await page.locator('#discussion textarea').fill('I agree to a text-only study-group checklist with manually entered tasks, owners and deadlines. Alice implements backend persistence and Bob builds the interface. Keep the first demo to one team and one board within 24 hours. I accept this scope and want the report to identify existing alternatives honestly.');
    if(member==='alice')await scene('Round '+v.discussion_round+' answer the shared difference',page);
    await click(page,'Submit difference answer');
   }
  }else if(v.phase==='awaiting_convergence_decision'){
   assert.equal(v.discussion_round,4);
   for(const member of ['alice','bob']){
    if((await view(member)).votes[member])continue;
    const page=pages[member];await sync(page);await page.locator('[data-view=studio]').click();
    await page.locator('#discussion textarea').fill('The scope and roles are clear. I agree to generate bounded candidate directions.');
    if(member==='alice')await scene('04 Team decides to generate',page);
    await click(page,'Generate directions');
    if(member==='alice')assert.equal(Object.keys((await view('alice')).candidates).length,0);
   }
  }else if(v.phase==='awaiting_review'){
   const cid=Object.keys(v.candidates)[0],version=v.candidates[cid].candidate_ref.version;
   for(const report of Object.values(v.evaluation_details)){assert.notEqual(report.fixture,true);assert.ok(report.search_log.some(x=>x.executed!==false),'No real search recorded');}
   if(version===1)session.first_reports=v.evaluation_details;
   await save();
   for(const member of ['alice','bob']){
    const current=await view(member);if(current.reviews[cid]?.[member])continue;
    const page=pages[member];await sync(page);await page.locator('[data-view=studio]').click();await page.locator('#candidates [role=tab]').first().click();
    if(member==='alice')await scene(version===1?'05 Review real research and request a revision':'06 Review the revised direction',page);
    if(version===1){await page.locator('#reviews textarea').fill('Limit the MVP to one shared board with manual task entry, an owner, a due date and a completed checkbox. Explicitly defer reminders, calendars and external integrations.');await click(page,'Request a small revision');}
    else {await click(page,'Accept this version');if(member==='alice')assert.equal((await view('alice')).final_output,null);}
   }
  }else if(v.phase==='completed'){
   completed=true;await sync(pages.alice);await pages.alice.locator('[data-view=brief]').click();await scene('07 Accepted project brief');
   const [download]=await Promise.all([pages.alice.waitForEvent('download'),pages.alice.getByRole('button',{name:'Export accepted brief',exact:true}).click()]);await download.saveAs(join(output,'accepted-brief.txt'));
   const admin=await view('admin');assert.equal(admin.private,null);assert.equal(v.discussion_round,4);
   await writeFile(join(output,'completed-admin-view.json'),JSON.stringify(admin,null,2));
   session.completed_at=new Date().toISOString();session.final_revision=v.revision;await save();
   await pages.alice.reload();await pages.alice.locator('#app').waitFor({state:'visible'});assert.ok((await pages.alice.locator('#status').innerText()).includes('Agreed by the team'));
   await delay(2500);console.log('PASS: cloud PostgreSQL + real DeepSeek/Tavily, two isolated UI participants, four human-gated rounds, revised/re-evaluated candidate, unanimous final acceptance, export and reload');
  }
  await delay(1600);
 }
 assert.ok(completed,'Did not complete within bounded test');assert.deepEqual(errors,[]);
}finally{
 const page=pages.alice,video=page?.video();
 for(const context of contexts)await context.close();
 if(video){await writeFile(join(capture,'video-path.txt'),await video.path());await writeFile(join(output,'video-path.txt'),await video.path());}
 await browser.close();
}
