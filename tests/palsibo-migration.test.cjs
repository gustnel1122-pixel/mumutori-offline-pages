/* Pure migration checks. No DOM, Firebase, storage or network. */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const context = vm.createContext({window: {}});
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'palsibo-migration.js'), 'utf8'), context);
const M = context.window.PalsiboMigration;
const plain = value => JSON.parse(JSON.stringify(value));
const item = (legacyId, shoppingGroup = 'today', extra = {}) => ({
  id: 'palsibo-20261026-' + legacyId, legacyId, trip: 'palsibo-20261026', shoppingGroup,
  name: '시험 준비물 ' + legacyId, qty: '1개', use: '기존 공간에서 사용', note: '구매 전 확인',
  zone: '레터 코너', figure: '기존 배치안', ...extra
});
const desk = item('letter-desk');
const stool = item('letter-stool');
const frames = item('character-frames');
const owned = item('owned-pos', 'owned');
function state() {
  return { version: 2, tasks: {keptTask: false}, inventory: {keptItem: {quantity: '직접 수정한 수량', status: '발주'}},
    note: '기존 공유 메모', openingDate: '2026-11-01', budget: {keep: 123},
    definitions: {tasks: [{id: 'keptTask', title: '기존 일'}], taskCategories: ['기존 일'],
      inventory: [{id: 'keptItem', name: '기존 준비물', category: '기존 분류', priority: '필수', quantity: '1', detail: '기존 설명', status: '검토'}], inventoryCategories: ['기존 분류']}
  };
}
function legacy(checked = {}, notes = {}) { return {version: 1, updatedAt: null, checked, notes}; }
function freeze(value) { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }

test('parse validates version, boolean checks, bounded string notes and preserves unknown IDs for caller backup', () => {
  assert.equal(M.parse(null), null);
  const value = legacy({'unknown-source-id': true}, {'unknown-source-id': '이전 원문'});
  assert.deepEqual(plain(M.parse(JSON.stringify(value))), value);
  for (const bad of ['{', JSON.stringify({...value, version: '1'}), JSON.stringify(legacy({x: 1})),
    JSON.stringify(legacy({}, {x: null})), JSON.stringify(legacy({}, {x: 'a'.repeat(601)})),
    JSON.stringify({...value, updatedAt: 42}), JSON.stringify({...value, arbitrary: true})]) {
    assert.throws(() => M.parse(bad));
  }
});

test('only canonical IDs and matching trip/group enter the migration; duplicates are removed', () => {
  const source = {items: [desk, desk, {...stool, trip: 'another'}, item('unknown'), {...frames, shoppingGroup: 'owned'}, {...owned, id: 'wrong'}]};
  assert.deepEqual(plain(M.items(source)), [desk]);
  assert.deepEqual(Object.keys(M.definition(desk)).sort(), ['id', 'name', 'category', 'priority', 'quantity', 'detail', 'status'].sort());
  assert.deepEqual(plain(M.record(owned)), {quantity: '1개', status: '준비 완료'});
  assert.throws(() => M.definition({...desk, qty: 'a'.repeat(81)}));
  assert.throws(() => M.definition({...desk, note: 'a'.repeat(6001)}));
});

test('empty legacy data creates no automatic records, including the owned references', () => {
  const before = state();
  const result = M.merge(before, legacy({}, {'letter-desk': '   '}), [desk, owned]);
  assert.equal(result.changed, false);
  assert.deepEqual(plain(result.state), before);
  assert.equal(result.imported.length, 0);
});

test('only explicit legacy entries materialize; source inputs and unrelated state remain untouched', () => {
  const before = freeze(state());
  const old = freeze(legacy({'letter-desk': true, 'letter-stool': false, unknown: true}, {'character-frames': '폭 30cm', unknown: '원본 보존'}));
  const source = freeze([desk, stool, frames, owned]);
  const result = M.merge(before, old, source);
  assert.equal(result.changed, true);
  assert.equal(result.state.inventory[desk.id].status, '준비 완료');
  assert.equal(result.state.inventory[stool.id].status, '검토');
  assert.equal(result.state.inventory[frames.id].status, '검토');
  assert.equal(Object.hasOwn(result.state.inventory, owned.id), false);
  assert.equal(Object.hasOwn(result.state.inventory, 'palsibo-20261026-unknown'), false);
  assert.equal(result.imported.length, 3);
  for (const key of ['tasks', 'note', 'openingDate', 'budget']) assert.deepEqual(plain(result.state[key]), before[key]);
  assert.deepEqual(plain(result.state.definitions.tasks), before.definitions.tasks);
  assert.deepEqual(plain(result.state.inventory.keptItem), before.inventory.keptItem);
  assert.deepEqual(Object.keys(result.state).sort(), Object.keys(before).sort());
  assert.deepEqual(before, state());
  assert.equal(old.notes.unknown, '원본 보존');
});

test('an existing remote incomplete state and edited quantity/definition win over legacy true', () => {
  const before = state(); M.ensureItem(before, desk);
  before.inventory[desk.id] = {quantity: '현장에서 변경한 2개', status: '검토'};
  const definition = before.definitions.inventory.find(x => x.id === desk.id);
  definition.name = '원격에서 바꾼 이름'; definition.detail = '다희 기존 메모';
  const snapshot = plain(before);
  const result = M.merge(before, legacy({'letter-desk': true}, {'letter-desk': '가로 80cm'}), [desk]);
  assert.deepEqual(plain(result.state.inventory[desk.id]), snapshot.inventory[desk.id]);
  const merged = result.state.definitions.inventory.find(x => x.id === desk.id);
  assert.equal(merged.name, '원격에서 바꾼 이름');
  assert.equal(merged.detail, '다희 기존 메모\n\n[10/26 팔시보 이전 메모]\n가로 80cm');
  assert.equal(result.conflicts.length, 1);
  assert.equal(result.conflicts[0].kept, '검토');
  assert.deepEqual(plain(before), snapshot);
});

test('legacy false cannot uncheck an existing remote completed record', () => {
  const before = state(); M.ensureItem(before, desk); before.inventory[desk.id].status = '준비 완료';
  const result = M.merge(before, legacy({'letter-desk': false}), [desk]);
  assert.equal(result.state.inventory[desk.id].status, '준비 완료');
  assert.equal(result.changed, false);
  assert.equal(result.conflicts.length, 1);
});

test('repeating the merge adds no item, category or identical note', () => {
  const old = legacy({'letter-desk': true}, {'letter-desk': '첫 줄\n둘째 줄'});
  const first = M.merge(state(), old, [desk]);
  const second = M.merge(first.state, old, [desk]);
  assert.equal(second.changed, false);
  assert.deepEqual(plain(second.state), plain(first.state));
  assert.equal(second.imported.length, 0);
  assert.equal(second.state.definitions.inventoryCategories.filter(x => x === M.CATEGORY).length, 1);
});

test('a note that cannot fit is deferred without truncating either existing or legacy text', () => {
  const before = state(); M.ensureItem(before, desk);
  before.definitions.inventory.find(x => x.id === desk.id).detail = '기'.repeat(5999);
  const old = legacy({}, {'letter-desk': '6000자를 넘기는 메모'});
  const result = M.merge(before, old, [desk]);
  assert.equal(result.changed, false);
  assert.equal(result.notesDeferred.length, 1);
  assert.equal(result.notesDeferred[0].legacyId, 'letter-desk');
  assert.equal(result.state.definitions.inventory.find(x => x.id === desk.id).detail, '기'.repeat(5999));
  assert.equal(old.notes['letter-desk'], '6000자를 넘기는 메모');
});

test('ensureItem fills only missing components and retains existing record and definition values', () => {
  const before = state();
  assert.equal(M.ensureItem(before, owned), true);
  assert.equal(before.inventory[owned.id].status, '준비 완료');
  assert.equal(M.ensureItem(before, owned), false);
  const existing = plain(M.definition(desk)); existing.quantity = '직접 수정한 기본 수량'; existing.status = '발주';
  before.definitions.inventory.push(existing);
  assert.equal(M.ensureItem(before, desk), true);
  assert.deepEqual(plain(before.inventory[desk.id]), {quantity: '직접 수정한 기본 수량', status: '발주'});
  assert.deepEqual(before.definitions.inventory.find(x => x.id === desk.id), existing);
});

test('owned reference note-only migration retains its ready default without manufacturing other records', () => {
  const result = M.merge(state(), legacy({}, {'owned-pos': '개통 시험은 별도 확인'}), [owned, desk]);
  assert.equal(result.state.inventory[owned.id].status, '준비 완료');
  assert.equal(Object.hasOwn(result.state.inventory, desk.id), false);
});
