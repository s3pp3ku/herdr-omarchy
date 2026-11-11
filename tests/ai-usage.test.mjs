import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { H, DAY } from '../mods/omarchy-ai-usage/time.js';

function usageHarness(files = {}, response = {}, status = 200, settings = {}, props = {}, live = {}) {
  const state = new Map();
  const requests = [], reads = [];
  let currentProps = props;
  const dependencies = {
    View: class {},
    home: () => '/home/test',
    appHome: () => '/home/test/.config/herdr-app',
    settings: () => settings,
    props: () => currentProps,
    focused: () => live.focused ?? null,
    panes: () => live.panes ?? [],
    agents: () => live.agents ?? [],
    exec: async () => ({ code: 1, stdout: '', stderr: '' }),
    readTextFile: async path => {
      reads.push(path);
      const value = files[path];
      if (typeof value === 'function') return value();
      return value === undefined ? null : typeof value === 'string' ? value : JSON.stringify(value);
    },
    shared: key => state.get(key),
    setShared: (key, value) => state.set(key, value),
    fetch: async (url, options) => {
      requests.push({ url, ...options });
      if (response && typeof response.then === 'function') return response;
      return { ok: status === 200, status, json: async () => response };
    },
  };
  const providerSource = readFileSync(new URL('../mods/omarchy-ai-usage/providers.js', import.meta.url), 'utf8')
    .replace(/^import .*;\n/gm, '').replace(/^export /gm, '');
  const providers = Function(...Object.keys(dependencies), 'H', 'DAY', `${providerSource}\nreturn { PROVIDERS, sourcesFor, fetchUsage };`)(...Object.values(dependencies), H, DAY);
  Object.assign(dependencies, providers);
  const source = readFileSync(new URL('../mods/omarchy-ai-usage/main.js', import.meta.url), 'utf8')
    .replace(/^import .*;\n/gm, '').replace('export default class', 'class');
  const { refreshOne, refreshAll, AiUsage } = Function(...Object.keys(dependencies), `${source}\nreturn { refreshOne, refreshAll, AiUsage };`)(...Object.values(dependencies));
  return {
    state, requests, reads, refreshOne, refreshAll, fetchUsage: providers.fetchUsage, AiUsage,
    route: (value, directory = null, usageSource) => providers.sourcesFor(value, async () => directory, usageSource),
    setProps: value => { currentProps = value; },
  };
}

const agent = key => ({ terminal: 't1', program: { key, name: key, icon: `${key}.svg`, tint: true } });
const claude = { id: 'claude.claude', provider: 'claude', agent: 'Claude', from: { claude: '/home/test/.claude' } };
const codex = { id: 'codex', provider: 'codex', agent: 'Codex', from: { codex: true } };
const copilot = { id: 'copilot', provider: 'copilot', agent: 'Copilot', from: { copilot: true } };
const claudeLogin = { '/home/test/.claude/.credentials.json': { claudeAiOauth: { accessToken: 'claude-token' } } };

test('Claude normalizes session and model limits, ignoring unknown windows', async () => {
  const h = usageHarness(claudeLogin, { limits: [
    { kind: 'session', percent: 42.4, resets_at: '2026-11-05T01:00:00Z' },
    { kind: 'weekly_scoped', percent: 91.7, resets_at: '2026-11-08T01:00:00Z', scope: { model: { display_name: 'Sonnet' } } },
    { kind: 'unknown', percent: 12 },
  ] });
  await h.refreshOne(claude);
  assert.deepEqual(h.state.get('omarchy-ai-usage.claude.claude').windows, [
    { short: '5h', long: '5-hour limit', span: 5 * 3600e3, used: 42, resets_at: '2026-11-05T01:00:00Z' },
    { short: '7d Sonnet', long: 'Weekly Sonnet limit', span: 7 * 24 * 3600e3, used: 92, resets_at: '2026-11-08T01:00:00Z' },
  ]);
  assert.equal(h.requests[0].url, 'https://api.anthropic.com/api/oauth/usage');
  assert.equal(h.requests[0].headers.Authorization, 'Bearer claude-token');
  assert.ok(!JSON.stringify([...h.state]).includes('claude-token'));
});

test('Claude also accepts legacy usage windows', async () => {
  const h = usageHarness(claudeLogin, { five_hour: { utilization: 12.6, resets_at: 'later' }, seven_day: { utilization: 60, resets_at: 'next week' } });
  await h.refreshOne(claude);
  assert.deepEqual(h.state.get('omarchy-ai-usage.claude.claude').windows.map(w => [w.short, w.used]), [['5h', 13], ['7d', 60]]);
});

test('Codex sends account ID and normalizes timestamps', async () => {
  const h = usageHarness({ '/home/test/.codex/auth.json': { tokens: { access_token: 'codex-token', account_id: 'account' } } }, {
    rate_limit: { primary_window: { limit_window_seconds: 18000, used_percent: 34.5, reset_at: 1800000000 }, secondary_window: {} },
  });
  await h.refreshOne(codex);
  assert.deepEqual(h.state.get('omarchy-ai-usage.codex').windows, [
    { short: '5h', long: '5-hour limit', span: 18000e3, used: 35, resets_at: new Date(1800000000e3).toISOString() },
  ]);
  assert.equal(h.requests[0].url, 'https://chatgpt.com/backend-api/wham/usage');
  assert.equal(h.requests[0].headers['ChatGPT-Account-Id'], 'account');
});

test('Copilot excludes unlimited and unknown quotas', async () => {
  const h = usageHarness({ '/home/test/.config/github-copilot/hosts.json': { github: { oauth_token: 'copilot-token' } } }, {
    quota_reset_date_utc: '2026-12-01', quota_snapshots: {
      premium_interactions: { percent_remaining: 70 }, chat: { unlimited: true, percent_remaining: 100 }, other: { percent_remaining: 0 },
    },
  });
  await h.refreshOne(copilot);
  assert.deepEqual(h.state.get('omarchy-ai-usage.copilot').windows, [
    { short: 'mo', long: 'Monthly premium requests', span: 30 * 24 * 3600e3, used: 30, resets_at: '2026-12-01', monthly: true },
  ]);
  assert.equal(h.requests[0].url, 'https://api.github.com/copilot_internal/user');
  assert.equal(h.requests[0].headers.Authorization, 'token copilot-token');
});

test('failed credentials preserve last fetched usage without making requests', async () => {
  const h = usageHarness({ '/home/test/.claude/.credentials.json': { claudeAiOauth: { accessToken: 'expired-token', expiresAt: 1 } } });
  const previous = { fetched: '2026-11-01T00:00:00Z', windows: [{ used: 20 }] };
  h.state.set('omarchy-ai-usage.claude.claude', previous);
  await h.refreshOne(claude);
  const result = h.state.get('omarchy-ai-usage.claude.claude');
  assert.equal(result.fetched, previous.fetched);
  assert.deepEqual(result.windows, previous.windows);
  assert.match(result.error, /token expired/);
  assert.equal(h.requests.length, 0);
  await h.refreshOne(codex);
  assert.match(h.state.get('omarchy-ai-usage.codex').error, /no Codex ChatGPT login/);
});

test('Claude account routing keeps work and personal sources separate', async () => {
  const h = usageHarness();
  assert.deepEqual((await h.route(agent('claude-code'))).map(s => [s.id, s.from.claude]), [
    ['claude.claude', '/home/test/.claude'], ['claude.personal', '/home/test/.claude-personal'],
  ]);
  const [personal] = await h.route(agent('claude-code'), '/home/test/.claude-personal');
  assert.equal(personal.id, 'claude.personal');
  assert.equal(personal.from.claude, '/home/test/.claude-personal');
});

test('Pi shares Codex login only when account IDs match', async () => {
  for (const accountId of ['same', 'different']) {
    const h = usageHarness({
      '/home/test/.pi/agent/settings.json': { defaultProvider: 'openai-codex' },
      '/home/test/.pi/agent/auth.json': { 'openai-codex': { type: 'oauth', accountId, access: 'pi-token' } },
      '/home/test/.codex/auth.json': { tokens: { account_id: 'same' } },
    });
    const [source] = await h.route(agent('pi'));
    assert.equal(source.id, accountId === 'same' ? 'codex' : 'pi.codex');
    assert.deepEqual(source.from, accountId === 'same' ? { codex: true } : { harness: 'pi', entry: 'openai-codex' });
  }
});

test('unsupported agents and API-key harnesses remain labelled without requests', async () => {
  const h = usageHarness({
    '/home/test/.config/opencode/opencode.json': { model: 'anthropic/sonnet' },
    '/home/test/.local/share/opencode/auth.json': { anthropic: { type: 'api', key: 'secret' } },
  });
  assert.equal((await h.route(agent('other')))[0].note, 'no usage API');
  assert.equal((await h.route(agent('opencode')))[0].note, 'anthropic: no usage API');
  assert.equal(h.requests.length, 0);
});

test('provider HTTP errors preserve previously fetched windows', async () => {
  const h = usageHarness(claudeLogin, {}, 401);
  const previous = { fetched: '2026-11-01T00:00:00Z', windows: [{ used: 20 }] };
  h.state.set('omarchy-ai-usage.claude.claude', previous);
  await h.refreshOne(claude);
  const result = h.state.get('omarchy-ai-usage.claude.claude');
  assert.equal(result.error, 'HTTP 401');
  assert.equal(result.fetched, previous.fetched);
  assert.deepEqual(result.windows, previous.windows);
});

test('OpenCode Claude OAuth uses access token for the usage endpoint', async () => {
  const h = usageHarness({
    '/home/test/.config/opencode/opencode.json': { model: 'anthropic/sonnet' },
    '/home/test/.local/share/opencode/auth.json': { anthropic: { type: 'oauth', refresh: 'refresh-token', access: 'access-token' } },
  });
  const [source] = await h.route(agent('opencode'));
  await h.refreshOne(source);
  assert.equal(source.id, 'opencode.claude');
  assert.equal(h.requests[0].headers.Authorization, 'Bearer access-token');
  assert.ok(!JSON.stringify([...h.state]).includes('access-token'));
});

test('Pi Copilot OAuth uses refresh token for the usage endpoint', async () => {
  const h = usageHarness({
    '/home/test/.pi/agent/settings.json': { defaultProvider: 'github-copilot' },
    '/home/test/.pi/agent/auth.json': { 'github-copilot': { type: 'oauth', refresh: 'refresh-token', access: 'access-token' } },
  });
  const [source] = await h.route(agent('pi'));
  await h.refreshOne(source);
  assert.equal(source.id, 'pi.copilot');
  assert.equal(h.requests[0].headers.Authorization, 'token refresh-token');
});

test('a Claude profile is named after its organization, Personal, or its folder', async () => {
  const { route } = usageHarness({
    '/home/test/.claude.json': { oauthAccount: { organizationName: 'Flexspring' } },
    '/home/test/.claude-personal/.claude.json': { oauthAccount: { organizationName: "me@example.com's Organization" } },
  });
  assert.equal((await route(agent('claude'), '/home/test/.claude'))[0].label, 'Flexspring');
  assert.equal((await route(agent('claude'), '/home/test/.claude-personal'))[0].label, 'Personal');
  assert.equal((await route(agent('claude'), '/home/test/.claude-other'))[0].label, 'Other');
});

test('settings.json claude_labels names a Claude profile outright', async () => {
  const { route } = usageHarness({
    '/home/test/.claude.json': { oauthAccount: { organizationName: 'Flexspring' } },
    '/home/test/.config/herdr-app/settings.json': { claude_labels: { '~/.claude': 'Work' } },
  });
  assert.equal((await route(agent('claude'), '/home/test/.claude'))[0].label, 'Work');
  assert.equal((await route(agent('claude'), '/home/test/.claude-other'))[0].label, 'Other');
});

const opencodeConfigPath = '/home/test/.config/opencode/opencode.json';
const omarchyCachePath = '/home/test/.local/state/omarchy/agents/usage/codex.json';
const omarchySource = { id: 'omarchy.codex', provider: 'openai', agent: 'opencode', label: 'Omarchy', sub: "Omarchy's ChatGPT subscription; OpenCode account not verified", from: { omarchy: 'codex', harness: 'opencode', entry: 'openai' } };
const freshOmarchyCache = () => ({
  ready: true, limitsStale: false, limitsFetchedAt: Date.now() - 60_000,
  limits: [
    { label: '5h window', percent: 0.46, resetsAt: new Date(Date.now() + 3600_000).toISOString() },
    { label: 'Weekly (7-day)', percent: 0.08, resetsAt: new Date(Date.now() + 7 * DAY).toISOString() },
  ],
});
const opencodeAuth = { openai: { type: 'oauth', access: 'synthetic-openai-token' } };

test('OpenCode OpenAI uses Omarchy cache only with the explicit opt-in', async () => {
  for (const config of [
    { model: 'openai/gpt-5' },
    { providers: { openai: {} } },
  ]) {
    const h = usageHarness({ [opencodeConfigPath]: config }, {}, 200, {}, { usage_source: 'omarchy' });
    const [source] = await h.route(agent('opencode'), null, 'omarchy');
    assert.deepEqual(source, { ...omarchySource, icon: 'opencode.svg', tint: true });
    assert.deepEqual(h.reads, [opencodeConfigPath]);
    assert.equal(h.requests.length, 0);
    assert.ok(!JSON.stringify(source).match(/token|accountId|email/i));
  }
});

test('OpenCode defaults to its original direct OpenAI OAuth route', async () => {
  const h = usageHarness({
    [opencodeConfigPath]: { model: 'openai/gpt-5' },
    '/home/test/.local/share/opencode/auth.json': opencodeAuth,
  });
  const [source] = await h.route(agent('opencode'));
  assert.equal(source.id, 'opencode.codex');
  assert.equal(source.provider, 'codex');
  assert.deepEqual(source.from, { harness: 'opencode', entry: 'openai' });
  assert.ok(h.reads.includes('/home/test/.local/share/opencode/auth.json'));
  assert.ok(!h.reads.includes(omarchyCachePath));
});

test('OpenCode sources shared with Codex retain OpenCode provenance while idle', async () => {
  const h = usageHarness({
    [opencodeConfigPath]: { model: 'openai/gpt-5' },
    '/home/test/.local/share/opencode/auth.json': { openai: { type: 'oauth', access: 'synthetic-openai-token', accountId: 'same' } },
    '/home/test/.codex/auth.json': { tokens: { account_id: 'same', access_token: 'synthetic-codex-token' } },
  });
  const [source] = await h.route(agent('opencode'));
  assert.equal(source.id, 'codex');
  assert.deepEqual(source.from, { codex: true, harness: 'opencode', entry: 'openai' });
  h.state.set('omarchy-ai-usage.shown', { list: [source], idle: true });
  h.setProps({ usage_source: 'omarchy' });
  await new h.AiUsage().refreshSources([], 'omarchy');
  assert.equal(h.state.get('omarchy-ai-usage.shown').list[0].id, 'omarchy.codex');
});

test('OpenCode API-key auth stays unsupported without opt-in', async () => {
  const h = usageHarness({
    [opencodeConfigPath]: { model: 'openai/gpt-5' },
    '/home/test/.local/share/opencode/auth.json': { openai: { type: 'api', key: 'synthetic-api-key' } },
  });
  const [source] = await h.route(agent('opencode'));
  assert.equal(source.provider, undefined);
  assert.deepEqual(source.from, { harness: 'opencode', entry: 'openai' });
  assert.equal(source.note, 'openai: no usage API');
  assert.ok(!JSON.stringify(source).includes('synthetic-api-key'));
});

test('OpenCode opt-in leaves an explicitly selected non-OpenAI provider unchanged', async () => {
  const h = usageHarness({
    [opencodeConfigPath]: { model: 'anthropic/sonnet' },
    '/home/test/.local/share/opencode/auth.json': { anthropic: { type: 'oauth', access: 'synthetic-anthropic-token' } },
  }, {}, 200, {}, { usage_source: 'omarchy' });
  const [source] = await h.route(agent('opencode'), null, 'omarchy');
  assert.equal(source.provider, 'claude');
  assert.deepEqual(source.from, { harness: 'opencode', entry: 'anthropic' });
  assert.ok(!h.reads.includes(omarchyCachePath));
});

test('Omarchy quota uses fractional percentages and retains the collector fetched time', async () => {
  const cache = freshOmarchyCache();
  const h = usageHarness({ [omarchyCachePath]: cache });
  const now = Date.now();
  const legacyResult = await h.fetchUsage(omarchySource);
  assert.ok(Array.isArray(legacyResult));
  const result = await h.fetchUsage(omarchySource, true);
  assert.deepEqual(result.windows.map(w => [w.short, w.long, w.used]), [
    ['5h', '5-hour limit', 46], ['7d', 'Weekly limit', 8],
  ]);
  assert.equal(Date.parse(result.fetched), cache.limitsFetchedAt);
  assert.ok(Math.abs(Date.now() - now) < 1000);
  assert.deepEqual(h.reads, [omarchyCachePath, omarchyCachePath]);
  assert.equal(h.requests.length, 0);
  const text = new h.AiUsage().tip(omarchySource);
  assert.match(text, /Omarchy's ChatGPT subscription; OpenCode account not verified/);
});

test('Omarchy cache accepts one valid supported window', async () => {
  const cache = freshOmarchyCache();
  cache.limits = [cache.limits[0]];
  const h = usageHarness({ [omarchyCachePath]: cache });
  const result = await h.fetchUsage(omarchySource, true);
  assert.deepEqual(result.windows.map(w => [w.short, w.used]), [['5h', 46]]);
  assert.equal(Date.parse(result.fetched), cache.limitsFetchedAt);
});

test('stale or malformed Omarchy cache preserves last-good windows and fetched timestamp', async () => {
  const originalNow = Date.now, now = Date.now();
  Date.now = () => now;
  try {
    const cases = [
      ['missing', undefined],
      ['not ready', { ...freshOmarchyCache(), ready: false }],
      ['stale', { ...freshOmarchyCache(), limitsStale: true }],
      ['old', { ...freshOmarchyCache(), limitsFetchedAt: now - 12 * 60_000 - 1 }],
      ['future', { ...freshOmarchyCache(), limitsFetchedAt: now + 1 }],
      ['invalid fetched timestamp', { ...freshOmarchyCache(), limitsFetchedAt: 'recent' }],
      ['missing limits', { ...freshOmarchyCache(), limits: null }],
      ['empty limits', { ...freshOmarchyCache(), limits: [] }],
      ['duplicate window', { ...freshOmarchyCache(), limits: [{ label: '5h window', percent: 0.4, resetsAt: new Date(now).toISOString() }, { label: '5h window', percent: 0.46, resetsAt: new Date(now).toISOString() }] }],
      ['unknown labels', { ...freshOmarchyCache(), limits: [{ label: 'other', percent: 0.5, resetsAt: new Date(now).toISOString() }] }],
      ['invalid fraction', { ...freshOmarchyCache(), limits: [{ label: '5h window', percent: 1.1, resetsAt: new Date(now).toISOString() }] }],
      ['invalid reset', { ...freshOmarchyCache(), limits: [{ label: '5h window', percent: 0.46, resetsAt: 'yesterday' }] }],
    ];
    for (const [name, cache] of cases) {
      const h = usageHarness(cache === undefined ? {} : { [omarchyCachePath]: cache });
      const previous = { checked: '2026-11-08T00:00:00Z', fetched: '2026-11-08T00:00:00Z', windows: [{ used: 17 }] };
      h.state.set('omarchy-ai-usage.omarchy.codex', previous);
      await h.refreshOne(omarchySource);
      const result = h.state.get('omarchy-ai-usage.omarchy.codex');
      assert.equal(result.fetched, previous.fetched, name);
      assert.deepEqual(result.windows, previous.windows, name);
      assert.match(result.error, /^Omarchy subscription limits are /, name);
      assert.equal(h.requests.length, 0, name);
    }
  } finally { Date.now = originalNow; }
});

test('popup Refresh waits for in-flight opt-in reconciliation before refreshing sources', async () => {
  let resolveConfig;
  const config = new Promise(resolve => { resolveConfig = resolve; });
  const old = { id: 'opencode.codex', provider: 'codex', agent: 'OpenCode', label: 'opencode', icon: 'opencode.svg', tint: true,
    from: { harness: 'opencode', entry: 'openai' } };
  const live = { focused: { tab: 't1' }, panes: [{ tab: 't1', terminal: 't1', focused: true,
    program: { key: 'opencode', name: 'OpenCode', icon: 'opencode.svg', tint: true, agent: true } }] };
  const h = usageHarness({
    [opencodeConfigPath]: () => config,
    '/home/test/.local/share/opencode/auth.json': opencodeAuth,
    [omarchyCachePath]: freshOmarchyCache(),
  }, {}, 200, {}, { usage_source: 'omarchy' }, live);
  const previous = { checked: '2000-01-01T00:00:00Z', fetched: '2000-01-01T00:00:00Z', windows: [{ used: 6 }] };
  h.state.set('omarchy-ai-usage.shown', { list: [old], idle: false });
  h.state.set('omarchy-ai-usage.opencode.codex', previous);
  const instance = new h.AiUsage(), tasks = [];
  const cx = { timer: { every() {} }, spawn: fn => tasks.push(fn), notify() {} };
  instance.init({}, cx);
  instance.sync(cx);
  const initialDiscovery = tasks.shift()(cx);
  await Promise.resolve();
  new h.AiUsage().requestRefresh(); // the popup's Refresh handler only publishes a request
  instance.sync(cx);
  const requestedDiscovery = tasks.shift()(cx);
  resolveConfig(JSON.stringify({ model: 'openai/gpt-5' }));
  await Promise.all([initialDiscovery, requestedDiscovery]);
  assert.equal(h.state.get('omarchy-ai-usage.shown').list[0].id, 'omarchy.codex');
  assert.deepEqual(h.state.get('omarchy-ai-usage.omarchy.codex').windows.map(w => w.used), [46, 8]);
  assert.equal(h.state.get('omarchy-ai-usage.opencode.codex'), previous);
  assert.equal(h.requests.length, 0);
  assert.ok(!h.reads.includes('/home/test/.local/share/opencode/auth.json'));
});

test('idle source reconciliation enables and disables Omarchy before popup refresh', async () => {
  const cache = freshOmarchyCache();
  const h = usageHarness({
    [opencodeConfigPath]: { model: 'openai/gpt-5' },
    '/home/test/.local/share/opencode/auth.json': opencodeAuth,
    [omarchyCachePath]: cache,
  });
  const old = { id: 'opencode.codex', provider: 'codex', agent: 'opencode', label: 'opencode', icon: 'opencode.svg', tint: true,
    from: { harness: 'opencode', entry: 'openai' } };
  const oldCache = { checked: '2026-11-08T00:00:00Z', fetched: '2026-11-08T00:00:00Z', windows: [{ used: 4 }] };
  h.state.set('omarchy-ai-usage.shown', { list: [old], idle: true });
  h.state.set('omarchy-ai-usage.opencode.codex', oldCache);
  const instance = new h.AiUsage();

  h.setProps({ usage_source: 'omarchy' });
  await instance.refreshSources([], 'omarchy');
  assert.equal(h.state.get('omarchy-ai-usage.shown').list[0].id, 'omarchy.codex');
  await h.refreshAll(true); // Same shared list the popup's Refresh button consumes.
  assert.deepEqual(h.state.get('omarchy-ai-usage.omarchy.codex').windows.map(w => w.used), [46, 8]);
  assert.equal(h.state.get('omarchy-ai-usage.omarchy.codex').fetched, new Date(cache.limitsFetchedAt).toISOString());
  assert.equal(h.state.get('omarchy-ai-usage.opencode.codex'), oldCache);
  assert.equal(h.state.get('omarchy-ai-usage.shown').idle, true);

  h.setProps({});
  await instance.refreshSources([], undefined);
  assert.equal(h.state.get('omarchy-ai-usage.shown').list[0].id, 'opencode.codex');
  assert.deepEqual(h.state.get('omarchy-ai-usage.shown').list[0].from, { harness: 'opencode', entry: 'openai' });
  h.setProps({ usage_source: 'omarchy' });
  await instance.refreshSources([], 'omarchy');
  assert.equal(h.state.get('omarchy-ai-usage.shown').list[0].id, 'omarchy.codex');
});

test('popup Refresh waits for opt-out reconciliation before using direct OAuth', async () => {
  let resolveConfig;
  const config = new Promise(resolve => { resolveConfig = resolve; });
  const files = {
    [opencodeConfigPath]: () => config,
    '/home/test/.local/share/opencode/auth.json': opencodeAuth,
    [omarchyCachePath]: freshOmarchyCache(),
  };
  const h = usageHarness(files, { rate_limit: { primary_window: { limit_window_seconds: 18000, used_percent: 31, reset_at: 1800000000 }, secondary_window: {} } });
  const oldOmarchy = { ...omarchySource, icon: 'openai.svg', tint: true };
  h.state.set('omarchy-ai-usage.shown', { list: [oldOmarchy], idle: true });
  h.state.set('omarchy-ai-usage.omarchy.codex', { checked: '2026-11-08T00:00:00Z', windows: [{ used: 4 }] });
  h.setProps({}); // The owner opted out while the old popup/source is still present.
  const owner = new h.AiUsage(), popup = new h.AiUsage(), tasks = [];
  const cx = { timer: { every() {} }, spawn: fn => tasks.push(fn), notify() {} };
  owner.init({}, cx);
  owner.sync(cx);
  const resolvingOldSource = tasks.shift()(cx);
  await Promise.resolve();
  popup.requestRefresh();
  owner.sync(cx);
  const resolvingRequest = tasks.shift()(cx);
  resolveConfig(JSON.stringify({ model: 'openai/gpt-5' }));
  await Promise.all([resolvingOldSource, resolvingRequest]);
  assert.equal(h.state.get('omarchy-ai-usage.shown').list[0].id, 'opencode.codex');
  assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0].url, 'https://chatgpt.com/backend-api/wham/usage');
  assert.ok(!h.reads.includes(omarchyCachePath));
});

test('focused OpenCode provenance wins a shared Codex source and enables idle opt-in', async () => {
  const live = { focused: { tab: 't1' }, panes: [
    { tab: 't1', terminal: 'open', focused: true, program: { key: 'opencode', name: 'OpenCode', icon: 'openai.svg', tint: true, agent: true } },
    { tab: 't1', terminal: 'codex', focused: false, program: { key: 'codex', name: 'Codex', icon: 'codex.svg', tint: true, agent: true } },
  ] };
  const h = usageHarness({
    [opencodeConfigPath]: { model: 'openai/gpt-5' },
    '/home/test/.local/share/opencode/auth.json': { openai: { type: 'oauth', access: 'synthetic-openai-token', accountId: 'same' } },
    '/home/test/.codex/auth.json': { tokens: { account_id: 'same', access_token: 'synthetic-codex-token' } },
  }, {}, 200, {}, {}, live);
  const instance = new h.AiUsage();
  await instance.refreshSources();
  const [source] = h.state.get('omarchy-ai-usage.shown').list;
  assert.equal(source.id, 'codex');
  assert.equal(source.agent, 'OpenCode');
  assert.deepEqual(source.from, { codex: true, harness: 'opencode', entry: 'openai' });
  live.focused = null;
  h.setProps({ usage_source: 'omarchy' });
  await instance.refreshSources([], 'omarchy');
  assert.equal(h.state.get('omarchy-ai-usage.shown').list[0].id, 'omarchy.codex');
});

test('original idle none.opencode descriptor can later enable Omarchy', async () => {
  const h = usageHarness({ [opencodeConfigPath]: { providers: { openai: {} } } });
  const unselected = { id: 'none.opencode', agent: 'OpenCode', label: 'OpenCode', icon: 'opencode.svg', tint: true, note: 'its provider: no usage API' };
  assert.equal(unselected.from, undefined);
  h.state.set('omarchy-ai-usage.shown', { list: [unselected], idle: true });
  const instance = new h.AiUsage();
  h.setProps({ usage_source: 'omarchy' });
  h.reads.length = 0;
  await instance.refreshSources([], 'omarchy');
  assert.equal(h.state.get('omarchy-ai-usage.shown').list[0].id, 'omarchy.codex');
  assert.equal(h.state.get('omarchy-ai-usage.shown').idle, true);
  assert.ok(!h.reads.includes('/home/test/.local/share/opencode/auth.json'));
});

test('original shared-Codex OpenCode descriptor migrates but standalone Codex does not', async () => {
  const files = { [opencodeConfigPath]: { providers: { openai: {} } } };
  const h = usageHarness(files, {}, 200, {}, { usage_source: 'omarchy' });
  const legacyOpenCode = { id: 'codex', provider: 'codex', agent: 'OpenCode', label: 'opencode', icon: 'codex.svg', tint: true, from: { codex: true } };
  h.state.set('omarchy-ai-usage.shown', { list: [legacyOpenCode], idle: true });
  await new h.AiUsage().refreshSources([], 'omarchy');
  assert.equal(h.state.get('omarchy-ai-usage.shown').list[0].id, 'omarchy.codex');

  const codexOnly = { id: 'codex', provider: 'codex', agent: 'Codex', label: 'codex', icon: 'codex.svg', tint: true, from: { codex: true } };
  h.state.set('omarchy-ai-usage.shown', { list: [codexOnly], idle: true });
  await new h.AiUsage().refreshSources([], 'omarchy');
  assert.equal(h.state.get('omarchy-ai-usage.shown').list[0].id, 'codex');
  assert.deepEqual(h.state.get('omarchy-ai-usage.shown').list[0].from, { codex: true });
});

test('visible option changes and the 60-second refresh rediscover OpenCode routing', async () => {
  const files = {
    [opencodeConfigPath]: { model: 'openai/gpt-5' },
    '/home/test/.local/share/opencode/auth.json': { ...opencodeAuth, anthropic: { type: 'oauth', access: 'synthetic-anthropic-token' } },
    [omarchyCachePath]: freshOmarchyCache(),
  };
  const live = { focused: { tab: 't1' }, panes: [{ tab: 't1', terminal: 't1', focused: true,
    program: { key: 'opencode', name: 'OpenCode', icon: 'openai.svg', tint: true, agent: true } }] };
  const h = usageHarness(files, {}, 200, {}, { usage_source: 'omarchy' }, live);
  const instance = new h.AiUsage(), tasks = [];
  let tick;
  const cx = { timer: { every(_ms, cb) { tick = cb; } }, spawn: fn => tasks.push(fn), notify() {} };
  instance.init({}, cx);
  instance.sync(cx);
  await Promise.all(tasks.splice(0).map(fn => fn(cx)));
  assert.equal(h.state.get('omarchy-ai-usage.shown').list[0].id, 'omarchy.codex');

  h.setProps({});
  instance.sync(cx);
  await Promise.all(tasks.splice(0).map(fn => fn(cx)));
  assert.equal(h.state.get('omarchy-ai-usage.shown').list[0].id, 'opencode.codex');

  files[opencodeConfigPath] = { model: 'anthropic/sonnet' };
  const tickCx = { notify() {} };
  let tickTask;
  tickCx.spawn = fn => { tickTask = fn(tickCx); };
  tick(tickCx);
  await tickTask;
  assert.equal(h.state.get('omarchy-ai-usage.shown').list[0].id, 'opencode.claude');
});

test('older provider discovery cannot overwrite or refresh a newer source list', async () => {
  let resolveOld, resolveNew;
  const oldConfig = new Promise(resolve => { resolveOld = resolve; });
  const newConfig = new Promise(resolve => { resolveNew = resolve; });
  const files = {
    [opencodeConfigPath]: () => oldConfig,
    '/home/test/.local/share/opencode/auth.json': { anthropic: { type: 'oauth', access: 'synthetic-anthropic-token' } },
    [omarchyCachePath]: freshOmarchyCache(),
  };
  const live = { focused: { tab: 't1' }, panes: [{ tab: 't1', terminal: 't1', focused: true,
    program: { key: 'opencode', name: 'OpenCode', icon: 'openai.svg', tint: true, agent: true } }] };
  const h = usageHarness(files, {}, 200, {}, { usage_source: 'omarchy' }, live);
  const instance = new h.AiUsage(), tasks = [];
  let tick;
  const cx = { timer: { every(_ms, cb) { tick = cb; } }, spawn: fn => tasks.push(fn), notify() {} };
  instance.init({}, cx);
  instance.sync(cx);
  const older = tasks.shift()(cx);
  await Promise.resolve();
  files[opencodeConfigPath] = () => newConfig;
  const tickCx = { notify() {} };
  let newer;
  tickCx.spawn = fn => { newer = fn(tickCx); };
  tick(tickCx);
  resolveNew(JSON.stringify({ model: 'openai/gpt-5' }));
  await newer;
  resolveOld(JSON.stringify({ model: 'anthropic/sonnet' }));
  await older;
  assert.equal(h.state.get('omarchy-ai-usage.shown').list[0].id, 'omarchy.codex');
  assert.deepEqual(h.state.get('omarchy-ai-usage.omarchy.codex').windows.map(w => w.used), [46, 8]);
  assert.equal(h.requests.length, 0);
  assert.ok(!h.reads.includes('/home/test/.local/share/opencode/auth.json'));
});

test('periodic ticks redraw and refresh Omarchy during a forced Copilot fetch', async () => {
  const originalNow = Date.now, start = Date.now();
  let now = start, resolveQuota;
  Date.now = () => now;
  const quotaResponse = new Promise(resolve => { resolveQuota = resolve; });
  const live = { focused: { tab: 't1' }, panes: [
    { tab: 't1', terminal: 'opencode', focused: true, program: { key: 'opencode', name: 'OpenCode', icon: 'openai.svg', tint: true, agent: true } },
    { tab: 't1', terminal: 'copilot', focused: false, program: { key: 'copilot', name: 'Copilot', icon: 'copilot.svg', tint: true, agent: true } },
  ] };
  let cache = { ready: true, limitsStale: false, limitsFetchedAt: start, limits: [
    { label: '5h window', percent: 0.25, resetsAt: new Date(start + 3600_000).toISOString() },
    { label: 'Weekly (7-day)', percent: 0.05, resetsAt: new Date(start + 7 * DAY).toISOString() },
  ] };
  const h = usageHarness({
    [opencodeConfigPath]: { model: 'openai/gpt-5' },
    [omarchyCachePath]: () => JSON.stringify(cache),
    '/home/test/.config/github-copilot/hosts.json': { github: { oauth_token: 'synthetic-copilot-token' } },
  }, quotaResponse, 200, {}, { usage_source: 'omarchy' }, live);
  const initial = { checked: new Date(start).toISOString(), fetched: new Date(start).toISOString(),
    windows: [{ short: '5h', long: '5-hour limit', span: 5 * H, used: 25, resets_at: new Date(start + 10_000).toISOString() }] };
  h.state.set('omarchy-ai-usage.shown', { list: [omarchySource, copilot], idle: false });
  h.state.set('omarchy-ai-usage.omarchy.codex', initial);
  h.state.set('omarchy-ai-usage.copilot', { checked: new Date(start - 5 * 60_000 - 1).toISOString(), windows: [] });
  let tick, notifications = 0, tasks = [];
  const cx = {
    timer: { every(_ms, cb) { tick = cb; } },
    spawn(fn) { const task = fn(cx); tasks.push(task); return task; },
    notify() { notifications++; },
  };
  const instance = new h.AiUsage();
  instance.init({}, cx);
  let forcedTask;
  try {
    instance.requestRefresh();
    instance.sync(cx);
    forcedTask = tasks.at(-1);
    for (let i = 0; i < 20 && !h.requests.length; i++) await Promise.resolve();
    assert.equal(h.requests.length, 1);
    assert.equal(h.requests[0].url, 'https://api.github.com/copilot_internal/user');
    let forcedSettled = false;
    forcedTask.then(() => { forcedSettled = true; });
    assert.equal(forcedSettled, false);

    now = start + 13 * 60_000;
    cache = { ready: true, limitsStale: false, limitsFetchedAt: now, limits: [
      { label: '5h window', percent: 0.72, resetsAt: new Date(now + 3600_000).toISOString() },
      { label: 'Weekly (7-day)', percent: 0.13, resetsAt: new Date(now + 7 * DAY).toISOString() },
    ] };
    tick(cx);
    assert.equal(notifications, 1, 'the timer notifies before periodic work');
    const periodicTask = tasks.at(-1);
    for (let i = 0; i < 20 && h.state.get('omarchy-ai-usage.omarchy.codex')?.windows?.[0]?.used !== 72; i++) await Promise.resolve();
    assert.deepEqual(h.state.get('omarchy-ai-usage.omarchy.codex').windows.map(w => w.used), [72, 13]);
    assert.equal(h.state.get('omarchy-ai-usage.omarchy.codex').fetched, new Date(now).toISOString());
    assert.equal(forcedSettled, false);

    now += 60_000;
    tick(cx);
    assert.equal(notifications, 2, 'later ticks still notify while forced Copilot work is pending');
    await tasks.at(-1);
    assert.equal(h.requests.length, 1, 'the pending Copilot request is deduplicated');
    assert.equal(forcedSettled, false);
    assert.ok(h.reads.filter(path => path === omarchyCachePath).length >= 2);
  } finally {
    resolveQuota({ ok: true, status: 200, json: async () => ({ quota_reset_date_utc: '2026-12-01', quota_snapshots: {} }) });
    await Promise.all(tasks);
    if (forcedTask) await forcedTask;
    Date.now = originalNow;
  }
});
