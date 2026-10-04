/* Shared opening budget. Persistence belongs to the planner's existing state/cloud adapter. */
(function () {
  'use strict';
  const STAGES = { startup: '오픈 전', monthly: '매월', reversal: '팔시보 전환 시' };
  const money = value => Number.isFinite(value) ? Math.round(value).toLocaleString('ko-KR') + '원' : '미확정';
  const number = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
  const own = (value, key) => Object.prototype.hasOwnProperty.call(value || {}, key);
  const clone = value => JSON.parse(JSON.stringify(value));
  const create = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const safeURL = value => {
    try { const url = new URL(value, document.baseURI); return ['http:', 'https:'].includes(url.protocol) ? url.href : ''; }
    catch (_) { return ''; }
  };
  function normaliseBudget(value) {
    const source = value && typeof value === 'object' ? value : {};
    return { items: clone(source.items || {}), selections: clone(source.selections || {}), assumptions: clone(source.assumptions || {}) };
  }
  function combineRows(data, inventory, budget) {
    const rows = (Array.isArray(data.items) ? data.items : []).map(item => ({ ...item }));
    const linked = new Set(rows.flatMap(row => [row.inventoryId, row.id, ...(Array.isArray(row.inventoryIds) ? row.inventoryIds : [])]).filter(Boolean));
    (Array.isArray(inventory) ? inventory : []).forEach(item => {
      if (!linked.has(item.id)) rows.push({
        id: 'unpriced-' + item.id, inventoryId: item.id, name: item.name, category: item.category,
        stage: 'startup', quantity: null, unit: '개 / 식', low: null, base: null, high: null,
        note: '준비물 목록에 있는 항목입니다. 중복 항목인지 확인한 뒤 예산 수량과 단가를 입력해 주세요.',
        vat: '미확인', shipping: '미확인', sourceLabel: '견적 필요', costNature: 'setup',
      });
    });
    const groups = new Map((data.groups || []).map(group => [group.id, group]));
    return rows.map(row => {
      const override = budget.items[row.id] || {};
      const quantity = number(override.quantity !== null && own(override, 'quantity') ? override.quantity : row.quantity);
      const custom = own(override, 'unitCost') && override.unitCost !== null;
      const unitCost = custom ? number(override.unitCost) : number(row.base);
      const low = custom ? unitCost : number(row.low);
      const high = custom ? unitCost : number(row.high);
      const group = groups.get(row.group);
      const selection = group ? (own(budget.selections, group.id) ? budget.selections[group.id] : group.defaultOption || '') : '';
      const activeOption = !group || selection === row.option;
      const included = typeof override.included === 'boolean' ? override.included : row.included !== false;
      const stage = own(STAGES, row.stage) ? row.stage : 'startup';
      return { ...row, stage, quantity, unitCost, low, high, included, activeOption, custom,
        paid: number(override.paid), active: included && activeOption,
        amount: quantity === 0 ? 0 : quantity !== null && unitCost !== null ? quantity * unitCost : null,
        lowAmount: quantity === 0 ? 0 : quantity !== null && low !== null ? quantity * low : null,
        highAmount: quantity === 0 ? 0 : quantity !== null && high !== null ? quantity * high : null };
    });
  }
  function sumRows(rows) {
    const active = rows.filter(row => row.active);
    return active.reduce((total, row) => ({
      base: total.base + (row.amount === null ? 0 : row.amount),
      low: total.low + (row.lowAmount === null ? 0 : row.lowAmount),
      high: total.high + (row.highAmount === null ? 0 : row.highAmount),
      missing: total.missing + (row.amount === null ? 1 : 0),
      rangeMissing: total.rangeMissing + (row.lowAmount === null || row.highAmount === null ? 1 : 0),
      paid: total.paid + (row.paid || 0), count: total.count + 1,
    }), { base: 0, low: 0, high: 0, missing: 0, rangeMissing: 0, paid: 0, count: 0 });
  }
  function calculate(data, inventory, rawBudget) {
    const budget = normaliseBudget(rawBudget);
    const rows = combineRows(data, inventory, budget);
    const byStage = {};
    Object.keys(STAGES).forEach(stage => { byStage[stage] = sumRows(rows.filter(row => row.stage === stage)); });
    const setup = sumRows(rows.filter(row => row.stage === 'startup' && !['stock', 'deposit'].includes(row.costNature)));
    const workingCapital = sumRows(rows.filter(row => row.stage === 'startup' && ['stock', 'deposit'].includes(row.costNature)));
    const pendingGroups = (data.groups || []).filter(group => {
      const selection = own(budget.selections, group.id) ? budget.selections[group.id] : group.defaultOption || '';
      return !(group.options || []).some(option => option.id === selection);
    });
    const values = {};
    ['rent', 'otherFixed', 'monthlySales', 'cogsPercent', 'cardPercent', 'otherVariablePercent', 'operatingDays'].forEach(key => {
      values[key] = number(budget.assumptions[key]);
    });
    const ratesReady = ['cogsPercent', 'cardPercent', 'otherVariablePercent'].every(key => values[key] !== null);
    const margin = ratesReady ? 1 - (values.cogsPercent + values.cardPercent + values.otherVariablePercent) / 100 : null;
    const fixed = values.rent !== null && values.otherFixed !== null ? byStage.monthly.base + values.rent + values.otherFixed : null;
    const fixedReady = fixed !== null && byStage.monthly.missing === 0;
    const monthlyBEP = fixedReady && margin > 0 ? fixed / margin : null;
    const recoveryReady = setup.missing === 0 && pendingGroups.length === 0;
    const threeMonthTarget = monthlyBEP !== null && recoveryReady ? (setup.base + fixed * 3) / margin : null;
    const operatingProfit = fixedReady && margin !== null && values.monthlySales !== null ? values.monthlySales * margin - fixed : null;
    return { rows, byStage, setup, workingCapital, pendingGroups, values, margin, fixed,
      monthlyBEP, threeMonthTarget, operatingProfit,
      dailyBEP: monthlyBEP !== null && values.operatingDays > 0 ? monthlyBEP / values.operatingDays : null,
      dailyRecovery: threeMonthTarget !== null && values.operatingDays > 0 ? threeMonthTarget / 3 / values.operatingDays : null };
  }

  function createOfflineBudget(options) {
    const root = options.element || document.getElementById('budget-dashboard');
    if (!root) return { render() {}, setLocked() {}, destroy() {} };
    let locked = false;
    let filter = 'all';
    let query = '';
    let destroyed = false;
    let editStatus = '';
    const isLocked = () => locked || (typeof options.isLocked === 'function' && options.isLocked());
    const data = () => options.data || window.OFFLINE_COST_DATA || { items: [], groups: [] };
    const inventory = () => typeof options.getInventory === 'function' ? options.getInventory() : [];
    const currentBudget = () => normaliseBudget(typeof options.getBudget === 'function' ? options.getBudget() : {});
    const mutate = change => {
      if (isLocked() || typeof options.onChangeBudget !== 'function') return;
      const next = currentBudget();
      change(next);
      try {
        const result = options.onChangeBudget(next);
        editStatus = result === false ? '저장하지 못했습니다. 상단 저장 상태를 확인해 주세요.' : '예산 변경을 반영했습니다. 공유 저장 상태는 상단에서 확인하세요.';
      } catch (error) { editStatus = '예산을 저장하지 못했습니다. 입력값과 상단 저장 상태를 확인해 주세요.'; }
      requestAnimationFrame(render);
    };
    function numberInput(labelText, value, onChange, options = {}) {
      const label = create('label', 'budget-field');
      label.append(create('span', '', labelText));
      const input = create('input');
      input.type = 'number'; input.min = '0'; input.max = String(options.max || 10000000000);
      input.step = options.step || '1'; input.inputMode = 'decimal'; input.value = value === null || value === undefined ? '' : String(value);
      input.placeholder = options.placeholder || '미확정'; input.disabled = isLocked();
      input.setAttribute('aria-label', options.ariaLabel || labelText);
      input.dataset.budgetFocus = options.ariaLabel || labelText;
      input.addEventListener('change', () => {
        const raw = input.value.trim();
        const parsed = raw === '' ? null : Number(raw);
        if (parsed !== null && (!Number.isFinite(parsed) || parsed < 0 || parsed > Number(input.max))) {
          input.setCustomValidity('0 이상 ' + Number(input.max).toLocaleString('ko-KR') + ' 이하로 입력해 주세요.');
          input.reportValidity(); return;
        }
        input.setCustomValidity('');
        if (!input.checkValidity()) { input.reportValidity(); return; }
        onChange(parsed);
      });
      label.append(input);
      if (options.hint) label.append(create('small', '', options.hint));
      return label;
    }
    function sourceLink(parent, label, url) {
      const safe = safeURL(url);
      if (!safe) { parent.append(create('span', '', label || '출처 / 견적 확인 필요')); return; }
      const link = create('a', '', label || '가격 근거 보기'); link.href = safe; link.target = '_blank'; link.rel = 'noopener noreferrer'; parent.append(link);
    }
    function amountCard(label, value, note, className) {
      const card = create('article', 'budget-stat ' + (className || ''));
      card.append(create('p', 'budget-stat-label', label), create('strong', '', money(value)), create('p', 'budget-stat-note', note));
      return card;
    }
    function totalNote(total) {
      if (total.count === 0) return '선택된 항목 없음';
      return total.count + '개 항목' + (total.missing ? ' · 미확정 ' + total.missing + '개 제외한 소계' : ' · 선택된 수량 기준') +
        (total.rangeMissing === 0 ? ' · 범위 ' + money(total.low) + '–' + money(total.high) : ' · 범위 미확정 항목 있음');
    }
    function renderGroups(parent, result, budget) {
      if (!(data().groups || []).length) return;
      const section = create('div', 'budget-choices');
      section.append(create('h3', '', '먼저 방식을 선택하세요'), create('p', 'budget-description', '외벽과 버터 테이블은 선택한 안 하나만 합계에 들어갑니다. 결정 전인 안은 비용이 빠져 있으므로 총예산이 아직 완성되지 않습니다.'));
      (data().groups || []).forEach(group => {
        const fieldset = create('fieldset', 'budget-choice-group');
        fieldset.append(create('legend', '', group.title));
        const selected = own(budget.selections, group.id) ? budget.selections[group.id] : group.defaultOption || '';
        const list = create('div', 'budget-choice-options');
        const variants = [{ id: '', label: '결정 전', note: '비교 후 선택 · 현재 합계에서 제외' }, ...(group.options || [])];
        variants.forEach(option => {
          const label = create('label', 'budget-choice' + (selected === option.id ? ' is-selected' : ''));
          const input = create('input'); input.type = 'radio'; input.name = 'budget-choice-' + group.id; input.value = option.id;
          input.checked = selected === option.id; input.disabled = isLocked();
          input.addEventListener('change', () => mutate(next => { next.selections[group.id] = option.id; }));
          const content = create('span'); content.append(create('strong', '', option.label));
          if (option.id) {
            const optionRows = result.rows.filter(row => row.group === group.id && row.option === option.id).map(row => ({ ...row, active: row.included }));
            const initial = sumRows(optionRows.filter(row => row.stage === 'startup'));
            const reversal = sumRows(optionRows.filter(row => row.stage === 'reversal'));
            content.append(create('span', 'budget-option-cost', '오픈 전 ' + money(initial.base) + (initial.missing ? ' + 미확정 ' + initial.missing + '개' : '')));
            if (reversal.count) content.append(create('small', '', '전환 시 ' + money(reversal.base) + (reversal.missing ? ' + 미확정' : '')));
          }
          if (option.note) content.append(create('small', '', option.note));
          label.append(input, content); list.append(label);
        });
        fieldset.append(list); section.append(fieldset);
      });
      parent.append(section);
    }
    function renderRow(row) {
      const article = create('article', 'budget-row' + (!row.included ? ' is-excluded' : ''));
      article.dataset.budgetId = row.id;
      const intro = create('div', 'budget-item-intro');
      const check = create('input'); check.type = 'checkbox'; check.checked = row.included; check.disabled = isLocked();
      check.setAttribute('aria-label', row.name + ' 예산에 포함');
      check.addEventListener('change', () => mutate(next => { next.items[row.id] = { ...next.items[row.id], included: check.checked }; }));
      const heading = create('div');
      heading.append(create('h4', '', row.name), create('p', 'budget-item-meta', [STAGES[row.stage], row.category, row.costNature === 'stock' ? '상품 재고' : row.costNature === 'deposit' ? '반환 예정 보증금' : '', row.inventoryId || row.inventoryIds?.length ? '준비물 연결' : ''].filter(Boolean).join(' · ')));
      intro.append(check, heading);
      const amount = create('div', 'budget-item-total'); amount.append(create('span', '', '품목 합계'), create('strong', '', row.included ? money(row.amount) : '제외'));
      intro.append(amount); article.append(intro);
      const inputs = create('div', 'budget-item-inputs');
      inputs.append(numberInput('예산 수량 (' + (row.unit || '개') + ')', row.quantity, value => mutate(next => { next.items[row.id] = { ...next.items[row.id], quantity: value }; }), { step: 'any', max: 1000000, ariaLabel: row.name + ' 예산 수량', hint: '비우면 조사 기준 수량으로 복원' }));
      inputs.append(numberInput('단가 (원)', row.unitCost, value => mutate(next => { next.items[row.id] = { ...next.items[row.id], unitCost: value }; }), { ariaLabel: row.name + ' 단가', hint: row.custom ? '직접 입력한 견적 · 비우면 조사값 복원' : '조사 기준값 · 직접 수정 가능' }));
      inputs.append(numberInput('이미 지출한 금액 (원)', row.paid, value => mutate(next => { next.items[row.id] = { ...next.items[row.id], paid: value }; }), { ariaLabel: row.name + ' 이미 지출한 금액', hint: '품목 전체의 지출액' }));
      article.append(inputs);
      const details = create('details', 'budget-source');
      const range = row.low !== null && row.high !== null ? money(row.low) + '–' + money(row.high) + ' / ' + (row.unit || '개') : '수량 또는 단가 견적 필요';
      details.append(create('summary', '', '가격 근거 · ' + range));
      const meta = create('p', '', '부가세 ' + (row.vat || '미확인') + ' · 배송 / 설치 ' + (row.shipping || '미확인') + ' · 확인일 ' + (row.asOf || data().asOf || '미기록'));
      details.append(meta);
      if (row.note) details.append(create('p', '', row.note));
      const sources = create('div', 'budget-source-links');
      sourceLink(sources, row.sourceLabel, row.sourceUrl);
      (row.sources || []).forEach(source => sourceLink(sources, source.label || source.title, source.url));
      details.append(sources);
      if (row.custom) {
        const reset = create('button', 'budget-link-button', '조사 단가로 되돌리기'); reset.type = 'button'; reset.disabled = isLocked();
        reset.addEventListener('click', () => mutate(next => { const entry = { ...next.items[row.id] }; delete entry.unitCost; next.items[row.id] = entry; }));
        details.append(reset);
      }
      article.append(details);
      return article;
    }
    function renderCosts(parent, result) {
      const area = create('div', 'budget-cost-list');
      const toolbar = create('div', 'budget-toolbar');
      const label = create('label', 'budget-search'); label.append(create('span', '', '준비물과 비용 검색'));
      const search = create('input'); search.type = 'search'; search.placeholder = '품목명 / 분류'; search.value = query;
      const list = create('div', 'budget-item-list');
      const count = create('p', 'budget-description');
      function paintRows() {
        const matches = result.rows.filter(row => row.activeOption && (filter === 'all' || row.stage === filter || filter === 'unknown' && row.amount === null) &&
          (!query || [row.name, row.category].join(' ').toLocaleLowerCase('ko').includes(query.toLocaleLowerCase('ko'))));
        list.replaceChildren(); matches.forEach(row => list.append(renderRow(row)));
        count.textContent = matches.length + '개 표시 · 수량은 예산 계산용입니다. 준비물의 규격 메모와 별도로 입력합니다.';
        if (!matches.length) list.append(create('p', 'budget-empty', '선택한 조건에 맞는 항목이 없습니다.'));
      }
      search.addEventListener('input', () => { query = search.value; paintRows(); }); label.append(search); toolbar.append(label);
      const tabs = create('div', 'budget-stage-tabs');
      [['all', '전체'], ['startup', '오픈 전'], ['monthly', '매월'], ['reversal', '전환 비용'], ['unknown', '미확정']].forEach(([key, title]) => {
        const button = create('button', '', title); button.type = 'button'; button.setAttribute('aria-pressed', String(filter === key));
        button.addEventListener('click', () => { filter = key; tabs.querySelectorAll('button').forEach(other => other.setAttribute('aria-pressed', String(other === button))); paintRows(); }); tabs.append(button);
      });
      toolbar.append(tabs); area.append(create('h3', '', '품목별 예산'), toolbar, count, list); parent.append(area); paintRows();
    }
    function renderBEP(parent, result) {
      const section = create('div', 'budget-bep');
      section.append(create('p', 'budget-kicker', '3개월 실험 · 매달 확인'), create('h3', '', '월 손익분기와 초기비 회수는 다릅니다'),
        create('p', 'budget-description', '3개월 안에 운영 방향을 판단합니다. 월 운영비를 매출로 충당하는 목표와, 초기 제작비까지 3개월 안에 회수하는 목표를 따로 확인하세요.'));
      const fields = create('div', 'budget-assumptions');
      [
        ['rent', '월 공간대여료 (원)', '대표님과 합의한 월 부담액 · 미정이면 빈칸'],
        ['otherFixed', '그 외 월 고정비 (원)', '월 비용표에 없는 추가 고정비만 · 없으면 0'],
        ['monthlySales', '예상 월매출 (원)', '입력한 매출로 월 운영손익 계산'],
        ['cogsPercent', '매출 대비 상품 원가율 (%)', '판매된 상품 매입원가 / 매출', 100],
        ['cardPercent', '결제 수수료율 (%)', '실제 카드·결제 계약의 적용 수수료', 100],
        ['otherVariablePercent', '그 외 변동비율 (%)', '포장·판매 연동 비용 · 없으면 0', 100],
        ['operatingDays', '월 영업일수 (일)', '일 목표매출 계산에 사용', 31],
      ].forEach(([key, label, hint, max]) => fields.append(numberInput(label, result.values[key], value => mutate(next => { next.assumptions[key] = value; }), { hint, max: max || 10000000000, step: key.endsWith('Percent') ? '0.01' : '1' })));
      section.append(fields);
      const unresolved = [];
      if (result.values.rent === null) unresolved.push('월 공간대여료');
      if (result.values.otherFixed === null) unresolved.push('추가 고정비(없으면 0)');
      if (['cogsPercent', 'cardPercent', 'otherVariablePercent'].some(key => result.values[key] === null)) unresolved.push('원가·수수료·변동비율');
      if (result.byStage.monthly.missing) unresolved.push('월 비용표의 미확정 ' + result.byStage.monthly.missing + '개');
      if (unresolved.length) section.append(create('p', 'budget-calculation-status', '월 목표를 계산하려면 확인할 값: ' + unresolved.join(' · ')));
      if (result.margin !== null && result.margin <= 0) section.append(create('p', 'budget-calculation-status budget-warning', '변동비율 합계가 100% 이상이라 손익분기 매출을 계산할 수 없습니다. 상품 원가와 수수료 가정을 확인하세요.'));
      const stats = create('div', 'budget-stats budget-bep-stats');
      stats.append(amountCard('월 운영 손익분기 매출', result.monthlyBEP, result.dailyBEP !== null ? '하루 ' + money(result.dailyBEP) + ' · 월 ' + result.values.operatingDays + '일 영업 기준' : '공간대여료·고정비·원가율·수수료 입력 필요'));
      stats.append(amountCard('3개월 초기비 회수 목표매출', result.threeMonthTarget, result.dailyRecovery !== null ? '3개월 매출 합계 · 하루 ' + money(result.dailyRecovery) : '오픈 제작비와 월 운영비를 함께 회수하는 별도 목표'));
      stats.append(amountCard('예상 월 운영손익', result.operatingProfit, '예상 월매출 × 공헌이익률 − 월 고정비', result.operatingProfit !== null && result.operatingProfit < 0 ? 'budget-negative' : ''));
      section.append(stats);
      const detail = create('details', 'budget-formulas'); detail.append(create('summary', '', '계산 기준과 빠져 있는 금액 확인'));
      const lines = [
        '공헌이익률 = 100% − 상품 원가율 − 결제 수수료율 − 기타 변동비율' + (result.margin !== null ? ' = ' + (result.margin * 100).toFixed(2) + '%' : ''),
        '월 손익분기 매출 = (월 공간대여료 + 월 비용표 합계 + 그 외 고정비) ÷ 공헌이익률',
        '3개월 회수 목표매출 = (초기 제작·설치비 + 월 고정비 × 3) ÷ 공헌이익률',
        '초기 상품 재고와 반환 예정 보증금은 오픈 전 현금 합계에는 포함하지만 초기비 회수식에서는 제외합니다. 재고 원가는 상품 원가율에서 차감하므로 두 번 계산하지 않습니다.',
        '전환 비용은 별도 예비자금입니다. 선택한 안의 전환비를 포함하려면 그 금액을 추가로 확보하세요. 종합소득세·부가세 납부액·자금 회수 시점은 별도 검토가 필요합니다.',
        '공간대여료 3개월분을 선납해도 비용이 추가로 생기는 것은 아닙니다. 초기 현금 지급 시점만 달라지므로 오픈 비용표와 월 공간대여료에 중복으로 넣지 마세요.',
        '단가의 부가세 기준을 통일한 뒤 확정하세요. 현재 합계는 각 행에 표시된 조사·입력 금액을 더한 예산이며 부가세 공제 후 회계손익이나 확정 견적이 아닙니다.',
      ];
      lines.forEach(line => detail.append(create('p', '', line)));
      if (result.margin !== null && result.margin <= 0) detail.append(create('p', 'budget-warning', '변동비율 합계가 100% 이상입니다. 현재 가정으로는 매출을 늘려도 고정비를 회수할 수 없습니다.'));
      section.append(detail); parent.append(section);
    }
    function render() {
      if (destroyed) return;
      const focused = root.contains(document.activeElement) ? document.activeElement.dataset.budgetFocus : '';
      const costData = data(), budget = currentBudget(), result = calculate(costData, inventory(), budget);
      const fragment = document.createDocumentFragment();
      const summary = create('div', 'budget-stats');
      const shown = total => total.missing && total.missing === total.count ? null : total.base;
      summary.append(amountCard('오픈 전 필요금액', shown(result.byStage.startup), totalNote(result.byStage.startup), 'budget-stat-main'));
      summary.append(amountCard('월 비용표 합계', shown(result.byStage.monthly), '공간대여료와 추가 고정비는 아래에서 별도 입력 · ' + totalNote(result.byStage.monthly)));
      summary.append(amountCard('팔시보 전환 예비금', shown(result.byStage.reversal), totalNote(result.byStage.reversal)));
      fragment.append(summary);
      const missing = Object.values(result.byStage).reduce((count, total) => count + total.missing, 0);
      const notice = create('div', 'budget-completeness' + (missing || result.pendingGroups.length ? ' has-unknowns' : ''));
      notice.append(create('strong', '', missing || result.pendingGroups.length ? '아직 확정 총액이 아닙니다' : '선택한 항목의 예산 합계입니다'));
      notice.append(create('p', '', '단가·수량 미확정 ' + missing + '개 · 방식 미선택 ' + result.pendingGroups.length + '건 · 미확정 금액은 0원으로 확정하지 않고 합계에서 제외합니다.'));
      const paid = result.byStage.startup.paid;
      notice.append(create('p', '', '오픈 전 선택항목 지출 입력액 ' + money(paid) + ' · 알려진 예산 중 남은 금액 ' + money(Math.max(0, result.byStage.startup.base - paid))));
      notice.append(create('small', '', '가격 확인일 ' + (costData.asOf || '미기록') + ' · 판매가 / 추정 제작비 / 별도 견적을 구분해 사용하세요. 배송·설치·부가세 미확인 항목은 실제 청구 시 늘어날 수 있습니다.'));
      fragment.append(notice);
      renderGroups(fragment, result, budget);
      renderBEP(fragment, result);
      renderCosts(fragment, result);
      if ((costData.references || []).length) {
        const refs = create('div', 'budget-references'); refs.append(create('h3', '', '결정에 필요한 참고자료'));
        costData.references.forEach(reference => sourceLink(refs, reference.title, reference.url)); fragment.append(refs);
      }
      const status = create('p', 'budget-edit-status', editStatus || '예산 수정값은 체크리스트와 함께 저장됩니다. 공유 연결 상태를 확인한 뒤 편집해 주세요.'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite'); fragment.append(status);
      root.classList.add('offline-budget'); root.replaceChildren(fragment);
      if (focused) Array.from(root.querySelectorAll('[data-budget-focus]')).find(input => input.dataset.budgetFocus === focused)?.focus({ preventScroll: true });
    }
    render();
    return { render, setLocked(value) { locked = Boolean(value); root.querySelectorAll('input:not([type="search"]), .budget-link-button').forEach(input => { input.disabled = isLocked(); }); }, destroy() { destroyed = true; root.replaceChildren(); } };
  }
  window.createOfflineBudget = createOfflineBudget;
  window.OfflineBudgetMath = Object.freeze({ calculate });
}());
