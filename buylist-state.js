/* Pure purchase-list helpers. Persistence and cloud acknowledgement belong to app.js.
 * Existing version-2 inventory fields are reused; no state schema fields are added.
 */
(function (factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (typeof window === 'object') window.OfflineBuylistState = api;
})(function () {
  'use strict';

  const MAX_DETAIL = 6000;
  const MAX_LINKS = 10;
  const MAX_LINK_LENGTH = 2048;
  const BRAND_CATEGORY = '브랜딩·포장 구매';
  const TRIP_CATEGORY = '10/26 팔시보 현장 준비';
  const TRIP = 'palsibo-20261026';
  const PREFIX_ROOT = '[[MUMUTORI_BUYLIST_LINKS';
  const PREFIX = PREFIX_ROOT + ':1]]\n';
  const SUFFIX = '\n[[/MUMUTORI_BUYLIST_LINKS]]\n';
  const STATUSES = ['검토', '견적 요청', '발주', '준비 완료'];
  const DEFINITION_FIELDS = ['id', 'name', 'category', 'priority', 'quantity', 'detail', 'status'];
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const KNOWN_GROUPS = Object.freeze({
    print: { name: '프린터 · 스티커 용지 · 잉크' },
    stamp: { name: '도장' },
    ink: { name: '도장 잉크' },
    pack: { name: '포장재 시험 묶음' },
    mood: { name: '브랜드 무드 아이템' },
    later: { name: '이번엔 안 함' },
    'palsibo-today': { name: '10/26 팔시보 · 오늘 구매', shoppingGroup: 'today' },
    'palsibo-verify': { name: '10/26 팔시보 · 현장 확인', shoppingGroup: 'verify' },
    'palsibo-elsewhere': { name: '10/26 팔시보 · 별도 준비', shoppingGroup: 'elsewhere' },
    'palsibo-owned': { name: '10/26 팔시보 · 이미 있음', shoppingGroup: 'owned' }
  });
  const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
  const copy = value => JSON.parse(JSON.stringify(value));
  const sourceItems = source => Array.isArray(source) ? source : object(source) && Array.isArray(source.items) ? source.items : [];

  function fail(message, raw) {
    const error = new Error(message);
    if (arguments.length > 1) error.raw = raw;
    return error;
  }

  function text(value, max, label, required) {
    if (value == null && !required) return '';
    if (typeof value !== 'string' || value.length > max || (required && !value.trim())) {
      throw fail(label + ' 형식이나 길이를 확인해 주세요.');
    }
    return value;
  }

  function checkedId(value) {
    if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(value)) {
      throw fail('준비물 ID 형식을 확인해 주세요.');
    }
    return value;
  }

  function groupFor(key, name) {
    if (!own(KNOWN_GROUPS, key)) throw fail('지원하지 않는 구매 묶음입니다.');
    const known = KNOWN_GROUPS[key];
    return {
      key,
      name: text(name == null ? known.name : name, 240, '구매 묶음 이름', true),
      trip: known.shoppingGroup ? TRIP : '',
      shoppingGroup: known.shoppingGroup || '',
      category: known.shoppingGroup ? TRIP_CATEGORY : BRAND_CATEGORY
    };
  }

  function groups(source) {
    const result = [], seen = new Set();
    sourceItems(source).forEach(item => {
      if (!object(item) || typeof item.groupKey !== 'string') throw fail('구매 묶음 자료를 확인해 주세요.');
      if (seen.has(item.groupKey)) return;
      const group = groupFor(item.groupKey, item.group);
      seen.add(group.key);
      result.push(group);
    });
    return result;
  }

  function validateLinks(value) {
    if (typeof value !== 'string' && !Array.isArray(value)) throw fail('링크는 한 줄에 하나씩 입력해 주세요.');
    const lines = typeof value === 'string' ? value.split(/\r\n|\n/) : value;
    const result = [], seen = new Set();
    for (const line of lines) {
      if (typeof line !== 'string' || /[\u0000-\u001f\u007f-\u009f]/.test(line)) {
        throw fail('링크에 제어 문자를 넣을 수 없습니다.');
      }
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (trimmed.length > MAX_LINK_LENGTH) throw fail('링크는 하나당 2,048자 이내로 입력해 주세요.');
      if (!/^https?:\/\/[^/\\]/i.test(trimmed) || /[\s\\]/.test(trimmed)) {
        throw fail('http:// 또는 https://로 시작하는 전체 주소를 입력해 주세요.');
      }
      let url;
      try { url = new URL(trimmed); }
      catch (_) { throw fail('올바른 HTTP 또는 HTTPS 주소를 입력해 주세요.'); }
      if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password) {
        throw fail('계정·비밀번호가 없는 HTTP 또는 HTTPS 주소만 저장할 수 있습니다.');
      }
      if (url.href.length > MAX_LINK_LENGTH) throw fail('정리된 링크가 2,048자를 넘습니다. 주소를 확인해 주세요.');
      if (!seen.has(url.href)) {
        seen.add(url.href);
        result.push(url.href);
        if (result.length > MAX_LINKS) throw fail('항목당 링크는 최대 10개까지 저장할 수 있습니다.');
      }
    }
    return result;
  }

  function parseDetail(detail) {
    if (typeof detail !== 'string' || detail.length > MAX_DETAIL) {
      throw fail('준비물 메모 형식이나 길이를 확인해 주세요. 원문은 보존합니다.', detail);
    }
    if (!detail.startsWith(PREFIX_ROOT)) return { memo: detail, links: null, override: false };
    if (!detail.startsWith(PREFIX)) throw fail('지원하지 않거나 손상된 구매 링크 형식입니다. 원문은 보존합니다.', detail);
    const end = detail.indexOf(SUFFIX, PREFIX.length);
    if (end < 0) throw fail('구매 링크 구분이 손상되었습니다. 원문은 보존합니다.', detail);
    try {
      const values = JSON.parse(detail.slice(PREFIX.length, end));
      if (!Array.isArray(values)) throw fail('구매 링크 목록 형식이 올바르지 않습니다.');
      return {
        memo: detail.slice(end + SUFFIX.length),
        links: validateLinks(values),
        override: true
      };
    } catch (error) {
      throw fail((error.message || '구매 링크 목록을 읽지 못했습니다.') + ' 원문은 보존합니다.', detail);
    }
  }

  function writeDetail(memo, links) {
    if (typeof memo !== 'string') throw fail('메모는 글로 입력해 주세요.');
    const body = text(memo, MAX_DETAIL, '메모', false);
    const result = PREFIX + JSON.stringify(validateLinks(links)) + SUFFIX + body;
    if (result.length > MAX_DETAIL) {
      throw fail('링크와 메모를 합쳐 6,000자 이내로 입력해 주세요. 내용을 잘라 저장하지 않습니다.');
    }
    return result;
  }

  function defaultMemo(item) {
    return [
      text(item.use, MAX_DETAIL, '사용처', false),
      text(item.note, MAX_DETAIL, '안내 메모', false)
    ].filter(Boolean).join('\n');
  }

  function read(item, entry) {
    if (!object(item)) throw fail('구매 항목을 확인해 주세요.');
    const detail = entry ? entry.detail : defaultMemo(item);
    const parsed = parseDetail(detail);
    return {
      memo: parsed.memo,
      links: parsed.override ? parsed.links : validateLinks(item.link == null ? [] : item.link),
      override: parsed.override
    };
  }

  function checkedDefinition(entry) {
    if (!object(entry) || Object.keys(entry).length !== DEFINITION_FIELDS.length ||
        Object.keys(entry).some(key => !DEFINITION_FIELDS.includes(key))) {
      throw fail('준비물 정의의 저장 필드를 확인해 주세요.');
    }
    checkedId(entry.id);
    text(entry.name, 240, '준비물 이름', true);
    text(entry.category, 60, '준비물 분류', true);
    if (entry.category !== entry.category.trim() || entry.category === '전체') throw fail('준비물 분류를 확인해 주세요.');
    if (typeof entry.priority !== 'string' || typeof entry.quantity !== 'string' || typeof entry.detail !== 'string') {
      throw fail('준비물 중요도·수량·메모는 글로 저장해야 합니다.');
    }
    text(entry.priority, 80, '준비물 중요도', false);
    text(entry.quantity, 80, '준비물 수량', false);
    text(entry.detail, MAX_DETAIL, '준비물 메모', false);
    if (!STATUSES.includes(entry.status)) throw fail('준비물 상태를 확인해 주세요.');
    return entry;
  }

  // Palsibo's richer seed definition is supplied by the caller when necessary.
  function definition(item) {
    if (!object(item)) throw fail('구매 항목을 확인해 주세요.');
    return checkedDefinition({
      id: checkedId(item.id),
      name: text(item.name, 240, '준비물 이름', true),
      category: BRAND_CATEGORY,
      priority: text(item.priority == null ? '확인 필요' : item.priority, 80, '준비물 중요도', false),
      quantity: text(item.qty, 80, '준비물 수량', false),
      detail: text(defaultMemo(item), MAX_DETAIL, '준비물 메모', false),
      status: item.status == null ? '검토' : item.status
    });
  }

  function stateShape(state) {
    if (!object(state) || !object(state.inventory) || !object(state.definitions) ||
        !Array.isArray(state.definitions.inventory) || !Array.isArray(state.definitions.inventoryCategories)) {
      throw fail('기존 준비표 기록을 확인한 뒤 구매 항목을 수정해 주세요.');
    }
  }

  function ensureItem(state, item, defaultDefinition) {
    stateShape(state);
    const id = checkedId(item && item.id);
    const matches = state.definitions.inventory.filter(entry => entry.id === id);
    if (matches.length > 1) throw fail('같은 준비물 ID가 중복되어 있습니다.');
    const existing = matches[0];
    const entry = checkedDefinition(existing || defaultDefinition || definition(item));
    if (entry.id !== id) throw fail('기본 정의의 준비물 ID가 일치하지 않습니다.');
    const addDefinition = !existing;
    const addCategory = !state.definitions.inventoryCategories.includes(entry.category);
    const addRecord = !own(state.inventory, id);
    // Validate every required change before mutating this working state.
    if (addDefinition && state.definitions.inventory.length >= 1000) throw fail('준비물은 최대 1,000개까지 저장할 수 있습니다.');
    if (addCategory && state.definitions.inventoryCategories.length >= 100) throw fail('준비물 분류는 최대 100개까지 저장할 수 있습니다.');
    if (addDefinition) state.definitions.inventory.push(copy(entry));
    if (addCategory) state.definitions.inventoryCategories.push(entry.category);
    if (addRecord) state.inventory[id] = { quantity: entry.quantity, status: entry.status };
    return addDefinition || addCategory || addRecord;
  }

  function update(state, item, patch, defaultDefinition) {
    stateShape(state);
    if (!object(patch) || Object.keys(patch).some(key => !['links', 'memo'].includes(key))) {
      throw fail('수정할 링크 또는 메모를 확인해 주세요.');
    }
    const next = copy(state);
    if (!Object.keys(patch).length) return next;
    ensureItem(next, item, defaultDefinition);
    const entry = next.definitions.inventory.find(value => value.id === item.id);
    const previous = parseDetail(entry.detail);
    if (own(patch, 'memo') && typeof patch.memo !== 'string') throw fail('메모는 글로 입력해 주세요.');
    const memo = own(patch, 'memo') ? text(patch.memo, MAX_DETAIL, '메모', false) : previous.memo;
    if (own(patch, 'links')) entry.detail = writeDetail(memo, patch.links);
    else if (previous.override) entry.detail = writeDetail(memo, previous.links);
    else if (memo.startsWith(PREFIX_ROOT)) {
      // A user's literal prefix is body text inside an explicit, valid envelope.
      entry.detail = writeDetail(memo, validateLinks(item.link == null ? [] : item.link));
    } else entry.detail = memo;
    return next;
  }

  function customGroup(id, groupList) {
    if (typeof id !== 'string' || id.length > 80) return null;
    const values = groupList == null ? Object.keys(KNOWN_GROUPS).map(key => groupFor(key)) : groupList;
    if (!Array.isArray(values)) return null;
    for (const group of values) {
      if (!object(group) || !own(KNOWN_GROUPS, group.key)) continue;
      const prefix = 'shop-' + group.key + '-';
      if (id.startsWith(prefix) && UUID.test(id.slice(prefix.length))) return groupFor(group.key, group.name);
    }
    return null;
  }

  function isCustom(id, groupList) {
    return Boolean(customGroup(id, groupList));
  }

  function add(state, group, values) {
    stateShape(state);
    if (!object(group) || !object(values) || Object.keys(values).some(key => !['id', 'name', 'links', 'memo'].includes(key))) {
      throw fail('추가할 구매 항목을 확인해 주세요.');
    }
    const target = groupFor(group.key, group.name);
    const id = checkedId(values.id);
    if (!customGroup(id, [target])) throw fail('추가 항목 ID와 구매 묶음이 일치하지 않습니다.');
    if (state.definitions.inventory.some(entry => entry.id === id) || own(state.inventory, id)) {
      throw fail('같은 ID의 준비물이 이미 있습니다.');
    }
    const name = text(values.name, 240, '준비물 이름', true).trim();
    const entry = {
      id, name,
      category: target.category,
      priority: target.shoppingGroup === 'owned' ? '보유·재사용' : '확인 필요',
      quantity: '',
      detail: writeDetail(values.memo == null ? '' : values.memo, values.links == null ? [] : values.links),
      status: target.shoppingGroup === 'owned' ? '준비 완료' : '검토'
    };
    checkedDefinition(entry);
    const next = copy(state);
    ensureItem(next, { id }, entry);
    return next;
  }

  function catalogue(state, source) {
    stateShape(state);
    const groupList = groups(source);
    const buckets = new Map(groupList.map(group => [group.key, []]));
    const definitions = new Map(state.definitions.inventory.map(entry => [entry.id, entry]));
    const seen = new Set();
    sourceItems(source).forEach(item => {
      checkedId(item.id);
      if (seen.has(item.id)) return;
      seen.add(item.id);
      const value = copy(item);
      const entry = definitions.get(item.id);
      if (entry) value.name = entry.name;
      buckets.get(item.groupKey).push(value);
    });
    state.definitions.inventory.forEach(entry => {
      if (seen.has(entry.id)) return;
      const group = customGroup(entry.id, groupList);
      if (!group) return;
      seen.add(entry.id);
      const record = state.inventory[entry.id] || entry;
      buckets.get(group.key).push({
        id: entry.id,
        name: entry.name,
        group: group.name,
        groupKey: group.key,
        trip: group.trip,
        shoppingGroup: group.shoppingGroup,
        qty: record.quantity,
        status: record.status,
        custom: true,
        use: '', note: '', link: '', price: '', stage: '', logo: '', zone: '', figure: '', image: ''
      });
    });
    return groupList.flatMap(group => buckets.get(group.key));
  }

  function copyText(items, state, title) {
    stateShape(state);
    const heading = text(title == null ? '무무토리 구매 기록' : title, 240, '복사 제목', true);
    const definitions = new Map(state.definitions.inventory.map(entry => [entry.id, entry]));
    const sections = new Map(), seen = new Set();
    sourceItems(items).forEach(item => {
      if (!object(item)) throw fail('복사할 구매 항목을 확인해 주세요.');
      checkedId(item.id);
      if (seen.has(item.id)) return;
      seen.add(item.id);
      const group = item.group || (own(KNOWN_GROUPS, item.groupKey) ? KNOWN_GROUPS[item.groupKey].name : '구매 목록');
      const entry = definitions.get(item.id);
      const record = state.inventory[item.id] || entry || { quantity: item.qty || '', status: item.status || '검토' };
      const values = read(item, entry);
      const lines = [
        '- ' + (entry ? entry.name : item.name),
        '  상태: ' + record.status,
        '  수량: ' + (record.quantity || '미입력'),
        '  링크:' + (values.links.length ? '\n' + values.links.map(link => '    ' + link).join('\n') : ' 없음'),
        '  메모:' + (values.memo ? '\n' + values.memo.split('\n').map(line => '    ' + line).join('\n') : ' 없음')
      ];
      if (!sections.has(group)) sections.set(group, []);
      sections.get(group).push(lines.join('\n'));
    });
    // Only supplied item content is copied. Browser/share URLs are never read.
    return [heading, ...Array.from(sections, ([group, rows]) => '[' + group + ']\n' + rows.join('\n\n'))].join('\n\n');
  }

  return Object.freeze({
    groups, parseDetail, writeDetail, validateLinks, read, definition,
    ensureItem, update, add, catalogue, isCustom, copyText
  });
});
