/* Cloud acknowledgement/CAS checks. Synthetic state and Firebase only; no network or credentials. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const B = require('../buylist-state.js');

const source = fs.readFileSync(path.join(__dirname, '..', 'firebase-sync.js'), 'utf8');
const clone = value => JSON.parse(JSON.stringify(value));
const settle = () => new Promise(resolve => setImmediate(resolve));
const catalogueContext = vm.createContext({window: {}});
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'buylist-data.js'), 'utf8'), catalogueContext);
const catalogueSource = clone(catalogueContext.window.OFFLINE_BUYLIST.items);
const purchaseItem = catalogueSource.find(item => item.groupKey === 'print');
const purchaseGroup = B.groups(catalogueSource).find(group => group.key === purchaseItem.groupKey);
const purchaseUrls = ['https://example.test/item?color=orange#option', 'http://example.test/compare'];
const customId = 'shop-' + purchaseGroup.key + '-22222222-2222-4222-8222-222222222222';
const itemId = 'palsibo-20261026-test-item';
const state = () => ({
  version: 2,
  definitions: {tasks: [], inventory: [{id: itemId, name: '동기화 시험 항목', category: '시험 분류', priority: '확인 필요', quantity: '1개', detail: '', status: '검토'}], taskCategories: [], inventoryCategories: ['시험 분류']},
  tasks: {}, inventory: {[itemId]: {status: '검토', quantity: '1개'}}, note: '', openingDate: '2026-11-01'
});

// Exercise purchase detail decoding and the unchanged seven-field definition
// contract on both transaction writes and Firebase-decoded reads. This mock does
// not pretend to replace app.js's complete project/import validator.
function validatePurchaseState(value) {
  const next = clone(value);
  assert(Array.isArray(next.definitions.inventory));
  assert(Array.isArray(next.definitions.inventoryCategories));
  for (const entry of next.definitions.inventory) {
    assert.deepEqual(Object.keys(entry).sort(), ['id', 'name', 'category', 'priority', 'quantity', 'detail', 'status'].sort());
    assert.equal(typeof entry.detail, 'string');
    assert(entry.detail.length <= 6000);
    const detail = B.parseDetail(entry.detail);
    if (detail.override) assert.deepEqual(B.validateLinks(detail.links), detail.links);
    if (next.inventory[entry.id]) assert.deepEqual(Object.keys(next.inventory[entry.id]).sort(), ['quantity', 'status']);
  }
  return next;
}

class Node {
  constructor(tag, document) { this.tagName = tag; this.document = document; this.children = []; this.listeners = new Map(); this.hidden = false; this.open = false; this.textContent = ''; this.value = ''; this.isConnected = false; }
  setAttribute(name, value) { this[name] = value; }
  append(...nodes) { for (const node of nodes) { node.parent = this; node.isConnected = true; this.children.push(node); if (this.tagName === 'head' && node.tagName === 'script') queueMicrotask(() => node.onload()); } }
  replaceChildren(...nodes) { this.children = []; this.append(...nodes); }
  insertAdjacentElement(_, node) { this.document.body.append(node); }
  addEventListener(type, fn, options) { const list = this.listeners.get(type) || []; list.push({fn, once: options?.once}); this.listeners.set(type, list); }
  emit(type) { for (const entry of [...(this.listeners.get(type) || [])]) { entry.fn({target: this}); if (entry.once) this.listeners.set(type, this.listeners.get(type).filter(other => other !== entry)); } }
  click() { this.emit('click'); }
  focus() { this.document.activeElement = this; }
  showModal() { this.open = true; }
  close() { this.open = false; this.emit('close'); }
  remove() { this.isConnected = false; if (this.parent) this.parent.children = this.parent.children.filter(node => node !== this); }
  querySelector(tag) { for (const node of this.children) { if (node.tagName === tag) return node; const nested = node.querySelector(tag); if (nested) return nested; } return null; }
}

function documentMock() {
  const document = {nodes: [], activeElement: null};
  document.createElement = tag => { const node = new Node(tag, document); document.nodes.push(node); return node; };
  document.getElementById = id => document.nodes.find(node => node.id === id) || null;
  document.head = document.createElement('head'); document.body = document.createElement('body');
  for (const [tag, id] of [['button', 'cloud-share'], ['button', 'cloud-retry'], ['p', 'cloud-status'], ['select', 'cloud-recovery'], ['button', 'cloud-backup']]) { const node = document.createElement(tag); node.id = id; document.body.append(node); }
  return document;
}

class Server {
  constructor(value) { this.value = clone(value); this.clients = []; this.pending = []; this.commits = 0; }
  attach() {
    const peer = {online: true, values: new Set(), connections: new Set()}; this.clients.push(peer);
    const snapshot = value => ({val: () => clone(value)});
    const ref = {
      get: async () => snapshot(this.value),
      on: (_, fn) => { peer.values.add(fn); fn(snapshot(this.value)); },
      off: (_, fn) => peer.values.delete(fn),
      transaction: (update, _, applyLocally) => {
        assert.equal(applyLocally, false, 'local speculative writes must not count as acknowledgement');
        return new Promise((resolve, reject) => this.pending.push({update, resolve, reject}));
      }
    };
    const db = {ref: route => route === '.info/connected' ? {
      on: (_, fn) => { peer.connections.add(fn); fn(snapshot(peer.online)); },
      off: (_, fn) => peer.connections.delete(fn)
    } : ref};
    peer.database = db;
    peer.setOnline = online => { peer.online = online; for (const fn of peer.connections) fn(snapshot(online)); };
    return peer;
  }
  broadcast() { for (const peer of this.clients) if (peer.online) for (const fn of peer.values) fn({val: () => clone(this.value)}); }
  commitNext({acknowledge = true} = {}) {
    const operation = this.pending.shift(); assert(operation, 'expected a queued transaction');
    const changed = operation.update(clone(this.value));
    const committed = changed !== undefined;
    if (committed) { this.value = clone(changed); this.commits++; this.broadcast(); }
    const committedValue = clone(this.value);
    const reply = {committed, snapshot: {val: () => clone(committedValue)}};
    const ack = () => operation.resolve(reply);
    if (acknowledge) ack();
    return {committed, ack};
  }
}

async function client(server, initial = state()) {
  const document = documentMock(), peer = server.attach(), timers = new Map(), storage = new Map();
  const acknowledgements = [], receipts = [], locks = [];
  let current = clone(initial), nextTimer = 0;
  const app = {name: 'mumutori-offline-shared', database: () => peer.database};
  const context = {document, URL, URLSearchParams, Blob, console, queueMicrotask,
    location: {search: '?shopping=palsibo-20261026&share=' + 'T'.repeat(43), href: 'https://example.test/?shopping=palsibo-20261026&share=' + 'T'.repeat(43) + '#buylist'},
    localStorage: {getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, String(value))},
    navigator: {clipboard: {writeText: async () => {}}},
    firebase: {apps: [app], initializeApp: () => app}, OFFLINE_FIREBASE_CONFIG: {},
    setTimeout: fn => { const id = ++nextTimer; timers.set(id, fn); return id; }, clearTimeout: id => timers.delete(id),
    addEventListener() {}, confirm: () => false
  };
  context.window = context;
  vm.createContext(context); vm.runInContext(source, context);
  const cloud = context.createOfflineCloud({
    getState: () => clone(current), validate: validatePurchaseState, blocked: () => false, isPristine: () => false,
    receive: value => { current = clone(value); receipts.push(clone(value)); },
    lock: value => locks.push(value), settled: value => acknowledgements.push(clone(value))
  });
  await settle();
  assert.equal(cloud.connected(), true, document.getElementById('cloud-status').textContent);
  acknowledgements.length = 0;
  return {cloud, peer, document, acknowledgements, receipts, locks,
    getState: () => clone(current),
    change(patch) { const {note, ...record} = patch; current.inventory[itemId] = {...current.inventory[itemId], ...record}; if (note !== undefined) current.definitions.inventory.find(item => item.id === itemId).detail = note; cloud.record(); },
    editPurchase(item, patch) { current = B.update(current, item, patch); cloud.record(); },
    addPurchase(group, fields) { current = B.add(current, group, fields); cloud.record(); },
    editInventory(id, patch) { current.inventory[id] = {...current.inventory[id], ...patch}; cloud.record(); },
    async flush() { const work = [...timers.values()]; timers.clear(); for (const fn of work) fn(); await settle(); },
    deferConflict() { const button = document.nodes.find(node => node.tagName === 'button' && node.textContent === '연결 보류 · 기기에서 계속' && node.parent?.parent?.open); assert(button, 'expected an unresolved conflict dialog'); button.click(); }
  };
}

test('exact-state acknowledgement waits for transaction commit response, including an early value event', async () => {
  const server = new Server(state()), device = await client(server);
  device.change({status: '준비 완료', note: '시험 메모'}); await device.flush();
  device.cloud.confirmCurrent(); assert.equal(device.acknowledgements.length, 0);
  const commit = server.commitNext({acknowledge: false});
  assert.equal(commit.committed, true); await settle();
  device.cloud.confirmCurrent(); assert.equal(device.acknowledgements.length, 0, 'value event while sending is not a completed transaction');
  commit.ack(); await settle();
  assert(device.acknowledgements.length > 0);
  assert.deepEqual(device.acknowledgements.at(-1), device.getState());
  device.acknowledgements.at(-1).definitions.inventory[0].detail = 'callback mutation';
  assert.equal(device.getState().definitions.inventory[0].detail, '시험 메모');
});

test('offline checks remain local and never settle until the reconnection transaction is acknowledged', async () => {
  const server = new Server(state()), device = await client(server);
  device.peer.setOnline(false); device.change({status: '준비 완료'}); await device.flush();
  device.cloud.confirmCurrent(); assert.equal(device.acknowledgements.length, 0); assert.equal(server.pending.length, 0);
  assert.equal(server.value.inventory[itemId].status, '검토');
  device.peer.setOnline(true); await device.flush();
  assert.equal(device.acknowledgements.length, 0); assert.equal(server.pending.length, 1);
  server.commitNext(); await settle();
  assert.equal(device.acknowledgements.at(-1).inventory[itemId].status, '준비 완료');
});

test('two clients receive the same item status and memo through confirmed server value events', async () => {
  const server = new Server(state()), first = await client(server), second = await client(server);
  first.change({status: '발주', note: '가상 현장 확인'}); await first.flush();
  assert.equal(second.getState().inventory[itemId].status, '검토');
  server.commitNext(); await settle();
  assert.equal(second.receipts.length, 1);
  assert.equal(second.getState().inventory[itemId].status, '발주');
  assert.equal(second.getState().definitions.inventory[0].detail, '가상 현장 확인');
  assert.deepEqual(second.acknowledgements.at(-1), second.getState());
  assert.equal(server.commits, 1);
});

test('concurrent CAS conflict preserves the first commit and does not settle the losing local change', async () => {
  const server = new Server(state()), first = await client(server), second = await client(server);
  first.change({note: '첫 기기 변경'}); second.change({note: '둘째 기기 변경'});
  await first.flush(); await second.flush(); assert.equal(server.pending.length, 2);
  server.commitNext(); await settle();
  const loser = server.commitNext(); assert.equal(loser.committed, false); await settle();
  assert.equal(server.commits, 1); assert.equal(server.value.definitions.inventory[0].detail, '첫 기기 변경');
  assert.equal(second.getState().definitions.inventory[0].detail, '둘째 기기 변경');
  second.cloud.confirmCurrent(); assert.equal(second.acknowledgements.length, 0);
  assert(second.document.nodes.some(node => node.tagName === 'dialog' && node.open));
  second.deferConflict(); await settle();
  second.cloud.confirmCurrent(); assert.equal(second.acknowledgements.length, 0); assert.equal(second.cloud.connected(), false);
});

test('a newer local edit during a pending save settles only after the newer state is acknowledged', async () => {
  const server = new Server(state()), device = await client(server);
  device.change({note: '보내는 중인 메모'}); await device.flush();
  device.change({note: '뒤이어 수정한 메모'});
  server.commitNext(); await settle();
  assert.equal(device.acknowledgements.length, 0); assert.equal(server.value.definitions.inventory[0].detail, '보내는 중인 메모');
  await device.flush(); assert.equal(server.pending.length, 1);
  server.commitNext(); await settle();
  assert.equal(device.acknowledgements.at(-1).definitions.inventory[0].detail, '뒤이어 수정한 메모');
  assert.equal(server.commits, 2);
});

test('two clients share new purchase rows, every link and raw memo through the unchanged inventory schema', async () => {
  const initial = state(); initial.budget = {keep: {amount: 1234}};
  const server = new Server(initial), first = await client(server, initial), second = await client(server, initial);
  const memo = '  현장 메모\n<img src=x onerror=alert(1)> & 원문  ';
  first.editPurchase(purchaseItem, {links: purchaseUrls, memo});
  first.addPurchase(purchaseGroup, {id: customId, name: '현장에서 추가한 준비물', links: purchaseUrls, memo: '추가 항목 메모'});
  first.editInventory(customId, {quantity: '현장 3개', status: '발주'});
  await first.flush();
  assert.equal(server.pending.length, 1);
  assert(!second.getState().inventory[customId]);
  const commit = server.commitNext({acknowledge: false}); await settle();
  assert.equal(first.acknowledgements.length, 0, 'the sender still awaits its transaction response');
  const received = second.getState();
  assert.equal(second.receipts.length, 1);
  assert.deepEqual(B.read(purchaseItem, received.definitions.inventory.find(entry => entry.id === purchaseItem.id)), {links: purchaseUrls, memo, override: true});
  const added = B.catalogue(received, catalogueSource).find(item => item.id === customId);
  assert.equal(added.groupKey, purchaseGroup.key);
  assert.deepEqual(B.read(added, received.definitions.inventory.find(entry => entry.id === customId)), {links: purchaseUrls, memo: '추가 항목 메모', override: true});
  assert.deepEqual(received.inventory[customId], {quantity: '현장 3개', status: '발주'});
  assert.deepEqual(received.inventory[itemId], initial.inventory[itemId]);
  assert.deepEqual(received.budget, initial.budget);
  commit.ack(); await settle();
  assert.deepEqual(first.acknowledgements.at(-1), received);

  // Removing the last link on the other device is an explicit empty override,
  // not a request to bring the source catalogue links back.
  second.editPurchase(purchaseItem, {links: [], memo: ''}); await second.flush();
  assert.equal(server.pending.length, 1);
  server.commitNext(); await settle();
  const returned = first.getState();
  assert.deepEqual(B.read(purchaseItem, returned.definitions.inventory.find(entry => entry.id === purchaseItem.id)), {links: [], memo: '', override: true});
  assert.deepEqual(returned.inventory[customId], {quantity: '현장 3개', status: '발주'});
  assert.deepEqual(second.acknowledgements.at(-1), returned);
  assert.equal(server.commits, 2);
});

test('editing purchase links and memo during a pending transaction settles only the following confirmed state', async () => {
  const server = new Server(state()), device = await client(server);
  device.editPurchase(purchaseItem, {links: [purchaseUrls[0]], memo: '첫 입력'});
  await device.flush();
  device.editPurchase(purchaseItem, {links: purchaseUrls, memo: '두 번째 입력\n최종 메모'});
  server.commitNext(); await settle();
  device.cloud.confirmCurrent();
  assert.equal(device.acknowledgements.length, 0);
  const firstSaved = Object.values(server.value.definitions.inventory).find(entry => entry.id === purchaseItem.id);
  assert.deepEqual(B.read(purchaseItem, firstSaved), {links: [purchaseUrls[0]], memo: '첫 입력', override: true});
  await device.flush();
  assert.equal(server.pending.length, 1);
  const next = server.commitNext({acknowledge: false}); await settle();
  assert.equal(device.acknowledgements.length, 0);
  next.ack(); await settle();
  const confirmed = device.acknowledgements.at(-1);
  assert.deepEqual(B.read(purchaseItem, confirmed.definitions.inventory.find(entry => entry.id === purchaseItem.id)), {links: purchaseUrls, memo: '두 번째 입력\n최종 메모', override: true});
  assert.deepEqual(confirmed, device.getState());
  assert.equal(server.commits, 2);
});
