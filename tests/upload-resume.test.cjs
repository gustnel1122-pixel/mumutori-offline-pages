const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto');

const secret = 'S'.repeat(43);
const sessionId = '12345678-1234-1234-1234-123456789abc';
const bytes = Buffer.from('%PDF-1.7\nresume regression fixture\n');
const file = { name: 'resume-test.pdf', size: bytes.length, lastModified: 123, slice: (a, b) => bytes.subarray(a, b) };
const storedKey = 'mumutori-upload:table-cover:' + file.name + ':' + file.size + ':' + file.lastModified;

function uploadPage(handlers) {
  const storage = new Map([[storedKey, sessionId]]);
  const nodes = Object.fromEntries(['files', 'status', 'progress', 'start', 'stop'].map(id => [id, { textContent: '', disabled: false }]));
  nodes.files.files = [file];
  const calls = [], messages = [];
  const context = {
    document: { getElementById: id => nodes[id] },
    localStorage: { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
    window: { opener: { postMessage: message => messages.push(message) } },
    FileReader: class {
      readAsDataURL(blob) { this.result = 'data:application/pdf;base64,' + blob.toString('base64'); this.onload(); }
    },
    google: { script: { run: {
      withSuccessHandler(success) { return { withFailureHandler(failure) {
        return new Proxy({}, { get(_, name) { return (...args) => {
          calls.push(name);
          try {
            if (!handlers[name]) throw Error('Unexpected RPC: ' + name);
            success(handlers[name](...args));
          } catch (error) { failure(error); }
        }; } });
      } }; }
    } } }
  };
  const html = fs.readFileSync('apps-script/OfflineUpload.html', 'utf8');
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1].replace('<?!= boot ?>', JSON.stringify({ k: secret, target: 'table-cover', origin: 'https://example.invalid', nonce: 'test-nonce', by: '김현수' }));
  vm.runInNewContext(script, context, { filename: 'OfflineUpload.html' });
  return { click: () => nodes.start.onclick(), storage, nodes, calls, messages };
}

function completedDriveSession() {
  const driveFile = { id: 'existing-drive-file', name: file.name, size: file.size, mime: 'application/pdf', url: 'https://drive.google.com/file/d/existing-drive-file/view' };
  const props = new Map([
    ['OFFLINE_SHARE_KEY', secret],
    ['OFFLINE_SHARED_URL', 'https://example.invalid/?share=' + secret],
    ['OU_' + sessionId, JSON.stringify({ at: Date.now(), target: 'table-cover', by: '김현수', size: file.size, offset: file.size, file: driveFile, attached: false })]
  ]);
  let unavailable = true;
  let state = { version: 2, definitions: { inventory: [], inventoryCategories: [] }, inventory: {} };
  const response = (code, body, headers = {}) => ({ getResponseCode: () => code, getContentText: () => JSON.stringify(body), getAllHeaders: () => headers });
  const context = {
    PropertiesService: { getScriptProperties: () => ({ getProperty: key => props.get(key) || null, setProperty: (key, value) => props.set(key, value) }) },
    Utilities: { getUuid: () => crypto.randomUUID() },
    UrlFetchApp: { fetch(url, options = {}) {
      assert.match(url, /firebasedatabase\.app/);
      if (unavailable) return response(503, { error: 'temporary unavailability' });
      if (options.method === 'put') { state = JSON.parse(options.payload); return response(200, state); }
      return response(200, state, { ETag: 'revision-1' });
    } }
  };
  vm.runInNewContext(fs.readFileSync('apps-script/OfflineOrders.gs', 'utf8'), context, { filename: 'OfflineOrders.gs' });
  return { status: (key, id) => context.offlineUploadStatus(key, id), recover: () => { unavailable = false; }, state: () => state, props };
}

test('resume preserves a completed Drive session through an attachment failure, and restarts only expired or missing sessions', async () => {
  const backend = completedDriveSession();
  const page = uploadPage({ offlineUploadStatus: backend.status });
  await page.click();
  assert.deepEqual(page.calls, ['offlineUploadStatus'], 'attachment failure must not create another Drive upload');
  assert.equal(page.storage.get(storedKey), sessionId, 'keep the existing Drive file/session for retry');
  assert.match(page.nodes.status.textContent, /파일은 저장됐지만 주문 연결을 확인해야/);
  assert.equal(page.nodes.start.disabled, false);

  backend.recover();
  await page.click();
  assert.deepEqual(page.calls, ['offlineUploadStatus', 'offlineUploadStatus']);
  assert.equal(page.storage.has(storedKey), false, 'clear the session only after attachment completes');
  assert.equal(page.messages.length, 1);
  assert.equal(page.messages[0].file.id, 'existing-drive-file');
  assert.equal(backend.state().definitions.inventory.filter(item => item.id === 'att-existing-drive-file').length, 1);
  assert.equal(JSON.parse(backend.props.get('OU_' + sessionId)).attached, true);

  for (const message of [
    '이어 올릴 기록이 없어요. 새로 시작해 주세요.',
    '업로드 유효기간이 지났어요. 새로 시작해 주세요.',
    '이어 올리기 시간이 지났어요. 파일을 다시 선택해 새로 시작해 주세요.'
  ]) {
    const restarted = uploadPage({
      offlineUploadStatus() { throw Error('Exception: ' + message); },
      offlineStartUpload(key, input) {
        assert.equal(key, secret);
        assert.equal(input.name, file.name);
        return { id: 'new-session', offset: 0, chunk: 2 * 1024 * 1024 };
      },
      offlineUploadChunk(key, id, offset, base64) {
        assert.equal(id, 'new-session');
        assert.equal(offset, 0);
        assert.deepEqual(Buffer.from(base64, 'base64'), bytes);
        return { id, offset: file.size, done: true, file: { id: 'new-drive-file', name: file.name, size: file.size } };
      }
    });
    await restarted.click();
    assert.deepEqual(restarted.calls, ['offlineUploadStatus', 'offlineStartUpload', 'offlineUploadChunk'], message);
    assert.equal(restarted.storage.has(storedKey), false);
    assert.equal(restarted.messages.length, 1);
  }
});
