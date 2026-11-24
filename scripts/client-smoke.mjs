// Client-half regression: loads the real bundle, checks both slot registrations,
// the i18n parity, and that the pocket renders without touching the network.
// Run: node scripts/client-smoke.mjs
import assert from 'node:assert/strict';

const ok = [];
const pass = (n) => ok.push(n);

function useState(init) {
  return [typeof init === 'function' ? init() : init, () => {}];
}
function useEffect() {}
function useMemo(fn) {
  return fn();
}
function useCallback(fn) {
  return fn;
}
function useRef(v) {
  return { current: v === undefined ? null : v };
}
function createElement(type, props, ...children) {
  return { type, props: props || {}, children: children.flat() };
}

const React = { createElement, useState, useEffect, useMemo, useCallback, useRef };
const ReactDom = { createPortal: (node, container) => ({ type: 'portal', container, node }) };

let loaded = null;
globalThis.window = {
  innerWidth: 1200,
  innerHeight: 800,
  getSelection: () => ({ toString: () => '' }),
  __ModuleLoader__: { load: (c) => (loaded = c) },
};
globalThis.document = { body: {}, addEventListener() {}, removeEventListener() {} };
const store = {};
globalThis.localStorage = {
  getItem: (k) => (k in store ? store[k] : null),
  setItem: (k, v) => {
    store[k] = String(v);
  },
  removeItem: (k) => {
    delete store[k];
  },
};
let fetchCalls = 0;
globalThis.fetch = () => {
  fetchCalls += 1;
  return Promise.reject(new Error('no network in test'));
};

await import('../client.js');

assert.ok(loaded, 'bundle 应调用 __ModuleLoader__.load');
assert.equal(loaded.id, 'dsh-prompt-pocket');
pass('bundle 以正确 id 注册');

const mod = loaded.factory((name) => {
  if (name === 'react') return React;
  if (name === 'react-dom') return ReactDom;
  throw new Error('unexpected import: ' + name);
});
assert.equal(typeof mod.apply, 'function');
assert.deepEqual(mod.inject, ['slots', 'locale']);
pass('factory 返回 apply 与 slots/locale 注入声明');

const slots = [];
let dict = null;
mod.apply({
  effect(fn) {
    return fn();
  },
  locale: {
    register(ns, d) {
      dict = { ns, d };
      return () => {};
    },
    bind() {
      return (k) => k;
    },
  },
  slots: {
    inject(name, fn) {
      return fn();
    },
    register(meta, component) {
      slots.push({ meta, component });
      return () => {};
    },
  },
});

assert.equal(slots.length, 2, '应当挂两个位置：输入框浮层 + 回复动作');
assert.equal(slots[0].meta.name, 'conversation.input.overlay');
assert.equal(slots[0].meta.id, 'dsh-prompt-pocket');
assert.equal(slots[1].meta.name, 'conversation.chat.assistant-actions');
assert.equal(slots[1].meta.order, 30);
pass('挂到输入框浮层与回复动作行');

assert.ok(dict && dict.d.zh && dict.d.en, '中英两套字典都要有');
assert.equal(Object.keys(dict.d.zh).length, Object.keys(dict.d.en).length, '中英条目数一致');
pass('中英字典条目对齐');

const props = {
  sessionId: 'session-a',
  useInput: () => '',
  useWorkspaces: () => [],
  inputActions: {
    captureInsertion: () => ({ draftRev: 1 }),
    insertText: () => true,
    setDraft: () => {},
    focus: () => {},
  },
};

const outer = slots[0].component(props);
const rendered = outer.type(outer.props);
const tree = JSON.stringify(rendered);
assert.ok(tree.includes('data-dsh-prompt-stash'), '浮点要带自己的标记');
assert.ok(tree.includes('portal'), '固定定位必须 portal 到 body');
assert.equal(fetchCalls, 0, '渲染期不该发请求');
pass('渲染出可拖动的浮点并 portal 到 body');

// The reply action must not fire a request until it is clicked.
const actionOuter = slots[1].component({ sessionId: 'session-a', messageId: 'm-1', useWorkspaces: () => [] });
const action = actionOuter.type(actionOuter.props);
assert.equal(JSON.stringify(action).includes('button'), true);
assert.equal(fetchCalls, 0, '回复按钮点之前不发请求');
pass('回复动作渲染时不发请求');

console.log('通过 ' + ok.length + ' 项：');
ok.forEach((n, i) => console.log('  ' + (i + 1) + '. ' + n));
