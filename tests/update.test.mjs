import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname } from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';

const execute = promisify(execFile);
const source = await readFile(new URL('../mods/omarchy-bar/update.js', import.meta.url), 'utf8');

async function put(root, files) {
  for (const [path, text] of Object.entries(files)) {
    await mkdir(dirname(`${root}/${path}`), { recursive: true });
    await writeFile(`${root}/${path}`, typeof text === 'string' ? text : JSON.stringify(text));
  }
}

const commit = async (repo, files) => {
  await put(repo, files);
  await execute('git', ['-C', repo, 'add', '-A']);
  await execute('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'c']);
  return (await execute('git', ['-C', repo, 'rev-parse', 'HEAD'])).stdout.trim();
};

test('update: main ahead is flagged, applied without losing the person\'s keys, wallpaper or theme', async () => {
  const root = await mkdtemp(`${tmpdir()}/herdr-update-`);
  const repo = `${root}/repo`, app = `${root}/app`;
  const store = {}, notes = [];
  globalThis.updateTest = {
    home: () => root, appHome: () => app, window: () => ({ platform: 'linux' }),
    shared: (k) => store[k], setShared: (k, v) => { store[k] = v; }, notify: (n) => notes.push(n),
    readTextFile: (p) => readFile(p, 'utf8').catch(() => null),
    writeTextFile: (p, text) => writeFile(p, text),
    exec: async (cmd, args) => {
      try { return { code: 0, ...(await execute(cmd, args)) }; }
      catch (error) { return { code: error.code || 1, stdout: '' }; }
    },
  };
  try {
    await mkdir(repo, { recursive: true });
    await execute('git', ['-C', repo, 'init', '-q', '-b', 'main']);
    const first = await commit(repo, {
      'mods/omarchy-a/main.js': 'a1', 'mods/omarchy-bar/main.js': 'bar1', 'themes/x.json': '{}', 'backgrounds/omarchy/t/1.webp': 'img', 'layouts/omarchy.svg': '<svg/>',
      'layouts/omarchy.json': { background: { image: 'theirs.webp', fit: 'cover' }, theme: 't', v: 1 },
      'keys.json': { 'layout:omarchy': { k1: 'theirs', k2: 'new' } },
    });
    await put(app, {
      'keys.json': { 'layout:omarchy': { k1: 'mine' }, global: { g: 'x' } },
      'layouts/omarchy.json': { background: { image: 'mine.webp' }, theme: { dark: 'x', light: 'y' }, v: 0 },
    });
    const mod = await import(`data:text/javascript;base64,${Buffer.from(source
      .replace(/import .* from "herdr";/, 'const { exec, home, appHome, readTextFile, writeTextFile, shared, setShared, notify, window } = globalThis.updateTest;')
      .replace(/https:\/\/github\.com\/shafiqimtiaz\/herdr-omarchy\.git/, repo)).toString('base64')}`);
    const json = async (p) => JSON.parse(await readFile(`${app}/${p}`, 'utf8'));

    await mod.checkUpdate();
    assert.deepEqual(store[mod.AVAILABLE], { sha: first, mods: ['omarchy-a', 'omarchy-bar'] });

    await mod.applyUpdate();
    assert.equal(await readFile(`${app}/mods/omarchy-a/main.js`, 'utf8'), 'a1');
    assert.equal(await readFile(`${app}/mods/omarchy-bar/main.js`, 'utf8'), 'bar1');
    assert.equal(await readFile(`${app}/backgrounds/omarchy/t/1.webp`, 'utf8'), 'img');
    assert.deepEqual(await json('keys.json'), { 'layout:omarchy': { k1: 'mine', k2: 'new' }, global: { g: 'x' } });
    assert.equal((await json('layouts/omarchy.json')).v, 0, 'no record yet: the layout stays');
    assert.equal(store[mod.RECORD].sha, first);
    assert.equal(store[mod.AVAILABLE], null);
    assert.equal(notes.at(-1).level, 'success');

    await mod.checkUpdate();
    assert.equal(store[mod.AVAILABLE], null);

    const themeTime = (await stat(`${app}/themes/x.json`)).mtimeMs;
    const second = await commit(repo, { 'mods/omarchy-a/main.js': 'a2', 'layouts/omarchy.json': { background: { image: 'theirs.webp', fit: 'cover' }, theme: 't', v: 2 } });
    await mod.checkUpdate();
    assert.equal(store[mod.AVAILABLE].sha, second);

    await mod.applyUpdate();
    assert.equal(await readFile(`${app}/mods/omarchy-a/main.js`, 'utf8'), 'a2');
    assert.deepEqual(await json('layouts/omarchy.json'), { background: { image: 'mine.webp', fit: 'cover' }, theme: { dark: 'x', light: 'y' }, v: 2 });
    assert.equal((await stat(`${app}/themes/x.json`)).mtimeMs, themeTime, 'unchanged files are not rewritten');
    assert.equal(store[mod.RECORD].sha, second);

    await writeFile(`${app}/layouts/omarchy.json`, JSON.stringify({ background: { image: 'mine2.webp' }, v: 2 }));
    await commit(repo, { 'mods/omarchy-a/main.js': 'a3' });
    await mod.applyUpdate();
    assert.equal((await json('layouts/omarchy.json')).background.image, 'mine2.webp', 'layout unchanged on main: left alone');
  } finally {
    delete globalThis.updateTest;
    await rm(root, { recursive: true, force: true });
  }
});
