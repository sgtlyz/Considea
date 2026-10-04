"use strict";
(async()=>{
const $=id=>document.getElementById(id),el=(tag,text,parent)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;parent?.append(n);return n;};
let zh=false;try{zh=localStorage.getItem('considea-study-lang')==='zh';}catch{}
const tr=(en,cn)=>zh?cn:en;
document.documentElement.lang=zh?'zh-CN':'en';document.title=tr('Considea · Recorded walkthrough','Considea · 流程演示');
for(const n of document.querySelectorAll('[data-en]'))n.textContent=zh?n.dataset.zh:n.dataset.en;
for(const n of document.querySelectorAll('[data-aria-en]'))n.setAttribute('aria-label',zh?n.dataset.ariaZh:n.dataset.ariaEn);
for(const b of document.querySelectorAll('[data-language]')){b.setAttribute('aria-pressed',String(b.dataset.language===(zh?'zh':'en')));b.onclick=()=>{try{localStorage.setItem('considea-study-lang',b.dataset.language);}catch{}location.reload();};}
try{
 const response=await fetch('/demo-data.json');if(!response.ok)throw Error();const original=await response.json();let dictionary={};
 if(zh){const r=await fetch('/demo-zh.json');if(!r.ok)throw Error();dictionary=await r.json();}
 const localized=value=>typeof value==='string'?(dictionary[value]||value):Array.isArray(value)?value.map(localized):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).map(([k,v])=>[k,localized(v)])):value;
 const data=localized(original);let position=0;
 $("demo-status").textContent=tr("Recorded ","录制日期：")+new Date(data.recorded_at).toLocaleDateString(zh?'zh-CN':'en-US')+tr(" · "+data.model+" · Real web retrieval · PostgreSQL"," · 真实模型与网页检索 · 持久化存储");
 $("run-notes").textContent=data.notes;
 function list(title,items,parent){if(!items?.length)return;el('h3',title,parent);const ul=el('ul',undefined,parent);for(const item of items)el('li',item,ul);}
 function sources(items,parent){const valid=(items||[]).filter(s=>{try{return ['https:','http:'].includes(new URL(s.url).protocol);}catch{return false;}});if(!valid.length)return;el('h3',tr('Sources read','查阅的来源'),parent);const ul=el('ul',undefined,parent);for(const source of valid){const li=el('li',undefined,ul),a=el('a',source.title||source.url,li);a.href=source.url;a.target='_blank';a.rel='noopener noreferrer';if(source.limitation)el('small',source.limitation,li);}}
 function render(){const step=data.steps[position],out=$("step-body");out.replaceChildren();$("step-number").textContent=step.kind;$("step-title").textContent=step.title;$("step-position").textContent=(position+1)+' / '+data.steps.length;$("previous").disabled=position===0;$("next").disabled=position===data.steps.length-1;
 for(const text of step.paragraphs||[])el('p',text,out);
 for(const item of step.members||[]){const article=el('article',undefined,out);el('h3',item.member,article);el('p',item.text,article);}
 if(step.candidate){const c=step.candidate;el('h3',c.title,out);el('p',c.problem,out);el('p',c.solution,out);list(tr('First demo','首版演示'),c.mvp_scope,out);list(tr('Deferred','暂不包含'),c.out_of_scope,out);}
 if(step.report){const r=step.report;for(const [key,test]of Object.entries(r.tests||{})){el('h3',tr(key,({novelty:'创新性',feasibility:'可行性'})[key]||'评估')+': '+tr(test.result.replaceAll('_',' '),({pass:'通过',fail:'未通过',insufficient_evidence:'证据不足'})[test.result]||'待确认'),out);el('p',test.reason,out);list(tr('Missing evidence','尚缺少的证据'),test.missing_information,out);}sources(r.evidence,out);}
 }
 $("previous").onclick=()=>{position--;render();};$("next").onclick=()=>{position++;render();};render();
}catch{$("demo-status").textContent=tr("The saved walkthrough could not be loaded. Please refresh, or use the video above.","流程记录暂时无法加载，请刷新重试，或查看上方实录视频。");}
})();
