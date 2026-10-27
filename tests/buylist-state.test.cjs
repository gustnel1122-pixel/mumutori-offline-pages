/* Purchase edits use the existing inventory schema. Pure fixtures only: no DOM, storage or network. */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const B = require('../buylist-state.js');
const context = vm.createContext({window: {}});
for (const file of ['buylist-data.js', 'palsibo-migration.js']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), context);
}
const M = context.window.PalsiboMigration;
const source = JSON.parse(JSON.stringify(context.window.OFFLINE_BUYLIST.items));
const plain = value => JSON.parse(JSON.stringify(value));
const inventoryKeys = ['id', 'name', 'category', 'priority', 'quantity', 'detail', 'status'].sort();
const urls = ['https://example.test/item?size=2&color=orange#option', 'http://example.test/compare'];
const sample = source.find(item => item.groupKey === 'print');
const trip = source.find(item => item.legacyId === 'letter-desk');
function freeze(value) { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }
function state() {
  return {version: 2, tasks: {keep: true}, inventory: {keep: {quantity: '기존 수량', status: '발주'}},
    note: '프로젝트 전체 메모', openingDate: '2026-11-01', budget: {keep: {amount: 1234}},
    definitions: {tasks: [{id: 'keep', title: '기존 할 일'}], taskCategories: ['기존 일'],
      inventory: [{id: 'keep', name: '기존 준비물', category: '기존 분류', priority: '필수', quantity: '1개', detail: '기존 설명', status: '검토'}],
      inventoryCategories: ['기존 분류']}};
}
const entry = (value, id) => value.definitions.inventory.find(item => item.id === id);
const groupId = group => 'shop-' + group.key + '-11111111-1111-4111-8111-111111111111';
function assertSchema(value) {
  assert.deepEqual(Object.keys(value).sort(), inventoryKeys);
  assert.equal(typeof value.detail, 'string');
  assert(value.detail.length <= 6000);
}

test('reading the 81-item catalogue and all groups never materializes or changes saved inventory', () => {
  const before = freeze(state()), sourceCopy = freeze(plain(source));
  const groups = B.groups(sourceCopy);
  assert.equal(sourceCopy.length, 81);
  assert.equal(groups.length, 10);
  assert.equal(new Set(groups.map(group => group.key)).size, groups.length);
  assert.deepEqual(B.groups({items: sourceCopy}), groups);
  const result = B.catalogue(before, sourceCopy);
  assert.equal(result.length, sourceCopy.length);
  assert.deepEqual(new Set(result.map(item => item.id)), new Set(sourceCopy.map(item => item.id)));
  assert.deepEqual(before, state());
  assert.deepEqual(sourceCopy, source);
});

test('plain legacy detail remains exact text and falls back to the catalogue link', () => {
  const memo = '  첫 줄\n<img src=x onerror=alert(1)> & 따옴표 "\n마지막 줄  ';
  assert.deepEqual(B.parseDetail(memo), {memo, links: null, override: false});
  const definition = {...B.definition(sample), detail: memo};
  const result = B.read(sample, definition);
  assert.equal(result.memo, memo);
  assert.deepEqual(result.links, [new URL(sample.link).href]);
  assert.equal(result.override, false);
  assertSchema(definition);
});

test('multiple absolute HTTP(S) URLs and untouched memo text round-trip inside one detail string', () => {
  const memo = '\n 현장에서 고른 것 <b>주황</b> & "원문"\n둘째 줄\n';
  const encoded = B.writeDetail(memo, urls);
  assert.equal(typeof encoded, 'string');
  const decoded = B.parseDetail(JSON.parse(JSON.stringify(encoded)));
  assert.deepEqual(decoded, {memo, links: urls, override: true});
  assert.deepEqual(B.validateLinks(urls), urls);
  assert.deepEqual(urls, ['https://example.test/item?size=2&color=orange#option', 'http://example.test/compare']);
});

test('unsafe schemes, relative links and malformed URL collections are rejected without partial edits', () => {
  const unsafe = ['javascript:alert(1)', 'data:text/html,<script>alert(1)</script>', 'file:///tmp/item',
    'blob:https://example.test/item', '//example.test/item', '/item', 'mailto:a@example.test', 'https://', 'ftp://example.test/item'];
  const before = freeze(B.update(state(), sample, {links: urls, memo: '저장된 메모'}));
  for (const address of unsafe) {
    assert.throws(() => B.validateLinks([urls[0], address]), address);
    assert.throws(() => B.update(before, sample, {links: [urls[0], address]}), address);
  }
  for (const value of [null, {}, [null], [42], [{href: urls[0]}]]) assert.throws(() => B.validateLinks(value));
  assert.deepEqual(B.read(sample, entry(before, sample.id)), {memo: '저장된 메모', links: urls, override: true});
});

test('explicit empty links and memo stay empty after JSON reload instead of reviving catalogue defaults', () => {
  const initial = B.update(state(), sample, {links: urls, memo: '지울 메모'});
  const cleared = B.update(freeze(initial), sample, {links: [], memo: ''});
  const reloaded = JSON.parse(JSON.stringify(cleared));
  assert.deepEqual(B.read(sample, entry(reloaded, sample.id)), {memo: '', links: [], override: true});
  assert.deepEqual(B.parseDetail(entry(reloaded, sample.id).detail), {memo: '', links: [], override: true});
  assert.equal(entry(initial, sample.id).detail, B.writeDetail('지울 메모', urls));
});

test('separate link and memo edits preserve the other field, inventory status, quantity and unrelated project state', () => {
  const before = state();
  B.ensureItem(before, sample);
  Object.assign(entry(before, sample.id), {name: '직접 바꾼 이름', category: '기존 분류', priority: '직접 중요도', quantity: '기본 3개', status: '견적 요청', detail: B.writeDetail('기존 메모', urls)});
  before.inventory[sample.id] = {quantity: '직접 수정한 8개', status: '준비 완료'};
  const snapshot = plain(before);
  const first = B.update(freeze(before), sample, {memo: '한글 입력 중인 새 메모\n'});
  const second = B.update(freeze(first), sample, {links: [urls[1]]});
  assert.deepEqual(B.read(sample, entry(second, sample.id)), {memo: '한글 입력 중인 새 메모\n', links: [urls[1]], override: true});
  const expected = {...snapshot.definitions.inventory.find(item => item.id === sample.id), detail: entry(second, sample.id).detail};
  assert.deepEqual(entry(second, sample.id), expected);
  assert.deepEqual(second.inventory, snapshot.inventory);
  for (const key of ['tasks', 'note', 'openingDate', 'budget']) assert.deepEqual(second[key], snapshot[key]);
  assert.deepEqual(second.definitions.tasks, snapshot.definitions.tasks);
  assert.deepEqual(second.definitions.inventoryCategories, snapshot.definitions.inventoryCategories);
  assert.deepEqual(before, snapshot);
  assertSchema(entry(second, sample.id));
});

test('ensureItem fills only missing definition or record and respects a supplied Palsibo default', () => {
  const before = state(), supplied = plain(M.definition(trip));
  before.inventory[trip.id] = {quantity: '이미 수정한 수량', status: '발주'};
  assert.equal(B.ensureItem(before, trip, supplied), true);
  assert.deepEqual(entry(before, trip.id), supplied);
  assert.deepEqual(before.inventory[trip.id], {quantity: '이미 수정한 수량', status: '발주'});
  assert.equal(B.ensureItem(before, trip, supplied), false);
  const definitionOnly = state();
  const edited = {...B.definition(sample), quantity: '직접 정한 수량', status: '준비 완료'};
  definitionOnly.definitions.inventory.push(edited);
  assert.equal(B.ensureItem(definitionOnly, sample), true);
  assert.deepEqual(definitionOnly.inventory[sample.id], {quantity: edited.quantity, status: edited.status});
  assert.equal(entry(definitionOnly, sample.id), edited);
});

test('the serialized 6000-character bound is enforced atomically for writes, updates and additions', () => {
  const overhead = B.writeDetail('', []).length;
  const longest = '가'.repeat(6000 - overhead);
  assert.equal(B.writeDetail(longest, []).length, 6000);
  assert.throws(() => B.writeDetail(longest + '나', []));
  const before = freeze(B.update(state(), sample, {links: urls, memo: '남겨 둘 값'})), snapshot = plain(before);
  assert.throws(() => B.update(before, sample, {links: [], memo: longest + '나'}));
  const group = B.groups(source)[0];
  assert.throws(() => B.add(before, group, {id: groupId(group), name: '신규 시험', links: [], memo: longest + '나'}));
  assert.deepEqual(before, snapshot);
});

test('each real group accepts one stable custom ID and retains its membership after a JSON reload', () => {
  const groups = B.groups(source), snapshot = plain(source);
  let current = state();
  for (const group of groups) {
    const before = plain(current), id = groupId(group);
    current = B.add(freeze(current), group, {id, name: group.name + ' <현장 추가>', links: urls, memo: group.name + ' 메모'});
    assert.deepEqual(before.inventory.keep, current.inventory.keep);
    const definition = entry(current, id);
    assertSchema(definition);
    assert.equal(definition.category, group.category);
    assert.equal(B.isCustom(id, groups), true);
    assert.equal(Object.keys(current.inventory[id]).length, 2);
  }
  const reloaded = JSON.parse(JSON.stringify(current));
  const catalogue = B.catalogue(reloaded, freeze(plain(source)));
  assert.equal(catalogue.length, 81 + groups.length);
  assert.equal(new Set(catalogue.map(item => item.id)).size, catalogue.length);
  for (const group of groups) {
    const id = groupId(group), item = catalogue.find(value => value.id === id);
    assert(item);
    assert.equal(item.groupKey, group.key);
    assert.equal(item.group, group.name);
    if (group.trip) { assert.equal(item.trip, group.trip); assert.equal(item.shoppingGroup, group.shoppingGroup); }
    assert.deepEqual(B.read(item, entry(reloaded, id)), {memo: group.name + ' 메모', links: urls, override: true});
    const positions = catalogue.flatMap((value, index) => value.groupKey === group.key ? [index] : []);
    assert.equal(positions.at(-1) - positions[0] + 1, positions.length, 'a group stays contiguous');
  }
  assert.deepEqual(source, snapshot);
  assert.deepEqual(reloaded.budget, state().budget);
});

test('duplicate IDs, mismatched groups and blank names cannot replace a saved custom item', () => {
  const [group, other] = B.groups(source);
  const id = groupId(group);
  const before = freeze(B.add(state(), group, {id, name: '이미 저장한 항목', links: urls, memo: '보존할 메모'}));
  const snapshot = plain(before);
  assert.throws(() => B.add(before, group, {id, name: '덮어쓸 이름', links: [], memo: ''}));
  assert.throws(() => B.add(before, other, {id, name: '다른 묶음', links: [], memo: ''}));
  assert.throws(() => B.add(before, other, {id: groupId(other), name: '  ', links: [], memo: ''}));
  assert.throws(() => B.add(before, other, {id: groupId(other), name: '가'.repeat(241), links: [], memo: ''}));
  assert.equal(B.isCustom('shop-unknown-11111111-1111-4111-8111-111111111111', B.groups(source)), false);
  assert.deepEqual(before, snapshot);
});

test('legacy migration appends its memo without changing encoded links, explicit empty links or existing checks', () => {
  for (const links of [urls, []]) {
    const before = B.update(state(), trip, {links, memo: '현장 구매 메모'}, plain(M.definition(trip)));
    before.inventory[trip.id] = {quantity: '현장 2개', status: '발주'};
    const old = freeze({version: 1, checked: {[trip.legacyId]: true}, notes: {[trip.legacyId]: '이전 휴대폰 메모'}});
    const moved = M.merge(freeze(before), old, [trip]);
    const details = B.read(trip, entry(moved.state, trip.id));
    assert.deepEqual(details.links, links);
    assert.equal(details.override, true);
    assert.equal(details.memo, '현장 구매 메모\n\n[10/26 팔시보 이전 메모]\n이전 휴대폰 메모');
    assert.equal(moved.state.inventory[trip.id].status, '발주');
    assert.equal(moved.state.inventory[trip.id].quantity, '현장 2개');
    const again = M.merge(moved.state, old, [trip]);
    assert.equal(again.changed, false);
    assert.deepEqual(plain(again.state), plain(moved.state));
    assert.equal(old.notes[trip.legacyId], '이전 휴대폰 메모');
  }
});

test('malformed or unknown link-block versions preserve the raw detail and refuse destructive edits', () => {
  const encoded = B.writeDetail('보존할 본문', urls);
  const bad = [encoded.replace('LINKS:1', 'LINKS:2'), encoded.replace(JSON.stringify(urls), '[bad json]')];
  for (const detail of bad) {
    assert.throws(() => B.parseDetail(detail), error => error.raw === detail);
    const before = state(); B.ensureItem(before, sample); entry(before, sample.id).detail = detail;
    const snapshot = plain(before);
    assert.throws(() => B.update(freeze(before), sample, {links: [], memo: '새 값'}));
    assert.deepEqual(before, snapshot);
  }
});

test('copy text uses current names, quantities, memo and every link for both catalogue and custom rows', () => {
  const group = B.groups(source).find(value => value.key === sample.groupKey);
  let current = B.update(state(), sample, {links: urls, memo: '원래 항목의 새 메모'});
  entry(current, sample.id).name = '준비표에서 바꾼 이름';
  current.inventory[sample.id] = {quantity: '직접 9개', status: '준비 완료'};
  current = B.add(current, group, {id: groupId(group), name: '현장 추가 항목', links: [urls[1]], memo: '추가 항목 메모'});
  const items = B.catalogue(current, source).filter(item => item.id === sample.id || item.id === groupId(group));
  const text = B.copyText(items, current, '시험 구매 결과');
  for (const expected of ['시험 구매 결과', '준비표에서 바꾼 이름', '직접 9개', '원래 항목의 새 메모', '현장 추가 항목', '추가 항목 메모', ...urls]) assert(text.includes(expected), expected);
  assert(!text.includes('[[MUMUTORI_BUYLIST_LINKS:'));
});
