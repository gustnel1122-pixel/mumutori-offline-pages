(function(){'use strict';
window.createPreparationView=function(opts){
 const P=window.OfflinePreparationState,B=window.OfflineBuylistState,root=opts.element;
 let tab='essential',query='',actor='',openRows=new Set(),closedZones=new Set(),openBuckets=new Set();
 try{actor=localStorage.getItem('mumutori-preparation-author')||'';}catch(_){}
 const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!=null)n.textContent=String(text);return n;};
 const values=()=>P.rows(opts.getState(),opts.source,opts.defaults,window.OFFLINE_PREPARATION_GROUPS);
 const fresh=id=>values().find(x=>x.id===id);
 const money=x=>x===null?'금액 입력':x.toLocaleString('ko-KR')+'원';
 const labels={yes:'하자',hold:'보류',no:'안 함','':'결정 필요'};
 const button=(label,fn,cls='',edit=false)=>{const b=el('button',cls,label);b.type='button';if(edit){b.dataset.prepControl='';b.disabled=opts.isLocked();}b.addEventListener('click',fn);return b;};
 const change=(id,patch)=>{try{opts.save(P.update(opts.getState(),fresh(id),patch,actor));render();}catch(e){opts.notify(e.message);}};
 const linkList=links=>{const box=el('div','prep-links');links.forEach((url,i)=>{try{const href=B.validateLinks([url])[0],a=el('a','',links.length>1?'열기 '+(i+1)+' ↗':'열기 ↗');a.href=href;a.target='_blank';a.rel='noopener noreferrer';a.setAttribute('aria-label','판매처 '+(i+1)+' 새 창으로 열기');box.append(a);}catch(_){}});return box;};
 const header=el('div','prep-top');
 const title=el('div');title.append(el('h2','','매장 준비 목록'),el('p','prep-subtitle','11/1(일), 문 열고 팔 수 있는 준비부터. 나머지는 아래에 접어 두었어요.'));
 const authorLabel=el('label','prep-author','지금 작성하는 사람');const author=el('select');author.setAttribute('aria-label','지금 작성하는 사람');
 for(const name of ['','사장님','다희']){const o=el('option','',name||'이름 선택');o.value=name;author.append(o);}author.value=actor;
 author.addEventListener('change',()=>{actor=author.value;try{localStorage.setItem('mumutori-preparation-author',actor);}catch(_){};});authorLabel.append(author,el('small','','선택한 이름으로 남아요'));
 header.append(title,authorLabel);root.append(header);
 const sync=el('p','prep-sync');sync.setAttribute('role','status');root.append(sync);
 const syncSource=document.getElementById('cloud-status');
 const syncText=()=>{sync.textContent=syncSource?.textContent||'이 기기에 저장 · 함께 보려면 기존 공유 링크로 열어 주세요.';};
 if(syncSource)new MutationObserver(syncText).observe(syncSource,{childList:true,subtree:true,characterData:true});syncText();
 const summary=el('p','prep-summary');summary.setAttribute('aria-live','polite');root.append(summary);
 const toolbar=el('div','prep-toolbar'),tabs=el('div','prep-tabs');tabs.setAttribute('role','group');tabs.setAttribute('aria-label','준비 목록 보기');
 for(const [id,label] of [['essential','기본 목록'],['needed','결정 필요'],['장바구니','장바구니'],['결제완료','결제완료'],['배송중','배송중'],['도착','도착'],['all','전체'],['no','안 삼']]){const b=button(label,()=>{tab=id;render();});b.dataset.prepTab=id;tabs.append(b);}toolbar.append(tabs);
 const search=el('input','prep-search');search.type='search';search.placeholder='이름·메모 검색';search.setAttribute('aria-label','매장 준비 목록 검색');search.addEventListener('input',()=>{query=search.value.trim().toLowerCase();render();});
 toolbar.append(search,button('+ 필요한 것',()=>editNew(),'prep-add',true),button('목록 복사',async()=>{const text=P.copyText(values());try{await navigator.clipboard.writeText(text);opts.notify('결정·링크·메모를 복사했어요.');}catch(_){copyFallback.value=text;copyFallback.hidden=false;copyFallback.focus();copyFallback.select();}}));root.append(toolbar);
 const copyFallback=el('textarea');copyFallback.hidden=true;copyFallback.setAttribute('aria-label','복사할 매장 준비 목록');root.append(copyFallback);
 const privacy=el('p','prep-privacy','원가 · 계좌 · 개인정보는 적지 마세요. 예상 금액은 이 준비물에 쓸 총액이에요.');root.append(privacy);
 root.append(el('p','prep-summary-help','장바구니·결제완료는 전체 목록의 해당 상태 수예요. 남은 것은 필수 중 설치 끝·안 삼을 뺀 수예요. 결제완료 합계는 배송중·도착·설치 끝도 포함한 입력 예상 금액이며, 실제 결제액은 아니에요.'));
 const content=el('div','prep-content');root.append(content);
 function inputField(form,label,value,kind='text',max=300){const wrap=el('label','prep-field'),n=el(kind==='textarea'?'textarea':'input');wrap.append(el('span','',label));if(kind!=='textarea')n.type=kind;n.value=value??'';n.maxLength=max;n.dataset.prepControl='';n.disabled=opts.isLocked();if(kind==='number'){n.min='0';n.step='1';}wrap.append(n);form.append(wrap);return n;}
 function dialog(title,build){const d=el('dialog','prep-dialog'),h=el('h3','',title),form=el('form'),error=el('p','prep-error');error.setAttribute('role','alert');error.hidden=true;d.setAttribute('aria-label',title);d.append(h,el('p','prep-privacy','원가 · 계좌 · 개인정보는 적지 마세요.'),form,error);document.body.append(d);const apply=build(form);const actions=el('div','prep-dialog-actions');actions.append(button('취소',()=>d.close()));const submit=button('저장',()=>{},'prep-primary',true);submit.type='submit';actions.append(submit);form.append(actions);form.addEventListener('submit',ev=>{ev.preventDefault();try{if(opts.isLocked())throw Error('공유 기록을 불러온 뒤 다시 저장해 주세요.');apply();d.close();render();}catch(e){error.textContent=e.message;error.hidden=false;}});d.addEventListener('close',()=>d.remove());d.showModal();}
 function editRow(row){const original=JSON.stringify(row.records.map(r=>r.entry));dialog(row.name+' · 내용 수정',form=>{
  const name=inputField(form,'이름',row.name,'text',240),use=inputField(form,'이게 뭐야 · 어디에 쓰나',row.use,'text',300),zone=inputField(form,'구역',row.zone,'text',60),quantity=inputField(form,'수량',row.quantity,'text',80),amount=inputField(form,'예상 금액 · 이 줄 전체 금액(원)',row.amount,'number'),comment=inputField(form,'한 줄 의견',row.comment,'text',300);
  return ()=>{const latest=fresh(row.id);if(original!==JSON.stringify(latest.records.map(r=>r.entry)))throw Error('다른 창에서 이 항목을 바꿨어요. 입력 내용을 복사한 뒤 다시 열어 주세요.');if(!name.value.trim()||!zone.value.trim())throw Error('이름과 구역을 적어 주세요.');const n=amount.value.trim()===''?null:Number(amount.value);opts.save(P.update(opts.getState(),latest,{name:name.value.trim(),use:use.value,zone:zone.value.trim(),quantity:quantity.value,amount:n,comment:comment.value},actor));};
 });}
 function editSource(row,record){const before=record.entry.detail;dialog(record.entry.name+' · 링크·메모 수정',form=>{
  const links=inputField(form,'링크 · 한 줄에 하나',record.links.join('\n'),'textarea',6000),memo=inputField(form,'메모',record.memo,'textarea',6000);links.inputMode='url';
  return ()=>{const latest=fresh(row.id),r=latest.records.find(x=>x.id===record.id);if(r.entry.detail!==before)throw Error('다른 창에서 이 메모를 바꿨어요. 입력 내용을 복사한 뒤 다시 열어 주세요.');opts.save(P.editRecord(opts.getState(),latest,record.id,{links:B.validateLinks(links.value),memo:memo.value}));};
 });}
 function editNew(){dialog('필요한 것 추가',form=>{const name=inputField(form,'이름','','text',240),use=inputField(form,'이게 뭐야 · 어디에 쓰나','','text',300),zone=inputField(form,'구역','포장','text',60),quantity=inputField(form,'수량','','text',80),amount=inputField(form,'예상 금액 · 이 줄 전체 금액(원)','','number'),links=inputField(form,'링크 · 한 줄에 하나','','textarea',6000),memo=inputField(form,'메모','','textarea',6000);
  return ()=>{if(!['사장님','다희'].includes(actor))throw Error('위에서 지금 작성하는 사람을 골라 주세요.');if(!name.value.trim()||!zone.value.trim())throw Error('이름과 구역을 적어 주세요.');const state=JSON.parse(JSON.stringify(opts.getState())),id='prep-'+crypto.randomUUID(),category=zone.value.trim(),entry={id,name:name.value.trim(),category,priority:'',quantity:quantity.value,detail:B.writeDetail(memo.value,B.validateLinks(links.value)),status:'검토'};B.ensureItem(state,{id},entry);const row=P.rows(state,opts.source,opts.defaults,window.OFFLINE_PREPARATION_GROUPS).find(r=>r.ids.includes(id));opts.save(P.update(state,row,{name:entry.name,use:use.value,zone:category,quantity:quantity.value,amount:amount.value===''?null:Number(amount.value)},actor));tab='needed';};
 });}
 function sourceCard(row,r,choice){const box=el('div','prep-source'),heading=el('div','prep-source-heading');heading.append(el('strong','',r.entry.name));if(choice){const b=button(row.selected===r.id?'선택됨':'이걸로 선택',()=>change(row.id,{choice:r.id}),'prep-choice',true);b.setAttribute('aria-pressed',String(row.selected===r.id));heading.append(b);}box.append(heading);
  if(r.item.price)box.append(el('p','prep-source-price','판매처 안내 금액: '+r.item.price));
  box.append(el('p','prep-original','기존 기록 · 수량 '+(r.record.quantity||'미입력')+' · '+(r.record.status==='준비 완료'?'설치 끝':r.record.status==='발주'?'결제완료':'미정')),linkList(r.links));
  if(r.memo)box.append(el('p','prep-source-memo',r.memo));if(r.error)box.append(el('p','prep-error',r.error));
  box.append(button('링크·메모 수정',()=>editSource(row,r),'',true));return box;
 }
 function card(row){const article=el('article','prep-row');article.dataset.prepRow=row.id;article.setAttribute('aria-label',row.name);const line=el('div','prep-line');
  const decisions=el('div','prep-cell prep-decisions');decisions.dataset.label='결정';for(const key of ['yes','hold','no']){const b=button(labels[key],()=>change(row.id,{decision:key}),'prep-chip '+key+(row.decision===key?' selected':''),true);b.setAttribute('aria-pressed',String(row.decision===key));b.setAttribute('aria-label',row.name+' '+labels[key]);decisions.append(b);}
  if(row.by)decisions.append(el('small','prep-who',row.by));
  const main=el('div','prep-cell prep-name');main.dataset.label='이름';const toggle=button((openRows.has(row.id)?'▾ ':'▸ ')+row.name,()=>{openRows.has(row.id)?openRows.delete(row.id):openRows.add(row.id);render();},'prep-row-toggle');toggle.setAttribute('aria-expanded',String(openRows.has(row.id)));main.append(toggle);
  if(row.thumbnail){try{const href=B.validateLinks([row.thumbnail])[0],img=el('img','prep-thumb');img.src=href;img.alt=row.name+' 참고 그림';img.loading='lazy';img.addEventListener('error',()=>img.remove(),{once:true});main.prepend(img);}catch(_){}}
  if(row.choices.length){main.append(button((row.selected?'선택한 상품 · ':'후보 ')+ (row.selected?'바꾸기':row.choices.length+'개'),()=>{openRows.add(row.id);render();},'prep-candidate-count'));}
  const use=el('div','prep-cell prep-use',row.use);use.dataset.label='이게 뭐야 · 어디에 쓰나';use.title=row.use;
  const zone=el('div','prep-cell prep-zone',row.zone);zone.dataset.label='구역';const quantity=el('div','prep-cell prep-quantity',row.quantity||'미입력');quantity.dataset.label='수량';
  const amount=el('div','prep-cell prep-amount');amount.dataset.label='예상 금액';amount.append(button(money(row.amount),()=>editRow(row),'',true));
  const links=el('div','prep-cell prep-link-cell');links.dataset.label='링크';links.append(linkList(row.links));if(!row.links.length)links.append(button(row.choices.length&&!row.selected?'상품 고르기':'링크 넣기',()=>{if(row.choices.length&&!row.selected){openRows.add(row.id);render();}else editSource(row,row.records.find(x=>x.id===(row.selected||row.anchor)));},'prep-muted',true));
  const memo=el('div','prep-cell prep-memo',row.comment||(row.id==='pos'?'끝 · 서류·신청 완료 (10/26 확인)':row.memo)||'—');memo.dataset.label='메모';memo.title=row.comment||row.memo;
  const status=el('div','prep-cell prep-progress');status.dataset.label='상태';
  const statusChip=button(row.progress+' ▾',()=>statusMenu(row,statusChip),'prep-status status-'+P.progress.indexOf(row.progress),true);statusChip.setAttribute('aria-label',row.name+' 상태: '+row.progress);statusChip.setAttribute('aria-haspopup','menu');statusChip.setAttribute('aria-expanded','false');status.append(statusChip);
  line.append(decisions,main,use,zone,quantity,amount,links,memo,status);article.append(line);
  const detail=el('div','prep-detail');detail.hidden=!openRows.has(row.id);const facts=el('p','prep-facts',row.use+' · '+row.zone+' · 수량 '+(row.quantity||'미입력'));detail.append(facts);
  detail.append(el('p','prep-by',row.by?'마지막 변경: '+row.by+(row.at?' · '+new Date(row.at).toLocaleString('ko-KR',{timeZone:'Asia/Seoul',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}):''):'아직 함께 결정하지 않았어요.'),el('p','prep-opinion',row.comment||'한 줄 의견을 남겨 함께 골라 보세요.'),button('내용·금액·의견 수정',()=>editRow(row),'prep-edit',true));
  if(row.id==='pos')detail.prepend(el('p','prep-confirmed','끝 · 서류·신청 완료 — 10/26 사장님 확인. 아래 옛 메모는 이력으로 보존했어요.'));
  const priority=button(row.essential?'나중에로 옮기기':'필수로 올리기',()=>change(row.id,{essential:!row.essential}),'prep-promote',true);
  if(row.essential)detail.append(priority);else article.append(priority);
  if(row.error)detail.append(el('p','prep-error',row.error));
  if(row.choices.length){const choices=el('details','prep-choices');choices.open=true;choices.append(el('summary','','후보 '+row.choices.length+'개 · 하나 고르기'));row.records.filter(r=>row.choices.includes(r.id)).forEach(r=>choices.append(sourceCard(row,r,true)));detail.append(choices);}
  const records=row.records.filter(r=>!row.choices.includes(r.id));if(records.length){const old=el('details','prep-originals');old.append(el('summary','','링크·메모와 기존 기록 '+records.length+'개'));records.forEach(r=>old.append(sourceCard(row,r,false)));detail.append(old);}
  article.append(detail);return article;
 }
 function statusMenu(row,trigger){
  root.querySelector('.prep-status-menu')?.remove();root.querySelectorAll('.prep-status').forEach(n=>n.setAttribute('aria-expanded','false'));
  const menu=el('div','prep-status-menu');menu.setAttribute('role','menu');menu.setAttribute('aria-label',row.name+' 상태 선택');
  const close=()=>{menu.remove();trigger.setAttribute('aria-expanded','false');document.removeEventListener('click',outside);};
  const outside=event=>{if(!menu.contains(event.target)&&event.target!==trigger)close();};
  P.progress.forEach((value,i)=>{const option=button(value,()=>{close();change(row.id,{progress:value});const target=root.querySelector('[data-prep-row="'+row.id+'"] .prep-status');target?.focus();},'prep-status-option status-'+i,true);option.setAttribute('role','menuitemradio');option.setAttribute('aria-label',value);option.setAttribute('aria-checked',String(row.progress===value));menu.append(option);});
  menu.addEventListener('keydown',event=>{const items=[...menu.querySelectorAll('button')],at=items.indexOf(document.activeElement);if(event.key==='Escape'){event.preventDefault();close();trigger.focus();}else if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){event.preventDefault();items[event.key==='Home'?0:event.key==='End'?items.length-1:(at+(event.key==='ArrowDown'?1:-1)+items.length)%items.length].focus();}});
  root.append(menu);const rect=trigger.getBoundingClientRect();menu.style.left=Math.max(8,Math.min(rect.left,innerWidth-190))+'px';menu.style.top=Math.max(8,Math.min(rect.bottom+4,innerHeight-350))+'px';trigger.setAttribute('aria-expanded','true');menu.querySelector('[aria-checked="true"]').focus();document.addEventListener('click',outside);
 }
 function render(){const all=values(),s=P.summary(all);summary.textContent='장바구니 '+s.cart+' · 결제완료 '+s.paid+' · 남은 것 '+s.remaining+' · 결제완료 합계 '+money(s.paidTotal)+(s.paidUnknown?' (금액 미입력 '+s.paidUnknown+'개)':'');
  tabs.querySelectorAll('button').forEach(b=>{b.setAttribute('aria-pressed',String(b.dataset.prepTab===tab));b.classList.toggle('active',b.dataset.prepTab===tab);});
  content.replaceChildren();const filtered=all.filter(r=>tab==='needed'?(!r.decision||r.decision==='hold'):tab==='no'?r.decision==='no':P.progress.includes(tab)?r.progress===tab:true).filter(r=>!query||[r.name,r.use,r.zone,r.comment,...r.records.map(x=>x.memo)].join(' ').toLowerCase().includes(query));
  const essentials=filtered.filter(r=>r.essential),later=filtered.filter(r=>!r.essential);
  content.append(el('p','prep-counts','기본 목록'+' '+all.filter(r=>r.essential).length+'줄 · 나중에 '+all.filter(r=>!r.essential).length+'줄 · 결정 필요 '+s.needed+' · 하자 '+s.yes+' · 안 함 '+s.no));
  if(!filtered.length){content.append(el('p','prep-empty','이 보기에 해당하는 준비물이 없어요.'));return;}
  const columns=el('div','prep-columns');['결정','이름','이게 뭐야 · 어디에 쓰나','구역','수량','예상 금액','링크','메모','상태'].forEach(t=>columns.append(el('span','',t)));content.append(columns);
  const active=essentials.filter(r=>r.progress!=='설치 끝'&&(tab==='all'||tab==='no'||r.decision!=='no'));
  drawZones(content,active);
  const finished=essentials.filter(r=>r.progress==='설치 끝');
  if(finished.length)bucket('finished','끝',finished,'준비를 마친 필수 항목이에요. 카드 단말기는 서류·신청 완료로 반영했어요.');
  const hidden=essentials.filter(r=>r.decision==='no'&&tab!=='all'&&tab!=='no');
  if(hidden.length)bucket('no','안 삼',hidden,'결정 “안 함”과 함께 표시해요. 기록은 남아 있어요.');
  if(later.length)bucket('later','나중에(필수 아님)',later,'오픈 당일 판매·결제·기본 포장에 꼭 필요하지 않은 장식·추가 도구·꾸밈 포장은 접었어요. 필요하면 필수로 올려 주세요.');
 }
 function bucket(id,label,rows,reason){const box=el('details','prep-bucket');box.dataset.prepBucket=id;box.open=openBuckets.has(id)||!!query;const title=el('summary','',label+' · '+rows.length+'줄');content.append(el('p','prep-bucket-reason',reason));box.append(title);box.addEventListener('toggle',()=>{if(box.isConnected)box.open?openBuckets.add(id):openBuckets.delete(id);});drawZones(box,rows);content.append(box);}
 function drawZones(container,filtered){
  const zones=[...new Set(filtered.map(r=>r.zone))];const order=['입구','중앙 테이블','벽면','레터 코너','상품 진열','포장','계산대','창고'];zones.sort((a,b)=>(order.includes(a)?order.indexOf(a):99)-(order.includes(b)?order.indexOf(b):99));
  zones.forEach(zone=>{const group=el('details','prep-group');group.open=!closedZones.has(zone);const sum=el('summary','',zone+' ');sum.append(el('span','',filtered.filter(r=>r.zone===zone).length));group.append(sum);group.addEventListener('toggle',()=>{if(group.isConnected)group.open?closedZones.delete(zone):closedZones.add(zone);});filtered.filter(r=>r.zone===zone).forEach(r=>group.append(card(r)));container.append(group);});
 }
 render();return {render,setLocked(){root.querySelectorAll('[data-prep-control]').forEach(n=>n.disabled=opts.isLocked());}};
};
})();
