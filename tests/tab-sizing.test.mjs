import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';

const source = readFileSync(new URL('../mods/omarchy-tabs/main.js', import.meta.url), 'utf8');
const sizing = source.slice(source.indexOf('    this.syncPanel(space, panel, body, enabled);') + '    this.syncPanel(space, panel, body, enabled);'.length, source.indexOf('    const panelButton ='));
function widths(count, strip, panels = 0, zoom = 1) {
  return vm.runInNewContext(`(function () { let tabW = 190, tabA = 190; ${sizing}; return [tabW, tabA]; }).call({room: {strip: ${strip}, panels: ${panels}}})`, {
    TAB_MIN: 84, TAB_MAX: 190, TAB_ACTIVE: 150,
    shown: Array(count), settings: () => ({ zoom }),
    window: { viewport_size: () => ({ width: 1800 }) },
    root: {}, find: () => ({ size: { px: 243 } }), enabled: [],
  });
}

test('compact tabs use measured strip and panel widths, not window width', () => {
  const [normal, active] = widths(5, 600, 100);
  assert.equal(normal, 84);
  assert.equal(active, 128);
});

test('measured widths account for UI zoom', () => {
  assert.deepEqual([...widths(5, 1200, 200, 2)], [...widths(5, 600, 100)]);
});

test('tabs keep minimum width when scrolling and maximum width when roomy', () => {
  assert.deepEqual([...widths(10, 500)], [84, 84]);
  assert.deepEqual([...widths(2, 1000)], [190, 190]);
});

test('empty and not-yet-measured strips use safe default widths', () => {
  assert.deepEqual([...widths(0, 0)], [190, 190]);
  assert.deepEqual([...widths(5, 0)], [190, 190]);
});
