import test from 'node:test';
import assert from 'node:assert/strict';
import { translate, validTranslation } from './localize.mjs';
import { createOfflineRuntime } from '../../agent/pi-base/offline.mjs';
const texts=[{key:'0:0',text:'I can spend 24 hours, but cannot build a wearable.'}];
test('Chinese display preserves constraints through the real agent harness',async()=>{
  const runtime=createOfflineRuntime(()=>({status:'ok',warnings:[],data:{translations:[{key:'0:0',text:'我可以投入 24 小时，但不能制作可穿戴设备。'}]}}));
  const result=await translate({room_id:'synthetic',texts},{runtime});
  assert.match(result[0].text,/不能/);assert.match(result[0].text,/24/);
});
test('rejects wrong keys, changed quantities, missing rows and untranslated text',()=>{
  for(const translations of [[],[{key:'wrong',text:'中文 24'}],[{key:'0:0',text:'中文 48'}],[{key:'0:0',text:'English 24'}]])
    assert.equal(validTranslation({translations},{texts}),false);
});

test('model schema describes the same envelope that the harness validates',async()=>{
  const runtime=createOfflineRuntime(()=>({status:'ok',warnings:[],data:{translations:[{key:'0:0',text:'可以投入 24 小时，但不能制作可穿戴设备。'}]}}));
  const stream=runtime.streamFn;
  runtime.streamFn=(model,context,options)=>{
    const prompt=context.systemPrompt || context.messages.filter(m=>m.role==='system').map(m=>typeof m.content==='string'?m.content:m.content.map(x=>x.text||'').join('')).join('\n');
    const schema=JSON.parse(prompt.split('OUTPUT JSON SCHEMA (authoritative field shapes): ')[1]);
    assert.deepEqual(schema.required,['status','data','warnings']);
    assert.ok(schema.properties.data.properties.translations);
    return stream(model,context,options);
  };
  await translate({room_id:'synthetic',texts},{runtime});
});

test('English display repairs untranslated Chinese and preserves quantities', async () => {
  const texts = [{key:'0:0',text:'我们只能投入 24 小时，不能做可穿戴设备。'}];
  let calls = 0;
  const runtime = createOfflineRuntime((payload, context) => {
    if (!calls) assert.equal(payload.language, 'en');
    assert.match(JSON.stringify(context), /natural English/);
    calls++;
    return {status:'ok',warnings:[],data:{translations:[{key:'0:0',text:calls === 1 ? '我们只能投入 24 小时。' : 'We can spend only 24 hours and cannot build a wearable.'}]}};
  });
  const result = await translate({room_id:'synthetic',texts,language:'en'},{runtime});
  assert.equal(calls, 2);
  assert.match(result[0].text, /only 24 hours and cannot/);
  assert.equal(validTranslation({translations:[{key:'0:0',text:'We can spend 48 hours.'}]},{texts,language:'en'}), false);
  await assert.rejects(translate({room_id:'synthetic',texts,language:'fr'},{runtime}), /Unsupported/);
});
