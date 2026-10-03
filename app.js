(function () {
  'use strict';

  const STORAGE_KEY = 'mumutori-offline-planner-v1';
  const INVENTORY_STATUSES = ['검토', '견적 요청', '발주', '준비 완료'];
  const MAX_NOTE_LENGTH = 20000;
  const MAX_QUANTITY_LENGTH = 80;
  const MAX_IMPORT_BYTES = 2 * 1024 * 1024;

  function init() {
    const data = window.OFFLINE_DATA;
    if (!data || !Array.isArray(data.tasks) || !Array.isArray(data.inventory)) {
      const status = document.getElementById('save-status');
      if (status) status.textContent = '프로젝트 자료를 불러오지 못했습니다. 페이지를 새로 열어 주세요.';
      return;
    }

    const byId = (id) => document.getElementById(id);
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
    let persistenceBlocked = false;
    let toastTimer;
    let lastImageTrigger = null;
    let cloud = null;
    let cloudLocked = false;
    let state = createDefaults();

    function createDefaults() {
      const tasks = Object.create(null);
      const inventory = Object.create(null);
      data.tasks.forEach((task) => { tasks[task.id] = task.status === 'done'; });
      data.inventory.forEach((item) => {
        inventory[item.id] = {
          quantity: String(item.quantity == null ? '' : item.quantity),
          status: INVENTORY_STATUSES.includes(item.status) ? item.status : '검토',
        };
      });
      return { version: 1, tasks, inventory, note: '', openingDate: '' };
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

    // Validate every field before merging. Unrecognized item IDs never enter state.
    function validateAndMerge(candidate, base) {
      if (!isObject(candidate) || !hasExactKeys(candidate, ['version', 'tasks', 'inventory', 'note', 'openingDate'])) {
        throw new Error('무무토리 프로젝트에서 내보낸 JSON 파일을 선택해 주세요.');
      }
      if (candidate.version !== 1 || !isObject(candidate.tasks) || !isObject(candidate.inventory)) {
        throw new Error('지원하지 않는 저장 형식입니다.');
      }
      if (typeof candidate.note !== 'string' || candidate.note.length > MAX_NOTE_LENGTH) {
        throw new Error('메모 형식이나 길이가 올바르지 않습니다.');
      }
      if (typeof candidate.openingDate !== 'string' || !validDate(candidate.openingDate)) {
        throw new Error('오픈 목표일 형식이 올바르지 않습니다.');
      }
      for (const value of Object.values(candidate.tasks)) {
        if (typeof value !== 'boolean') throw new Error('체크리스트 값이 올바르지 않습니다.');
      }
      for (const value of Object.values(candidate.inventory)) {
        if (!isObject(value) || !hasExactKeys(value, ['quantity', 'status']) ||
            typeof value.quantity !== 'string' || value.quantity.length > MAX_QUANTITY_LENGTH ||
            !INVENTORY_STATUSES.includes(value.status)) {
          throw new Error('준비물 수량 또는 상태가 올바르지 않습니다.');
        }
      }
      const next = {
        version: 1,
        tasks: Object.assign(Object.create(null), base.tasks),
        inventory: Object.create(null),
        note: candidate.note,
        openingDate: candidate.openingDate,
      };
      Object.entries(base.inventory).forEach(([id, item]) => {
        next.inventory[id] = { quantity: item.quantity, status: item.status };
      });
      Object.entries(candidate.tasks).forEach(([id, value]) => {
        if (taskIds.has(id)) next.tasks[id] = value;
      });
      Object.entries(candidate.inventory).forEach(([id, value]) => {
        if (inventoryIds.has(id)) next.inventory[id] = { quantity: value.quantity, status: value.status };
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
      ['전체', ...new Set(data.tasks.map((task) => task.category))].forEach((category) => {
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
      const visible = data.tasks.filter((task) => {
        const searchText = [task.title, task.category, task.owner, task.detail, task.priority].join(' ').toLocaleLowerCase('ko');
        return (activeCategory === '전체' || task.category === activeCategory) &&
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
        row.append(check, info);
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
      data.inventory.filter(item => activeInventoryCategory === '전체' || item.category === activeInventoryCategory).forEach((item) => {
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
        row.append(info, quantityLabel, statusLabel);
        fragment.append(row);
      });
      elements.inventoryList.replaceChildren(fragment);
      renderInventorySummary();
    }

    function renderInventoryFilters() {
      const filters = byId('inventory-filters');
      if (!filters) return;
      filters.replaceChildren();
      ['전체', ...new Set(data.inventory.map(item => item.category))].forEach(category => {
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
      activeCategory = '전체'; elements.search.value = ''; elements.incomplete.checked = false;
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
        if (file.size > MAX_IMPORT_BYTES) throw new Error('2MB 이하의 프로젝트 JSON 파일을 선택해 주세요.');
        let candidate;
        try { candidate = JSON.parse(await file.text()); }
        catch (error) { throw new Error('JSON 파일을 읽을 수 없습니다. 기존 내용은 유지됩니다.'); }
        const next = validateAndMerge(candidate, state);
        if (cloudLocked) throw new Error('연결 상태를 확인한 후 다시 가져와 주세요.');
        if (cloud?.connected() && !window.confirm('가져온 파일의 변경 내용을 Firebase 기록에도 반영합니다. 계속할까요?')) return;
        // A valid, explicitly selected import may replace otherwise protected storage.
        let persisted = true;
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); }
        catch (error) { persisted = false; }
        state = next;
        if (persisted) { persistenceBlocked = false; if (cloud) cloud.record(state); }
        else if (cloud) cloud.pause(new Error('가져온 기록을 기기에 저장하지 못해 동기화를 중단했습니다. JSON을 보관해 주세요.'));
        renderTasks();
        renderInventory();
        renderEditableFields();
        setSaveStatus(persisted ? '가져온 내용을 이 브라우저에 저장함' : '가져옴 · 브라우저 저장 실패', !persisted);
        notify(persisted
          ? '프로젝트 내용을 가져왔습니다. 현재 목록에 있는 항목만 적용했습니다.'
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

    // Browser tools use the same state and Firebase save queue as the visible UI.
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
