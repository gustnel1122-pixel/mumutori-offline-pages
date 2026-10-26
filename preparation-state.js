(function(factory){const api=factory(typeof module==='object'?require('./buylist-state.js'):window.OfflineBuylistState);if(typeof module==='object')module.exports=api;if(typeof window==='object')window.OfflinePreparationState=api;})(function(B){
'use strict';
const PREFIX='[[MUMUTORI_PREPARATION:1]]\n', END='\n[[/MUMUTORI_PREPARATION]]\n';
const decisions=['','yes','hold','no'], progress=['미정','장바구니','결제완료','배송중','도착','설치 끝','안 삼'];
const legacyProgress={'살 것':'미정','주문함':'결제완료','도착 · 설치 끝':'설치 끝'};
const normalizeProgress=value=>legacyProgress[value]||value;
const paidProgress=['결제완료','배송중','도착','설치 끝'];
const copy=x=>JSON.parse(JSON.stringify(x));
const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
function validateMeta(m){
 if(!m||typeof m!=='object'||Array.isArray(m)||Object.keys(m).some(k=>!['decision','by','comment','at','choice','amount','progress','name','use','zone','quantity','essential','previousProgress','posConfirmed'].includes(k)))throw Error('기록 형식을 확인해 주세요. 기존 내용은 보존됩니다.');
 if(own(m,'decision')&&!decisions.includes(m.decision))throw Error('결정을 확인해 주세요.');
 if(own(m,'by')&&!['사장님','다희'].includes(m.by))throw Error('작성하는 사람을 골라 주세요.');
 for(const key of ['progress','previousProgress'])if(own(m,key)&&!progress.includes(normalizeProgress(m[key])))throw Error('진행 상태를 확인해 주세요.');
 for(const key of ['essential','posConfirmed'])if(own(m,key)&&typeof m[key]!=='boolean')throw Error('준비물 분류를 확인해 주세요.');
 if(own(m,'amount')&&m.amount!==null&&(!Number.isSafeInteger(m.amount)||m.amount<0||m.amount>1e10))throw Error('예상 금액은 0 이상인 원 단위 숫자로 입력해 주세요.');
 for(const [k,max] of Object.entries({comment:300,at:32,choice:80,name:240,use:300,zone:60,quantity:80}))if(own(m,k)&&(typeof m[k]!=='string'||m[k].length>max))throw Error('입력 내용의 길이를 확인해 주세요.');
 if(m.at&&!Number.isFinite(Date.parse(m.at)))throw Error('기록 시각을 확인해 주세요.');
 return m;
}
function unpack(detail){
 if(!detail.startsWith('[[MUMUTORI_PREPARATION'))return {meta:{},raw:detail};
 if(!detail.startsWith(PREFIX))throw Error('지원하지 않는 준비 기록입니다. 원문을 보존합니다.');
 const i=detail.indexOf(END,PREFIX.length);if(i<0)throw Error('준비 기록이 손상되었습니다. 원문을 보존합니다.');
 return {meta:validateMeta(JSON.parse(detail.slice(PREFIX.length,i))),raw:detail.slice(i+END.length)};
}
function pack(meta,raw){const out=PREFIX+JSON.stringify(validateMeta(meta))+END+raw;if(out.length>6000)throw Error('기존 내용과 새 기록을 합쳐 6,000자를 넘습니다. 기존 메모를 보관한 뒤 줄여 주세요.');return out;}
function sourceEntries(state,source,defaults){
 const fallback=new Map(defaults.map(x=>[x.id,x]));
 const result=new Map(state.definitions.inventory.map(x=>[x.id,copy(x)]));
 source.forEach(x=>{if(!result.has(x.id))result.set(x.id,copy(fallback.get(x.id)||B.definition(x)));});
 return result;
}
function rows(state,source,defaults,groups){
 const entries=sourceEntries(state,source,defaults),bySource=new Map(source.map(x=>[x.id,x])),seen=new Set();
 const result=[];
 function make(group){
  const ids=group.ids.filter(id=>entries.has(id)&&!seen.has(id));if(!ids.length)return;ids.forEach(id=>seen.add(id));
  const records=ids.map(id=>{const entry=entries.get(id),item=bySource.get(id)||{id,link:[]};let values,error='';try{const un=unpack(entry.detail);values={...B.read(item,{...entry,detail:un.raw}),meta:un.meta};}catch(e){values={links:[],memo:entry.detail,meta:{}};error=e.message;}
   return {id,entry,item,...values,error,record:state.inventory[id]||{quantity:entry.quantity,status:entry.status}};});
  const anchor=records[0],meta=anchor.meta;
  const choices=(group.choices||[]).filter(id=>ids.includes(id));
  const selected=choices.includes(meta.choice)?meta.choice:'';
  const picked=records.find(x=>x.id===selected)||anchor;
  const active=selected?[picked]:records.filter(x=>!choices.includes(x.id));
  const linkRecords=active.length?active:[];
  const inferred=anchor.record.status==='준비 완료'?'설치 끝':anchor.record.status==='발주'?'결제완료':'미정';
  const posConfirmed=group.id==='pos'&&!meta.posConfirmed;
  const decision=posConfirmed?'yes':meta.decision??(group.archived?'no':'');
  const currentProgress=posConfirmed?'설치 끝':decision==='no'?'안 삼':normalizeProgress(meta.progress)||inferred;
  result.push({...group,ids,records,anchor:anchor.id,choices,selected,decision,by:meta.by||'',comment:meta.comment||'',at:meta.at||'',amount:meta.amount??null,essential:meta.essential??group.essential??true,
   name:meta.name||group.name,use:meta.use||group.use,zone:meta.zone||group.zone,quantity:meta.quantity??picked.record.quantity,progress:currentProgress,
   links:[...new Set(linkRecords.flatMap(x=>x.links))],memo:picked.memo,thumbnail:records.find(x=>x.item.image)?.item.image||'',error:anchor.error,meta});
 }
 groups.forEach(make);
 for(const [id,entry] of entries)if(!seen.has(id))make({id:'extra-'+id,name:entry.name.replace(/ 후보/g,''),use:'직접 추가한 준비물 · 펼쳐서 내용을 적어 주세요',zone:entry.category,ids:[id],choices:[],archived:entry.category==='이전 안·제외'});
 return result;
}
function materialize(next,record){B.ensureItem(next,{id:record.id},record.entry);return next.definitions.inventory.find(x=>x.id===record.id);}
function update(state,row,patch,actor){
 if(!['사장님','다희'].includes(actor))throw Error('위에서 지금 작성하는 사람을 골라 주세요.');
 if(row.error)throw Error(row.error);
 const next=copy(state),record=row.records.find(x=>x.id===row.anchor),entry=materialize(next,record),un=unpack(entry.detail);
 if(own(patch,'choice')&&patch.choice!==''&&!row.choices.includes(patch.choice))throw Error('이 줄의 상품 중에서 골라 주세요.');
 const changes={...patch};
 const prior=normalizeProgress(un.meta.previousProgress||un.meta.progress);
 const restoreProgress=prior&&prior!=='안 삼'?prior:record.record.status==='준비 완료'?'설치 끝':record.record.status==='발주'?'결제완료':'미정';
 if(own(changes,'progress'))changes.progress=normalizeProgress(changes.progress);
 if(changes.decision==='no'||changes.progress==='안 삼'){
  changes.previousProgress=row.progress==='안 삼'?restoreProgress:row.progress;
  if(changes.previousProgress==='안 삼')changes.previousProgress='미정';
  changes.decision='no';changes.progress='안 삼';
 }else if(own(changes,'progress')&&row.decision==='no')changes.decision=own(changes,'decision')?changes.decision:'yes';
 else if(own(changes,'decision')&&row.progress==='안 삼')changes.progress=restoreProgress;
 const base=row.id==='pos'&&!un.meta.posConfirmed?{...un.meta,decision:row.decision,progress:row.progress,posConfirmed:true}:un.meta;
 const meta={...base,...changes,by:actor,at:new Date().toISOString()};validateMeta(meta);
 entry.detail=pack(meta,un.raw);
 if(own(changes,'progress')&&changes.progress!=='안 삼')next.inventory[entry.id].status=['도착','설치 끝'].includes(changes.progress)?'준비 완료':['결제완료','배송중'].includes(changes.progress)?'발주':'검토';
 if(own(patch,'quantity'))next.inventory[entry.id].quantity=patch.quantity;
 return next;
}
function editRecord(state,row,id,patch){
 const rec=row.records.find(x=>x.id===id);if(!rec)throw Error('항목을 다시 열어 주세요.');if(rec.error)throw Error(rec.error);
 const next=copy(state),entry=materialize(next,rec),un=unpack(entry.detail),parsed=B.read(rec.item,{...entry,detail:un.raw});
 const raw=B.writeDetail(own(patch,'memo')?patch.memo:parsed.memo,own(patch,'links')?patch.links:parsed.links);
 entry.detail=Object.keys(un.meta).length?pack(un.meta,raw):raw;return next;
}
function summary(values){const yes=values.filter(x=>x.decision==='yes'),paid=values.filter(x=>x.decision!=='no'&&paidProgress.includes(x.progress));return {needed:values.filter(x=>!x.decision||x.decision==='hold').length,yes:yes.length,no:values.filter(x=>x.decision==='no').length,total:yes.reduce((a,r)=>a+(r.amount??0),0),unknown:yes.filter(x=>x.amount===null).length,cart:values.filter(x=>x.progress==='장바구니'&&x.decision!=='no').length,paid:values.filter(x=>x.progress==='결제완료'&&x.decision!=='no').length,remaining:values.filter(x=>x.essential&&x.decision!=='no'&&x.progress!=='설치 끝').length,paidTotal:paid.reduce((a,r)=>a+(r.amount??0),0),paidUnknown:paid.filter(x=>x.amount===null).length};}
function copyText(values){return ['무무토리 · 매장 준비 목록',...values.map(r=>[r.name,({yes:'하자',hold:'보류',no:'안 함'})[r.decision]||'결정 필요',r.progress,r.zone,'수량: '+r.quantity,'예상 금액: '+(r.amount===null?'미입력':r.amount+'원'),'선택: '+(r.selected||'미선택'),r.by+' '+r.comment,...r.records.map(x=>[x.entry.name,...x.links,x.memo].join('\n'))].join('\n'))].join('\n\n');}
return Object.freeze({unpack,pack,rows,update,editRecord,summary,copyText,validateMeta,progress,normalizeProgress});
});
