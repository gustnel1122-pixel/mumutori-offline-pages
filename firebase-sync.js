/* Full-state sync for the shared project identified by the current URL. */
(function () {
  'use strict';
  const shareKey = new URLSearchParams(window.location.search).get('share') || '';
  const shared = /^[A-Za-z0-9_-]{43}$/.test(shareKey);
  const ROOT = shared ? 'hub/offlineStoreShared/' + shareKey : null;
  const SDK = 'https://www.gstatic.com/firebasejs/12.19.0/';
  const PREFIX = 'mumutori-offline-cloud-v2:';
  const copy = value => JSON.parse(JSON.stringify(value));
  const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  function list(value) {
    if (value == null) return [];
    if (Array.isArray(value)) return value;
    if (!object(value)) throw new Error('클라우드 목록 형식을 확인해야 합니다.');
    const keys = Object.keys(value).sort((a, b) => Number(a) - Number(b));
    if (keys.some((key, index) => key !== String(index))) throw new Error('클라우드 목록 순서가 올바르지 않습니다.');
    return keys.map(key => value[key]);
  }
  function decode(value, ui, base) {
    if (value === null) return null;
    if (!object(value)) throw new Error('클라우드 기록 형식이 올바르지 않습니다.');
    const next = copy(value);
    next.tasks ??= {};
    next.inventory ??= {};
    if (next.version === 2) {
      next.definitions ??= {};
      if (!object(next.definitions)) throw new Error('클라우드 목록 정의가 올바르지 않습니다.');
      for (const field of ['tasks', 'inventory', 'taskCategories', 'inventoryCategories']) next.definitions[field] = list(next.definitions[field]);
      next.definitions.tasks = next.definitions.tasks.map(task => {
        if (!object(task)) throw new Error('클라우드 작업 형식이 올바르지 않습니다.');
        return { ...task, dependsOn: list(task.dependsOn) };
      });
    }
    return ui.validate(next, base);
  }
  // Firebase removes null/empty containers and may return dense numeric maps as arrays.
  // Normalize both representations before comparing a transaction's expected value.
  function wire(value) {
    if (value === null || typeof value !== 'object') return value;
    const result = {};
    Object.keys(value).sort().forEach(key => {
      const child = wire(value[key]);
      if (child !== null) result[key] = child;
    });
    return Object.keys(result).length ? result : null;
  }
  const token = value => JSON.stringify(wire(value));
  const same = (left, right) => token(left) === token(right);
  const scripts = new Map();
  function script(name) {
    if (!scripts.has(name)) scripts.set(name, new Promise((resolve, reject) => {
      const element = document.createElement('script');
      element.src = SDK + name;
      element.onload = resolve;
      element.onerror = () => { scripts.delete(name); element.remove(); reject(new Error('Firebase를 불러오지 못했습니다. 인터넷 연결을 확인해 주세요.')); };
      document.head.append(element);
    }));
    return scripts.get(name);
  }
  function element(tag, text, className) {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
  }
  function download(state, filename) {
    const url = URL.createObjectURL(new Blob([JSON.stringify(state, null, 2) + '\n'], {type:'application/json;charset=utf-8'}));
    const link = element('a'); link.href = url; link.download = filename;
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  window.createOfflineCloud = function (ui) {
    const share = document.getElementById('cloud-share');
    const retry = document.getElementById('cloud-retry');
    const status = document.getElementById('cloud-status');
    if (!retry || !status) return null;
    let recovery = document.getElementById('cloud-recovery');
    let backup = document.getElementById('cloud-backup');
    if (!recovery || !backup) {
      const controls = element('div', undefined, 'cloud-recovery-tools');
      recovery = element('select'); recovery.id = 'cloud-recovery'; recovery.setAttribute('aria-label', '연결 전 백업 선택');
      backup = element('button', '이전 기록 JSON', 'editor-button'); backup.id = 'cloud-backup'; backup.type = 'button';
      controls.append(recovery, backup); status.insertAdjacentElement('afterend', controls);
    }
    let db, ref, loadPromise, valueHandler, onlineHandler, timer;
    let generation = 0, ready = false, online = false, sending = false, halted = false, resolving = false, retryOnNetwork = false;
    let baseRaw = null, baseState = copy(ui.getState()), latestRaw, cancelChoice, forceWrite = false, remoteSequence = 0;
    const message = text => { status.textContent = text; };
    function recoveries() {
      let entries;
      try { entries = JSON.parse(localStorage.getItem(PREFIX + 'recoveries') || '[]'); }
      catch (_) { throw new Error('연결 전 백업 목록을 읽지 못했습니다. 현재 기록을 JSON으로 먼저 내보내 주세요.'); }
      if (!Array.isArray(entries)) throw new Error('연결 전 백업 목록을 확인해 주세요.');
      entries.forEach(entry => {
        if (!object(entry) || typeof entry.at !== 'string' || !Number.isFinite(Date.parse(entry.at)) || typeof entry.reason !== 'string' || !object(entry.state)) throw new Error('연결 전 백업 형식을 확인해 주세요.');
        decode(entry.state, ui, ui.getState());
      });
      return entries;
    }
    function renderRecoveries() {
      const entries = recoveries(); recovery.replaceChildren();
      entries.forEach((entry, index) => {
        const option = element('option', new Date(entry.at).toLocaleString('ko-KR') + ' · ' + entry.reason);
        option.value = String(index); recovery.append(option);
      });
      recovery.hidden = backup.hidden = entries.length === 0;
    }
    function preserve(state, reason) {
      const entries = recoveries().filter(entry => !same(entry.state, state));
      entries.unshift({at:new Date().toISOString(), reason, state:copy(state)});
      localStorage.setItem(PREFIX + 'recoveries', JSON.stringify(entries.slice(0, 4)));
      renderRecoveries();
    }
    function dirty() { return !same(ui.getState(), baseState); }
    function show() {
      if (!ready || halted || resolving) return;
      message(sending ? '클라우드 저장 확인 중 · 이 기기에도 백업됨' : dirty() ? (online ? '클라우드 저장 대기 · 이 기기에도 백업됨' : '오프라인 · 변경을 이 기기에 보관 중') : online ? '공유 기록 동기화됨 · 이 링크를 받은 사람과 함께 사용' : '오프라인 · 마지막 기록을 이 기기에 보관 중');
    }
    function pause(error) {
      halted = true; ready = false; clearTimeout(timer); retry.hidden = false; ui.lock(false);
      retryOnNetwork = /(?:network|disconnected|unavailable)/i.test(String(error?.code || ''));
      const denied = /permission|PERMISSION|unauthorized/.test(String(error?.code || ''));
      message(denied ? '이 공유 링크의 연결 상태를 확인해 주세요. 기록은 이 기기에 보관했습니다.' : error?.code ? '클라우드 연결을 확인하지 못했습니다. 기록은 이 기기에 보관했습니다. 다시 연결해 주세요.' : (error?.message || '연결을 중단했습니다. 기록은 이 기기에 보관했습니다.'));
    }
    async function readRemote() {
      const sequence = remoteSequence;
      const snapshot = await ref.get();
      return sequence !== remoteSequence && latestRaw !== undefined ? copy(latestRaw) : snapshot.val();
    }
    function summary(state) {
      return '할 일 ' + state.definitions.tasks.length + '개 · 준비물 ' + state.definitions.inventory.length + '개 · 완료 ' + Object.values(state.tasks).filter(Boolean).length + '개 · 메모 ' + state.note.length + '자';
    }
    function choose(local, remote, reason, legacy) {
      return new Promise(resolve => {
        const dialog = element('dialog', undefined, 'list-editor-dialog cloud-choice-dialog');
        dialog.setAttribute('aria-labelledby', 'cloud-choice-title');
        const title = element('h3', remote ? '이어 쓸 기록을 선택해 주세요' : '클라우드 저장을 시작할까요?'); title.id = 'cloud-choice-title';
        dialog.append(title, element('p', reason));
        dialog.append(element('p', '이 기기: ' + summary(local)));
        if (remote) dialog.append(element('p', '클라우드: ' + summary(remote)));
        if (legacy) dialog.append(element('p', '클라우드는 이전 형식입니다. 현재 편집한 목록에 완료 상태·수량·메모·날짜를 적용하며, 다음 저장부터 새 형식을 사용합니다. 원본은 연결 전 백업에 보관합니다.'));
        dialog.append(element('p', '기기 기록으로 저장하면 클라우드의 목록과 기록 전체를 바꿉니다. 선택 전 양쪽 기록을 이 브라우저에 백업합니다.'));
        const actions = element('div', undefined, 'cloud-choice-actions');
        let result = 'defer';
        const button = (label, action, actionClass) => {
          const control = element('button', label, 'editor-button ' + (actionClass || '')); control.type = 'button';
          control.addEventListener('click', action); actions.append(control); return control;
        };
        if (remote) button('클라우드 기록 이어쓰기', () => { result = 'remote'; dialog.close(); });
        button(remote ? '이 기기 기록으로 클라우드 바꾸기' : '이 기기 기록으로 저장 시작', () => {
          if (remote && !window.confirm('클라우드 목록과 기록을 이 기기 내용으로 바꿀까요? 바꾸기 전 양쪽 기록은 백업에서 받을 수 있습니다.')) return;
          result = 'local'; dialog.close();
        });
        button('이 기기 JSON 받기', () => download(local, 'mumutori-offline-device-before-connect.json'));
        if (remote) button('클라우드 JSON 받기', () => download(remote, 'mumutori-offline-cloud-before-connect.json'));
        button('연결 보류 · 기기에서 계속', () => dialog.close());
        dialog.append(actions); document.body.append(dialog);
        const previous = document.activeElement;
        const cancelThisChoice = () => { result = 'defer'; if (dialog.open) dialog.close(); };
        cancelChoice = cancelThisChoice;
        dialog.addEventListener('close', () => {
          if (cancelChoice === cancelThisChoice) cancelChoice = null;
          dialog.remove();
          if (previous?.isConnected) previous.focus({preventScroll:true}); resolve(result);
        }, {once:true});
        if (typeof dialog.showModal !== 'function') { dialog.remove(); cancelChoice = null; resolve('defer'); return; }
        dialog.showModal(); actions.querySelector('button')?.focus();
      });
    }
    async function resolveDifference(raw, reason) {
      if (resolving || halted) return;
      const stamp = generation;
      resolving = true; ready = false; clearTimeout(timer); ui.lock(true);
      latestRaw = copy(raw);
      try {
        const local = copy(ui.getState());
        const remote = decode(raw, ui, local);
        preserve(local, '기기 기록');
        if (raw !== null) preserve(raw, '클라우드 원본');
        message('기기와 클라우드 기록을 확인해 주세요. 선택 전에는 서버에 저장하지 않습니다.');
        const decision = await choose(local, remote, reason, raw?.version === 1);
        if (stamp !== generation) return;
        if (decision === 'defer') {
          halted = true; retryOnNetwork = false; retry.hidden = false;
          message('클라우드 연결 보류 · 이 기기에 계속 저장합니다. 다시 연결할 때 기록을 선택할 수 있습니다.'); return;
        }
        // Re-read after a potentially long user decision; never adopt a stale choice.
        const fresh = await readRemote();
        if (stamp !== generation) return;
        if (!same(fresh, raw)) {
          resolving = false;
          await resolveDifference(fresh, '선택하는 동안 다른 기기의 클라우드 기록이 바뀌었습니다. 최신 기록을 다시 확인해 주세요.'); return;
        }
        baseRaw = copy(raw); baseState = remote === null ? null : copy(remote);
        if (decision === 'remote') ui.receive(copy(remote));
        forceWrite = decision === 'local';
        ready = true; halted = false; retry.hidden = true;
      } catch (error) { if (stamp === generation) pause(error); }
      finally {
        if (stamp === generation) {
          resolving = false; ui.lock(false);
          if (ready && !halted) {
            if (latestRaw !== undefined && !same(latestRaw, baseRaw)) onRemote(latestRaw);
            show(); schedule();
          }
        }
      }
    }
    function onRemote(raw) {
      remoteSequence++;
      latestRaw = copy(raw);
      if (!ready || halted || resolving || sending) return;
      try {
        if (same(raw, baseRaw)) { show(); return; }
        const next = decode(raw, ui, baseState);
        if (next !== null && same(next, ui.getState())) {
          baseRaw = copy(raw); baseState = copy(next); forceWrite = false; show(); return;
        }
        if (dirty() || forceWrite || raw === null) {
          resolveDifference(raw, raw === null ? '클라우드 기록이 삭제되어 자동 저장을 멈췄습니다.' : '다른 기기와 이 기기에서 기록을 함께 수정했습니다. 어느 기록으로 이어 쓸지 선택해 주세요.'); return;
        }
        ui.receive(next); baseRaw = copy(raw); baseState = copy(next); show();
      } catch (error) { pause(error); }
    }
    function schedule() { clearTimeout(timer); timer = setTimeout(flush, 550); }
    async function flush() {
      if (!ready || halted || resolving || sending || !online || !shared || (!dirty() && !forceWrite)) return;
      const stamp = generation;
      let sent;
      try { sent = ui.validate(copy(ui.getState())); }
      catch (error) { pause(error); return; }
      const expected = token(baseRaw);
      sending = true; latestRaw = undefined; show();
      try {
        const result = await ref.transaction(current => stamp === generation && token(current) === expected ? wire(sent) : undefined, undefined, false);
        if (stamp !== generation) return;
        if (!result.committed) {
          const fresh = await readRemote();
          if (stamp === generation) await resolveDifference(fresh, '저장 전에 클라우드 기록이 바뀌어 덮어쓰기를 멈췄습니다. 두 기록을 확인해 주세요.');
          return;
        }
        baseRaw = result.snapshot.val(); baseState = sent; forceWrite = false;
      } catch (error) { if (stamp === generation) pause(error); }
      finally {
        if (stamp === generation) {
          sending = false;
          if (ready && !halted) {
            if (latestRaw !== undefined && !same(latestRaw, baseRaw)) onRemote(latestRaw);
            show(); if (dirty() || forceWrite) schedule();
          }
        }
      }
    }
    function detach() {
      generation++; clearTimeout(timer);
      if (ref && valueHandler) ref.off('value', valueHandler);
      if (db && onlineHandler) db.ref('.info/connected').off('value', onlineHandler);
      if (cancelChoice) cancelChoice();
      valueHandler = onlineHandler = null;
      ready = false; resolving = false; sending = false; online = false; forceWrite = false; latestRaw = undefined;
      ui.lock(false);
    }
    async function connect() {
      if (!shared) return;
      detach(); halted = false; retryOnNetwork = false; retry.hidden = true;
      const stamp = generation;
      if (ui.blocked()) { pause(new Error('기존 기기 자료를 먼저 JSON으로 확인한 후 다시 연결해 주세요.')); return; }
      ref = db.ref(ROOT); ui.lock(true);
      message('클라우드 기록을 확인 중 · 선택 전에는 기록을 바꾸지 않습니다.');
      onlineHandler = snapshot => { online = snapshot.val() === true; show(); if (online) schedule(); };
      db.ref('.info/connected').on('value', onlineHandler);
      try {
        const raw = await readRemote();
        if (stamp !== generation) return;
        const initial = decode(raw, ui, ui.getState());
        if (raw !== null && raw.version === 2 && (same(initial, ui.getState()) || ui.isPristine?.())) {
          if (!same(initial, ui.getState())) ui.receive(copy(initial));
          baseRaw = copy(raw); baseState = copy(initial); ready = true; ui.lock(false); show();
        } else await resolveDifference(raw, raw === null ? '저장된 클라우드 기록이 없습니다. 현재 기기 기록으로 시작할지 선택해 주세요.' : '이 기기의 기록과 클라우드 기록이 다릅니다. 자동으로 덮어쓰지 않고 이어 쓸 기록을 선택합니다.');
        if (stamp !== generation) return;
        valueHandler = snapshot => onRemote(snapshot.val());
        ref.on('value', valueHandler, error => { if (stamp === generation) pause(error); });
      } catch (error) { if (stamp === generation) pause(error); }
    }
    async function load() {
      if (!shared) return;
      if (loadPromise) return loadPromise;
      retry.disabled = true;
      message('공유 기록을 불러오는 중 · 이 기기의 기록도 보관합니다.');
      loadPromise = (async () => {
        await script('firebase-app-compat.js');
        await script('firebase-database-compat.js');
        // This named app intentionally has no Auth SDK or account session.
        const app = firebase.apps.find(app => app.name === 'mumutori-offline-shared') || firebase.initializeApp(window.OFFLINE_FIREBASE_CONFIG, 'mumutori-offline-shared');
        db = app.database();
        await connect();
      })().catch(error => {
        loadPromise = null;
        message('공유 연결 준비에 실패했습니다. 인터넷 연결을 확인한 뒤 다시 눌러 주세요. 기록은 계속 이 기기에 저장합니다.');
        retry.hidden = false;
        throw error;
      }).finally(() => { retry.disabled = false; });
      return loadPromise;
    }
    if (share) {
      share.hidden = !shared;
      share.addEventListener('click', async () => {
        if (!shared) return;
        const url = new URL(window.location.href);
        url.hash = '';
        try {
          await navigator.clipboard.writeText(url.href);
          share.textContent = '공유 링크 복사됨';
          setTimeout(() => { share.textContent = '공유 링크 복사'; }, 2000);
        } catch (_) {
          message('주소창의 전체 링크를 복사해 전달해 주세요. 링크를 받은 사람은 같은 기록을 보고 수정할 수 있습니다.');
        }
      });
    }
    retry.addEventListener('click', () => {
      if (!shared) return;
      if (sending) { show(); return; }
      if (db) connect().catch(pause);
      else load().catch(() => {});
    });
    backup.addEventListener('click', () => {
      try {
        const saved = recoveries()[Number(recovery.value)];
        if (!saved) throw new Error('선택한 백업을 찾지 못했습니다.');
        download(saved.state, 'mumutori-offline-before-connect-' + saved.at.slice(0, 10) + '.json');
      } catch (error) { message(error.message); }
    });
    window.addEventListener('beforeunload', event => {
      if (shared && (sending || (ready && dirty()))) { event.preventDefault(); event.returnValue = ''; }
    });
    window.addEventListener('online', () => {
      if (shared && !db) load().catch(() => {});
      else if (shared && retryOnNetwork) connect().catch(pause);
      else show();
    });
    try { renderRecoveries(); } catch (_) { pause(new Error('연결 전 백업 목록을 읽지 못했습니다. 현재 기록을 JSON으로 내보낸 뒤 확인해 주세요.')); }
    if (shared) load().catch(() => {});
    else { retry.hidden = true; message('공유 링크로 열어 주세요 · 현재 기록은 이 기기에 저장됩니다.'); }
    return {
      connected: () => Boolean(shared && ready && !halted),
      pause,
      record() {
        if (ready && !halted && !resolving) { show(); schedule(); }
      }
    };
  };
}());
