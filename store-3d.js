/* Mumutori interactive software-rendered 3D scene. Geometry is a proposal, not surveyed dimensions.
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
      <div class="s3-grid"></div><canvas class="s3-canvas" aria-hidden="true"></canvas>
      <div class="s3-badge">INTERACTIVE SPACE <span>01</span></div>
      <div class="s3-floating-note"><i></i>사진 기준 공간 제안 · 치수 미확정</div>
      <div class="s3-zoom" aria-label="확대 축소"><button type="button" data-action="in" aria-label="공간 확대">＋</button><button type="button" data-action="out" aria-label="공간 축소">−</button><button type="button" data-action="reset" aria-label="처음 시점으로 돌아가기">↺</button></div>
      <div class="s3-view-caption" aria-live="polite">전체 공간 · 좌우로 돌려보세요</div>
    </div>
    <div class="s3-under"><p id="s3-help"><strong>드래그해서 회전</strong> · 휠 / 두 손가락으로 확대 · 방향키로 시점 이동</p><span>기존 카운터 + 계단 유지</span></div>
    <div class="s3-legend"><span><i class="s3-dot s3-dot-butter"></i>버터 매대 3곳</span><span><i class="s3-dot s3-dot-pink"></i>사입 소품 16종</span><span><i class="s3-dot s3-dot-wood"></i>기존 결제 카운터</span><span><i class="s3-dot s3-dot-paper"></i>옆 벽 편지 코너</span></div>
    <details class="s3-assortment"><summary>매대에 놓인 상품 보기 <span>레퍼런스의 실제 판매 상품</span></summary><div class="s3-product-list"></div><p>상품 구성과 수량은 배치 예시입니다. 실제 사입 목록은 체크리스트에서 조정해 주세요.</p></details>`;
  // One canvas draws all projected geometry. No CSS 3D compositor layers.
  const viewport = mount.querySelector('.s3-viewport');
  const canvas = mount.querySelector('.s3-canvas');
  const ctx = canvas.getContext('2d', {alpha:true});
  if (!ctx) { mount.querySelector('.s3-view-caption').textContent='이 브라우저에서는 공간 미리보기를 열 수 없습니다.'; return; }
  const scene = {group:'scene'};
  const shapes=[];
  const state = {rx:-27,ry:27,zoom:1,fit:1,facade:false,walls:true};
  const billboardNodes=[];
  let scheduled=false, width=1, height=1, pixelRatio=1;
  const textures=new Map();
  const $=(tag,cls,parent=scene)=>{
    if(parent.group) return {group:cls};
    const n=document.createElement(tag);n.className=cls;parent.appendChild(n);return n;
  };
  const radians=n=>n*Math.PI/180;
  function rotations(extra){return [...extra.matchAll(/rotate([XYZ])\((-?[\d.]+)deg\)/g)].map(m=>[m[1],radians(+m[2])]).reverse();}
  function rotate(p,list){let [x,y,z]=p;for(const [axis,a] of list){const c=Math.cos(a),s=Math.sin(a);if(axis==='X'){const ny=y*c-z*s;z=y*s+z*c;y=ny;}else if(axis==='Y'){const nx=x*c+z*s;z=-x*s+z*c;x=nx;}else{const nx=x*c-y*s;y=x*s+y*c;x=nx;}}return [x,y,z];}
  function transform(points,x,y,z,extra){const r=rotations(extra);return points.map(p=>{const q=rotate(p,r);return [q[0]+x,q[1]-y,q[2]+z];});}
  function normal(points){const a=points[0],b=points[1],c=points[2],u=b.map((v,i)=>v-a[i]),v=c.map((n,i)=>n-b[i]);const n=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]],l=Math.hypot(...n)||1;return n.map(v=>v/l);}
  function box(x,y,z,w,h,d,material='wood',extra='',parent=scene){
    const X=w/2,Y=h/2,Z=d/2;
    const faces=[
      ['front',w,h,[[-X,-Y,Z],[X,-Y,Z],[X,Y,Z],[-X,Y,Z]]],
      ['back',w,h,[[X,-Y,-Z],[-X,-Y,-Z],[-X,Y,-Z],[X,Y,-Z]]],
      ['right',d,h,[[X,-Y,Z],[X,-Y,-Z],[X,Y,-Z],[X,Y,Z]]],
      ['left',d,h,[[-X,-Y,-Z],[-X,-Y,Z],[-X,Y,Z],[-X,Y,-Z]]],
      ['top',w,d,[[-X,-Y,-Z],[X,-Y,-Z],[X,-Y,Z],[-X,-Y,Z]]],
      ['bottom',w,d,[[-X,Y,Z],[X,Y,Z],[X,Y,-Z],[-X,Y,-Z]]]
    ];
    const layer=material==='foundation'?-3:material==='floor'?-2:parent.group==='s3-walls'?-1:0;
    faces.forEach(([side,fw,fh,pts])=>{const points=transform(pts,x,y,z,extra);shapes.push({kind:'face',material,side,w:fw,h:fh,points,normal:normal(points),group:parent.group,layer});});
  }
  function plane(cls,x,y,z,w,h,extra='',text='',parent=scene){
    const n={kind:'plane',cls,x,y,z,w,h,text,points:transform([[-w/2,-h/2,0],[w/2,-h/2,0],[w/2,h/2,0],[-w/2,h/2,0]],x,y,z,extra),group:parent.group,layer:parent.group==='s3-walls'?-1:0};
    n.normal=normal(n.points);
    n.appendChild=img=>{n.image=img;img.loading='eager';img.addEventListener('load',draw);};
    shapes.push(n);return n;
  }
  function label(text,x,y,z,variant=''){const n=plane(`s3-label ${variant}`,x,y,z,118,25,'',text);billboardNodes.push({node:n,x,y,z});return n;}
  const colors={foundation:'#b8a590',floor:'#c79f72',wall:'#cfa96f',cream:'#eee4cd',counter:'#573e2a',darkwood:'#62442c',teal:'#315a52',stairs:'#ded1b9',rail:'#777669',black:'#37322c',brass:'#ad8652',bottle:'#67462f',butter:'#f4db87',foil:'#c7cbc5',paper:'#efe5cc',typewriter:'#dfd4b5',keyboard:'#494235',light:'#f6edd8',metal:'#738078',wood:'#bd986b'};
  const shade={top:1.07,front:1,right:.83,left:.91,back:.88,bottom:.74};
  function tint(hex,n){const v=parseInt(hex.slice(1),16);return `rgb(${Math.min(255,Math.round((v>>16)*n))},${Math.min(255,Math.round(((v>>8)&255)*n))},${Math.min(255,Math.round((v&255)*n))})`;}
  function path(c,pts){c.beginPath();c.moveTo(pts[0][0],pts[0][1]);for(let i=1;i<pts.length;i++)c.lineTo(pts[i][0],pts[i][1]);c.closePath();}
  function rounded(c,x,y,w,h,r){r=Math.min(r,w/2,h/2);c.beginPath();c.moveTo(x+r,y);c.lineTo(x+w-r,y);c.quadraticCurveTo(x+w,y,x+w,y+r);c.lineTo(x+w,y+h-r);c.quadraticCurveTo(x+w,y+h,x+w-r,y+h);c.lineTo(x+r,y+h);c.quadraticCurveTo(x,y+h,x,y+h-r);c.lineTo(x,y+r);c.quadraticCurveTo(x,y,x+r,y);c.closePath();}
  function makeTexture(shape){
    const key=[shape.kind,shape.material||shape.cls,shape.side||'',shape.w,shape.h,shape.text||''].join('|');
    if(textures.has(key))return textures.get(key);
    const t=document.createElement('canvas');t.width=Math.max(4,Math.ceil(shape.w*1.5));t.height=Math.max(4,Math.ceil(shape.h*1.5));const c=t.getContext('2d');c.scale(t.width/shape.w,t.height/shape.h);const w=shape.w,h=shape.h;
    const fill=v=>{c.fillStyle=v;c.fillRect(0,0,w,h);};
    const line=(x1,y1,x2,y2,color,lw=1)=>{c.strokeStyle=color;c.lineWidth=lw;c.beginPath();c.moveTo(x1,y1);c.lineTo(x2,y2);c.stroke();};
    const poly=(pts,color)=>{path(c,pts);c.fillStyle=color;c.fill();};
    const text=(str,size=10,color='#755235',x=w/2,y=h/2)=>{c.font=`600 ${size}px Pretendard, sans-serif`;c.fillStyle=color;c.textAlign='center';c.textBaseline='middle';c.fillText(str,x,y,w-5);};
    const gradient=(a,b)=>{const g=c.createLinearGradient(0,0,w,h);g.addColorStop(0,a);g.addColorStop(1,b);return g;};
    if(shape.kind==='face'){
      const m=shape.material;fill(colors[m]||colors.wood);
      if(m==='floor'){
        fill(gradient('#d8b184','#bb8c63'));
        for(let y=0;y<h;y+=39){line(0,y,w,y,'#79543138',.8);for(let x=(Math.floor(y/39)%3)*58;x<w;x+=174)line(x,y,x,Math.min(h,y+39),'#85592e2b',.6);}
        for(let y=3;y<h;y+=4)line(0,y,w,y,'#f4d9b21e',.8);
      } else if(m==='wall'){
        fill(gradient('#d4b17c','#c3975a'));
        for(let x=0;x<w;x+=56)line(x,0,x,h,'#865c343b',.7);
        for(let x=4;x<w;x+=5)line(x,0,x+Math.sin(x)*2,h,'#83572012',.7);
      } else if(m==='counter'||m==='darkwood'){
        for(let x=0;x<w;x+=7)line(x,0,x,h,'#31211520',.8);
      } else if(m==='butter'){
        fill(gradient(shape.side==='top'?'#ffeeb0':'#ffe6a0',shape.side==='top'?'#f1d383':'#edce73'));
        c.strokeStyle='#fff1b5';c.lineWidth=2;c.strokeRect(1,1,w-2,h-2);
      } else if(m==='foil'){
        fill('#c0c7c1');
        const tones=['#dce1d9','#a9b1aa','#eef0e9','#99a49c','#c8ceca','#e5e8df'];
        for(let y=0;y<h;y+=17)for(let x=0;x<w;x+=27){const i=Math.round(x/27+y/17);poly([[x,y],[x+28,y+1],[x+11,y+18]],tones[i%6]);poly([[x+28,y+1],[x+28,y+18],[x+11,y+18]],tones[(i+2)%6]);line(x,y,x+11,y+18,'#ffffff70',.5);}
      } else if(m==='keyboard'&&shape.side==='top'){
        for(let y=3;y<h;y+=6)for(let x=3;x<w;x+=6){c.fillStyle='#e6dac0';c.beginPath();c.arc(x,y,1.8,0,Math.PI*2);c.fill();}
      }
      const f=shade[shape.side]||1;if(f<1){c.fillStyle=`rgba(0,0,0,${1-f})`;c.fillRect(0,0,w,h);}else{c.fillStyle='rgba(255,255,245,.1)';c.fillRect(0,0,w,h);}
    } else {
      const cls=shape.cls;
      if(cls==='s3-trim-drop'||cls==='s3-butter-drip'){
        const g=c.createLinearGradient(0,0,w,0);g.addColorStop(0,'#e8c269');g.addColorStop(.5,'#fce6a4');g.addColorStop(1,'#edcc77');rounded(c,.8,-7,w-1.6,h+6,w/2);c.fillStyle=g;c.fill();c.strokeStyle='#cda23d50';c.lineWidth=.7;c.stroke();
      }else if(cls==='s3-wrapper-fold'){
        const pts=[[0,h*.31],[w*.24,1],[w*.56,h*.51],[w*.84,0],[w,h*.46],[w*.93,h],[w*.65,h*.69],[w*.26,h]];poly(pts,'#ecebdb');poly([[0,h*.31],[w*.56,h*.51],[w*.26,h]],'#b8c1bb');poly([[w*.56,h*.51],[w,h*.46],[w*.93,h]],'#eef0e7');line(w*.24,1,w*.56,h*.51,'#ffffed',1);
      }else if(cls==='s3-stair-stringer'){
        poly([[0,0],[w,h*.87],[w,h],[0,h*.12]],'#b8a481');line(0,1,w,h*.87,'#867452',2);
      }else if(cls==='s3-passage'){
        fill(gradient('#aab5b0','#74847e'));c.strokeStyle='#a47d4f';c.lineWidth=9;c.strokeRect(0,0,w,h);line(0,h*.7,w,h*.7,'#c7d0c6',3);
      }else if(cls==='s3-lampshade')poly([[w*.23,0],[w*.77,0],[w,h],[0,h]],gradient('#caba8c','#fae9b4'));
      else if(cls==='s3-terminal-screen'){fill('#a9b5a0');c.strokeStyle='#292f28';c.lineWidth=3;c.strokeRect(0,0,w,h);}
      else if(cls==='s3-letter-sheet'||cls==='s3-writing-paper'){
        fill('#fffaf0');c.strokeStyle='#d5c9ac';c.lineWidth=.8;c.strokeRect(0,0,w,h);for(let y=8;y<h-5;y+=6)line(5,y,w-5,y,'#cbb993',.7);
      }else if(cls==='s3-mailbox-face'){
        fill('#eee0bb');c.strokeStyle='#8e7350';c.lineWidth=2;c.strokeRect(1,1,w-2,h-2);c.fillStyle='#514531';c.fillRect(4,8,w-8,4);text('POST',7,'#826239',w/2,h*.75);
      }else if(cls==='s3-letter-sign'){fill('#fcf5e0');c.strokeStyle='#b1a28b';c.lineWidth=1;c.strokeRect(0,0,w,h);text(shape.text,10);}
      else if(cls==='s3-glass'){fill(gradient('#b9d3cd08','#effff31f'));line(w*.2,0,w*.8,h,'#ffffff55',2);}
      else if(cls==='s3-facade-sign'){fill('#f7edcf');c.strokeStyle='#93774b';c.lineWidth=2;c.strokeRect(1,1,w-2,h-2);c.font='bold 28px Georgia,serif';c.fillStyle='#6b452b';c.textAlign='center';c.textBaseline='middle';c.fillText('mumutori',w/2,h/2);}
      else if(cls==='s3-door-word')text('OPEN',17);
      else if(cls==='s3-entry-rug'){fill('#dfbc73');c.strokeStyle='#ad884c';c.lineWidth=2;c.strokeRect(1,1,w-2,h-2);text(shape.text,12);}
      else if(cls==='s3-standing-banner'){fill('#fff2b5');c.strokeStyle='#c7a968';c.strokeRect(.5,.5,w-1,h-1);shape.text.split('\n').forEach((s,i)=>text(s,7,'#6d4930',w/2,14+i*13));}
    }
    textures.set(key,t);return t;
  }
  function texturedTriangle(image,src,dst){
    const [a,b,c]=src,[A,B,C]=dst,det=(b[0]-a[0])*(c[1]-a[1])-(c[0]-a[0])*(b[1]-a[1]);if(Math.abs(det)<.0001)return;
    const aa=((B[0]-A[0])*(c[1]-a[1])-(C[0]-A[0])*(b[1]-a[1]))/det;
    const bb=((B[1]-A[1])*(c[1]-a[1])-(C[1]-A[1])*(b[1]-a[1]))/det;
    const cc=((C[0]-A[0])*(b[0]-a[0])-(B[0]-A[0])*(c[0]-a[0]))/det;
    const dd=((C[1]-A[1])*(b[0]-a[0])-(B[1]-A[1])*(c[0]-a[0]))/det;
    ctx.save();path(ctx,dst);ctx.clip();ctx.transform(aa,bb,cc,dd,A[0]-aa*a[0]-cc*a[1],A[1]-bb*a[0]-dd*a[1]);ctx.drawImage(image,0,0);ctx.restore();
  }
  function imageQuad(image,p){const w=image.naturalWidth||image.width,h=image.naturalHeight||image.height;if(!w||!h)return;texturedTriangle(image,[[0,0],[w,0],[w,h]],[p[0],p[1],p[2]]);texturedTriangle(image,[[0,0],[w,h],[0,h]],[p[0],p[2],p[3]]);}
  const textured=new Set(['floor','wall','counter','darkwood','butter','foil','keyboard']);
  function render(){
    scheduled=false;if(!width||!height)return;
    ctx.setTransform(pixelRatio,0,0,pixelRatio,0,0);ctx.clearRect(0,0,width,height);ctx.imageSmoothingEnabled=true;
    const camera=[['Y',radians(state.ry)],['X',radians(state.rx)]],scale=state.fit*state.zoom;
    const view=p=>rotate([p[0],p[1]+132,p[2]],camera);
    const project=q=>{const k=1900/(1900-q[2]*scale);return [width/2+q[0]*scale*k,height/2-20+q[1]*scale*k,q[2],scale*k];};
    const records=[];
    for(const s of shapes){
      if(s.group==='s3-walls'&&!state.walls||s.group==='s3-facade'&&!state.facade)continue;
      const isSprite=s.cls==='s3-product'||s.cls?.includes('s3-label');
      if(isSprite){const p=project(view([s.x,-s.y,s.z]));records.push({s,p,z:p[2],layer:s.cls.includes('s3-label')?2:1});continue;}
      const n=rotate(s.normal,camera);
      if(n[2]<.015)continue;
      const p=s.points.map(v=>project(view(v)));
      records.push({s,p,z:p.reduce((a,v)=>a+v[2],0)/4,layer:s.layer});
    }
    records.sort((a,b)=>a.layer-b.layer||a.z-b.z);
    // A soft contact shadow anchors the miniature on the cream viewing surface.
    ctx.save();const shadow=project(view([0,14,20]));ctx.translate(shadow[0],shadow[1]+18*scale);ctx.scale(1,.27);const g=ctx.createRadialGradient(0,0,30*scale,0,0,380*scale);g.addColorStop(0,'#73552a22');g.addColorStop(1,'#73552a00');ctx.fillStyle=g;ctx.fillRect(-430*scale,-430*scale,860*scale,860*scale);ctx.restore();
    for(const r of records){const {s,p}=r;
      if(s.cls==='s3-product'){
        if(s.image?.complete&&s.image.naturalWidth){const k=p[3],iw=s.w*k,ih=s.h*k;ctx.drawImage(s.image,p[0]-iw/2,p[1]-ih/2,iw,ih);}continue;
      }
      if(s.cls?.includes('s3-label')){
        const k=Math.max(.55,p[3]),w=s.w*k,h=s.h*k;rounded(ctx,p[0]-w/2,p[1]-h/2,w,h,h/2);const dark=s.cls.includes('s3-label-dark');ctx.fillStyle=dark?'#634b39ee':'#fff6dfee';ctx.fill();ctx.strokeStyle='#ab97714d';ctx.lineWidth=.7;ctx.stroke();ctx.fillStyle=dark?'#fff4dc':'#795b39';ctx.font=`600 ${Math.max(8,9*k)}px Pretendard,sans-serif`;ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(s.text,p[0],p[1],w-8);continue;
      }
      if(s.image){if(s.image.complete&&s.image.naturalWidth)imageQuad(s.image,p);continue;}
      if(s.kind==='face'){
        path(ctx,p);ctx.fillStyle=tint(colors[s.material]||colors.wood,shade[s.side]||1);ctx.fill();
        if(textured.has(s.material)&&(s.w*s.h>450||s.material==='keyboard'))imageQuad(makeTexture(s),p);
        ctx.strokeStyle='#654c2d18';ctx.lineWidth=.55;ctx.stroke();
      }else imageQuad(makeTexture(s),p);
    }
    canvas.dataset.view=`${state.rx.toFixed(1)},${state.ry.toFixed(1)},${state.zoom.toFixed(2)}`;
    canvas.dataset.faces=String(records.length);
  }
  function draw(){if(!scheduled){scheduled=true;requestAnimationFrame(render);}}
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
    // The yellow body starts above the foil, avoiding intersecting volumes.
    box(x,(h+30)/2,z,w,h-30,d,'butter');
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
  const clamp=(n,min,max)=>Math.min(max,Math.max(min,n));
  function clearPreset(){mount.querySelectorAll('[data-view]').forEach(b=>b.setAttribute('aria-pressed','false'));mount.querySelector('.s3-view-caption').textContent='자유 시점';}
  function zoom(delta){state.zoom=clamp(state.zoom*delta,.55,2.1);draw();}
  const presets={overview:{rx:-27,ry:27,zoom:1,text:'전체 공간 · 좌우로 돌려보세요'},front:{rx:-12,ry:0,zoom:1.1,text:'입구에서 · 뒤쪽 계단과 카운터 유지'},plan:{rx:-83,ry:0,zoom:.9,text:'위에서 · 중앙과 양옆 매대의 동선'},letter:{rx:-25,ry:43,zoom:1.1,text:'편지 코너 · 오른쪽 벽면 작성대와 우편함'}};
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
  const resize=()=>{
    width=viewport.clientWidth;height=viewport.clientHeight;pixelRatio=Math.min(window.devicePixelRatio||1,1.5);
    canvas.width=Math.round(width*pixelRatio);canvas.height=Math.round(height*pixelRatio);
    state.fit=Math.min(width/805,height/770);draw();
  };
  new ResizeObserver(resize).observe(viewport);resize();
})();
