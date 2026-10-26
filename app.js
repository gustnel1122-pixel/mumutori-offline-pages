(function () {
  'use strict';

  const STORAGE_KEY = 'mumutori-offline-planner-v1';
  const INVENTORY_STATUSES = ['검토', '견적 요청', '발주', '준비 완료'];
  const MAX_NOTE_LENGTH = 20000;
  const MAX_QUANTITY_LENGTH = 80;
  const MAX_IMPORT_BYTES = 16 * 1024 * 1024;

  function init() {
    const data = window.OFFLINE_DATA;
    if (!data || !Array.isArray(data.tasks) || !Array.isArray(data.inventory)) {
      const status = document.getElementById('save-status');
      if (status) status.textContent = '프로젝트 자료를 불러오지 못했습니다. 페이지를 새로 열어 주세요.';
      return;
    }

    const byId = (id) => document.getElementById(id);
    const clone = value => JSON.parse(JSON.stringify(value));
    const seedTasks = clone(data.tasks).map(task => ({
      ...task,
      dueDate: task.dueDate || '',
      detail: task.id === 'goods-01'
        ? '레퍼런스 HTML의 상품 16종은 무무토리가 판매했던 상품입니다. 과일·채소 키링, 동전지갑, 버터 스퀴시 등을 사입 상품 구색과 진열 검토에 함께 반영합니다. 현재 재고·판매 SKU·수량·가격은 확인 후 확정합니다.'
        : task.detail.replaceAll('편지을', '편지를'),
    }));
    const seedInventory = clone(data.inventory);
    const taskIds = new Set(data.tasks.map((task) => task.id));
    const inventoryIds = new Set(data.inventory.map((item) => item.id));
    const taskTitles = new Map(data.tasks.map((task) => [task.id, task.title]));
    const elements = {
      taskList: byId('task-list'),
      filters: byId('task-filters'),
      search: byId('task-search'),
      incomplete: byId('task-incomplete'),
      inventoryList: byId('inventory-list'),
      note: byId('project-note'),
      openingDate: byId('opening-date'),
      saveStatus: byId('save-status'),
      toast: byId('toast'),
    };
    let activeCategory = '전체';
    let activeInventoryCategory = '전체';
    let inventoryQuery = '';
    let priorityFilter = '전체';
    let dueFilter = '전체';
    let editorTrigger = null;
    let persistenceBlocked = false;
    let toastTimer;
    let lastImageTrigger = null;
    let cloud = null;
    let cloudLocked = false;
    let budgetView = null;
    let state = createDefaults();
    const palsibo = window.PalsiboMigration;
    const tripItems = palsibo ? palsibo.items(window.OFFLINE_BUYLIST) : [];
    const tripById = new Map(tripItems.map(item => [item.id, item]));
    const params = new URLSearchParams(location.search);
    const hasSharedLink = /^[A-Za-z0-9_-]{43}$/.test(params.get('share') || '');
    let buylistFilter = params.get('shopping') === 'palsibo-20261026' ? 'today' : 'branding';
    let migrationRunning = false, pendingMigration = null;
    const purchases = window.OfflineBuylistState;
    const purchaseSource = window.OFFLINE_BUYLIST?.items || [];
    const purchaseById = new Map(purchaseSource.map(item => [item.id, item]));
    const purchaseGroups = purchases.groups(purchaseSource);
    const purchaseDrafts = new Map();
    const purchaseHint = '원가 · 계좌 · 개인정보는 적지 마세요';
    function purchaseItems() { return purchases.catalogue(state, purchaseSource); }
    function purchaseDefault(item) { return tripById.has(item.id) ? palsibo.definition(item) : purchases.definition(item); }
    function purchaseInfo(item) {
      const definition = state.definitions.inventory.find(entry => entry.id === item.id) || purchaseDefault(item);
      try { return purchases.read(item, definition); }
      catch (error) { return {links:[], memo:definition.detail || '', error:error.message}; }
    }
    function storePurchase(next) {
      if (cloudLocked || persistenceBlocked) throw new Error('저장 상태를 확인한 뒤 입력해 주세요.');
      const previous = state;
      state = validateAndMerge(next, createDefaults());
      if (!save()) { state = previous; syncDefinitions(); throw new Error('저장하지 못했어요. 입력 내용을 복사해 보관하고 저장 상태를 확인해 주세요.'); }
      syncDefinitions();
    }
    function purchaseLinks(links, compact = false) {
      const box = node('div', 'buylist-links' + (compact ? ' buylist-card-links' : ''));
      box.hidden = !links.length;
      links.forEach((href, index) => {
        const label = compact ? '판매처 열기' + (links.length > 1 ? ' ' + (index + 1) : '') + ' ↗' : href;
        const link = node('a', 'buylist-link', label);
        link.href = href; link.target = '_blank'; link.rel = 'noopener noreferrer';
        link.setAttribute('aria-label', '판매처 열기 · ' + href + ' (새 창)');
        box.append(link);
      });
      return box;
    }

    function purchaseMemoPreview(memo) {
      const preview = node('p', 'buylist-memo-preview', memo);
      preview.hidden = !memo.trim();
      return preview;
    }

    // Untouched catalogue rows stay virtual. Opening a page never replaces the
    // shared list, and another device's old check can still be imported safely.
    function inventoryEntries() {
      return data.inventory.concat(purchaseSource.filter(item => !inventoryIds.has(item.id)).map(purchaseDefault));
    }
    function inventoryRecord(item) {
      const fallback = purchaseById.has(item.id) ? purchaseDefault(purchaseById.get(item.id)) : item;
      return state.inventory[item.id] || {quantity:fallback.quantity || '', status:fallback.status || '검토'};
    }
    function ensureInventory(id) {
      if (purchaseById.has(id)) { const item = purchaseById.get(id); purchases.ensureItem(state, item, purchaseDefault(item)); syncDefinitions(); }
      return inventoryIds.has(id);
    }
    function tripActions(item) {
      const actions = node('div', 'item-actions');
      const edit = editorButton('수량·메모 수정', '', () => {
        if (cloudLocked || persistenceBlocked) return;
        showItemEditor('inventory', item.id);
      });
      edit.setAttribute('aria-label', item.name + ' 수량·메모 수정');
      edit.disabled = cloudLocked || persistenceBlocked;
      actions.append(edit); return actions;
    }
    function migrationMessage(text) {
      const box = byId('palsibo-migration-status');
      if (box) { box.hidden = !text; box.textContent = text; }
    }
    async function fingerprint(text) {
      const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
      return Array.from(new Uint8Array(bytes), value => value.toString(16).padStart(2, '0')).join('');
    }
    function migrationProjection(snapshot) {
      return JSON.stringify(tripItems.map(item => [item.id, snapshot.inventory[item.id] || null,
        snapshot.definitions.inventory.find(entry => entry.id === item.id) || null]));
    }
    function acknowledgeMigration(snapshot) {
      const pending = pendingMigration;
      if (!pending || migrationProjection(snapshot) !== pending.expected) return;
      if (pending.deferred) {
        migrationMessage('긴 메모 ' + pending.deferred + '개는 옛 목록에 보관했어요. 준비표의 메모를 확인해 주세요.');
        return;
      }
      try {
        localStorage.setItem(pending.key, pending.fingerprint);
        pendingMigration = null;
        migrationMessage('옛 팔시보 체크·메모를 이 준비표로 옮겼어요.' +
          (pending.conflicts ? ' 겹친 ' + pending.conflicts + '개 체크는 지금 준비표의 값을 유지했어요.' : '') +
          (hasSharedLink ? ' 다른 기기에서도 같은 공유 링크로 이어 쓸 수 있어요.' : ' 다른 기기에서는 쓰시던 공유 링크로 열어 주세요.'));
      } catch (_) { migrationMessage('체크·메모는 저장했지만 이전 완료 표시를 남기지 못했어요. 옛 목록은 그대로 보관되어 있어요.'); }
    }
    async function migratePalsibo() {
      if (!palsibo || persistenceBlocked || cloudLocked || migrationRunning || (hasSharedLink && !cloud?.connected())) return;
      migrationRunning = true;
      try {
        const raw = localStorage.getItem(palsibo.LEGACY_KEY);
        const legacy = palsibo.parse(raw);
        if (!legacy) return;
        const digest = await fingerprint(raw);
        const scope = hasSharedLink ? await fingerprint(params.get('share')) : 'local';
        const key = 'mumutori-palsibo-migration-v1:' + scope;
        if (localStorage.getItem(key) === digest) return;
        if (pendingMigration?.key === key && pendingMigration.fingerprint === digest &&
            pendingMigration.expected === migrationProjection(state)) return;
        // Connection or state may change while the digest promise is pending.
        if (persistenceBlocked || cloudLocked || (hasSharedLink && !cloud?.connected())) return;
        const result = palsibo.merge(state, legacy, tripItems);
        const next = validateAndMerge(result.state, createDefaults());
        pendingMigration = {key, fingerprint:digest, expected:migrationProjection(next),
          conflicts:result.conflicts.length, deferred:result.notesDeferred.length};
        if (result.changed) {
          state = next;
          if (!save()) { pendingMigration = null; return; }
          syncDefinitions(); renderInventoryFilters(); renderInventory();
          migrationMessage(hasSharedLink ? '옛 체크·메모를 옮겼어요. 공유 저장을 확인하고 있어요.' : '옛 체크·메모를 이 기기에 옮겼어요.');
        }
        if (!hasSharedLink) acknowledgeMigration(state);
        else if (!result.changed) cloud.confirmCurrent?.();
      } catch (error) { migrationMessage(error.message || '옛 체크 기록을 확인하지 못했어요. 원본은 그대로 보관합니다.'); }
      finally { migrationRunning = false; }
    }
    function cloudSettled(snapshot) {
      acknowledgeMigration(snapshot);
      // Run after Firebase has updated its comparison baseline.
      queueMicrotask(migratePalsibo);
    }


    function createDefaults() {
      const tasks = Object.create(null);
      const inventory = Object.create(null);
      seedTasks.forEach((task) => { tasks[task.id] = task.status === 'done'; });
      seedInventory.forEach((item) => {
        inventory[item.id] = {
          quantity: String(item.quantity == null ? '' : item.quantity),
          status: INVENTORY_STATUSES.includes(item.status) ? item.status : '검토',
        };
      });
      return { version: 2, tasks, inventory, note: '', openingDate: '', budget: {}, definitions: {
        tasks: clone(seedTasks), inventory: clone(seedInventory),
        taskCategories: [...new Set(seedTasks.map(task => task.category))],
        inventoryCategories: [...new Set(seedInventory.map(item => item.category))],
      } };
    }

    function syncDefinitions() {
      data.tasks = state.definitions.tasks;
      data.inventory = state.definitions.inventory;
      taskIds.clear(); inventoryIds.clear(); taskTitles.clear();
      data.tasks.forEach(task => { taskIds.add(task.id); taskTitles.set(task.id, task.title); });
      data.inventory.forEach(item => inventoryIds.add(item.id));
      if (activeCategory !== '전체' && !state.definitions.taskCategories.includes(activeCategory)) activeCategory = '전체';
      if (activeInventoryCategory !== '전체' && !purchaseGroups.some(group => group.category === activeInventoryCategory) && !state.definitions.inventoryCategories.includes(activeInventoryCategory)) activeInventoryCategory = '전체';
    }

    function validateDefinitions(definitions) {
      if (!isObject(definitions) || !hasExactKeys(definitions, ['tasks', 'inventory', 'taskCategories', 'inventoryCategories'])) throw new Error('목록 정의 형식이 올바르지 않습니다.');
      const safeString = (value, max, required) => typeof value === 'string' && value.length <= max && (!required || Boolean(value.trim()));
      for (const kind of ['tasks', 'inventory']) {
        const entries = definitions[kind];
        const categories = definitions[kind === 'tasks' ? 'taskCategories' : 'inventoryCategories'];
        if (!Array.isArray(entries) || entries.length > 1000 || !Array.isArray(categories) || categories.length > 100) throw new Error('목록 또는 분류가 너무 많습니다.');
        if (categories.some(category => !safeString(category, 60, true) || category !== category.trim() || category === '전체') || new Set(categories).size !== categories.length) throw new Error('분류 이름을 확인해 주세요.');
        const ids = new Set();
        for (const entry of entries) {
          const fields = kind === 'tasks' ? ['id', 'title', 'category', 'owner', 'priority', 'detail', 'dependsOn', 'status', 'dueDate'] : ['id', 'name', 'category', 'priority', 'quantity', 'detail', 'status'];
          if (!isObject(entry) || !hasExactKeys(entry, fields) || typeof entry.id !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(entry.id) || ids.has(entry.id)) throw new Error('항목 ID 또는 필드가 올바르지 않습니다.');
          ids.add(entry.id);
          if (!safeString(entry[kind === 'tasks' ? 'title' : 'name'], 240, true) || !categories.includes(entry.category) || !safeString(entry.priority, 80, false) || !safeString(entry.detail, 6000, false)) throw new Error('항목 내용이나 분류가 올바르지 않습니다.');
          if (kind === 'tasks') {
            if (!safeString(entry.owner, 160, false) || !safeString(entry.dueDate, 10, false) || !validDate(entry.dueDate) || !['todo', 'done'].includes(entry.status) || !Array.isArray(entry.dependsOn) || entry.dependsOn.length > 1000 || new Set(entry.dependsOn).size !== entry.dependsOn.length) throw new Error('담당 또는 선행 작업 형식이 올바르지 않습니다.');
          } else if (!safeString(entry.quantity, MAX_QUANTITY_LENGTH, false) || !INVENTORY_STATUSES.includes(entry.status)) throw new Error('준비물 기본값이 올바르지 않습니다.');
        }
        if (kind === 'tasks' && entries.some(entry => entry.dependsOn.some(id => typeof id !== 'string' || id === entry.id || !ids.has(id)))) throw new Error('선행 작업으로 지정한 항목이 없습니다.');
      }
      const tasks = new Map(definitions.tasks.map(task => [task.id, task]));
      const visited = new Set(), visiting = new Set();
      function visit(id) {
        if (visiting.has(id)) throw new Error('선행 작업이 서로를 기다리지 않도록 순서를 바꿔 주세요.');
        if (visited.has(id)) return;
        visiting.add(id); tasks.get(id).dependsOn.forEach(visit); visiting.delete(id); visited.add(id);
      }
      tasks.forEach(task => visit(task.id));
      return clone(definitions);
    }

    function isObject(value) {
      return value !== null && typeof value === 'object' && !Array.isArray(value);
    }

    function hasExactKeys(value, expected) {
      const keys = Object.keys(value);
      return keys.length === expected.length && keys.every((key) => expected.includes(key));
    }

    function validDate(value) {
      if (value === '') return true;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
      const parsed = new Date(value + 'T00:00:00Z');
      return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
    }

    // Version 1 files migrate without losing the edited list. Version 2 includes definitions.
    function validateAndMerge(candidate, base) {
      if (!isObject(candidate) || ![1, 2].includes(candidate.version)) throw new Error('지원하지 않는 저장 형식입니다.');
      const fields = ['version', 'tasks', 'inventory', 'note', 'openingDate'];
      if (candidate.version === 2) fields.push('definitions');
      if (Object.hasOwn(candidate, 'budget')) fields.push('budget');
      if (!hasExactKeys(candidate, fields) || !isObject(candidate.tasks) || !isObject(candidate.inventory)) throw new Error('무무토리 프로젝트에서 내보낸 JSON 파일을 선택해 주세요.');
      if (typeof candidate.note !== 'string' || candidate.note.length > MAX_NOTE_LENGTH) throw new Error('메모 형식이나 길이가 올바르지 않습니다.');
      if (typeof candidate.openingDate !== 'string' || !validDate(candidate.openingDate)) throw new Error('오픈 목표일 형식이 올바르지 않습니다.');
      for (const value of Object.values(candidate.tasks)) if (typeof value !== 'boolean') throw new Error('체크리스트 값이 올바르지 않습니다.');
      for (const value of Object.values(candidate.inventory)) {
        if (!isObject(value) || !hasExactKeys(value, ['quantity', 'status']) || typeof value.quantity !== 'string' || value.quantity.length > MAX_QUANTITY_LENGTH || !INVENTORY_STATUSES.includes(value.status)) throw new Error('준비물 수량 또는 상태가 올바르지 않습니다.');
      }
      const definitions = candidate.version === 2 ? validateDefinitions(candidate.definitions) : clone(base.definitions);
      const budget = window.OfflineBudgetState.normalize(candidate.version === 1 && !Object.hasOwn(candidate, 'budget') ? base.budget : candidate.budget);
      const next = { version: 2, tasks: Object.create(null), inventory: Object.create(null), note: candidate.note, openingDate: candidate.openingDate, definitions, budget };
      definitions.tasks.forEach(task => {
        next.tasks[task.id] = Object.hasOwn(candidate.tasks, task.id) ? candidate.tasks[task.id] : (candidate.version === 1 && Object.hasOwn(base.tasks, task.id) ? base.tasks[task.id] : task.status === 'done');
      });
      definitions.inventory.forEach(item => {
        const value = candidate.inventory[item.id] || (candidate.version === 1 ? base.inventory[item.id] : null) || { quantity: item.quantity, status: item.status };
        next.inventory[item.id] = { quantity: value.quantity, status: value.status };
      });
      return next;
    }

    function notify(message, persistent) {
      if (!elements.toast) return;
      clearTimeout(toastTimer);
      elements.toast.textContent = message;
      elements.toast.hidden = false;
      elements.toast.classList.add('is-visible');
      if (!persistent) {
        toastTimer = setTimeout(() => {
          elements.toast.classList.remove('is-visible');
          elements.toast.hidden = true;
        }, 6500);
      }
    }

    function setSaveStatus(message, error) {
      if (!elements.saveStatus) return;
      elements.saveStatus.textContent = message;
      elements.saveStatus.classList.toggle('save-error', Boolean(error));
    }

    function save() {
      if (persistenceBlocked) {
        setSaveStatus('저장 중단 · JSON을 내보내 백업해 주세요', true);
        return false;
      }
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
        setSaveStatus('이 기기에 백업됨', false);
        if (cloud) cloud.record(state);
        return true;
      } catch (error) {
        if (cloud) cloud.pause(new Error('기기 저장에 실패해 동기화를 중단했습니다. 현재 기록을 JSON으로 내보내 주세요.'));
        setSaveStatus('저장 실패 · JSON으로 백업해 주세요', true);
        notify('브라우저 저장 공간을 사용할 수 없습니다. 변경 내용은 JSON 내보내기로 보관해 주세요.');
        return false;
      }
    }

    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored !== null) state = validateAndMerge(JSON.parse(stored), state);
      syncDefinitions();
      setSaveStatus(stored === null ? '변경하면 이 브라우저에 자동 저장' : '이 브라우저의 저장 내용 불러옴', false);
    } catch (error) {
      persistenceBlocked = true;
      setSaveStatus('저장 자료 확인 필요 · 자동 저장 중단', true);
      notify('기존 저장 자료를 읽을 수 없어 기본 목록을 표시합니다. 기존 자료는 보존했습니다. 정상 JSON을 가져오면 저장을 다시 시작합니다. 현재 화면도 JSON으로 내보낼 수 있습니다.', true);
    }

    function node(tag, className, text) {
      const element = document.createElement(tag);
      if (className) element.className = className;
      if (text !== undefined && text !== null) element.textContent = String(text);
      return element;
    }

    // 설명 글 안의 http(s) 주소를 눌러 열 수 있는 링크로 보여 준다(화면 표시만 — 저장 내용은 그대로).
    function detailNode(text) {
      const paragraph = node('p', 'task-detail');
      const value = String(text);
      const pattern = /https?:\/\/[^\s<>"']+/g;
      let last = 0, match;
      while ((match = pattern.exec(value))) {
        const url = match[0].replace(/[.,;:!?)\]]+$/, '');
        const end = match.index + url.length;
        pattern.lastIndex = end;
        if (match.index > last) paragraph.append(document.createTextNode(value.slice(last, match.index)));
        let safe = null;
        try { const parsed = new URL(url); if (parsed.protocol === 'https:' || parsed.protocol === 'http:') safe = parsed.href; } catch (_) {}
        if (safe) {
          const link = node('a', 'detail-link', url);
          link.href = safe; link.target = '_blank'; link.rel = 'noopener noreferrer';
          paragraph.append(link);
        } else paragraph.append(document.createTextNode(url));
        last = end;
      }
      if (last < value.length) paragraph.append(document.createTextNode(value.slice(last)));
      return paragraph;
    }

    function textAt(id, text) {
      const element = byId(id);
      if (element) element.textContent = text;
    }

    function editorButton(label, className, action) {
      const button = node('button', 'editor-button ' + (className || ''), label);
      button.type = 'button';
      if (action) button.addEventListener('click', action);
      return button;
    }

    function itemActions(kind, entry) {
      const actions = node('div', 'item-actions');
      const name = kind === 'tasks' ? entry.title : entry.name;
      const edit = editorButton('수정', '', () => showItemEditor(kind, entry.id));
      edit.setAttribute('aria-label', name + ' 수정');
      const remove = editorButton('삭제', 'editor-danger', () => {
        if (cloudLocked) return;
        const dependents = kind === 'tasks' ? data.tasks.filter(task => task.dependsOn.includes(entry.id)) : [];
        const suffix = dependents.length ? '\n이 항목을 기다리는 ' + dependents.length + '개 작업의 선행 작업 목록에서도 제외합니다.' : '';
        if (!window.confirm('“' + name + '” 항목과 기록을 삭제할까요?' + suffix)) return;
        const definitions = clone(state.definitions);
        definitions[kind] = definitions[kind].filter(item => item.id !== entry.id);
        if (kind === 'tasks') definitions.tasks.forEach(task => { task.dependsOn = task.dependsOn.filter(id => id !== entry.id); });
        commitDefinitions(definitions);
        notify('항목을 삭제했습니다.');
      });
      remove.setAttribute('aria-label', name + ' 삭제');
      edit.disabled = cloudLocked; remove.disabled = cloudLocked;
      actions.append(edit, remove);
      return actions;
    }

    function commitDefinitions(definitions) {
      if (cloudLocked) throw new Error('클라우드 기록을 확인한 후 목록을 수정해 주세요.');
      state.definitions = validateDefinitions(definitions);
      const tasks = Object.create(null), inventory = Object.create(null);
      state.definitions.tasks.forEach(task => { tasks[task.id] = Object.hasOwn(state.tasks, task.id) ? state.tasks[task.id] : task.status === 'done'; });
      state.definitions.inventory.forEach(item => { inventory[item.id] = state.inventory[item.id] || { quantity: item.quantity, status: item.status }; });
      state.tasks = tasks; state.inventory = inventory;
      syncDefinitions(); save();
      renderFilters(); renderTasks(); renderInventoryFilters(); renderInventory();
    }

    function dialogForm(title, description) {
      const dialog = byId('list-editor-dialog');
      if (!dialog) return null;
      if (!dialog.open) editorTrigger = document.activeElement;
      dialog.replaceChildren();
      const header = node('div', 'editor-heading');
      const heading = node('h2', '', title); heading.id = 'list-editor-title';
      header.append(heading, editorButton('닫기', 'editor-close', () => dialog.close()));
      dialog.append(header);
      if (description) dialog.append(node('p', 'editor-description', description));
      const form = node('form', 'editor-form');
      const error = node('p', 'editor-error'); error.setAttribute('role', 'alert'); error.hidden = true;
      dialog.append(form);
      const actions = node('div', 'editor-form-actions');
      const submit = node('button', 'button primary', '저장'); submit.type = 'submit';
      actions.append(editorButton('취소', '', () => dialog.close()), submit);
      return { dialog, form, error, actions, submit,
        finish: (onSubmit) => {
          form.append(error, actions);
          form.addEventListener('submit', event => {
            event.preventDefault(); error.hidden = true;
            if (cloudLocked) return;
            try { onSubmit(); }
            catch (failure) { error.textContent = failure.message || '내용을 확인해 주세요.'; error.hidden = false; error.scrollIntoView({ block: 'nearest' }); }
          });
          if (!dialog.open) dialog.showModal();
          const first = form.querySelector('input:not([type="checkbox"]), select, textarea, button');
          if (first) first.focus();
        }
      };
    }

    function formField(form, labelText, options) {
      const label = node('label', 'editor-field' + (options.wide ? ' editor-field-wide' : ''));
      label.append(node('span', '', labelText));
      const input = node(options.type === 'textarea' ? 'textarea' : options.type === 'select' ? 'select' : 'input');
      if (input.tagName === 'INPUT') input.type = options.type === 'date' ? 'date' : 'text';
      if (options.required) input.required = true;
      if (options.max) input.maxLength = options.max;
      if (options.placeholder) input.placeholder = options.placeholder;
      if (options.type === 'select') options.items.forEach(item => {
        const option = node('option', '', typeof item === 'string' ? item : item.label);
        option.value = typeof item === 'string' ? item : item.value; input.append(option);
      });
      input.value = options.value || '';
      if (options.type === 'textarea') input.rows = 4;
      label.append(input);
      if (options.help) label.append(node('small', '', options.help));
      form.append(label);
      return input;
    }

    function categoryKey(kind) { return kind === 'tasks' ? 'taskCategories' : 'inventoryCategories'; }
    function newItemId(kind) {
      const prefix = kind === 'tasks' ? 'custom-task-' : 'custom-item-';
      return prefix + (globalThis.crypto?.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10));
    }
    function checkedCategory(value) {
      const category = value.trim();
      if (!category || category.length > 60 || category === '전체') throw new Error('분류 이름은 1~60자로 입력해 주세요. “전체”는 사용할 수 없습니다.');
      return category;
    }

    function showItemEditor(kind, id) {
      if (cloudLocked) return;
      const task = kind === 'tasks';
      const originalEntry = state.definitions[kind].find(item => item.id === id);
      const purchase = !task && purchaseItems().find(item => item.id === id);
      const entry = originalEntry || (purchase ? purchaseDefault(purchase) : null);
      const originalRecord = entry && !task ? clone(inventoryRecord(entry)) : null;
      const purchaseFields = purchase ? purchaseInfo(purchase) : null;
      if (purchaseFields?.error) { notify(purchaseFields.error); return; }
      const editor = dialogForm((entry ? '수정 · ' : '추가 · ') + (task ? '할 일' : '준비물'), '내용과 분류를 실제 계획에 맞게 바꾸세요. 저장한 항목과 기록은 JSON 백업에도 포함됩니다.');
      if (!editor) return;
      const { form, dialog } = editor;
      const grid = node('div', 'editor-grid'); form.append(grid);
      const name = formField(grid, task ? '할 일 이름 *' : '준비물 이름 *', { value: entry?.[task ? 'title' : 'name'], required: true, max: 240, wide: true });
      const categories = [...new Set([...state.definitions[categoryKey(kind)], ...(entry?.category ? [entry.category] : [])])];
      const selected = entry?.category || (task ? activeCategory : activeInventoryCategory);
      const category = formField(grid, '분류', { type: 'select', items: categories.length ? categories : ['미분류'], value: categories.includes(selected) ? selected : categories[0] || '미분류' });
      const newCategory = formField(grid, '새 분류로 저장', { max: 60, placeholder: '필요할 때만 입력', help: '입력하면 왼쪽 선택 대신 새 분류를 사용합니다.' });
      const priority = formField(grid, '중요도', { value: entry?.priority || '선택', max: 80, placeholder: '예: 필수, 선택, 확인 완료' });
      let owner, quantity, status;
      if (task) owner = formField(grid, '담당자', { value: entry?.owner, max: 160, placeholder: '예: 무무토리 · 제작 업체' });
      else {
        quantity = formField(grid, '수량 / 규격 메모', { value: originalRecord?.quantity || '', max: MAX_QUANTITY_LENGTH });
        status = formField(grid, '준비 상태', { type: 'select', items: INVENTORY_STATUSES, value: originalRecord?.status || '검토' });
      }
      const dueDate = task ? formField(grid, '완료 목표일', { type: 'date', value: entry?.dueDate, help: '아직 정해지지 않았다면 비워 두세요.' }) : null;
      const purchaseURLs = purchase ? formField(grid, '링크 · 한 줄에 하나', {type:'textarea', value:purchaseFields.links.join('\n'), max:6000, wide:true, help:purchaseHint}) : null;
      const detail = formField(grid, purchase ? '메모' : '상세 내용', { type: 'textarea', value: purchase ? purchaseFields.memo : entry?.detail, max: 6000, wide: true, help:purchase ? purchaseHint : '' });
      const dependencies = [];
      if (task) {
        const disclosure = node('details', 'editor-dependencies');
        disclosure.append(node('summary', '', '선행 작업 선택 · 현재 ' + (entry?.dependsOn.length || 0) + '개'));
        disclosure.append(node('p', '', '이 일을 시작하기 전에 확인해야 할 항목을 선택하세요.'));
        const fieldset = node('fieldset', 'dependency-options');
        const legend = node('legend', '', '선행 작업'); fieldset.append(legend);
        data.tasks.filter(item => item.id !== id).forEach(item => {
          const label = node('label', 'dependency-option');
          const check = node('input'); check.type = 'checkbox'; check.value = item.id; check.checked = Boolean(entry?.dependsOn.includes(item.id));
          label.append(check, node('span', '', item.title)); fieldset.append(label); dependencies.push(check);
        });
        if (!dependencies.length) fieldset.append(node('p', '', '선택할 다른 작업이 아직 없습니다.'));
        disclosure.append(fieldset); form.append(disclosure);
      }
      editor.finish(() => {
        if (!name.value.trim()) throw new Error('항목 이름을 입력해 주세요.');
        if (purchase && (JSON.stringify(state.definitions.inventory.find(item => item.id === id)) !== JSON.stringify(originalEntry) || JSON.stringify(inventoryRecord(entry)) !== JSON.stringify(originalRecord))) throw new Error('다른 화면에서 이 항목을 바꿨어요. 창을 닫고 최신 내용을 다시 열어 주세요.');
        const definitions = clone(state.definitions);
        const chosenCategory = checkedCategory(newCategory.value || category.value);
        if (!definitions[categoryKey(kind)].includes(chosenCategory)) definitions[categoryKey(kind)].push(chosenCategory);
        const next = task
          ? { id: entry?.id || newItemId(kind), title: name.value.trim(), category: chosenCategory, owner: owner.value.trim(), priority: priority.value.trim(), detail: detail.value.trim(), dependsOn: dependencies.filter(check => check.checked).map(check => check.value), dueDate: dueDate.value, status: entry && state.tasks[entry.id] ? 'done' : 'todo' }
          : { id: entry?.id || newItemId(kind), name: name.value.trim(), category: chosenCategory, priority: priority.value.trim(), quantity: quantity.value, detail: purchase ? purchases.writeDetail(detail.value, purchases.validateLinks(purchaseURLs.value)) : detail.value.trim(), status: status.value };
        const index = definitions[kind].findIndex(item => item.id === id);
        if (index < 0) definitions[kind].push(next); else definitions[kind][index] = next;
        validateDefinitions(definitions);
        if (purchase) {
          const candidate = clone(state);
          candidate.definitions = definitions;
          candidate.inventory[next.id] = {quantity:quantity.value, status:status.value};
          storePurchase(candidate);
          activeInventoryCategory = chosenCategory; inventoryQuery = '';
          const search = byId('inventory-search'); if (search) search.value = '';
          renderInventoryFilters(); renderInventory(); dialog.close(); notify('항목을 수정했습니다.');
          return;
        }
        if (!task) state.inventory[next.id] = { quantity: quantity.value, status: status.value };
        if (task) { activeCategory = chosenCategory; priorityFilter = '전체'; dueFilter = '전체'; const dueSelect = byId('task-due-filter'); if (dueSelect) dueSelect.value = '전체'; if (elements.search) elements.search.value = ''; if (elements.incomplete) elements.incomplete.checked = false; }
        else { activeInventoryCategory = chosenCategory; inventoryQuery = ''; const search = byId('inventory-search'); if (search) search.value = ''; }
        commitDefinitions(definitions); dialog.close(); notify(entry ? '항목을 수정했습니다.' : '새 항목을 추가했습니다.');
      });
    }

    function showCategoryEditor(kind) {
      if (cloudLocked) return;
      const key = categoryKey(kind);
      const editor = dialogForm((kind === 'tasks' ? '할 일' : '준비물') + ' 분류 관리', '분류 이름을 바꾸거나 빈 분류를 미리 만들 수 있습니다. 분류를 삭제할 때 항목은 다른 분류로 옮깁니다.');
      if (!editor) return;
      const list = node('div', 'category-editor-list'); editor.form.append(list);
      state.definitions[key].forEach(category => {
        const row = node('div', 'category-editor-row');
        const label = node('label', 'editor-field');
        const count = state.definitions[kind].filter(item => item.category === category).length;
        label.append(node('span', '', category + ' · ' + count + '개'));
        const input = node('input'); input.type = 'text'; input.value = category; input.maxLength = 60; input.setAttribute('aria-label', category + ' 분류 이름'); label.append(input);
        const rename = editorButton('이름 변경', '', () => {
          try {
            if (cloudLocked) return;
            const name = checkedCategory(input.value);
            if (name === category) return;
            if (state.definitions[key].includes(name)) throw new Error('이미 있는 분류입니다. 다른 이름을 입력하거나 분류를 삭제해 합쳐 주세요.');
            const definitions = clone(state.definitions);
            definitions[key] = definitions[key].map(value => value === category ? name : value);
            definitions[kind].forEach(item => { if (item.category === category) item.category = name; });
            if (kind === 'tasks' && activeCategory === category) activeCategory = name;
            if (kind === 'inventory' && activeInventoryCategory === category) activeInventoryCategory = name;
            commitDefinitions(definitions); showCategoryEditor(kind); notify('분류 이름을 바꿨습니다.');
          } catch (failure) { editor.error.textContent = failure.message; editor.error.hidden = false; }
        });
        const remove = editorButton('분류 삭제', 'editor-danger', () => showCategoryRemoval(kind, category));
        row.append(label, rename, remove); list.append(row);
      });
      const add = formField(editor.form, '새 분류', { max: 60, required: true, placeholder: '예: 이번 주 확인할 일' });
      editor.submit.textContent = '분류 추가';
      editor.finish(() => {
        const category = checkedCategory(add.value);
        if (state.definitions[key].includes(category)) throw new Error('이미 있는 분류입니다.');
        const definitions = clone(state.definitions); definitions[key].push(category);
        commitDefinitions(definitions); showCategoryEditor(kind); notify('새 분류를 만들었습니다.');
      });
    }

    function showCategoryRemoval(kind, category) {
      if (cloudLocked) return;
      const key = categoryKey(kind);
      const count = state.definitions[kind].filter(item => item.category === category).length;
      const editor = dialogForm('분류 삭제 · ' + category, count ? count + '개 항목은 삭제하지 않고 선택한 분류로 옮깁니다.' : '이 분류에는 항목이 없습니다.');
      if (!editor) return;
      let destination;
      if (count) {
        const choices = state.definitions[key].filter(value => value !== category);
        if (!choices.length) choices.push(category === '미분류' ? '기본 분류' : '미분류');
        destination = formField(editor.form, '항목을 옮길 분류', { type: 'select', items: choices, value: choices[0] });
      }
      editor.submit.textContent = count ? '항목을 옮기고 분류 삭제' : '빈 분류 삭제';
      editor.finish(() => {
        if (!window.confirm('“' + category + '” 분류를 삭제할까요?' + (count ? ' 항목은 “' + destination.value + '”로 이동합니다.' : ''))) return;
        const definitions = clone(state.definitions);
        definitions[key] = definitions[key].filter(value => value !== category);
        if (count) {
          if (!definitions[key].includes(destination.value)) definitions[key].push(destination.value);
          definitions[kind].forEach(item => { if (item.category === category) item.category = destination.value; });
        }
        commitDefinitions(definitions); showCategoryEditor(kind); notify('분류를 삭제했습니다. 항목의 기록은 유지됩니다.');
      });
    }

    function installEditors() {
      const dialog = node('dialog', 'list-editor-dialog'); dialog.id = 'list-editor-dialog'; dialog.setAttribute('aria-labelledby', 'list-editor-title');
      dialog.addEventListener('close', () => { if (editorTrigger && document.contains(editorTrigger)) editorTrigger.focus({ preventScroll: true }); });
      document.body.append(dialog);
      [['tasks', elements.filters], ['inventory', byId('inventory-filters')]].forEach(([kind, anchor]) => {
        if (!anchor) return;
        const toolbar = node('div', 'list-editor-toolbar');
        const actions = node('div', 'list-editor-toolbar-actions');
        actions.append(editorButton(kind === 'tasks' ? '+ 할 일 추가' : '+ 준비물 추가', 'editor-primary', () => showItemEditor(kind)), editorButton('분류 관리', '', () => showCategoryEditor(kind)));
        toolbar.append(actions, node('p', '', '항목과 분류를 직접 수정해 실제 준비 목록으로 만들어 보세요.'));
        if (kind === 'inventory') {
          const label = node('label', 'editor-inventory-search'); label.append(node('span', '', '준비물 검색'));
          const search = node('input'); search.type = 'search'; search.id = 'inventory-search'; search.placeholder = '이름·분류·상세 내용 검색';
          search.addEventListener('input', () => { inventoryQuery = search.value.trim().toLocaleLowerCase('ko'); renderInventory(); }); label.append(search); toolbar.append(label);
        }
        if (kind === 'tasks') {
          anchor.closest('.task-toolbar').before(toolbar);
          const extra = node('div', 'editor-extra-filters');
          [['task-priority-filter', '중요도', ['전체']], ['task-due-filter', '기한', ['전체', '7일 이내', '기한 지남', '기한 없음']]].forEach(([id, title, values]) => {
            const label = node('label'); label.append(node('span', '', title)); const select = node('select'); select.id = id;
            values.forEach(value => { const option = node('option', '', value); option.value = value; select.append(option); });
            select.addEventListener('change', () => { if (id === 'task-priority-filter') priorityFilter = select.value; else dueFilter = select.value; renderTasks(); });
            label.append(select); extra.append(label);
          });
          anchor.closest('.task-toolbar').after(extra);
        } else anchor.before(toolbar);
      });
      const restore = editorButton('가져오기 전 기록 복원', '', () => {
        if (cloudLocked) { notify('클라우드 기록을 확인한 후 복원해 주세요.'); return; }
        const previous = localStorage.getItem(STORAGE_KEY + '-before-import');
        if (!previous) { notify('이 브라우저에 가져오기 전 백업이 없습니다.'); return; }
        if (!window.confirm('마지막 JSON 가져오기 직전의 목록과 기록으로 복원할까요? 현재 내용이 필요하면 먼저 JSON으로 내보내 주세요.')) return;
        try {
          const next = validateAndMerge(JSON.parse(previous), createDefaults());
          localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); state = next; persistenceBlocked = false;
          if (cloud) cloud.record(state);
          syncDefinitions(); renderFilters(); renderTasks(); renderInventoryFilters(); renderInventory(); renderEditableFields();
          setSaveStatus('가져오기 전 기록 복원됨', false); notify('가져오기 전 기록으로 복원했습니다.');
        } catch (_) { notify('이전 백업을 읽거나 저장하지 못했습니다. 현재 기록을 JSON으로 먼저 내보내 주세요.'); }
      });
      restore.id = 'restore-before-import';
      const exportButton = byId('export-button');
      if (exportButton?.parentElement) exportButton.parentElement.append(restore);
    }

    function renderProgress() {
      const completed = data.tasks.filter((task) => state.tasks[task.id]).length;
      const percent = data.tasks.length ? Math.round(completed / data.tasks.length * 100) : 0;
      textAt('progress-count', completed + ' / ' + data.tasks.length);
      textAt('progress-percent', percent + '%');
      const bar = byId('progress-bar');
      if (bar) {
        bar.style.width = percent + '%';
        const progress = bar.closest('[role="progressbar"]');
        if (progress) {
          progress.setAttribute('aria-valuemin', '0');
          progress.setAttribute('aria-valuemax', '100');
          progress.setAttribute('aria-valuenow', String(percent));
          progress.setAttribute('aria-valuetext', data.tasks.length + '개 중 ' + completed + '개 완료');
        }
      }
    }

    function renderFilters() {
      if (!elements.filters) return;
      elements.filters.replaceChildren();
      const prioritySelect = byId('task-priority-filter');
      if (prioritySelect) {
        const priorities = ['전체', ...new Set(data.tasks.map(task => task.priority).filter(Boolean))];
        if (!priorities.includes(priorityFilter)) priorityFilter = '전체';
        prioritySelect.replaceChildren(...priorities.map(priority => { const option = node('option', '', priority); option.value = priority; return option; }));
        prioritySelect.value = priorityFilter;
      }
      ['전체', ...state.definitions.taskCategories].forEach((category) => {
        const button = node('button', 'filter-button' + (category === activeCategory ? ' active' : ''), category);
        button.type = 'button';
        button.dataset.category = category;
        button.setAttribute('aria-pressed', String(category === activeCategory));
        elements.filters.append(button);
      });
    }

    function renderTasks() {
      if (!elements.taskList) return;
      const query = elements.search ? elements.search.value.trim().toLocaleLowerCase('ko') : '';
      const incompleteOnly = Boolean(elements.incomplete && elements.incomplete.checked);
      const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
      const nextWeek = new Date(today + 'T00:00:00Z'); nextWeek.setUTCDate(nextWeek.getUTCDate() + 7);
      const nextWeekDate = nextWeek.toISOString().slice(0, 10);
      const visible = data.tasks.filter((task) => {
        const searchText = [task.title, task.category, task.owner, task.detail, task.priority].join(' ').toLocaleLowerCase('ko');
        const dueMatches = dueFilter === '전체' || (dueFilter === '기한 없음' && !task.dueDate) || (dueFilter === '기한 지남' && task.dueDate && task.dueDate < today && !state.tasks[task.id]) || (dueFilter === '7일 이내' && task.dueDate && task.dueDate >= today && task.dueDate <= nextWeekDate);
        return (activeCategory === '전체' || task.category === activeCategory) && (priorityFilter === '전체' || task.priority === priorityFilter) && dueMatches &&
          (!incompleteOnly || !state.tasks[task.id]) && (!query || searchText.includes(query));
      });
      const fragment = document.createDocumentFragment();
      visible.forEach((task) => {
        const done = state.tasks[task.id];
        const row = node('article', 'task-row' + (done ? ' task-done' : ''));
        row.dataset.taskRow = task.id;
        const check = node('input', 'task-check');
        check.type = 'checkbox';
        check.disabled = cloudLocked;
        check.id = 'task-' + task.id;
        check.dataset.taskId = task.id;
        check.checked = done;
        check.setAttribute('aria-label', task.title + ' 완료');
        const info = node('div', 'task-info');
        const label = node('label', 'task-title', task.title);
        label.htmlFor = check.id;
        const meta = node('div', 'task-meta');
        meta.append(node('span', 'tag', task.category));
        if (task.priority) meta.append(node('span', 'tag tag-priority', task.priority));
        if (task.owner) meta.append(node('span', 'owner', task.owner));
        if (task.dueDate) meta.append(node('span', 'task-due' + (!done && task.dueDate < today ? ' task-overdue' : ''), '기한 ' + task.dueDate.replaceAll('-', '.') + (!done && task.dueDate < today ? ' · 지남' : '')));
        info.append(label, meta);
        if (task.detail) info.append(detailNode(task.detail));
        const referenceValue = window.OFFLINE_TASK_REFERENCES?.[task.id];
        const references = referenceValue ? (Array.isArray(referenceValue) ? referenceValue : [referenceValue]) : [];
        if (references.length) {
          const links = node('p', 'task-detail');
          references.forEach(reference => {
            const value = typeof reference === 'string' ? reference : reference.url;
            if (!/^reference-(administration|exterior|butter|budget)\.html$/.test(value)) return;
            const titles = {administration:'행정·결제·광고 안내',exterior:'외벽·간판 비교안',butter:'버터 매대 제작안',budget:'가격·예산 산정 근거'};
            const key = value.replace('reference-', '').split('.')[0];
            const link = node('a', 'text-link', '참고: ' + (reference.title || titles[key]));
            link.href = value; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.style.marginRight = '1rem';
            links.append(link);
          });
          info.append(links);
        }
        const dependencies = (task.dependsOn || []).filter((id) => taskTitles.has(id));
        if (dependencies.length) {
          const remaining = dependencies.filter((id) => !state.tasks[id]);
          const dependencyText = remaining.length
            ? '먼저 확인 · ' + remaining.map((id) => taskTitles.get(id)).join(' / ')
            : '선행 작업 확인 완료';
          info.append(node('p', 'task-dependencies' + (remaining.length ? '' : ' dependencies-done'), dependencyText));
        }
        row.append(check, info, itemActions('tasks', task));
        fragment.append(row);
      });
      if (!visible.length) fragment.append(node('p', 'empty-state', '조건에 맞는 항목이 없습니다. 검색어나 필터를 바꿔 보세요.'));
      elements.taskList.replaceChildren(fragment);
      textAt('task-summary', visible.length + '개 표시 · 전체 ' + data.tasks.length + '개');
      renderProgress();
    }

    function purchaseEditor(item, name) {
      const fields = purchaseInfo(item), draft = purchaseDrafts.get(item.id) || {};
      const details = node('details', 'buylist-editor'); details.dataset.purchaseEditor = item.id;
      details.append(node('summary', '', '링크 · 메모'));
      details.append(node('small', 'buylist-field-help', '입력하면 자동 저장 · 06 준비표와 같은 내용이에요.'));
      for (const field of ['links', 'memo']) {
        const label = node('label', 'editor-field');
        label.append(node('span', '', field === 'links' ? '링크 · 한 줄에 하나' : '메모'));
        const input = node('textarea'); input.rows = field === 'links' ? 2 : 3; input.maxLength = 6000;
        input.id = 'purchase-' + item.id + '-' + field;
        input.dataset.buylistId = item.id; input.dataset.buylistField = field;
        input.setAttribute('aria-label', (item.zone ? item.zone + ' ' : '') + name + (field === 'links' ? ' 링크' : ' 메모'));
        input.value = draft[field]?.value ?? (field === 'links' ? fields.links.join('\n') : fields.memo);
        if (field === 'links') { input.placeholder = 'https://…'; input.inputMode = 'url'; input.spellcheck = false; input.autocapitalize = 'off'; }
        input.disabled = cloudLocked || persistenceBlocked || Boolean(fields.error);
        const hint = node('small', 'buylist-field-help', purchaseHint); hint.id = input.id + '-hint';
        const error = node('small', 'editor-error', draft[field]?.error || fields.error || '');
        error.id = input.id + '-error'; error.dataset.purchaseError = field;
        error.hidden = !error.textContent; error.setAttribute('role', 'status');
        input.setAttribute('aria-describedby', hint.id + ' ' + error.id);
        input.setAttribute('aria-invalid', String(Boolean(error.textContent)));
        label.append(input, hint, error); details.append(label);
      }
      const status = node('small', 'buylist-field-help'); status.dataset.purchaseSave = '';
      status.setAttribute('role', 'status'); details.append(status);
      return details;
    }

    function refreshPurchaseRow(id) {
      const item = purchaseItems().find(entry => entry.id === id); if (!item) return;
      const fields = purchaseInfo(item);
      const row = byId('buylist-list')?.querySelector('[data-buylist-row="' + id + '"]');
      row?.querySelector('.buylist-card-links')?.replaceWith(purchaseLinks(fields.links, true));
      row?.querySelector('.buylist-memo-preview')?.replaceWith(purchaseMemoPreview(fields.memo));
      const title = row?.querySelector('.buylist-name');
      if (title) {
        title.replaceChildren();
        if (fields.links[0]) {
          const link = node('a', 'buylist-link', item.name); link.href = fields.links[0];
          link.target = '_blank'; link.rel = 'noopener noreferrer'; title.append(link);
        } else title.textContent = item.name;
      }
      // Keep the active purchase input and IME composition intact during autosave.
      const prep = elements.inventoryList?.querySelector('[data-inventory-row="' + id + '"] .inventory-info');
      if (prep) {
        prep.querySelectorAll('.task-detail, .buylist-links, .editor-error').forEach(part => part.remove());
        const actions = prep.querySelector('.item-actions');
        if (fields.memo) prep.insertBefore(detailNode(fields.memo), actions);
        if (fields.links.length) prep.insertBefore(purchaseLinks(fields.links), actions);
      }
    }

    function addPurchase(group) {
      if (cloudLocked || persistenceBlocked) return;
      const editor = dialogForm(group.name + ' · 항목 추가', purchaseHint);
      if (!editor) return;
      const name = formField(editor.form, '이름 *', {required:true,max:240,wide:true});
      const links = formField(editor.form, '링크 · 한 줄에 하나', {type:'textarea',max:6000,wide:true,placeholder:'https://…',help:purchaseHint});
      const memo = formField(editor.form, '메모', {type:'textarea',max:6000,wide:true,help:purchaseHint});
      links.inputMode = 'url'; links.spellcheck = false; links.autocapitalize = 'off';
      editor.submit.textContent = '추가';
      editor.finish(() => {
        const suffix = globalThis.crypto?.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, digit => { const n = Math.floor(Math.random() * 16); return (digit === 'x' ? n : (n & 3) | 8).toString(16); });
        const id = 'shop-' + group.key + '-' + suffix;
        storePurchase(purchases.add(state, group, {id,name:name.value,links:purchases.validateLinks(links.value),memo:memo.value}));
        renderInventoryFilters(); renderInventory(); editor.dialog.close(); notify('이 묶음과 06 준비표에 항목을 추가했어요.');
      });
    }

    function removeAddedPurchase(item) {
      if (cloudLocked || persistenceBlocked || !purchases.isCustom(item.id, purchaseGroups)) return;
      const editor = dialogForm('추가 항목 삭제', '“' + item.name + '” 항목과 체크·링크·메모를 구매 목록과 준비표에서 삭제할까요?');
      if (!editor) return;
      editor.submit.textContent = '삭제';
      editor.finish(() => {
        const next = clone(state);
        next.definitions.inventory = next.definitions.inventory.filter(entry => entry.id !== item.id);
        delete next.inventory[item.id]; storePurchase(next); purchaseDrafts.delete(item.id);
        renderInventory(); editor.dialog.close(); notify('추가 항목을 삭제했어요.');
      });
    }

    function renderBuyList() {
      const list = byId('buylist-list'); if (!list) return;
      const expanded = new Set(Array.from(list.querySelectorAll('[data-purchase-editor][open]')).map(el => el.dataset.purchaseEditor));
      const openGroups = new Set(Array.from(list.querySelectorAll('details.buylist-group[open]')).map(el => el.id));
      const active = document.activeElement;
      const focus = active?.dataset.buylistField ? {id:active.id,start:active.selectionStart,end:active.selectionEnd} : null;
      const allItems = purchaseItems(), tripView = buylistFilter !== 'branding';
      const groups = purchaseGroups.filter(group => tripView ? Boolean(group.trip) && (buylistFilter === 'trip' || group.shoppingGroup === buylistFilter) : !group.trip);
      const labels = {'검토':'후보','견적 요청':'시안·견적 요청','발주':'주문함·제작 중','준비 완료':'도착·시험 끝'};
      const counts = {'검토':0,'견적 요청':0,'발주':0,'준비 완료':0};
      const onlyRemaining = byId('buylist-incomplete')?.checked;
      let displayed = 0, total = 0;
      textAt('buylist-title', tripView ? '10/26 팔시보 구매.' : '브랜딩·포장 구매 목록.');
      textAt('buylist-intro', tripView ? '다희 님 배치안에서 필요한 것만, 보유 수량과 치수를 확인한 뒤 준비해요. 체크·링크·메모는 06 준비표와 함께 저장돼요.' : '판매처 링크와 현장 메모를 항목마다 적어 두세요. 06 준비표와 같은 기록으로 이어집니다.');
      const decisions = byId('buylist-decisions'); if (decisions) decisions.hidden = tripView;
      const tools = byId('palsibo-tools'); if (tools) tools.hidden = false;
      const filterNames = {today:'오늘 구매',verify:'현장 확인',owned:'이미 있음',elsewhere:'별도 준비',trip:'현장 전체',branding:'브랜딩·포장'};
      byId('buylist-filters')?.querySelectorAll('[data-buylist-filter]').forEach(button => {
        const key = button.dataset.buylistFilter, selected = key === buylistFilter;
        const count = allItems.filter(item => key === 'branding' ? !item.trip : Boolean(item.trip) && (key === 'trip' || item.shoppingGroup === key)).length;
        button.textContent = filterNames[key] + (key === 'branding' ? '' : ' ' + count);
        button.setAttribute('aria-pressed', String(selected)); button.classList.toggle('active', selected);
      });
      const copyItems = allItems.filter(item => tripView ? Boolean(item.trip) : !item.trip);
      textAt('buylist-copy-scope', '복사 범위: ' + (tripView ? '팔시보 전체 ' : '브랜딩·포장 전체 ') + copyItems.length + '개 · 저장된 링크와 메모 포함');
      const fragment = document.createDocumentFragment();
      for (const groupData of groups) {
        const groupItems = allItems.filter(item => item.groupKey === groupData.key);
        const items = groupItems.filter(item => !onlyRemaining || inventoryRecord(item).status !== '준비 완료');
        total += groupItems.length;
        const later = groupData.key === 'later';
        const group = node(later ? 'details' : 'div', 'buylist-group' + (later ? ' buylist-fold' : ''));
        group.id = 'buylist-' + groupData.key; if (later) group.open = openGroups.has(group.id);
        const heading = node(later ? 'summary' : 'h3', '', groupData.name);
        heading.append(node('small', '', items.length + '개' + (onlyRemaining ? ' / ' + groupItems.length : '')));
        if (later) heading.append(node('span', 'buylist-fold-hint', '눌러서 펼치기'));
        const body = node('div', 'buylist-rows'); group.append(heading, body);
        for (const item of items) {
          displayed += 1;
          const record = inventoryRecord(item), fields = purchaseInfo(item), trip = Boolean(item.trip);
          const custom = purchases.isCustom(item.id, purchaseGroups);
          const status = record.status; if (status in counts) counts[status] += 1;
          const row = node('article', 'buylist-row'); row.dataset.buylistRow = item.id;
          row.classList.toggle('buylist-done', status === '준비 완료');
          const info = node('div', 'buylist-info'), title = node('h4', 'buylist-name');
          if (fields.links[0]) {
            const link = node('a', 'buylist-link', item.name); link.href = fields.links[0]; link.target = '_blank'; link.rel = 'noopener noreferrer'; title.append(link);
          } else title.textContent = item.name;
          info.append(title, purchaseLinks(fields.links, true), purchaseMemoPreview(fields.memo));
          if (item.use) info.append(node('p', 'buylist-use', item.use));
          if (item.note) info.append(node('p', 'buylist-memo', item.note));
          if (trip && item.figure) info.append(node('p', 'buylist-memo', '그림 자리 · ' + item.figure));
          if (trip && item.image) {
            try {
              const url = purchases.validateLinks([item.image])[0];
              const figure = node('a', 'buylist-link', '다희 님 배치 그림 보기 ↗');
              figure.href = url; figure.target = '_blank'; figure.rel = 'noopener noreferrer'; info.append(figure);
            } catch (_) {}
          }
          if (item.ink && Array.isArray(item.ink.links)) {
            const line = node('p', 'buylist-ink'); line.append(node('strong', '', item.ink.lead || '이 도장엔 →'));
            item.ink.links.forEach((entry, index) => {
              line.append(document.createTextNode(index ? ' · ' : ' '));
              try {
                const href = purchases.validateLinks([entry.href])[0];
                const link = node('a', 'buylist-link', entry.label); link.href = href; link.target = '_blank'; link.rel = 'noopener noreferrer'; line.append(link);
              } catch (_) { line.append(document.createTextNode(String(entry.label || ''))); }
            });
            if (item.ink.more) { const jump = node('a', 'buylist-link', ' 다른 잉크 보기 ↓'); jump.href = '#buylist-ink'; line.append(jump); }
            if (item.ink.note) line.append(node('span', 'buylist-ink-note', ' ' + item.ink.note));
            info.append(line);
          }
          const meta = node('div', 'task-meta');
          if (item.tag) meta.append(node('span', 'tag', item.tag));
          if (item.logo) meta.append(node('span', 'tag' + (item.logo === '필요' ? ' tag-logo' : ''), '로고 ' + item.logo));
          if (item.chip) meta.append(node('span', 'tag ' + (item.chipKind === 'ask' ? 'tag-ask' : 'tag-ok'), item.chip));
          if (meta.childNodes.length) info.append(meta);
          const editor = purchaseEditor(item, item.name); editor.open = expanded.has(item.id); info.append(editor);
          const price = node('p', 'buylist-price', trip || custom ? record.quantity || item.qty || '' : item.price || '가격은 판매처에서 확인');
          const side = node('div', 'buylist-side');
          const chip = node('span', 'buylist-status', later ? '이번엔 안 함' : labels[status] || status);
          chip.dataset.status = later ? 'later' : status;
          if (trip) chip.textContent = status === '준비 완료' ? (item.shoppingGroup === 'verify' ? '확인 완료' : item.shoppingGroup === 'owned' ? '보유·재사용' : '준비 끝') : status === '검토' ? item.stage || '확인 필요' : labels[status];
          side.append(chip);
          if ((trip && item.shoppingGroup !== 'owned') || custom) {
            const label = node('label', 'incomplete-toggle'), check = node('input');
            check.type = 'checkbox'; check.dataset.palsiboCheck = item.id;
            check.checked = status === '준비 완료'; check.disabled = cloudLocked || persistenceBlocked;
            check.setAttribute('aria-label', (item.zone ? item.zone + ' ' : '') + item.name + (item.shoppingGroup === 'verify' ? ' 확인 완료' : ' 준비 끝'));
            label.append(check, document.createTextNode(item.shoppingGroup === 'verify' ? '확인 완료' : '준비 끝')); side.append(label);
          }
          const edit = editorButton('준비표에서 수정', '', () => {
            activeInventoryCategory = (state.definitions.inventory.find(entry => entry.id === item.id) || purchaseDefault(item)).category;
            inventoryQuery = ''; const search = byId('inventory-search'); if (search) search.value = '';
            renderInventoryFilters(); renderInventory();
            const target = elements.inventoryList.querySelector('[data-inventory-row="' + item.id + '"]');
            location.hash = 'inventory'; target?.scrollIntoView({block:'center'}); target?.querySelector('input')?.focus({preventScroll:true});
          });
          edit.disabled = cloudLocked || persistenceBlocked; side.append(edit);
          if (custom) { const remove = editorButton('추가 항목 삭제', '', () => removeAddedPurchase(item)); remove.disabled = cloudLocked || persistenceBlocked; side.append(remove); }
          row.append(info, price, side); body.append(row);
        }
        if (!items.length) body.append(node('p', 'empty-state', onlyRemaining ? '이 묶음은 준비가 끝났어요. 새 항목은 아래에서 추가할 수 있어요.' : '이 묶음의 항목을 추가해 주세요.'));
        const footer = node('div', 'buylist-add-row');
        const add = editorButton('+ 항목 추가', '', () => addPurchase(groupData));
        add.setAttribute('aria-label', groupData.name + ' 항목 추가'); add.disabled = cloudLocked || persistenceBlocked;
        footer.append(add); group.append(footer); fragment.append(group);
      }
      list.replaceChildren(fragment);
      textAt('buylist-summary', '표시 ' + displayed + ' / ' + total + '개 · 준비 완료 ' + counts['준비 완료'] + '개 · ' + (hasSharedLink ? '같은 공유 링크로 이어쓰기' : '이 기기에 저장 · 다른 기기는 공유 링크로 열기'));
      if (focus) {
        const restored = byId(focus.id);
        if (restored) { restored.focus({preventScroll:true}); restored.setSelectionRange(focus.start, focus.end); }
      }
    }

    byId('buylist-filters')?.addEventListener('click', event => {
      const button = event.target.closest('[data-buylist-filter]'); if (!button) return;
      buylistFilter = button.dataset.buylistFilter; renderBuyList();
    });
    byId('buylist-incomplete')?.addEventListener('change', renderBuyList);
    byId('buylist-list')?.addEventListener('change', event => {
      const input = event.target, id = input.dataset.palsiboCheck;
      const item = id && purchaseItems().find(entry => entry.id === id);
      if (!item || cloudLocked || persistenceBlocked || input.type !== 'checkbox') return;
      ensureInventory(id); state.inventory[id].status = input.checked ? '준비 완료' : '검토';
      save(); renderInventory();
    });
    byId('buylist-list')?.addEventListener('input', event => {
      const input = event.target, id = input.dataset.buylistId, field = input.dataset.buylistField;
      if (!id || !['links','memo'].includes(field) || cloudLocked || persistenceBlocked) return;
      const item = purchaseItems().find(entry => entry.id === id); if (!item) return;
      const row = input.closest('.buylist-row'), error = row.querySelector('[data-purchase-error="' + field + '"]');
      const status = row.querySelector('[data-purchase-save]');
      try {
        const value = field === 'links' ? purchases.validateLinks(input.value) : input.value;
        storePurchase(purchases.update(state, item, {[field]:value}, purchaseDefault(item)));
        const draft = purchaseDrafts.get(id) || {}; delete draft[field];
        if (Object.keys(draft).length) purchaseDrafts.set(id, draft); else purchaseDrafts.delete(id);
        error.textContent = ''; error.hidden = true; input.setAttribute('aria-invalid','false');
        status.textContent = hasSharedLink ? '이 기기에 저장했어요 · 공유 저장 상태는 페이지 안내에서 확인할 수 있어요.' : '이 기기에 저장했어요.';
        refreshPurchaseRow(id);
      } catch (failure) {
        const message = failure.message || '저장할 내용을 확인해 주세요.';
        purchaseDrafts.set(id, {...purchaseDrafts.get(id), [field]:{value:input.value,error:message}});
        error.textContent = message; error.hidden = false; input.setAttribute('aria-invalid','true');
        status.textContent = '이 입력은 저장하지 않았어요. 마지막 정상 값은 그대로예요.';
      }
    });
    byId('palsibo-copy')?.addEventListener('click', async () => {
      const tripView = buylistFilter !== 'branding';
      const items = purchaseItems().filter(item => tripView ? Boolean(item.trip) : !item.trip);
      const snapshot = {...state,definitions:{...state.definitions,inventory:inventoryEntries()}};
      let text;
      try { text = purchases.copyText(items, snapshot, '무무토리 · ' + (tripView ? '10/26 팔시보' : '브랜딩·포장') + ' 체크 결과'); }
      catch (error) { notify(error.message); return; }
      // Keep an accessible manual copy available when clipboard permission is absent.
      const box = byId('palsibo-copy-fallback'); box.value = text;
      try { await navigator.clipboard.writeText(text); box.hidden = true; notify('체크 결과를 복사했어요. 링크와 메모도 함께 들어 있어요.'); }
      catch (_) { box.hidden = false; box.focus(); box.select(); notify('아래 글을 선택해 복사해 주세요.'); }
    });

    document.querySelectorAll('[data-palsibo-link]').forEach(link => {
      const url = new URL(location.href); url.searchParams.set('shopping', 'palsibo-20261026'); url.hash = 'buylist'; link.href = url.href;
    });

    function renderInventorySummary(skipBuylist = false) {
      const entries = inventoryEntries();
      const prepared = entries.filter(item => inventoryRecord(item).status === '준비 완료').length;
      textAt('inventory-summary', prepared + ' / ' + entries.length + ' 품목 준비 완료');
      if (!skipBuylist) renderBuyList();
    }

    function renderInventory(skipBuylist = false) {
      if (!elements.inventoryList) return;
      const fragment = document.createDocumentFragment();
      inventoryEntries().filter(item => (activeInventoryCategory === '전체' || item.category === activeInventoryCategory) && (!inventoryQuery || [item.name, item.category, item.detail, item.priority].join(' ').toLocaleLowerCase('ko').includes(inventoryQuery))).forEach((item) => {
        const row = node('article', 'inventory-row');
        const record = inventoryRecord(item);
        row.classList.toggle('inventory-done', record.status === '준비 완료');
        row.dataset.inventoryRow = item.id;
        const info = node('div', 'inventory-info');
        info.append(node('h3', 'inventory-name', item.name));
        const meta = node('div', 'task-meta');
        if (item.category) meta.append(node('span', 'tag', item.category));
        if (item.priority) meta.append(node('span', 'tag tag-priority', item.priority));
        info.append(meta);
        const purchase = purchaseItems().find(entry => entry.id === item.id);
        if (purchase) {
          const fields = purchaseInfo(purchase);
          if (fields.memo) info.append(detailNode(fields.memo));
          if (fields.links.length) info.append(purchaseLinks(fields.links));
          if (fields.error) info.append(node('p', 'editor-error', fields.error));
        } else if (item.detail) info.append(detailNode(item.detail));
        const quantityLabel = node('label', 'inventory-quantity');
        quantityLabel.append(node('span', '', '수량'));
        const quantity = node('input');
        quantity.type = 'text';
        quantity.disabled = cloudLocked;
        quantity.maxLength = MAX_QUANTITY_LENGTH;
        quantity.value = record.quantity;
        quantity.dataset.inventoryId = item.id;
        quantity.dataset.field = 'quantity';
        quantity.setAttribute('aria-label', item.name + ' 수량');
        quantityLabel.append(quantity);
        const statusLabel = node('label', 'inventory-status');
        statusLabel.append(node('span', '', '준비 상태'));
        const select = node('select');
        select.disabled = cloudLocked;
        select.dataset.inventoryId = item.id;
        select.dataset.field = 'status';
        select.setAttribute('aria-label', item.name + ' 준비 상태');
        INVENTORY_STATUSES.forEach((value) => {
          const option = node('option', '', value);
          option.value = value;
          select.append(option);
        });
        select.value = record.status;
        statusLabel.append(select);
        info.append(purchaseById.has(item.id) ? tripActions(item) : itemActions('inventory', item));
        row.append(info, quantityLabel, statusLabel);
        fragment.append(row);
      });
      if (!fragment.childNodes.length) fragment.append(node('p', 'empty-state', '조건에 맞는 준비물이 없습니다. 검색어나 분류를 바꿔 보세요.'));
      elements.inventoryList.replaceChildren(fragment);
      renderInventorySummary(skipBuylist);
      budgetView?.render();
    }

    function renderInventoryFilters() {
      const filters = byId('inventory-filters');
      if (!filters) return;
      filters.replaceChildren();
      ['전체', ...new Set([...state.definitions.inventoryCategories, ...purchaseGroups.map(group => group.category)])].forEach(category => {
        const button = node('button', 'filter-button', category);
        button.type = 'button'; button.dataset.inventoryCategory = category;
        button.setAttribute('aria-pressed', String(category === activeInventoryCategory));
        filters.append(button);
      });
    }
    byId('inventory-filters')?.addEventListener('click', event => {
      const button = event.target.closest('[data-inventory-category]');
      if (!button) return;
      activeInventoryCategory = button.dataset.inventoryCategory;
      byId('inventory-filters').querySelectorAll('[data-inventory-category]').forEach(filter => filter.setAttribute('aria-pressed', String(filter.dataset.inventoryCategory === activeInventoryCategory)));
      renderInventory();
    });
    document.querySelectorAll('.next-actions a[href^="#task-"]').forEach(link => link.addEventListener('click', () => {
      activeCategory = '전체'; priorityFilter = '전체'; dueFilter = '전체'; const dueSelect = byId('task-due-filter'); if (dueSelect) dueSelect.value = '전체'; elements.search.value = ''; elements.incomplete.checked = false;
      renderFilters(); renderTasks();
    }));

    function renderPhases() {
      const container = byId('phases');
      if (!container || !Array.isArray(data.phases)) return;
      container.replaceChildren();
      data.phases.forEach((phase, index) => {
        const card = node('article', 'phase-card');
        card.append(node('span', 'phase-number', String(index + 1).padStart(2, '0')));
        card.append(node('h3', '', phase.title));
        card.append(node('p', '', phase.description));
        if (phase.gate) card.append(node('p', 'phase-gate', '진행 조건 · ' + phase.gate));
        container.append(card);
      });
    }

    function renderOpeningDate() {
      const value = state.openingDate;
      textAt('opening-label', value ? value.split('-').join('.') + ' 오픈 목표' : '오픈일 미정 · 준비 조건부터 확인');
    }

    function renderEditableFields() {
      if (elements.note) {
        elements.note.maxLength = MAX_NOTE_LENGTH;
        elements.note.value = state.note;
      }
      if (elements.openingDate) elements.openingDate.value = state.openingDate;
      renderOpeningDate();
    }

    if (elements.filters) elements.filters.addEventListener('click', (event) => {
      const button = event.target.closest('button[data-category]');
      if (!button || !elements.filters.contains(button)) return;
      activeCategory = button.dataset.category;
      elements.filters.querySelectorAll('button[data-category]').forEach((filter) => {
        const active = filter.dataset.category === activeCategory;
        filter.classList.toggle('active', active);
        filter.setAttribute('aria-pressed', String(active));
      });
      renderTasks();
    });
    if (elements.search) elements.search.addEventListener('input', renderTasks);
    if (elements.incomplete) elements.incomplete.addEventListener('change', renderTasks);
    if (elements.taskList) elements.taskList.addEventListener('change', (event) => {
      if (cloudLocked) return;
      const check = event.target;
      const id = check.dataset.taskId;
      if (!id || !taskIds.has(id) || check.type !== 'checkbox') return;
      state.tasks[id] = check.checked;
      save();
      renderTasks();
      const restored = byId('task-' + id);
      if (restored) restored.focus({ preventScroll: true });
      else if (elements.incomplete) elements.incomplete.focus({ preventScroll: true });
    });
    if (elements.inventoryList) {
      elements.inventoryList.addEventListener('input', (event) => {
        if (cloudLocked) return;
        const input = event.target;
        const id = input.dataset.inventoryId;
        if (persistenceBlocked || input.dataset.field !== 'quantity' || !ensureInventory(id)) return;
        state.inventory[id].quantity = input.value.slice(0, MAX_QUANTITY_LENGTH);
        save();
        budgetView?.render();
        renderBuyList();
      });
      elements.inventoryList.addEventListener('change', (event) => {
        if (cloudLocked) return;
        const select = event.target;
        const id = select.dataset.inventoryId;
        if (persistenceBlocked || select.dataset.field !== 'status' || !INVENTORY_STATUSES.includes(select.value) || !ensureInventory(id)) return;
        state.inventory[id].status = select.value;
        const row = select.closest('.inventory-row');
        if (row) row.classList.toggle('inventory-done', select.value === '준비 완료');
        save();
        renderInventorySummary();
      });
    }
    if (elements.note) elements.note.addEventListener('input', () => {
      if (cloudLocked) return;
      state.note = elements.note.value.slice(0, MAX_NOTE_LENGTH);
      save();
    });
    if (elements.openingDate) elements.openingDate.addEventListener('change', () => {
      if (cloudLocked) return;
      const value = elements.openingDate.value;
      if (!validDate(value)) {
        notify('올바른 날짜를 선택해 주세요.');
        return;
      }
      state.openingDate = value;
      save();
      renderOpeningDate();
    });

    const exportButton = byId('export-button');
    if (exportButton) exportButton.addEventListener('click', () => {
      const blob = new Blob([JSON.stringify(state, null, 2) + '\n'], { type: 'application/json;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'mumutori-offline-' + new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()) + '.json';
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      notify('현재 체크리스트, 준비물, 메모를 JSON 파일로 내보냈습니다.');
    });
    byId('copy-backup-button')?.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(JSON.stringify(state, null, 2) + '\n'); notify('목록·메모·예산을 포함한 전체 준비 기록 JSON을 복사했습니다.'); }
      catch (_) { notify('복사할 수 없습니다. 준비 기록 내보내기를 사용해 주세요.'); }
    });

    const importFile = byId('import-file');
    if (importFile) importFile.addEventListener('change', async () => {
      const file = importFile.files && importFile.files[0];
      if (!file) return;
      try {
        if (file.size > MAX_IMPORT_BYTES) throw new Error('16MB 이하의 프로젝트 JSON 파일을 선택해 주세요.');
        let candidate;
        try { candidate = JSON.parse(await file.text()); }
        catch (error) { throw new Error('JSON 파일을 읽을 수 없습니다. 기존 내용은 유지됩니다.'); }
        const next = validateAndMerge(candidate, state);
        if (cloudLocked) throw new Error('연결 상태를 확인한 후 다시 가져와 주세요.');
        if (!window.confirm(candidate.version === 1
          ? '이전 형식의 기록을 가져옵니다. 현재 편집한 목록은 유지하고 완료 상태·수량·메모·날짜를 적용할까요?'
          : '현재 목록과 기록을 가져온 파일의 내용으로 바꿀까요? 바꾸기 전 기록은 이 브라우저에 한 번 더 백업합니다.')) return;
        try {
          const before = localStorage.getItem(STORAGE_KEY);
          if (before !== null) localStorage.setItem(STORAGE_KEY + '-before-import', before);
        } catch (_) { throw new Error('가져오기 전 백업을 저장하지 못했습니다. 현재 기록을 JSON으로 먼저 내보내 주세요.'); }
        // A valid, explicitly selected import may replace otherwise protected storage.
        let persisted = true;
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); }
        catch (error) { persisted = false; }
        state = next;
        syncDefinitions(); renderFilters(); renderInventoryFilters();
        if (persisted) { persistenceBlocked = false; if (cloud) cloud.record(state); }
        else if (cloud) cloud.pause(new Error('가져온 기록을 기기에 저장하지 못해 동기화를 중단했습니다. JSON을 보관해 주세요.'));
        renderTasks();
        renderInventory();
        renderEditableFields();
        setSaveStatus(persisted ? '가져온 내용을 이 브라우저에 저장함' : '가져옴 · 브라우저 저장 실패', !persisted);
        notify(persisted
          ? '목록과 준비 기록을 가져왔습니다. 이전 형식 파일은 현재 목록의 항목에 적용됩니다.'
          : '화면에는 가져왔지만 브라우저에 저장하지 못했습니다. JSON 파일을 보관해 주세요.', !persisted);
      } catch (error) {
        notify(error.message || '파일을 가져오지 못했습니다. 기존 내용은 유지됩니다.');
      } finally {
        importFile.value = '';
      }
    });

    const dialog = byId('image-dialog');
    const dialogImage = byId('dialog-image');
    const dialogCaption = byId('dialog-caption');
    const dialogClose = byId('dialog-close');
    function closeDialog() {
      if (dialog && dialog.open) dialog.close();
    }
    if (dialog && dialogImage) {
      document.addEventListener('click', (event) => {
        const trigger = event.target.closest('[data-image]');
        if (!trigger) return;
        const source = trigger.dataset.image;
        if (!source) return;
        let parsed;
        try { parsed = new URL(source, document.baseURI); }
        catch (error) { return; }
        if (!['http:', 'https:', 'file:', 'blob:'].includes(parsed.protocol)) return;
        if (parsed.protocol === 'blob:' && parsed.origin !== location.origin) return;
        lastImageTrigger = trigger;
        const caption = trigger.dataset.caption || '';
        dialogImage.src = parsed.href;
        dialogImage.alt = caption;
        if (dialogCaption) dialogCaption.textContent = caption;
        if (typeof dialog.showModal === 'function') dialog.showModal();
        else {
          notify('이 브라우저는 이미지 확대 창을 지원하지 않습니다.');
          return;
        }
        if (dialogClose) dialogClose.focus();
      });
      if (dialogClose) dialogClose.addEventListener('click', closeDialog);
      dialog.addEventListener('click', (event) => {
        if (event.target !== dialog) return;
        const bounds = dialog.getBoundingClientRect();
        if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) closeDialog();
      });
      dialog.addEventListener('close', () => {
        if (lastImageTrigger && document.contains(lastImageTrigger)) lastImageTrigger.focus({ preventScroll: true });
      });
    }

    installEditors();
    syncDefinitions();
    renderFilters();
    renderTasks();
    renderInventoryFilters();
    renderInventory();
    renderPhases();
    renderEditableFields();

    if (window.createOfflineBudget && byId('budget-dashboard')) budgetView = window.createOfflineBudget({
      element: byId('budget-dashboard'),
      getInventory: () => state.definitions.inventory.map(item => ({...item, ...state.inventory[item.id]})),
      getBudget: () => state.budget || {},
      onChangeBudget: next => {
        if (cloudLocked || persistenceBlocked) return false;
        try { state.budget = window.OfflineBudgetState.normalize(next); return save(); }
        catch (error) { notify(error.message); budgetView?.render(); return false; }
      },
      isLocked: () => cloudLocked || persistenceBlocked,
    });
    budgetView?.render();

    if (window.createOfflineCloud) cloud = window.createOfflineCloud({
      getState: () => state,
      isPristine: () => JSON.stringify(state) === JSON.stringify(createDefaults()),
      validate: (value, base) => validateAndMerge(value, base || createDefaults()),
      blocked: () => persistenceBlocked,
      settled: cloudSettled,
      lock: locked => {
        cloudLocked = locked;
        budgetView?.setLocked(locked || persistenceBlocked);
        document.querySelectorAll('#task-list input, #task-list .item-actions button, #inventory-list input, #inventory-list select, #inventory-list .item-actions button, [data-palsibo-check], #buylist-list .item-actions button, #buylist-list textarea, #buylist-list button, .list-editor-toolbar-actions button, #list-editor-dialog input, #list-editor-dialog select, #list-editor-dialog textarea, #list-editor-dialog .editor-form button, #project-note, #opening-date, #import-file, #restore-before-import').forEach(control => { control.disabled = locked || persistenceBlocked; });
      },
      receive: next => {
        // Persist before replacing the visible draft: quota errors preserve local work.
        if (persistenceBlocked) throw new Error('기존 기기 기록을 확인하기 전에는 클라우드 기록으로 바꾸지 않습니다.');
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); }
        catch (_) { setSaveStatus('기기 백업 실패 · JSON으로 내보내 주세요', true); throw new Error('기기 백업에 실패해 동기화를 중단했습니다. 현재 기록을 JSON으로 내보내 주세요.'); }
        // Preserve the active field and caret during unrelated remote edits.
        const active = document.activeElement;
        const locator = active?.id ? '#' + CSS.escape(active.id) : active?.dataset.inventoryId ? '[data-inventory-id="' + active.dataset.inventoryId + '"][data-field="' + active.dataset.field + '"]' : null;
        const selection = active && typeof active.selectionStart === 'number' ? [active.selectionStart, active.selectionEnd] : null;
        const previous = state;
        state = next;
        syncDefinitions(); renderFilters(); renderInventoryFilters();
        if (JSON.stringify(previous.definitions) !== JSON.stringify(next.definitions)) { renderTasks(); renderInventory(); }
        if (JSON.stringify(previous.tasks) !== JSON.stringify(next.tasks)) renderTasks();
        if (JSON.stringify(previous.inventory) !== JSON.stringify(next.inventory)) { renderInventory(); renderInventorySummary(); }
        if (previous.note !== next.note && elements.note) elements.note.value = next.note;
        if (previous.openingDate !== next.openingDate) renderEditableFields();
        if (JSON.stringify(previous.budget) !== JSON.stringify(next.budget)) budgetView?.render();
        if (locator) {
          const restored = document.querySelector(locator);
          if (restored) { restored.focus({preventScroll:true}); if (selection && restored.setSelectionRange) restored.setSelectionRange(...selection); }
        }
        setSaveStatus('클라우드 기록을 이 기기에 백업함', false);
      }
    });

    queueMicrotask(migratePalsibo);

    // Browser tools use the same locally stored state as the visible UI.
    if (document.modelContext?.registerTool) {
      const lifecycle = new AbortController();
      const register = tool => { try { Promise.resolve(document.modelContext.registerTool(tool, {signal:lifecycle.signal})).catch(() => {}); } catch (_) {} };
      register({name:'export_offline_project',title:'전체 준비 기록 JSON 읽기',description:'Read the complete current checklist definitions, inventory, note, opening date and budget for backup. No changes are made.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true,untrustedContentHint:true},execute:()=>clone(state)});
      register({name:'read_offline_project', title:'무무토리 준비 상태 읽기', description:'Read the visible checklist, supplies, note and opening date, stored in this browser.', inputSchema:{type:'object',properties:{},additionalProperties:false}, annotations:{readOnlyHint:true,untrustedContentHint:true}, execute:() => ({tasks:data.tasks.map(t=>({id:t.id,title:t.title,owner:t.owner,dependsOn:t.dependsOn,done:state.tasks[t.id]})),inventory:data.inventory.map(i=>({id:i.id,name:i.name,...state.inventory[i.id]})),note:state.note,openingDate:state.openingDate,storage:cloud?.connected()?'firebase-and-device':'this-browser-only'})});
      register({name:'set_offline_task_completion', title:'무무토리 할 일 완료 상태 변경', description:'Set one checklist item complete or incomplete, save to this browser.', inputSchema:{type:'object',properties:{id:{type:'string'},done:{type:'boolean'}},required:['id','done'],additionalProperties:false}, annotations:{readOnlyHint:false,untrustedContentHint:false}, execute:input=>{
        if(!isObject(input)||!hasExactKeys(input,['id','done'])||!taskIds.has(input.id)||typeof input.done!=='boolean') throw new Error('올바른 항목과 완료 값을 입력하세요.');
        if(cloudLocked) throw new Error('클라우드 연결 확인 중에는 수정할 수 없습니다.');
        if(persistenceBlocked) throw new Error('기존 저장 자료를 먼저 확인해 주세요.');
        state.tasks[input.id]=input.done;const saved=save();renderTasks();return {id:input.id,done:input.done,saved,storage:cloud?.connected()?'firebase-and-device':'this-browser-only'};
      }});
      window.addEventListener('pagehide',event=>{ if (!event.persisted) lifecycle.abort(); });
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
}());
