// Synthetic local HTTP/browser integration. Never run this against a production room.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const polling=process.env.CONCLAVE_TEST_POLLING==='1';
const base=process.env.CONCLAVE_TEST_URL || 'http://127.0.0.1:8779';
if(!['127.0.0.1','localhost'].includes(new URL(base).hostname))throw Error('Browser smoke is local-only');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function api(path,body,token){
 const res=await fetch(base+'/api'+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:body===undefined?undefined:JSON.stringify(body)});
 const data=await res.json();assert.ok(res.ok,JSON.stringify(data));return data;
}
const created=await api('/rooms',{room_context:{member_ids:['alice','bob'],hackathon_context:'SYNTHETIC BROWSER INTEGRATION',deadline_at:null,constraints:[]},config:{candidate_count:1}});
const tokens={};for(const member of ['alice','bob'])tokens[member]=(await api('/rooms/'+created.room_id+'/join',{invitation:created.invitations[member]})).token;
const view=member=>api('/rooms/'+created.room_id,undefined,tokens[member]);
async function send(member,type,payload){const v=await view(member);const key={'interview.answer':'interview','profile.approve':'interview','difference.answer':'difference','convergence.vote':'convergence'}[type];
 const expected_revision=key?v.event_revisions[key]:v.event_revisions.review[payload.candidate_ref.id];
 const result=await api('/rooms/'+created.room_id+'/events',{contract_version:'2.0',event_id:crypto.randomUUID(),room_id:created.room_id,expected_revision,type,payload},tokens[member]);assert.equal(result.status,'accepted');}
async function until(predicate,ms=20000){const end=Date.now()+ms;while(Date.now()<end){if(await predicate())return;await delay(100);}throw Error('Timed out waiting for browser/workflow state');}
let browser;try{browser=await chromium.launch({headless:true});}catch{browser=await chromium.launch({headless:true,channel:'chrome'});}
const pages={},errors=[];
try{
 for(const member of ['alice','bob']){const context=await browser.newContext();const page=await context.newPage();pages[member]=page;
   page.on('pageerror',error=>errors.push(error.message));
   await page.addInitScript(({room,token,polling})=>{
     localStorage.setItem('considea-study-lang','zh');
     sessionStorage.setItem('conclave-auth',JSON.stringify({room_id:room,token}));
     // Disable the recovery timer: UI changes below must arrive from the real SSE subscription.
     const interval=window.setInterval;window.setInterval=(fn,ms,...rest)=>ms===10000&&!polling?0:interval(fn,ms,...rest);
   },{room:created.room_id,token:tokens[member],polling});
   await page.goto(base);await page.locator('#app').waitFor({state:'visible'});
 }
 const admin=await browser.newPage();admin.on('pageerror',error=>errors.push(error.message));await admin.goto(base);
 await admin.getByRole('button',{name:'Enter test workspace'}).click();await admin.getByRole('button',{name:'中文',exact:true}).click();
 await admin.getByText('恢复已有会话',{exact:true}).click();
 await admin.locator('#roomId').fill(created.room_id);await admin.locator('#token').fill(created.admin_token);
 await admin.locator('#resume').click();await admin.locator('#app').waitFor({state:'visible'});
 const unauthorized=await fetch(base+'/api/rooms/'+created.room_id+'/updates');assert.equal(unauthorized.status,401);
 for(let round=1;round<=4;round++){
   await until(async()=>{
     const v=await view('alice');if(v.phase!=='interviewing')return true;
     for(const member of ['alice','bob']){const p=(await view(member)).private;
       if(p.stage==='awaiting_answers')await send(member,'interview.answer',{session_ref:p.session_ref,question_batch_ref:p.question_batch.question_batch_ref,
         answers:p.question_batch.questions.map(q=>({question_key:q.question_key,text:'PRIVATE-'+member+'-'+round,declined:false}))});
       else if(p.stage==='awaiting_profile_approval')await send(member,'profile.approve',{draft_ref:p.draft.draft_ref,items:p.draft.content.items.map(i=>({item_key:i.item_key,category:i.category,text:'Public goal '+member,basis:i.basis,confidence:i.confidence})),unknowns:[]});
     }return false;
   });
   const v=await view('alice');assert.equal(v.discussion_round,round);
   await until(async()=> (await view('alice')).phase==='awaiting_difference_answers');
   const d=(await view('alice')).difference;
   for(const member of d.content.affected_member_ids)await send(member,'difference.answer',{difference_ref:d.difference_ref,
     selected_option_key:d.content.answer_type==='binary'?d.content.options[0].key:null,text:'Public answer '+member,disagrees_with_framing:false});
 }
 await until(async()=> (await pages.alice.locator('#status').innerText()).includes('等待成员选择'));
 assert.ok(!(await pages.bob.locator('body').innerText()).includes('PRIVATE-alice'));
 assert.ok(!(await pages.alice.locator('body').innerText()).includes('PRIVATE-bob'));
 for(const member of ['alice','bob']){const v=await view(member);await send(member,'convergence.vote',{difference_ref:v.difference.difference_ref,discussion_round:v.discussion_round,decision:'converge',reason:'SYNTHETIC human decision'});}
 await until(async()=> (await view('alice')).evaluation_input_required===true);
 await admin.locator('#refresh').click();
 await admin.locator('#status').getByLabel('项目时限',{exact:true}).selectOption('none');
 await admin.getByRole('button',{name:'保存时限并继续评估'}).click();
 await until(async()=> (await view('alice')).phase==='awaiting_review');
 await until(async()=> (await pages.bob.locator('#status').innerText()).includes('等待审阅'));
 assert.ok((await pages.bob.locator('#candidates').innerText()).includes('创新性'));
 assert.equal(Object.values((await view('alice')).evaluation_details)[0].fixture,true);
 for(const member of ['alice','bob']){const v=await view(member);const id=Object.keys(v.candidates)[0];await send(member,'candidate.review',{candidate_ref:v.candidates[id].candidate_ref,evaluation_ref:v.evaluations[id].evaluation_ref,decision:'accept',instructions:''});}
 await until(async()=> (await pages.alice.locator('#status').innerText()).includes('已完成'));
 await pages.alice.screenshot({path:new URL('../data/integration-browser.png',import.meta.url).pathname.replace(/^\/(.:)/,'$1'),fullPage:true});
 assert.deepEqual(errors,[]);
 console.log('PASS: isolated member/admin sessions, '+(polling?'HTTP polling':'real subscriptions without polling')+', four rounds, privacy, explicit time gate, native evaluator report, final acceptance; no page errors.');
}finally{await browser.close();}
