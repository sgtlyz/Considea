"use strict";
(async()=>{
const $=id=>document.getElementById(id),el=(tag,text,parent)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;parent?.append(n);return n;};
try{
 const response=await fetch('/demo-data.json');if(!response.ok)throw Error();const data=await response.json();let position=0;
 $("demo-status").textContent="Recorded "+new Date(data.recorded_at).toLocaleDateString()+" · "+data.model+" · Real web retrieval · PostgreSQL";
 $("run-notes").textContent=data.notes;
 function list(title,items,parent){if(!items?.length)return;el('h3',title,parent);const ul=el('ul',undefined,parent);for(const item of items)el('li',item,ul);}
 function sources(items,parent){const valid=(items||[]).filter(s=>{try{return ['https:','http:'].includes(new URL(s.url).protocol);}catch{return false;}});if(!valid.length)return;el('h3','Sources read',parent);const ul=el('ul',undefined,parent);for(const source of valid){const li=el('li',undefined,ul),a=el('a',source.title||source.url,li);a.href=source.url;a.target='_blank';a.rel='noopener noreferrer';if(source.limitation)el('small',source.limitation,li);}}
 function render(){const step=data.steps[position],out=$("step-body");out.replaceChildren();$("step-number").textContent=step.kind;$("step-title").textContent=step.title;$("step-position").textContent=(position+1)+' / '+data.steps.length;$("previous").disabled=position===0;$("next").disabled=position===data.steps.length-1;
 for(const text of step.paragraphs||[])el('p',text,out);
 for(const item of step.members||[]){const article=el('article',undefined,out);el('h3',item.member,article);el('p',item.text,article);}
 if(step.candidate){const c=step.candidate;el('h3',c.title,out);el('p',c.problem,out);el('p',c.solution,out);list('First demo',c.mvp_scope,out);list('Deferred',c.out_of_scope,out);}
 if(step.report){const r=step.report;for(const [key,test]of Object.entries(r.tests||{})){el('h3',key+': '+test.result.replaceAll('_',' '),out);el('p',test.reason,out);list('Missing evidence',test.missing_information,out);}sources(r.evidence,out);}
 }
 $("previous").onclick=()=>{position--;render();};$("next").onclick=()=>{position++;render();};render();
}catch{$("demo-status").textContent="The saved walkthrough could not be loaded. Please refresh, or use the video above.";}
})();
