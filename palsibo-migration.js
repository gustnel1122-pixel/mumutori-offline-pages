/* In-memory helpers for the 10/26 Palsibo list. No DOM, storage or network access.
 * ensureItem edits the supplied working state; merge returns a separate state.
 * The caller owns persistence, cloud acknowledgement and migration receipts.
 */
(function (global) {
  'use strict';

  const LEGACY_KEY = 'mumutori-palsibo-20261026-v1';
  const TRIP = 'palsibo-20261026';
  const CATEGORY = '10/26 팔시보 현장 준비';
  const NOTE_MARKER = '[10/26 팔시보 이전 메모]';
  const GROUPS = Object.freeze({
    'left-cabinets': 'today', 'right-cabinets': 'today', 'letter-desk': 'today',
    'letter-stool': 'today', 'letter-mailbox': 'today', 'character-frames': 'today',
    'chalk-paint': 'today', 'matte-varnish': 'today', 'paint-tools': 'today',
    'paint-protection': 'today', 'measure-table': 'verify', 'typewriter-check': 'verify',
    'display-tools': 'verify', 'back-room': 'verify', 'cargo-arrival': 'verify',
    'tablecloth-choice': 'elsewhere', 'signs': 'elsewhere', 'frame-print': 'elsewhere',
    'letter-supplies': 'elsewhere', 'packing-supplies': 'elsewhere', 'lucky-goods': 'elsewhere',
    'owned-pos': 'owned', 'owned-printer': 'owned', 'owned-table': 'owned', 'owned-interior': 'owned'
  });
  const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const copy = value => JSON.parse(JSON.stringify(value));
  const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

  function validItem(item) {
    return object(item) && item.trip === TRIP && typeof item.legacyId === 'string' &&
      own(GROUPS, item.legacyId) && item.id === TRIP + '-' + item.legacyId &&
      item.shoppingGroup === GROUPS[item.legacyId];
  }

  function items(source) {
    const values = Array.isArray(source) ? source : source && Array.isArray(source.items) ? source.items : [];
    const seen = new Set();
    return values.filter(item => {
      if (!validItem(item) || seen.has(item.id)) return false;
      seen.add(item.id); return true;
    });
  }

  function text(value, max, label, required) {
    if (value == null && !required) return '';
    if (typeof value !== 'string' || value.length > max || (required && !value.trim())) {
      throw new Error(label + ' 형식이나 길이를 확인해 주세요.');
    }
    return value;
  }

  function definition(item) {
    if (!validItem(item)) throw new Error('팔시보 준비 항목의 고정 ID와 구분을 확인해 주세요.');
    const details = [
      text(item.use, 6000, '사용처', false),
      text(item.note, 6000, '준비 안내', false),
      item.zone ? '현장 위치: ' + text(item.zone, 240, '현장 위치', false) : '',
      item.figure ? '시안 위치: ' + text(item.figure, 500, '시안 위치', false) : '',
      item.link ? '참고: ' + text(item.link, 2000, '참고 주소', false) : ''
    ].filter(Boolean).join('\n');
    return {
      id: item.id,
      name: text(item.name, 240, '준비물 이름', true),
      category: CATEGORY,
      priority: text(item.priority == null ? (item.shoppingGroup === 'owned' ? '보유·재사용' : '확인 필요') : item.priority, 80, '중요도', false),
      quantity: text(item.qty == null ? '' : item.qty, 80, '수량', false),
      detail: text(details, 6000, '준비물 설명', false),
      status: item.shoppingGroup === 'owned' ? '준비 완료' : '검토'
    };
  }

  function record(item) {
    const entry = definition(item);
    return { quantity: entry.quantity, status: entry.status };
  }

  function stateShape(state) {
    if (!object(state) || !object(state.inventory) || !object(state.definitions) ||
        !Array.isArray(state.definitions.inventory) || !Array.isArray(state.definitions.inventoryCategories)) {
      throw new Error('기존 준비표 기록을 확인한 뒤 이전해 주세요.');
    }
  }

  function ensureItem(state, item) {
    stateShape(state);
    // Build and validate before making any changes to the working state.
    const seed = definition(item);
    const existing = state.definitions.inventory.find(entry => entry.id === item.id);
    const entry = existing || seed;
    let changed = false;
    if (!existing) { state.definitions.inventory.push(seed); changed = true; }
    if (!state.definitions.inventoryCategories.includes(entry.category)) {
      state.definitions.inventoryCategories.push(entry.category); changed = true;
    }
    if (!own(state.inventory, item.id)) {
      state.inventory[item.id] = { quantity: entry.quantity, status: entry.status };
      changed = true;
    }
    return changed;
  }

  function validateLegacy(value) {
    if (!object(value) || value.version !== 1 || !object(value.checked) || !object(value.notes) ||
        Object.keys(value).some(key => !['version', 'updatedAt', 'checked', 'notes'].includes(key))) {
      throw new Error('이전 팔시보 체크 기록 형식을 확인해 주세요. 원본은 그대로 보관합니다.');
    }
    if (own(value, 'updatedAt') && value.updatedAt !== null &&
        (typeof value.updatedAt !== 'string' || value.updatedAt.length > 64 || !Number.isFinite(Date.parse(value.updatedAt)))) {
      throw new Error('이전 팔시보 기록의 저장 날짜를 확인해 주세요.');
    }
    for (const checked of Object.values(value.checked)) {
      if (typeof checked !== 'boolean') throw new Error('이전 팔시보 체크 값은 참 또는 거짓이어야 합니다.');
    }
    for (const note of Object.values(value.notes)) {
      if (typeof note !== 'string' || note.length > 600) throw new Error('이전 팔시보 메모는 600자 안의 글이어야 합니다.');
    }
    return value;
  }

  function parse(raw) {
    if (raw === null || raw === undefined) return null;
    if (typeof raw !== 'string') throw new Error('이전 팔시보 기록은 저장된 JSON 문자열이어야 합니다.');
    let value;
    try { value = JSON.parse(raw); }
    catch (_) { throw new Error('이전 팔시보 기록을 읽지 못했습니다. 원본은 그대로 보관합니다.'); }
    return validateLegacy(value);
  }

  function hasNote(detail, block) {
    let at = detail.indexOf(block);
    while (at !== -1) {
      const after = detail.slice(at + block.length);
      if (after === '' || after.startsWith('\n\n')) return true;
      at = detail.indexOf(block, at + 1);
    }
    return false;
  }

  function merge(state, legacy, source) {
    stateShape(state);
    const next = copy(state);
    const result = { state: next, changed: false, imported: [], conflicts: [], notesDeferred: [] };
    if (legacy === null || legacy === undefined) return result;
    validateLegacy(legacy);
    for (const item of items(source)) {
      const hasCheck = own(legacy.checked, item.legacyId);
      const note = own(legacy.notes, item.legacyId) ? legacy.notes[item.legacyId] : '';
      const hasMemo = Boolean(note.trim());
      if (!hasCheck && !hasMemo) continue;

      // Any existing destination definition or record may have been edited remotely.
      const existed = next.definitions.inventory.some(entry => entry.id === item.id) || own(next.inventory, item.id);
      let changed = ensureItem(next, item);
      const entry = next.definitions.inventory.find(candidate => candidate.id === item.id);
      const current = next.inventory[item.id];
      if (hasCheck) {
        const requested = legacy.checked[item.legacyId] ? '준비 완료' : '검토';
        if (!existed) current.status = requested;
        else if (current.status !== requested) {
          result.conflicts.push({ id: item.id, legacyId: item.legacyId, field: 'status', kept: current.status, requested });
        }
      }
      if (hasMemo) {
        const block = NOTE_MARKER + '\n' + note;
        const detail = typeof entry.detail === 'string' ? entry.detail : '';
        if (!hasNote(detail, block)) {
          const combined = detail + (detail ? '\n\n' : '') + block;
          if (combined.length <= 6000) { entry.detail = combined; changed = true; }
          else result.notesDeferred.push({ id: item.id, legacyId: item.legacyId, reason: 'detail-too-long' });
        }
      }
      if (changed) { result.changed = true; result.imported.push(item.id); }
    }
    return result;
  }

  global.PalsiboMigration = Object.freeze({ LEGACY_KEY, TRIP, CATEGORY, items, definition, record, ensureItem, merge, parse });
})(typeof window === 'object' ? window : globalThis);
