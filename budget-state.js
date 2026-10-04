/* Canonical budget overrides shared by local, JSON and Firebase state validation. */
(function () {
  'use strict';

  const ID = /^[A-Za-z][A-Za-z0-9_-]{0,79}$/;
  const FORBIDDEN_IDS = new Set(['__proto__', 'constructor', 'prototype']);
  const ROOT_KEYS = ['items', 'selections', 'assumptions'];
  const ITEM_KEYS = ['quantity', 'unitCost', 'included', 'paid'];
  const ASSUMPTION_LIMITS = Object.freeze({
    rent: 1e10,
    otherFixed: 1e10,
    monthlySales: 1e10,
    cogsPercent: 100,
    cardPercent: 100,
    otherVariablePercent: 100,
    operatingDays: 31,
  });

  function invalid() {
    throw new TypeError('예산 데이터의 항목 또는 값이 올바르지 않습니다.');
  }

  function record(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) invalid();
    if (Object.getOwnPropertySymbols(value).length) invalid();
    // Only JSON-style data properties are accepted; never execute a supplied getter.
    const keys = Object.getOwnPropertyNames(value);
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor.enumerable || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) invalid();
    }
    return keys;
  }

  function allowedRecord(value, allowed) {
    const keys = record(value);
    if (keys.some(key => !allowed.includes(key))) invalid();
    return keys;
  }

  function safeId(value) {
    if (typeof value !== 'string' || !ID.test(value) || FORBIDDEN_IDS.has(value)) invalid();
    return value;
  }

  function numeric(value, limit) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > limit) invalid();
    return value === 0 ? 0 : value;
  }

  function normalize(value) {
    if (value == null) return {};
    allowedRecord(value, ROOT_KEYS);
    const result = {};

    if (value.items != null) {
      const keys = record(value.items);
      if (keys.length > 1000) invalid();
      const items = {};
      for (const id of keys.sort()) {
        safeId(id);
        const source = value.items[id];
        if (source == null) continue;
        allowedRecord(source, ITEM_KEYS);
        const item = {};
        for (const key of ITEM_KEYS) {
          if (!Object.prototype.hasOwnProperty.call(source, key) || source[key] == null) continue;
          if (key === 'included') {
            if (typeof source[key] !== 'boolean') invalid();
            item[key] = source[key];
          } else {
            item[key] = numeric(source[key], key === 'quantity' ? 1e6 : 1e10);
          }
        }
        if (Object.keys(item).length) items[id] = item;
      }
      if (Object.keys(items).length) result.items = items;
    }

    if (value.selections != null) {
      const keys = record(value.selections);
      if (keys.length > 100) invalid();
      const selections = {};
      for (const id of keys.sort()) {
        safeId(id);
        const option = value.selections[id];
        if (option == null) continue;
        selections[id] = option === '' ? '' : safeId(option);
      }
      if (Object.keys(selections).length) result.selections = selections;
    }

    if (value.assumptions != null) {
      allowedRecord(value.assumptions, Object.keys(ASSUMPTION_LIMITS));
      const assumptions = {};
      for (const key of Object.keys(ASSUMPTION_LIMITS)) {
        if (!Object.prototype.hasOwnProperty.call(value.assumptions, key) || value.assumptions[key] == null) continue;
        assumptions[key] = numeric(value.assumptions[key], ASSUMPTION_LIMITS[key]);
      }
      if (Object.keys(assumptions).length) result.assumptions = assumptions;
    }

    return result;
  }

  window.OfflineBudgetState = Object.freeze({ normalize });
})();
