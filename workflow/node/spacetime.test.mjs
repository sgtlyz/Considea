import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { SpaceClient } from './spacetime.mjs';
import { DbConnection } from './bindings.mjs';
import { createOfflineRuntime } from '../../agent/pi-base/offline.mjs';
const config = process.env.CONCLAVE_TEST_SPACETIME_CONFIG;
const options = { skip: !config, timeout: 30000 };
const fixture = async()=>{
 const pair=JSON.parse(await readFile(new URL('../../agent/interfaces/fixtures/idea-generate.json',import.meta.url),'utf8'));
 pair.request.room_id='sdk-test-'+randomUUID();pair.request.request_id='request-'+randomUUID();
 return pair;
};
test('real database deduplicates concurrent workers and replays persisted success after reconnect',options,async()=>{
 const client=new SpaceClient(config); const {request,response}=await fixture();let calls=0;
 const runtime=createOfflineRuntime(async()=>{calls++;await new Promise(r=>setTimeout(r,100));return {status:'ok',data:response.data,warnings:[]};});
 try{
   const results=await Promise.all([client.idea({request,runtime}),client.idea({request,runtime})]);
   assert.equal(calls,1);assert.deepEqual(results[0],results[1]);
   client.close();
   const replay=await client.idea({request,runtime});
   assert.equal(calls,1);assert.deepEqual(replay,results[0]);
 }finally{client.close();}
});
test('real subscriptions isolate outsider and worker identities from the shared board',options,async()=>{
 const client=new SpaceClient(config);let outsider;
 const room_id='privacy-test-'+randomUUID();
 try{
   await client.publish({room_id,revision:1,idea_revision:0,snapshot:{room_id,revision:1,phase:'interviewing'}});
   assert.equal([...client.worker.connection.db.myIdeaJobs.iter()].filter(r=>r.roomId===room_id).length,0);
   const settings=JSON.parse(await readFile(config,'utf8'));
   outsider=await new Promise((resolve,reject)=>DbConnection.builder().withUri(settings.uri).withDatabaseName(settings.database)
     .onConnect(c=>resolve(c)).onConnectError((_,e)=>reject(e)).build());
   await new Promise((resolve,reject)=>outsider.subscriptionBuilder().onApplied(resolve).onError(reject)
     .subscribe(['SELECT * FROM my_workflow_boards','SELECT * FROM my_idea_jobs']));
   assert.equal([...outsider.db.myWorkflowBoards.iter()].length,0);
   assert.equal([...outsider.db.myIdeaJobs.iter()].length,0);
   await assert.rejects(outsider.reducers.publishBoard({roomId:room_id,revision:2n,ideaRevision:0n,
     snapshotJson:JSON.stringify({room_id,revision:2,phase:'completed'})}),/UNAUTHORIZED/);
 }finally{outsider?.disconnect();client.close();}
});
test('explicit retry reruns failed remote outcomes, never returns a cached failure forever',options,async()=>{
 const client=new SpaceClient(config); const {request,response}=await fixture();
 try{
   const bad=createOfflineRuntime(()=>({status:'ok',data:{invalid:true},warnings:[]}));
   assert.equal((await client.idea({request,runtime:bad})).status,'error');
   const good=createOfflineRuntime(()=>({status:'ok',data:response.data,warnings:[]}));
   assert.equal((await client.idea({request,runtime:good,attempt:2})).status,'ok');
 }finally{client.close();}
});
