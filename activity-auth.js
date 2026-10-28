// Reuse the studio Google session; shared editing remains available without login.
import {onAuth,signIn,signOut} from '/mumutori-dashboard/src/fbauth.js?v=activity20261028';
let me=null;
function paint(){const host=document.getElementById('order-app');if(!host)return;let bar=document.getElementById('activity-auth');if(!bar){bar=document.createElement('div');bar.id='activity-auth';bar.style.cssText='padding:8px 20px;font-size:13px;background:#f5f1e8';host.insertAdjacentElement('beforebegin',bar);}bar.replaceChildren();const text=document.createElement('span');text.textContent=me?'Google 로그인됨 · 변경 알림 연결':'로그인하면 이 기기의 변경 알림도 함께 보내요. ';const b=document.createElement('button');b.type='button';b.textContent=me?'로그아웃':'Google 로그인';b.addEventListener('click',()=>{Promise.resolve(me?signOut():signIn()).catch(()=>{text.textContent='로그인을 완료하지 못했어요. 다시 눌러 주세요. ';});});bar.append(text,b);}
onAuth(u=>{me=u;paint();window.OfflineActivity?.flush();});paint();
