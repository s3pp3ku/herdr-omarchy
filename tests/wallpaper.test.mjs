import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, symlink, unlink, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';

const execute = promisify(execFile);
const PNG = Buffer.from('89504e470d0a1a0a0000000d', 'hex');
const JPEG = Buffer.from('ffd8ffe000104a4649460001', 'hex');
const picture = (magic, text) => Buffer.concat([magic, Buffer.from(text)]);
const shows = async (path, text) => assert.ok((await readFile(path)).toString('latin1').endsWith(text));
const source = await readFile(new URL('../mods/omarchy-bar/wallpaper.js', import.meta.url), 'utf8');
const load = () => import(`data:text/javascript;base64,${Buffer.from(source.replace(/import .* from "herdr";/, 'const { exec, appHome, layout, home, settings, readTextFile, window } = globalThis.wallpaperTest;')).toString('base64')}#${Math.random()}`);

test('desktop wallpaper follows symlink changes and same-path edits; missing links fall back', async () => {
  const root = await mkdtemp(`${tmpdir()}/herdr-wallpaper-`);
  const state = `${root}/.local/state/omarchy/current`;
  const app = `${root}/custom-app-home`;
  let current = { background: { image: 'old', opacity: 0.8 }, children: [] };
  const calls = [];
  globalThis.wallpaperTest = {
    home: () => root, appHome: () => app, layout: () => current,
    settings: () => ({ theme: 'test' }),
    readTextFile: async () => null, window: () => ({ platform: 'linux' }),
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
    const mod = await load();
    await mkdir(`${app}/backgrounds/omarchy/test`, { recursive: true });
    await writeFile(`${app}/backgrounds/omarchy/test/1.png`, 'bundled');
    await mod.matchWallpaper('test');
    assert.equal(current.background.image, 'backgrounds/omarchy/test/1.png');
    await mkdir(state, { recursive: true });
    const first = `${root}/photo with 'quotes'.png`;
    await writeFile(first, picture(PNG, 'first image'));
    await symlink(first, `${state}/background`);
    await mod.matchWallpaper('test');
    const image = current.background.image;
    assert.match(image, /^backgrounds\/desktop\/.+\.png$/);
    await shows(`${app}/${image}`, 'first image');
    assert.equal(current.background.opacity, 0.8);
    const count = calls.filter(([cmd]) => cmd === 'herdr-app').length;
    await mod.matchWallpaper('test');
    assert.equal(calls.filter(([cmd]) => cmd === 'herdr-app').length, count);
    await writeFile(first, picture(PNG, 'edited image'));
    await mod.matchWallpaper('test');
    assert.notEqual(current.background.image, image);
    await shows(`${app}/${current.background.image}`, 'edited image');
    const second = `${root}/other.jpg`;
    await writeFile(second, picture(JPEG, 'second image'));
    await unlink(`${state}/background`);
    await symlink(second, `${state}/background`);
    await mod.matchWallpaper('test');
    await shows(`${app}/${current.background.image}`, 'second image');
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

async function desktopCase(platform, run) {
  const root = await mkdtemp(`${tmpdir()}/herdr-wallpaper-`);
  const app = `${root}/app`;
  const state = { current: { background: { image: 'old' }, children: [] }, follow: false, desktop: null, calls: [] };
  globalThis.wallpaperTest = {
    home: () => root, appHome: () => app, layout: () => state.current,
    settings: () => ({ theme: 'test' }),
    window: () => ({ platform }),
    readTextFile: async () => JSON.stringify({ follow_desktop_wallpaper: state.follow }),
    exec: async (cmd, args) => {
      state.calls.push([cmd, args]);
      if (cmd === 'herdr-app') {
        state.current = JSON.parse(args[2]).layout;
        return { code: 0, stdout: '' };
      }
      if (cmd === 'gsettings') {
        const key = args.at(-1);
        if (key === 'color-scheme') return { code: 0, stdout: `'${state.dark ? 'prefer-dark' : 'default'}'\n` };
        if (key === 'picture-uri-dark') return { code: 0, stdout: `'${state.darkDesktop ?? ''}'\n` };
        return { code: 0, stdout: `'${state.desktop ?? ''}'\n` };
      }
      if (cmd === 'powershell' && args.at(-1).includes('Get-ItemProperty')) return { code: 0, stdout: `${state.desktop ?? ''}\r\n` };
      if (cmd === 'powershell') return { code: 0, stdout: 'backgrounds/desktop/current-abc.jpg' };
      try { return { code: 0, ...(await execute(cmd, args)) }; }
      catch (error) { return { code: error.code || 1, stdout: '' }; }
    },
  };
  try {
    await mkdir(`${app}/backgrounds/omarchy/test`, { recursive: true });
    await writeFile(`${app}/backgrounds/omarchy/test/1.png`, 'bundled');
    await writeFile(`${app}/backgrounds/omarchy/test/2.png`, 'bundled 2');
    await run(await load(), state, root, app);
  } finally {
    delete globalThis.wallpaperTest;
    await rm(root, { recursive: true, force: true });
  }
}

test('GNOME wallpaper is followed only when asked, dark picture in dark mode', () =>
  desktopCase('linux', async (mod, state, root, app) => {
    const light = `${root}/my background`, dark = `${root}/dark.png`;
    await writeFile(light, picture(JPEG, 'light image'));
    await writeFile(dark, picture(PNG, 'dark image'));
    state.desktop = `file://${encodeURI(light)}`;
    state.darkDesktop = `file://${dark}`;
    await mod.matchWallpaper('test');
    assert.equal(state.current.background.image, 'backgrounds/omarchy/test/1.png');
    state.follow = true;
    await mod.matchWallpaper('test');
    await shows(`${app}/${state.current.background.image}`, 'light image');
    const shown = state.current.background.image;
    await mod.nextWallpaper();
    assert.equal(state.current.background.image, shown);
    state.dark = true;
    await mod.matchWallpaper('test');
    await shows(`${app}/${state.current.background.image}`, 'dark image');
    state.desktop = 'file:///usr/share/backgrounds/slideshow.xml';
    state.darkDesktop = '';
    await mod.matchWallpaper('test');
    assert.equal(state.current.background.image, 'backgrounds/omarchy/test/1.png');
    await mod.nextWallpaper();
    assert.equal(state.current.background.image, 'backgrounds/omarchy/test/2.png');
    state.desktop = `file://${encodeURI(light)}`;
    await mod.matchWallpaper('test');
    state.follow = false;
    await mod.matchWallpaper('test');
    assert.equal(state.current.background.image, 'backgrounds/omarchy/test/1.png');
  }));

test('Windows wallpaper is read and copied through PowerShell', () =>
  desktopCase('windows', async (mod, state) => {
    state.follow = true;
    state.desktop = "C:\\Users\\José o'neil\\Pictures\\sea.jpg";
    await mod.matchWallpaper('test');
    assert.equal(state.current.background.image, 'backgrounds/desktop/current-abc.jpg');
    const [, args] = state.calls.find(([cmd, a]) => cmd === 'powershell' && a.at(-1).includes('Copy-Item'));
    assert.ok(args.at(-1).includes("$src = 'C:\\Users\\José o''neil\\Pictures\\sea.jpg'"));
    assert.ok(!state.calls.some(([cmd]) => cmd === 'sh'));
  }));

test('macOS keeps the theme wallpapers even when asked to follow', () =>
  desktopCase('macos', async (mod, state) => {
    state.follow = true;
    await mod.matchWallpaper('test');
    assert.equal(state.current.background.image, 'backgrounds/omarchy/test/1.png');
  }));
