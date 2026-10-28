(function(){'use strict';
const pending=new Map(),finished=new Set();let acknowledged=null;
const storageKey='mumutori-activity-pending-v1';
try{for(const [key,event]of JSON.parse(sessionStorage.getItem(storageKey)||'[]')){if(event&&/^act_[a-f0-9]{32}$/.test(event.eventId))pending.set(key,event);}}catch{}
function persist(){try{sessionStorage.setItem(storageKey,JSON.stringify([...pending]));}catch{}}
function records(s,kind){return window.OfflineOrders.records(s,kind);}
function enqueue(proof,action){try{if(finished.has(proof)||pending.has(proof))return;const e=window.MumutoriActivity?.make('주문판',action);if(!e)return;pending.set(proof,e);persist();flush();}catch{}}
function capture(before,after){try{
 const added=kind=>records(after,kind).filter(r=>!records(before,kind).some(x=>x.id===r.id));
 const files=added('attachment');for(const f of files)enqueue(f.id,'파일 첨부');
 if(files.length)return;
 const newEvents=added('activity');if(!newEvents.length)return;
 const comments=added('comment'),requests=added('request');
 const changed=kind=>JSON.stringify(records(before,kind))!==JSON.stringify(records(after,kind));
 let action=comments.length?'댓글 저장':requests.length?'목업 요청':changed('scene')?'도면 변경':JSON.stringify(before.tasks)!==JSON.stringify(after.tasks)?'할 일 변경':'기록 저장';
 if(changed('item')&&!comments.length&&!requests.length){const old=records(before,'item');if(records(after,'item').some(r=>old.some(x=>x.id===r.id&&x.status!==r.status)))action='상태 변경';}
 for(const e of newEvents)enqueue(e.id,action);
}catch{}}
function flush(){try{if(!acknowledged||!window.firebase?.apps?.length||!window.firebase.auth().currentUser)return;const proofs=new Set(records(acknowledged).map(r=>r.id));
 for(const [proof,e]of pending){if(!proofs.has(proof))continue;pending.delete(proof);finished.add(proof);persist();window.MumutoriActivity?.record(e);}
}catch{}}
window.OfflineActivity={capture,uploaded(fileId){enqueue('att-'+fileId,'파일 첨부');},settled(snapshot){acknowledged=snapshot;flush();},flush};
})();
