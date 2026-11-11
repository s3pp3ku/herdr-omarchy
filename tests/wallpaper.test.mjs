import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, symlink, unlink, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';

const execute = promisify(execFile);
const source = await readFile(new URL('../mods/omarchy-bar/wallpaper.js', import.meta.url), 'utf8');

test('desktop wallpaper follows symlink changes and same-path edits; missing links fall back', async () => {
  const root = await mkdtemp(`${tmpdir()}/herdr-wallpaper-`);
  const state = `${root}/.local/state/omarchy/current`;
  const app = `${root}/custom-app-home`;
  let current = { background: { image: 'old', opacity: 0.8 }, children: [] };
  const calls = [];
  globalThis.wallpaperTest = {
    home: () => root, appHome: () => app, layout: () => current,
    settings: () => ({ theme: 'test' }),
    exec: async (cmd, args) => {
      calls.push([cmd, args]);
      if (cmd === 'herdr-app') {
        current = JSON.parse(args[2]).layout;
        return { code: 0, stdout: '' };
      }
      if (cmd === 'omarchy-theme-bg-next') return { code: 0, stdout: '' };
      try { return { code: 0, ...(await execute(cmd, args)) }; }
      catch (error) { return { code: error.code || 1, stdout: '' }; }
    },
  };
  try {
    const mod = await import(`data:text/javascript;base64,${Buffer.from(source.replace(/import .* from "herdr";/, 'const { exec, appHome, layout, home, settings } = globalThis.wallpaperTest;')).toString('base64')}`);
    await mkdir(`${app}/backgrounds/omarchy/test`, { recursive: true });
    await writeFile(`${app}/backgrounds/omarchy/test/1.png`, 'bundled');
    await mod.matchWallpaper('test');
    assert.equal(current.background.image, 'backgrounds/omarchy/test/1.png');
    await mkdir(state, { recursive: true });
    const first = `${root}/photo with 'quotes'.png`;
    await writeFile(first, 'first image');
    await symlink(first, `${state}/background`);
    await mod.matchWallpaper('test');
    const image = current.background.image;
    assert.match(image, /^backgrounds\/desktop\/.+\.png$/);
    assert.equal(await readFile(`${app}/${image}`, 'utf8'), 'first image');
    assert.equal(current.background.opacity, 0.8);
    const count = calls.filter(([cmd]) => cmd === 'herdr-app').length;
    await mod.matchWallpaper('test');
    assert.equal(calls.filter(([cmd]) => cmd === 'herdr-app').length, count);
    await writeFile(first, 'edited image');
    await mod.matchWallpaper('test');
    assert.notEqual(current.background.image, image);
    assert.equal(await readFile(`${app}/${current.background.image}`, 'utf8'), 'edited image');
    const second = `${root}/other.jpg`;
    await writeFile(second, 'second image');
    await unlink(`${state}/background`);
    await symlink(second, `${state}/background`);
    await mod.matchWallpaper('test');
    assert.equal(await readFile(`${app}/${current.background.image}`, 'utf8'), 'second image');
    assert.equal((await readdir(`${app}/backgrounds/desktop`)).length, 1);
    await mod.nextWallpaper();
    assert.ok(calls.some(([cmd]) => cmd === 'omarchy-theme-bg-next'));
    await unlink(`${state}/background`);
    await mod.matchWallpaper('test');
    assert.equal(current.background.image, 'backgrounds/omarchy/test/1.png');
    await mod.nextWallpaper();
    assert.equal(current.background.image, 'backgrounds/omarchy/test/1.png');
    await symlink(`${root}/missing.png`, `${state}/background`);
    await mod.matchWallpaper('test');
    assert.equal(current.background.image, 'backgrounds/omarchy/test/1.png');
    await unlink(`${state}/background`);
    const unsupported = `${root}/image.svg`;
    await writeFile(unsupported, '<svg/>');
    await symlink(unsupported, `${state}/background`);
    await mod.matchWallpaper('test');
    assert.equal(current.background.image, 'backgrounds/omarchy/test/1.png');
    await unlink(`${state}/background`);
    await symlink(second, `${state}/background`);
    await rm(`${app}/backgrounds/desktop`, { recursive: true });
    await writeFile(`${app}/backgrounds/desktop`, 'not a directory');
    await mod.matchWallpaper('test');
    assert.equal(current.background.image, 'backgrounds/omarchy/test/1.png');
  } finally {
    delete globalThis.wallpaperTest;
    await rm(root, { recursive: true, force: true });
  }
});
