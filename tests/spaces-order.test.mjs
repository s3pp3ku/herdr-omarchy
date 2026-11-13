import assert from 'node:assert/strict';
import { test } from 'node:test';
import { arrange } from '../mods/omarchy-spaces/order.js';

const space = (id, status = null, changed = null) => ({ w: { id, status, tabs: [{ changed_at: changed }] }, g: null });
const ids = (rows) => rows.map((r) => r.w.id);

test('active spaces go first, latest activity on top; the rest keep their order', () => {
  const list = [space('a'), space('b', 'working', 10), space('c', 'idle', 99), space('d', 'done', 30), space('e', 'blocked', 20)];
  assert.deepEqual(ids(arrange(list)), ['d', 'e', 'b', 'a', 'c']);
});

test('an active space with no recorded change still goes above idle ones', () => {
  assert.deepEqual(ids(arrange([space('a'), space('b', 'working')])), ['b', 'a']);
});

test('an active worktree lifts its repo group and stays under its checkout', () => {
  const main = { ...space('main'), g: { repo: 'r', linked: false } };
  const tree = { ...space('tree', 'working', 5), g: { repo: 'r', linked: true } };
  const out = arrange([space('x', 'done', 1), main, space('y'), tree]);
  assert.deepEqual(ids(out), ['main', 'tree', 'x', 'y']);
  assert.equal(out[1].tree, '└─');
});

test('an active space never leaves its machine block', () => {
  const remote = { ...space('r', 'working', 50), w: { id: 'r', machine: 'box', status: 'working', tabs: [{ changed_at: 50 }] } };
  assert.deepEqual(ids(arrange([space('a'), space('b', 'done', 1), remote])), ['b', 'a', 'r']);
});
