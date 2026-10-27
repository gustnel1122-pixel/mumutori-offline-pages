(function(root,factory){const api=factory();if(typeof module==='object')module.exports=api;else root.OfflineSharedMerge=api;})(typeof window==='undefined'?globalThis:window,function(){
 'use strict';
 const copy=x=>x===undefined?undefined:JSON.parse(JSON.stringify(x));
 const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
 const object=x=>x&&typeof x==='object'&&!Array.isArray(x);
 function merge(base,local,remote){
  const prefix='[[MUMUTORI_ORDER:1]]\n';
  if(object(local)&&object(remote)&&local.id===remote.id&&typeof local.detail==='string'&&typeof remote.detail==='string'&&local.detail.startsWith(prefix)&&remote.detail.startsWith(prefix)){
    const parse=x=>x?.detail?.startsWith(prefix)?JSON.parse(x.detail.slice(prefix.length)):{};
    const values=[parse(base),parse(local),parse(remote)],audit=['by','at','updatedBy','updatedAt'];
    const clean=v=>Object.fromEntries(Object.entries(v).filter(([k])=>!audit.includes(k)));
    const merged=merge(...values.map(clean)),latest=[values[1],values[2]].sort((a,b)=>(a.updatedAt||a.at||'').localeCompare(b.updatedAt||b.at||''))[1];
    audit.forEach(k=>{if(latest[k]!==undefined)merged[k]=latest[k];});
    return {...remote,name:(merged.name||base?.name||remote.name).slice(0,240),detail:prefix+JSON.stringify(merged)};
  }
  if(equal(local,base))return copy(remote);
  if(equal(remote,base)||equal(local,remote))return copy(local);
  if([base,local,remote].every(Array.isArray)){
   if([base,local,remote].every(a=>a.every(x=>object(x)&&typeof x.id==='string'))){
    const maps=[base,local,remote].map(a=>Object.fromEntries(a.map(x=>[x.id,x]))),out=merge(...maps);return [...new Set([...remote,...local].map(x=>x.id))].filter(id=>out[id]!==undefined).map(id=>out[id]);
   }
   if([base,local,remote].every(a=>a.every(x=>typeof x==='string'))&&base.every(x=>local.includes(x)&&remote.includes(x)))return [...new Set([...remote,...local])];
  }
  if([base,local,remote].every(object)){
   const out={};for(const k of new Set([...Object.keys(base),...Object.keys(local),...Object.keys(remote)])){const v=merge(base[k],local[k],remote[k]);if(v!==undefined)out[k]=v;}return out;
  }
  throw Error('같은 내용을 두 기기에서 바꿨어요. 두 기록을 확인해 주세요.');
 }
 return {merge};
});
