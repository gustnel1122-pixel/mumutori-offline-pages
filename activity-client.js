// Best-effort, create-only activity records. No business payloads, credentials or email in records.
(function(root){'use strict';
const screens=new Set(['운영홈','소싱','장부','주문판','pc']);
const actions=new Set(['기록 저장','상태 변경','댓글 저장','파일 첨부','규칙 저장','검수 요청','수량 변경','장바구니 변경','분류 요청','분류 변경','분류 되돌리기','레터 할 일 저장','레터 초안 저장','레터 설정 적용','할 일 변경','도면 변경','목업 요청','설정 저장']);
const BASE='https://mumutori-letter-default-rtdb.asia-southeast1.firebasedatabase.app';
function user(){try{return root.firebase?.apps?.length?root.firebase.auth().currentUser:null;}catch{return null;}}
function actor(u){const name=String(u?.displayName||'').trim();return /^[가-힣a-zA-Z ·'-]{1,40}$/.test(name)?name:'운영 사용자';}
function createReporter(deps={}){
 const current=deps.user||user,request=deps.fetch||((...args)=>root.fetch(...args));
 const uuid=deps.uuid||(()=>root.crypto.randomUUID().replaceAll('-','').toLowerCase());
 const attempts=new Map();
 function make(screen,action){try{if(!screens.has(screen)||!actions.has(action))return null;const id=uuid();if(!/^[a-f0-9]{32}$/.test(id))return null;return {eventId:'act_'+id,workId:'web_'+id,screen,action};}catch{return null;}}
 function record(input){
  try{
   if(!input||!screens.has(input.screen)||!actions.has(input.action))return Promise.resolve(false);
   const item=input.eventId?input:make(input.screen,input.action);
   if(!item||!/^act_[a-f0-9]{32}$/.test(item.eventId)||!/^web_[a-f0-9]{32}$/.test(item.workId))return Promise.resolve(false);
   const u=current();if(!u?.uid)return Promise.resolve(false);
   if(attempts.has(item.eventId))return attempts.get(item.eventId);
   const work=async()=>{
    let timer;const abort=new AbortController();
    try{
     const token=await Promise.race([u.getIdToken(),new Promise((_,reject)=>{timer=setTimeout(()=>{abort.abort();reject(Error('timeout'));},4000);})]);
     if(current()?.uid!==u.uid)return false;
     const value={schema:1,actor:actor(u),action:item.action,screen:item.screen,workId:item.workId,source:'dashboard',createdAt:{'.sv':'timestamp'},status:'pending',sent:false};
     const response=await request(BASE+'/activityHub/events/'+item.eventId+'.json?auth='+encodeURIComponent(token),{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(value),signal:abort.signal});
     return response.ok;
    }catch{return false;}finally{clearTimeout(timer);}
   };
   // One attempt per event, including unknown responses: create-only server permissions.
   const promise=Promise.resolve().then(work).catch(()=>false);attempts.set(item.eventId,promise);
   if(attempts.size>500)attempts.delete(attempts.keys().next().value);
   return promise;
  }catch{return Promise.resolve(false);}
 }
 return {make,record};
}
root.MumutoriActivity={...createReporter(),createReporter};
})(typeof window==='undefined'?globalThis:window);
