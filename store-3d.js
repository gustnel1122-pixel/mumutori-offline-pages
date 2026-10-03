/* Mumutori interactive CSS 3D scene. Geometry is a proposal, not surveyed dimensions.
   All imagery and dependencies are served locally. Product cutouts were extracted
   without modification from the user's supplied reference HTML. */
(() => {
  'use strict';
  const mount = document.getElementById('store-3d');
  if (!mount) return;
  mount.innerHTML = `
    <div class="s3-toolbar" aria-label="공간 시점 선택">
      <div class="s3-presets"><button type="button" data-view="overview" aria-pressed="true">전체 공간</button><button type="button" data-view="front" aria-pressed="false">입구에서</button><button type="button" data-view="plan" aria-pressed="false">위에서</button><button type="button" data-view="letter" aria-pressed="false">편지 코너</button></div>
      <div class="s3-options"><label><input type="checkbox" data-option="facade"> 전면 간판</label><label><input type="checkbox" data-option="walls" checked> 벽 보기</label></div>
    </div>
    <div class="s3-viewport" tabindex="0" role="application" aria-label="무무토리 공간 3D 보기. 방향키로 회전, 더하기와 빼기로 확대 축소, Home으로 처음 시점. 마우스나 한 손가락으로 돌리고 두 손가락으로 확대할 수 있습니다." aria-describedby="s3-help">
      <div class="s3-grid"></div><div class="s3-world"><div class="s3-scene"></div></div>
      <div class="s3-badge">INTERACTIVE SPACE <span>01</span></div>
      <div class="s3-floating-note"><i></i>사진 기준 공간 제안 · 치수 미확정</div>
      <div class="s3-zoom" aria-label="확대 축소"><button type="button" data-action="in" aria-label="공간 확대">＋</button><button type="button" data-action="out" aria-label="공간 축소">−</button><button type="button" data-action="reset" aria-label="처음 시점으로 돌아가기">↺</button></div>
      <div class="s3-view-caption" aria-live="polite">전체 공간 · 좌우로 돌려보세요</div>
    </div>
    <div class="s3-under"><p id="s3-help"><strong>드래그해서 회전</strong> · 휠 / 두 손가락으로 확대 · 방향키로 시점 이동</p><span>기존 카운터 + 계단 유지</span></div>
    <div class="s3-legend"><span><i class="s3-dot s3-dot-butter"></i>버터 매대 3곳</span><span><i class="s3-dot s3-dot-pink"></i>사입 소품 16종</span><span><i class="s3-dot s3-dot-wood"></i>기존 결제 카운터</span><span><i class="s3-dot s3-dot-paper"></i>옆 벽 편지 코너</span></div>
    <details class="s3-assortment"><summary>매대에 놓인 상품 보기 <span>레퍼런스의 실제 판매 상품</span></summary><div class="s3-product-list"></div><p>상품 구성과 수량은 배치 예시입니다. 실제 사입 목록은 체크리스트에서 조정해 주세요.</p></details>`;
  const world = mount.querySelector('.s3-world');
  const scene = mount.querySelector('.s3-scene');
  const viewport = mount.querySelector('.s3-viewport');
  const state = {rx:-27, ry:27, zoom:1, fit:1, facade:false, walls:true};
  const billboardNodes = [];
  const $ = (tag, cls, parent=scene) => { const n=document.createElement(tag); n.className=cls; parent.appendChild(n); return n; };
  const place = (node,x,y,z,extra='') => { node.style.transform=`translate3d(${x}px,${-y}px,${z}px) ${extra}`; return node; };
  const face = (parent,cls,w,h,transform) => {const n=$('div',`s3-face ${cls}`,parent);Object.assign(n.style,{width:`${w}px`,height:`${h}px`,left:`${-w/2}px`,top:`${-h/2}px`,transform});return n;};
  function box(x,y,z,w,h,d,material='wood',extra='',parent=scene) {
    const n=place($('div',`s3-box s3-${material}`,parent),x,y,z,extra);
    face(n,'s3-front',w,h,`translateZ(${d/2}px)`);
    face(n,'s3-back',w,h,`rotateY(180deg) translateZ(${d/2}px)`);
    face(n,'s3-right',d,h,`rotateY(90deg) translateZ(${w/2}px)`);
    face(n,'s3-left',d,h,`rotateY(-90deg) translateZ(${w/2}px)`);
    face(n,'s3-top',w,d,`rotateX(90deg) translateZ(${h/2}px)`);
    face(n,'s3-bottom',w,d,`rotateX(-90deg) translateZ(${h/2}px)`);
    return n;
  }
  function plane(cls,x,y,z,w,h,extra='',text='',parent=scene) {
    const n=place($('div',`s3-plane ${cls}`,parent),x,y,z,extra);
    n.style.width=`${w}px`;n.style.height=`${h}px`;n.style.marginLeft=`${-w/2}px`;n.style.marginTop=`${-h/2}px`;n.textContent=text;return n;
  }
  function label(text,x,y,z,variant='') {const n=plane(`s3-label ${variant}`,x,y,z,118,25,'',text);billboardNodes.push({node:n,x,y,z});return n;}
  // The room is deliberately cut away: rear and right wall can be hidden for circulation review.
  box(0,-8,0,526,16,646,'foundation');
  box(0,1,0,510,4,630,'floor');
  const walls=$('div','s3-walls');
  box(0,141,-314,516,282,12,'wall','',walls);
  box(257,141,0,12,282,640,'wall','',walls);
  // A short rear-left wall frames the existing passage; the long left wall is cut away.
  box(-254,141,-230,10,282,174,'wall','',walls);
  plane('s3-passage',-193,83,-306,79,166,'','',walls);
  box(0,270,-305,510,35,7,'cream','',walls);
  box(247,270,0,7,35,616,'cream','',walls);
  for(let i=0;i<11;i++){
    plane('s3-trim-drop',-230+i*45,252-(i%3)*4,-300,13+(i%2)*6,17+(i%3)*8,'','',walls);
    plane('s3-trim-drop',242,252-(i%2)*7,-270+i*52,14,16+(i%3)*10,'rotateY(-90deg)','',walls);
  }
  // Existing wood / teal counter and the staircase are kept as a separate ensemble.
  box(20,43,-251,315,86,76,'counter');
  box(20,44,-211,295,62,3,'teal');
  box(20,91,-251,330,12,92,'darkwood');
  box(20,35,-207,8,73,8,'darkwood');
  for(const x of [-138,178]) box(x,43,-212,10,87,11,'darkwood');
  for(let i=0;i<11;i++)box(-109+i*25,243-i*14,-260,28,14,94,'stairs');
  plane('s3-stair-stringer',25,169,-207,303,180,'');
  box(22,229,-209,341,5,4,'rail','rotateZ(29deg)');
  for(let i=0;i<6;i++)box(-95+i*53,264-i*29.5,-209,4,58,4,'rail');
  // Familiar countertop fixtures: lamp, card terminal and bottles. Two low dark chairs.
  box(-94,112,-249,3,35,3,'brass');
  box(-94,103,-249,24,4,20,'brass');
  plane('s3-lampshade',-94,134,-249,31,24);
  box(78,107,-250,31,22,20,'black');
  plane('s3-terminal-screen',78,110,-238,23,12);
  for(let i=0;i<3;i++){box(24+i*13,111,-258,8,26,8,'bottle');box(24+i*13,129,-258,3,10,3,'darkwood');}
  for(const x of [-10,87]){
    box(x,62,-167,56,9,43,'black');box(x,89,-181,57,28,8,'black');
    for(const dx of [-21,21]) for(const dz of [-15,15])box(x+dx,31,-167+dz,5,58,5,'darkwood');
    box(x,23,-149,45,4,4,'brass');
  }
  label('기존 결제 카운터',20,151,-188,'s3-label-dark');
  // Three full rectangular butter blocks: matching top/base footprint, no legs or overhang.
  function butter(x,z,w,d,h) {
    box(x,h/2,z,w,h,d,'butter');
    box(x,15,z,w+.8,30,d+.8,'foil');
    for(let i=0;i<Math.ceil(w/35);i++){
      const xx=x-w/2+15+i*34;
      plane('s3-wrapper-fold',xx,30+(i%2)*2,z+d/2+.6,37,18,`rotateZ(${i%2?7:-7}deg)`);
      plane('s3-wrapper-fold',xx,29,z-d/2-.6,37,17,`rotateY(180deg) rotateZ(${i%2?-8:9}deg)`);
    }
    for(let i=0;i<Math.ceil(d/37);i++){
      plane('s3-wrapper-fold',x+w/2+.6,30,z-d/2+17+i*36,38,17,`rotateY(90deg) rotateZ(${i%2?6:-8}deg)`);
      plane('s3-wrapper-fold',x-w/2-.6,30,z-d/2+17+i*36,38,17,`rotateY(-90deg) rotateZ(${i%2?-9:7}deg)`);
    }
    for(let i=0;i<Math.ceil(w/64);i++){
      const len=22+(i%3)*13;
      plane('s3-butter-drip',x-w/2+23+i*60,h-len/2+1,z+d/2+1,12+(i%2)*5,len);
    }
    for(let i=0;i<Math.ceil(d/64);i++)plane('s3-butter-drip',x+w/2+1,h-14-(i%2)*6,z-d/2+23+i*62,12,30+(i%2)*13,'rotateY(90deg)');
    // Official logo is a modest wrapper detail, not printed on every displayed good.
    const logo=plane('s3-wrapper-logo',x+w*.29,18,z+d/2+1.8,21,21);
    const im=document.createElement('img');im.src='assets/brand-logo.png';im.alt='';im.loading='lazy';logo.appendChild(im);
  }
  butter(-11,49,226,142,82);
  butter(-213,12,64,226,72);
  butter(213,39,64,280,72);
  // Small display risers leave most of the butter top visible.
  box(-42,85,21,120,6,46,'paper');box(-209,75,-34,49,6,89,'paper');
  // Side-wall letter writing zone (not on the rear counter).
  box(211,81,121,42,14,31,'typewriter');
  box(211,85,106,42,14,8,'typewriter');
  box(211,81,136,41,5,18,'keyboard');
  plane('s3-letter-sheet',211,107,109,29,36,'rotateX(-8deg)');
  plane('s3-writing-paper',213,72.8,189,35,45,'rotateX(90deg)');
  box(231,75,185,2,2,29,'bottle');
  // Mailbox is mounted to the right wall, facing into the room.
  box(244,139,148,19,53,38,'paper');
  plane('s3-mailbox-face',233.5,141,148,35,45,'rotateY(-90deg)','POST');
  plane('s3-letter-sign',244,210,111,114,42,'rotateY(-90deg)','내일 보내는 편지',walls);
  label('편지 작성 · 우편함',204,172,202,'s3-label-letter');
  // Track lighting: slim rails rather than a roof, keeping the cutaway view readable.
  box(-218,282,-71,4,4,420,'rail');box(213,282,-65,4,4,440,'rail');
  for(const x of [-218,213])for(const z of [-232,-104,40,164]){
    box(x,271,z,3,20,3,'cream');box(x,257,z,14,15,18,'light','rotateX(-15deg)');
  }
  // Optional front glass frame and sign. Entrance stays on the left.
  const facade=$('div','s3-facade');
  for(const x of [-256,-123,256])box(x,139,320,7,278,7,'metal','',facade);
  box(0,278,320,521,12,12,'metal','',facade);box(0,7,321,519,9,8,'metal','',facade);
  box(-190,126,320,126,6,7,'metal','',facade);
  plane('s3-glass',67,139,320,371,267,'','',facade);
  plane('s3-glass',-190,192,320,124,153,'','',facade);
  plane('s3-facade-sign',0,305,322,503,44,'','mumutori',facade);
  plane('s3-door-word',-190,187,325,89,30,'','OPEN',facade);
  box(-139,112,326,3,26,5,'brass','',facade);
  // Entry marker and standing banner on the front right.
  plane('s3-entry-rug',-188,3,278,101,53,'rotateX(90deg)','어서 와요');
  box(222,48,351,3,90,3,'brass');box(222,3,351,48,5,30,'brass');
  plane('s3-standing-banner',222,74,354,50,80,'','작고 귀여운\n것들의 가게\n\nmumutori');
  const products=[['버터 스틱 말랑이',43],['딸기 동전지갑',44],['군고구마 펜던트',45],['마늘 키링',46],['머쉬룸 펜던트',47],['가지 동전지갑',48],['당근 동전지갑',49],['레몬 키링',50],['생강 키링',51],['고추 키링',52],['감자 키링',53],['토마토 카드 홀더',54],['노란 감자 동전지갑',55],['찹쌀 경단 동전지갑',56],['토스트 동전지갑',57],['식물 모양 키링',58]];
  const positions=[[-71,88,18,40],[-17,88,18,38],[36,82,21,37],[-63,82,76,37],[-12,82,75,39],[47,82,80,42],[-216,78,-57,35],[-211,78,-7,35],[-212,72,52,35],[-214,72,98,34],[211,72,-67,33],[213,72,-19,35],[208,72,32,35],[15,82,-2,30],[-218,72,-84,30],[68,82,36,32]];
  products.forEach(([name,num],i)=>{
    const [x,base,z,size]=positions[i];
    const item=plane('s3-product',x,base+size*.5,z,size,size);
    const img=document.createElement('img');img.src=`assets/products/ref-${num}.webp`;img.alt='';img.draggable=false;img.loading='lazy';item.appendChild(img);item.title=name;
    billboardNodes.push({node:item,x,y:base+size*.5,z});
    const card=$('figure','s3-product-card',mount.querySelector('.s3-product-list'));
    const photo=document.createElement('img');photo.src=img.src;photo.alt=name;photo.loading='lazy';card.appendChild(photo);
    const cap=document.createElement('figcaption');cap.textContent=name;card.appendChild(cap);
  });
  let scheduled=false;
  function render(){
    scheduled=false;
    world.style.transform=`translateY(10px) scale(${state.fit*state.zoom}) rotateX(${state.rx}deg) rotateY(${state.ry}deg) translateY(132px)`;
    billboardNodes.forEach(({node,x,y,z})=>place(node,x,y,z,`rotateY(${-state.ry}deg)`));
    mount.classList.toggle('s3-show-facade',state.facade);mount.classList.toggle('s3-hide-walls',!state.walls);
  }
  const draw=()=>{if(!scheduled){scheduled=true;requestAnimationFrame(render);}};
  const clamp=(n,min,max)=>Math.min(max,Math.max(min,n));
  function clearPreset(){mount.querySelectorAll('[data-view]').forEach(b=>b.setAttribute('aria-pressed','false'));mount.querySelector('.s3-view-caption').textContent='자유 시점';}
  function zoom(delta){state.zoom=clamp(state.zoom*delta,.55,2.1);draw();}
  const presets={overview:{rx:-27,ry:27,zoom:1,text:'전체 공간 · 좌우로 돌려보세요'},front:{rx:-12,ry:0,zoom:1.1,text:'입구에서 · 뒤쪽 계단과 카운터 유지'},plan:{rx:-83,ry:0,zoom:1.02,text:'위에서 · 중앙과 양옆 매대의 동선'},letter:{rx:-25,ry:43,zoom:1.2,text:'편지 코너 · 오른쪽 벽면 작성대와 우편함'}};
  function preset(name){Object.assign(state,presets[name]);mount.querySelectorAll('[data-view]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.view===name)));mount.querySelector('.s3-view-caption').textContent=presets[name].text;draw();}
  mount.querySelectorAll('[data-view]').forEach(b=>b.addEventListener('click',()=>preset(b.dataset.view)));
  mount.querySelectorAll('[data-option]').forEach(input=>input.addEventListener('change',()=>{state[input.dataset.option]=input.checked;draw();}));
  mount.querySelector('[data-action="in"]').addEventListener('click',()=>zoom(1.15));
  mount.querySelector('[data-action="out"]').addEventListener('click',()=>zoom(1/1.15));
  mount.querySelector('[data-action="reset"]').addEventListener('click',()=>preset('overview'));
  const pointers=new Map();let pinchDistance=0;
  const distance=()=>{const a=[...pointers.values()];return a.length===2?Math.hypot(a[0].x-a[1].x,a[0].y-a[1].y):0;};
  viewport.addEventListener('pointerdown',e=>{
    if(e.target.closest('button,input,label')||e.button>0)return;
    viewport.focus({preventScroll:true});pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});viewport.setPointerCapture(e.pointerId);pinchDistance=distance();viewport.classList.add('is-dragging');
  });
  viewport.addEventListener('pointermove',e=>{
    const old=pointers.get(e.pointerId);if(!old)return;
    pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
    if(pointers.size===2){const next=distance();if(pinchDistance)zoom(next/pinchDistance);pinchDistance=next;}
    else{state.ry+=(e.clientX-old.x)*.36;state.rx=clamp(state.rx-(e.clientY-old.y)*.25,-86,-5);draw();}
    clearPreset();
  });
  function end(e){pointers.delete(e.pointerId);pinchDistance=0;if(!pointers.size)viewport.classList.remove('is-dragging');}
  viewport.addEventListener('pointerup',end);viewport.addEventListener('pointercancel',end);viewport.addEventListener('lostpointercapture',end);
  viewport.addEventListener('wheel',e=>{if(document.activeElement!==viewport&&!e.ctrlKey)return;e.preventDefault();zoom(Math.exp(-e.deltaY*.0015));},{passive:false});
  viewport.addEventListener('keydown',e=>{
    if(e.target!==viewport)return;let handled=true;
    if(e.key==='ArrowLeft')state.ry-=8;else if(e.key==='ArrowRight')state.ry+=8;
    else if(e.key==='ArrowUp')state.rx=clamp(state.rx-6,-86,-5);else if(e.key==='ArrowDown')state.rx=clamp(state.rx+6,-86,-5);
    else if(e.key==='+'||e.key==='=')zoom(1.12);else if(e.key==='-')zoom(1/1.12);
    else if(e.key==='Home'){preset('overview');e.preventDefault();return;}else handled=false;
    if(handled){e.preventDefault();clearPreset();draw();}
  });
  const resize=()=>{state.fit=Math.min(viewport.clientWidth/805,viewport.clientHeight/635);draw();};
  new ResizeObserver(resize).observe(viewport);resize();
})();
