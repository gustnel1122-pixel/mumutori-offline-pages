(() => {
  'use strict';
  const references = `무무토리 오프라인 프로젝트를 이어서 수정해 줘.
프로젝트 페이지: ${location.origin}${location.pathname}
GitHub: https://github.com/gustnel1122-pixel/mumutori-offline-pages
최신 페이지 소스와 실제 게시 상태를 먼저 확인해 줘.
현재 홈페이지 https://mumutori.com 와 Drive ‘팔시보 스토어’ 실제 사진, 현행 공식 도토리 로고를 기준으로 삼아 줘. 중요한 변경과 진행 상태를 기록해 줘.`;
  const decisions = `반드시 유지할 확정 사항:
1. 후면 계단 아래는 카운터야. 그 위치의 기존 카운터와 집기는 그대로 유지해.
2. 기존 벽면 우드와 조명은 유지해. 우드 위 흰 벽에만 버터가 녹아 흐르다 멈춘 느낌의 페인트를 적용해.
3. 중앙 테이블과 벽면 진열 집기 모두 버터로 바꿔. 상판과 하단의 기본 외곽은 동일한 사각형이고, 누구나 한눈에 버터 덩어리로 알아보게 해.
4. 아래는 펼친 은색 버터 포장지, 위로 버터가 올라온 형태야. 버터가 옆면으로 녹아 흘러내리다 굳은 모습으로 만들어. 평평한 상판과 사각형 실루엣을 유지해. 다리형·물방울형 테이블로 바꾸지 마.
5. 카운터와 별도로 벽면 한쪽에 타자기·편지 작성 공간을 두고, 바로 옆에 우편함을 배치해.
6. 고객이 규격에 맞게 편지 작성 → 우편함 투입 → 기존 카운터 결제. 다음날 직원이 전량 수거·집계 → 타자기로 인쇄 → 우편으로 발송하는 서비스야.
7. 홍대·연남동의 따뜻한 소품상점 분위기. 정면·돌출간판은 크림·짙은 갈색·현행 도토리로 간격과 정렬을 통일하고 매장 앞 유리 밖에 스탠드 배너를 둬. 출입문과 주변 통로는 확보해.`;
  const boundaries = `확정하지 않은 것:
실측 치수·예산·오픈 날짜·재료·업체·상품 구색, 편지 용지 크기·글자 수·가격·집계 마감·휴무일·우편 서비스는 임의로 결정하지 말고 필요한 시점에 물어봐.
기존 임차인는 기존 임차인 지위를 유지해. 건물주 사용 동의 요청은 기존 임차인 담당이고 동의·사업자 주소 변경은 아직 완료되지 않았어. 
이미지는 디자인 제안이며 실측 도면이 아니야. 제안과 사용자 확정을 구분해. Notion은 사용하지 않아.`;
  const imageRules = `첨부한 실제 매장 원사진과 현재 시안을 함께 참고해. 창·출입문·계단·카운터·천장·우드·조명의 실제 구조를 보존해. 미확인 공간이나 치수를 사실처럼 만들지 마. 로고는 첨부한 현행 원본을 우선하고, 생성 이미지의 글자·로고를 바로 제작 원본으로 사용하지 않도록 표시해.`;
  const prompts = [
    {id:'project', title:'프로젝트 전체 이어서 수정', description:'결정 사항, 이미지, 체크리스트와 게시 상태까지 함께 이어갑니다.', text:`${references}\n\n${decisions}\n\n${boundaries}\n\n작업 요청:\n이번 변경을 실사 목업·같은 구조의 3D·집기 상세·외관, 페이지 설명·준비물·담당자·선행 작업에 일관되게 반영해 줘. 기존 체크·메모·브라우저 저장·JSON 백업 기능을 보존하고 실제 게시 상태를 확인해 줘. 기기 간 자동 동기화는 현재 작업 범위 밖이야. 완료하지 않은 작업을 완료로 표시하지 마. 수정용 프롬프트와 복사 버튼도 갱신해 줘. GitHub 반영과 실제 게시 결과를 각각 알려줘. 실제 고객 편지 본문·주소는 이 프로젝트 페이지에 저장하지 마.`},
    {id:'interior', title:'실제 사진 기반 실내 목업', description:'기존 카운터를 유지하고 중앙·벽면 버터 집기를 조정합니다.', text:`${imageRules}\n\n${decisions}\n\n따뜻한 실제 매장 사진처럼 생성해 줘. 중앙 버터의 사각 덩어리감과 은색 포장지, 벽면 집기, 별도 레터 코너·우편함이 읽히게 해. 진열 소품으로 버터 전체를 가리지 마. 실내 시안에서는 카운터와 편지 코너가 다른 위치라는 점이 명확해야 해.\n\n${boundaries}`},
    {id:'butter', title:'사각 버터 집기 상세', description:'상하단 사각형, 버터 몸체와 은색 포장지의 비율을 수정합니다.', text:`무무토리 소품상점의 버터 집기 상세 이미지를 만들어 줘. 현재 버터 테이블 시안을 첨부했어. 중앙 테이블과 벽면 콘솔에 같은 디자인 언어를 적용해.\n\n상판과 하단은 동일한 사각 외곽, 두꺼운 연한 노란색 버터 블록, 평평한 실용 진열면. 아래에는 펼쳐진 은색 버터 포장지, 위로 버터가 올라오고 옆면으로 녹아 흘러내리다 굳은 모습. 누구나 즉시 버터라고 알아보게 해. 은색 포장지의 접힘과 크림색 종이 가장자리, 작은 현행 도토리 포인트는 제안으로 반영해. 중앙 버터를 귀여운 소품으로 너무 많이 덮지 마.\n\n치수와 실제 재료는 아직 미정이야. 다리형·아메바형·물방울형 상판으로 바꾸지 마. 고품질 실사 제품 사진 같은 디자인 제안으로 보여줘.`},
    {id:'exterior', title:'간판·매장 앞 배너', description:'정면·돌출간판의 정렬과 매장 밖 배너를 함께 다듬습니다.', text:`${imageRules}\n\n팔시보 매장 실제 정면 사진과 최신 무무토리 외관 시안을 바탕으로 수정해 줘. 홍대·연남동 독립 소품상점의 따뜻하고 담백한 분위기. 크림 간판, 짙은 갈색 ‘무무토리’, 작은 ‘소품상점’, 현행 도토리 원본을 사용하고 기준선·자간·줄 간격·좌우 여백을 일관되게 맞춰. 정면과 돌출간판이 한 세트처럼 어울리게 해.\n\n스탠드 배너는 반드시 유리 밖 매장 앞, 입구 옆에 둬. 도토리와 ‘무무토리 소품상점’, ‘편지를 남기는 곳’ 정도로 간결하게 구성해. 왼쪽 출입문·차고·옆 통로를 가리지 마. 환기구와 실제 파사드 구조를 유지해. 유리 너머 중앙·벽면의 사각 버터 블록과 은색 포장지가 보이도록 해. 실제 설치 위치·규격·고정 방식은 실측 확인 전 제안이야.`},
    {id:'spatial', title:'같은 공간의 3D 이미지', description:'실내 목업과 같은 구조·가구·레터 동선을 유지합니다.', text:`${imageRules}\n\n${decisions}\n\n첨부한 실사 수정 시안과 같은 공간·같은 집기 디자인을 반영한 3D 이미지를 만들어 줘. 중앙 사각 버터 테이블, 벽면의 사각 버터 콘솔과 은색 포장지, 한쪽 벽의 타자기·작성면·인접 우편함, 후면 계단 아래 기존 카운터를 구분해 보여줘. 원사진의 비례와 공간을 따라가되 안 보이는 부분은 추정이라는 설명을 붙일 수 있게 해. 고객 작성→우편함→기존 카운터 결제 동선을 확보해. 실측 평면도나 시공 도면으로 표현하지 마.\n\n${boundaries}`}
  ];
  const cards = document.getElementById('prompt-cards');
  const status = document.getElementById('prompt-copy-status');
  const change = document.getElementById('prompt-change');
  if (!cards || !status || !change) return;
  const areas = new Map();
  prompts.forEach(prompt => {
    const article = document.createElement('article');
    const heading = document.createElement('h3'); heading.textContent = prompt.title;
    const description = document.createElement('p'); description.textContent = prompt.description;
    const details = document.createElement('details');
    const summary = document.createElement('summary'); summary.textContent = '프롬프트 펼쳐 보기';
    const area = document.createElement('textarea'); area.readOnly = true; area.rows = 9; area.value = prompt.text; area.setAttribute('aria-label', `${prompt.title} 프롬프트`);
    const button = document.createElement('button'); button.type = 'button'; button.className = 'button secondary'; button.dataset.copyPrompt = prompt.id; button.textContent = '프롬프트 복사';
    details.append(summary, area); article.append(heading, description, details, button); cards.append(article); areas.set(prompt.id, area);
  });
  async function copy(text) {
    if (navigator.clipboard && window.isSecureContext) {
      try { await navigator.clipboard.writeText(text); return true; } catch (_) { /* Try supported fallback. */ }
    }
    const area = document.createElement('textarea'); area.value = text; area.setAttribute('aria-label', '복사할 프롬프트'); area.style.cssText = 'position:fixed;left:0;top:0;opacity:0;pointer-events:none;'; document.body.append(area); area.focus(); area.select();
    let success = false;
    try { success = document.execCommand('copy'); } catch (_) { success = false; }
    area.remove(); return success;
  }
  document.addEventListener('click', async event => {
    const button = event.target.closest('[data-copy-prompt]');
    if (!button || button.disabled) return;
    const prompt = prompts.find(item => item.id === button.dataset.copyPrompt); if (!prompt) return;
    const extra = change.value.trim(); const value = prompt.text + (extra ? `\n\n이번 수정 요청:\n${extra}` : '');
    button.disabled = true;
    try {
      if (await copy(value)) {
        status.textContent = `‘${prompt.title}’ 프롬프트를 복사했습니다.${extra ? ' 입력한 수정 요청도 포함됐습니다.' : ''}`;
      } else {
        const area = areas.get(prompt.id); area.value = value; area.parentElement.open = true; area.focus(); area.select();
        status.textContent = '자동 복사가 허용되지 않아 텍스트를 선택했습니다. Ctrl+C 또는 ⌘C로 복사해 주세요.';
      }
    } finally { button.disabled = false; }
  });
})();
