(function(){'use strict';
window.createProductionView=function(opts){
 const P=window.OfflineProduction,root=document.getElementById('production-board'),seeds=window.OFFLINE_PRODUCTION_SEEDS;
 let actor='',filter='전체',query='';try{actor=localStorage.getItem('mumutori-board-author')||'';}catch(_){}
 const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;};
 const button=(txt,fn)=>{const b=el('button','board-button',txt);b.type='button';b.addEventListener('click',fn);return b;};
 const link=(txt,url)=>{const a=el('a','board-link',txt);a.href=P.safeUrl(url);a.target='_blank';a.rel='noopener noreferrer';return a;};
 const rows=()=>P.rows(opts.getState(),seeds);
 const author=document.getElementById('board-author');author.value=actor;author.addEventListener('change',()=>{actor=author.value;try{localStorage.setItem('mumutori-board-author',actor);}catch(_){}});
 document.getElementById('board-search').addEventListener('input',e=>{query=e.target.value;render();});
 document.querySelectorAll('[data-board-filter]').forEach(b=>b.addEventListener('click',()=>{filter=b.dataset.boardFilter;render();}));
 function editor(id){
  if(opts.isLocked()){opts.notify('공유 기록을 불러온 뒤 수정해 주세요.');return;}
  const original=rows().find(r=>r.id===id),dialog=el('dialog','board-dialog');dialog.setAttribute('aria-label',original.title+' 수정');
  const form=el('form');form.append(el('h2','',original.title),el('p','board-muted','파일은 드라이브 폴더에 넣고 주소를 남겨 주세요. 비밀번호·고객정보는 넣지 않습니다.'));
  const fields={};
  const labels={title:'자리 이름',status:'진행 상태',confirmed:'확정 내용',size:'크기 · 수량',owner:'담당',folder:'제작물 폴더 주소',files:'파일 주소 · 한 줄에 하나',memo:'메모',next:'다음 할 일',due:'마감',decision:'결정 대기 · 없으면 비워 두기'};
  for(const [key,label] of Object.entries(labels)){
   const box=el('label','board-field',label);let input;
   if(['status','owner'].includes(key)){input=el('select');for(const value of key==='status'?P.statuses:P.owners){const o=el('option','',value);o.value=value;input.append(o);}}
   else if(['confirmed','memo','next','decision','files'].includes(key)){input=el('textarea');input.rows=key==='files'?3:2;}
   else {input=el('input');input.type=key==='due'?'date':'text';}
   input.value=original[key];input.name=key;input.maxLength=P.fields[key];input.dataset.boardControl='';fields[key]=input;box.append(input);form.append(box);
  }
  const error=el('p','board-error');error.setAttribute('role','alert');form.append(error);
  const actions=el('div','board-dialog-actions'),cancel=button('닫기',()=>dialog.close()),save=button('변경 저장',()=>{});save.type='submit';save.dataset.boardControl='';actions.append(cancel,save);form.append(actions);
  form.addEventListener('submit',e=>{e.preventDefault();try{
   if(opts.isLocked())throw Error('공유 연결을 확인한 뒤 다시 저장해 주세요.');
   const current=rows().find(r=>r.id===id),patch={};for(const k of Object.keys(fields)){if(fields[k].value===original[k])continue;if(current[k]!==original[k]&&current[k]!==fields[k].value)throw Error('다른 사람이 '+labels[k]+'을 바꿨어요. 입력을 복사한 뒤 최신 칸을 다시 열어 주세요.');patch[k]=fields[k].value;}
   if(!Object.keys(patch).length){dialog.close();return;}
   opts.save(P.update(opts.getState(),seeds,id,patch,actor));dialog.close();render();opts.notify('기기에 저장했어요. 상단에서 공유 저장 완료를 확인해 주세요.');
  }catch(e){error.textContent=e.message;}});
  dialog.append(form);document.body.append(dialog);dialog.addEventListener('close',()=>{dialog.remove();document.getElementById(id)?.querySelector('button')?.focus();});dialog.showModal();fields.title.focus();
 }
 function render(){
  let all;try{all=rows();}catch(e){root.replaceChildren(el('p','board-error',e.message));return;}
  const shown=all.filter(r=>(filter==='전체'||(filter==='결정 대기'?r.decision:filter===r.owner||filter===r.status))&&[r.title,r.confirmed,r.next,r.memo].join(' ').includes(query));
  document.querySelectorAll('[data-board-filter]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.boardFilter===filter)));
  root.replaceChildren();
  for(const r of shown){
   const card=el('article','place-card');card.id=r.id;
   const head=el('div','place-head');head.append(el('span','place-id',r.id),el('span','place-status status-'+P.statuses.indexOf(r.status),r.status));card.append(head,el('h3','',r.title),el('p','place-confirmed',r.confirmed));
   const meta=el('div','place-meta');meta.append(el('span','',r.owner),el('span','',r.due?'마감 '+r.due:'마감 미정'));card.append(meta,el('p','place-size',r.size));
   if(r.decision)card.append(el('p','place-decision','결정 대기 · '+r.decision));
   const next=el('div','place-next');next.append(el('small','','다음 할 일'),el('p','',r.next||'다음 할 일을 적어 주세요.'));card.append(next);
   if(r.memo)card.append(el('p','place-memo',r.memo));
   const files=el('div','place-files');if(r.folder)files.append(link('제작물 폴더 ↗',r.folder));r.files.split('\n').filter(Boolean).forEach((url,i)=>files.append(link('파일 '+(i+1)+' ↗',url)));if(!r.files)files.append(el('small','','인쇄용 원본 · 시안 · 사진을 넣는 곳'));card.append(files);
   const foot=el('div','place-foot');foot.append(el('small','',r.at?(r.by+' · '+new Date(r.at).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'})):'10/27 확정 기준'),button('수정',()=>editor(r.id)));card.append(foot);root.append(card);
  }
  if(!shown.length)root.append(el('p','board-muted','조건에 맞는 제작물이 없어요.'));
  document.getElementById('board-count').textContent=all.filter(r=>r.status==='완료').length+' / '+all.length+' 완료';
  const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const d=Math.round((Date.parse('2026-11-01T00:00:00+09:00')-Date.parse(today+'T00:00:00+09:00'))/86400000);document.getElementById('shared-dday').textContent=d>0?'D−'+d:d===0?'D-DAY':'오픈 +'+(-d);
  for(const owner of ['현수','다희']){const list=document.getElementById(owner==='현수'?'today-hyunsoo':'today-dahee');list.replaceChildren();const tasks=all.filter(r=>r.status!=='완료'&&(r.owner===owner||r.owner==='둘이')&&r.next).sort((a,b)=>(a.due||'9999').localeCompare(b.due||'9999'));const more=el('details','today-more');more.append(el('summary','', '나머지 '+Math.max(0,tasks.length-2)+'개'));tasks.forEach((r,i)=>{const a=el('a','today-item');a.href='#'+r.id;a.append(el('strong','',r.title),el('span','',r.next));(i<2?list:more).append(a);});if(tasks.length>2)list.append(more);if(!tasks.length)list.append(el('p','','남은 일이 없어요.'));}
  const waiting=document.getElementById('shared-decisions');waiting.replaceChildren();for(const r of all.filter(r=>r.decision)){const a=el('a','decision-item');a.href='#'+r.id;a.append(el('strong','',r.title),el('span','',r.decision));waiting.append(a);}
  document.getElementById('decision-count').textContent=all.filter(r=>r.decision).length+'건';
  const text=P.markdown(opts.getState(),seeds,document.getElementById('cloud-status').textContent);document.getElementById('ai-current-text').textContent=text;
 }
 const sync=document.getElementById('cloud-status');const observer=new MutationObserver(()=>{document.getElementById('shared-save-status').textContent=sync.textContent;});observer.observe(sync,{childList:true,characterData:true,subtree:true});
 document.getElementById('snapshot-download').addEventListener('click',()=>{const text=P.markdown(opts.getState(),seeds,sync.textContent),url=URL.createObjectURL(new Blob([text],{type:'text/markdown;charset=utf-8'})),a=el('a');a.href=url;a.download='페이지_현재상태.md';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
 document.getElementById('ai-copy').addEventListener('click',async()=>{try{await navigator.clipboard.writeText(P.markdown(opts.getState(),seeds,sync.textContent));opts.notify('현재 내용을 복사했어요. AI에게 붙여 넣어 주세요.');}catch(_){opts.notify('복사하지 못했어요. 현재상태 파일 받기를 눌러 주세요.');}});
 render();return {render,setLocked(){document.querySelectorAll('[data-board-control]').forEach(x=>x.disabled=opts.isLocked());}};
};})();
