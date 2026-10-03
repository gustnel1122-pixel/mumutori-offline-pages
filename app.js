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
    let state = createDefaults();

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
      return { version: 2, tasks, inventory, note: '', openingDate: '', definitions: {
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
      if (activeInventoryCategory !== '전체' && !state.definitions.inventoryCategories.includes(activeInventoryCategory)) activeInventoryCategory = '전체';
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
      if (!hasExactKeys(candidate, fields) || !isObject(candidate.tasks) || !isObject(candidate.inventory)) throw new Error('무무토리 프로젝트에서 내보낸 JSON 파일을 선택해 주세요.');
      if (typeof candidate.note !== 'string' || candidate.note.length > MAX_NOTE_LENGTH) throw new Error('메모 형식이나 길이가 올바르지 않습니다.');
      if (typeof candidate.openingDate !== 'string' || !validDate(candidate.openingDate)) throw new Error('오픈 목표일 형식이 올바르지 않습니다.');
      for (const value of Object.values(candidate.tasks)) if (typeof value !== 'boolean') throw new Error('체크리스트 값이 올바르지 않습니다.');
      for (const value of Object.values(candidate.inventory)) {
        if (!isObject(value) || !hasExactKeys(value, ['quantity', 'status']) || typeof value.quantity !== 'string' || value.quantity.length > MAX_QUANTITY_LENGTH || !INVENTORY_STATUSES.includes(value.status)) throw new Error('준비물 수량 또는 상태가 올바르지 않습니다.');
      }
      const definitions = candidate.version === 2 ? validateDefinitions(candidate.definitions) : clone(base.definitions);
      const next = { version: 2, tasks: Object.create(null), inventory: Object.create(null), note: candidate.note, openingDate: candidate.openingDate, definitions };
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
      const entry = state.definitions[kind].find(item => item.id === id);
      const editor = dialogForm((entry ? '수정 · ' : '추가 · ') + (task ? '할 일' : '준비물'), '내용과 분류를 실제 계획에 맞게 바꾸세요. 저장한 항목과 기록은 JSON 백업에도 포함됩니다.');
      if (!editor) return;
      const { form, dialog } = editor;
      const grid = node('div', 'editor-grid'); form.append(grid);
      const name = formField(grid, task ? '할 일 이름 *' : '준비물 이름 *', { value: entry?.[task ? 'title' : 'name'], required: true, max: 240, wide: true });
      const categories = state.definitions[categoryKey(kind)];
      const selected = entry?.category || (task ? activeCategory : activeInventoryCategory);
      const category = formField(grid, '분류', { type: 'select', items: categories.length ? categories : ['미분류'], value: categories.includes(selected) ? selected : categories[0] || '미분류' });
      const newCategory = formField(grid, '새 분류로 저장', { max: 60, placeholder: '필요할 때만 입력', help: '입력하면 왼쪽 선택 대신 새 분류를 사용합니다.' });
      const priority = formField(grid, '중요도', { value: entry?.priority || '선택', max: 80, placeholder: '예: 필수, 선택, 확인 완료' });
      let owner, quantity, status;
      if (task) owner = formField(grid, '담당자', { value: entry?.owner, max: 160, placeholder: '예: 무무토리 · 제작 업체' });
      else {
        quantity = formField(grid, '수량 / 규격 메모', { value: entry ? state.inventory[entry.id].quantity : '', max: MAX_QUANTITY_LENGTH });
        status = formField(grid, '준비 상태', { type: 'select', items: INVENTORY_STATUSES, value: entry ? state.inventory[entry.id].status : '검토' });
      }
      const dueDate = task ? formField(grid, '완료 목표일', { type: 'date', value: entry?.dueDate, help: '아직 정해지지 않았다면 비워 두세요.' }) : null;
      const detail = formField(grid, '상세 내용', { type: 'textarea', value: entry?.detail, max: 6000, wide: true });
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
        const definitions = clone(state.definitions);
        const chosenCategory = checkedCategory(newCategory.value || category.value);
        if (!definitions[categoryKey(kind)].includes(chosenCategory)) definitions[categoryKey(kind)].push(chosenCategory);
        const next = task
          ? { id: entry?.id || newItemId(kind), title: name.value.trim(), category: chosenCategory, owner: owner.value.trim(), priority: priority.value.trim(), detail: detail.value.trim(), dependsOn: dependencies.filter(check => check.checked).map(check => check.value), dueDate: dueDate.value, status: entry && state.tasks[entry.id] ? 'done' : 'todo' }
          : { id: entry?.id || newItemId(kind), name: name.value.trim(), category: chosenCategory, priority: priority.value.trim(), quantity: quantity.value, detail: detail.value.trim(), status: status.value };
        const index = definitions[kind].findIndex(item => item.id === id);
        if (index < 0) definitions[kind].push(next); else definitions[kind][index] = next;
        validateDefinitions(definitions);
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
        const previous = localStorage.getItem(STORAGE_KEY + '-before-import');
        if (!previous) { notify('이 브라우저에 가져오기 전 백업이 없습니다.'); return; }
        if (!window.confirm('마지막 JSON 가져오기 직전의 목록과 기록으로 복원할까요? 현재 내용이 필요하면 먼저 JSON으로 내보내 주세요.')) return;
        try {
          const next = validateAndMerge(JSON.parse(previous), createDefaults());
          localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); state = next; persistenceBlocked = false;
          syncDefinitions(); renderFilters(); renderTasks(); renderInventoryFilters(); renderInventory(); renderEditableFields();
          setSaveStatus('가져오기 전 기록 복원됨', false); notify('가져오기 전 기록으로 복원했습니다.');
        } catch (_) { notify('이전 백업을 읽거나 저장하지 못했습니다. 현재 기록을 JSON으로 먼저 내보내 주세요.'); }
      });
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
        if (task.detail) info.append(node('p', 'task-detail', task.detail));
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

    function renderInventorySummary() {
      const prepared = data.inventory.filter((item) => state.inventory[item.id].status === '준비 완료').length;
      textAt('inventory-summary', prepared + ' / ' + data.inventory.length + ' 품목 준비 완료');
    }

    function renderInventory() {
      if (!elements.inventoryList) return;
      const fragment = document.createDocumentFragment();
      data.inventory.filter(item => (activeInventoryCategory === '전체' || item.category === activeInventoryCategory) && (!inventoryQuery || [item.name, item.category, item.detail, item.priority].join(' ').toLocaleLowerCase('ko').includes(inventoryQuery))).forEach((item) => {
        const row = node('article', 'inventory-row');
        row.classList.toggle('inventory-done', state.inventory[item.id].status === '준비 완료');
        row.dataset.inventoryRow = item.id;
        const info = node('div', 'inventory-info');
        info.append(node('h3', 'inventory-name', item.name));
        const meta = node('div', 'task-meta');
        if (item.category) meta.append(node('span', 'tag', item.category));
        if (item.priority) meta.append(node('span', 'tag tag-priority', item.priority));
        info.append(meta);
        if (item.detail) info.append(node('p', 'task-detail', item.detail));
        const quantityLabel = node('label', 'inventory-quantity');
        quantityLabel.append(node('span', '', '수량'));
        const quantity = node('input');
        quantity.type = 'text';
        quantity.disabled = cloudLocked;
        quantity.maxLength = MAX_QUANTITY_LENGTH;
        quantity.value = state.inventory[item.id].quantity;
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
        select.value = state.inventory[item.id].status;
        statusLabel.append(select);
        info.append(itemActions('inventory', item));
        row.append(info, quantityLabel, statusLabel);
        fragment.append(row);
      });
      if (!fragment.childNodes.length) fragment.append(node('p', 'empty-state', '조건에 맞는 준비물이 없습니다. 검색어나 분류를 바꿔 보세요.'));
      elements.inventoryList.replaceChildren(fragment);
      renderInventorySummary();
    }

    function renderInventoryFilters() {
      const filters = byId('inventory-filters');
      if (!filters) return;
      filters.replaceChildren();
      ['전체', ...state.definitions.inventoryCategories].forEach(category => {
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
        if (!inventoryIds.has(id) || input.dataset.field !== 'quantity') return;
        state.inventory[id].quantity = input.value.slice(0, MAX_QUANTITY_LENGTH);
        save();
      });
      elements.inventoryList.addEventListener('change', (event) => {
        if (cloudLocked) return;
        const select = event.target;
        const id = select.dataset.inventoryId;
        if (!inventoryIds.has(id) || select.dataset.field !== 'status' || !INVENTORY_STATUSES.includes(select.value)) return;
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

    if (window.createOfflineCloud) cloud = window.createOfflineCloud({
      getState: () => state,
      validate: value => validateAndMerge(value, createDefaults()),
      blocked: () => persistenceBlocked,
      lock: locked => {
        cloudLocked = locked;
        document.querySelectorAll('#task-list input, #inventory-list input, #inventory-list select, #project-note, #opening-date, #import-file').forEach(control => { control.disabled = locked; });
      },
      receive: next => {
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
        if (locator) {
          const restored = document.querySelector(locator);
          if (restored) { restored.focus({preventScroll:true}); if (selection && restored.setSelectionRange) restored.setSelectionRange(...selection); }
        }
        if (!persistenceBlocked) {
          try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); setSaveStatus('클라우드 기록을 이 기기에 백업함', false); }
          catch (_) { setSaveStatus('기기 백업 실패 · JSON으로 내보내 주세요', true); throw new Error('기기 백업에 실패해 동기화를 중단했습니다. JSON으로 내보내 주세요.'); }
        }
      }
    });

    // Browser tools use the same locally stored state as the visible UI.
    if (document.modelContext?.registerTool) {
      const lifecycle = new AbortController();
      const register = tool => { try { Promise.resolve(document.modelContext.registerTool(tool, {signal:lifecycle.signal})).catch(() => {}); } catch (_) {} };
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
