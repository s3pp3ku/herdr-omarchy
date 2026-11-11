import { View, div, image, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { agents, exec, focused, home, panes, shared, setShared, props, openOverlay, settings, theme } from "herdr";

import { PROVIDERS, sourcesFor, fetchUsage } from "./providers.js";
import { clock, pace, resets, resetsShort } from "./time.js";

const MOD = "omarchy-ai-usage";
const keyOf = id => `${MOD}.${id}`;
const SHOWN = keyOf("shown");
const REFRESH_REQUEST = keyOf("refresh-request");
const REFRESH_HANDLED = keyOf("refresh-handled");
const EVERY = 5 * 60e3;
// One missed cycle plus slack, so a slow fetch doesn't flash the bar grey.
const STALE = 12 * 60e3;
const AMBER = "#ffb347", RED = "#ff5d6c";
const POPUP_W = 320, GAP = 6;

const refreshing = new Set();

async function refreshOne(src) {
  if (!src.provider || refreshing.has(src.id)) return;
  refreshing.add(src.id);
  const prev = shared(keyOf(src.id)) ?? {};
  const now = new Date().toISOString();
  try {
    const { windows, fetched } = await fetchUsage(src, true);
    setShared(keyOf(src.id), { checked: now, fetched: fetched ?? now, error: null, windows });
  } catch (e) {
    setShared(keyOf(src.id), { ...prev, checked: now, error: String(e?.message ?? e) });
  } finally { refreshing.delete(src.id); }
}

const shownList = () => shared(SHOWN)?.list ?? [];
const isOpenCodeSource = src => src.from?.harness === "opencode"
  || (src.id === "none.opencode" && src.agent === "OpenCode")
  || (src.id === "codex" && src.agent === "OpenCode" && src.label === "opencode" && src.from?.codex === true);
const sourceSignature = (vis, usageSource) => `${vis.map(v => `${v.terminal}:${v.program.key}`).join(",")}|${usageSource ?? ""}`;
const uniqueSources = list => {
  const sources = new Map();
  for (const src of list) if (!sources.has(src.id)) sources.set(src.id, src);
  return [...sources.values()];
};
const due = src => src.provider && Date.now() - (Date.parse(shared(keyOf(src.id))?.checked ?? "") || 0) >= EVERY;
const refreshAll = (force) => Promise.all(shownList().filter(s => force || due(s)).map(refreshOne));
const isStale = u => !u?.fetched || Boolean(u.error) || Date.now() - Date.parse(u.fetched) > STALE;

// Agent terminals the person sees now, the focused one first. A zoomed pane hides the rest.
function visible() {
  const f = focused();
  if (!f) return [];
  let ps = panes().filter(p => p.tab === f.tab && p.terminal && p.program?.agent);
  if (ps.some(p => p.zoomed)) ps = ps.filter(p => p.zoomed);
  const list = ps.map(p => ({ terminal: p.terminal, program: p.program, focused: p.focused }));
  const block = f.terminal && !list.some(v => v.terminal === f.terminal) && agents().find(a => a.address === f.terminal);
  if (block) list.push({ terminal: block.address, program: block.program, focused: true });
  return list.sort((a, b) => b.focused - a.focused);
}

export default class AiUsage extends View {
  init(_props, cx) {
    if (props()?.overlay) return;
    this.sig = null;
    this.claudeEnv = {};
    this.discoveryGeneration = 0;
    this.refreshRequestId = Number(shared(REFRESH_HANDLED)) || 0;
    this.refreshInFlightId = 0;
    this.refreshForcedId = 0;
    cx.timer.every(60e3, cx => {
      cx.notify();
      const requestId = Number(shared(REFRESH_REQUEST)) || 0;
      const requested = requestId > this.refreshRequestId;
      const force = requested && this.refreshForcedId !== requestId;
      if (force) this.refreshInFlightId = requestId;
      cx.spawn(async () => {
        const current = await this.refreshSources();
        if (current) {
          if (force) this.refreshForcedId = requestId;
          await refreshAll(force);
          if (force) this.acknowledgeRefresh(requestId);
        } else if (force && this.refreshInFlightId === requestId) this.refreshInFlightId = 0;
      });
    });
  }

  // CLAUDE_CONFIG_DIR is per process; Linux /proc ties it to the Herdr terminal (HC_TERMINAL_ID).
  async claudeDirOf(terminal) {
    if (!(terminal in this.claudeEnv)) {
      const r = await exec("sh", ["-c", `for f in /proc/[0-9]*/environ; do tr '\\0' '\\n' < "$f" 2>/dev/null | awk -F= '/^HC_TERMINAL_ID=/{t=$2} /^CLAUDE_CONFIG_DIR=/{c=$2} END{if(t!="")print t" "c}'; done`]).catch(() => null);
      for (const line of (r?.stdout ?? "").split("\n")) {
        const i = line.indexOf(" "), t = line.slice(0, i), dir = line.slice(i + 1).trim();
        if (i > 0 && (dir || !this.claudeEnv[t])) this.claudeEnv[t] = dir;
      }
      if (!(terminal in this.claudeEnv)) this.claudeEnv[terminal] = null;
    }
    const dir = this.claudeEnv[terminal];
    return dir === null ? null : (dir || `${home()}/.claude`);
  }

  // Rebuild source descriptors before any refresh, including requests from the popup.
  sync(cx) {
    const vis = visible(), choice = props()?.usage_source, sig = sourceSignature(vis, choice);
    const requestId = Number(shared(REFRESH_REQUEST)) || 0;
    const requested = requestId > this.refreshRequestId;
    if (sig === this.sig && (!requested || this.refreshInFlightId === requestId)) return;
    this.sig = sig;
    if (requested) this.refreshInFlightId = requestId;
    if (!vis.length && shownList().length && !shared(SHOWN)?.idle) setShared(SHOWN, { list: shownList(), idle: true });
    cx.spawn(async () => {
      const current = await this.refreshSources(vis, choice);
      if (!current) {
        if (requested && this.refreshInFlightId === requestId) this.refreshInFlightId = 0;
        return;
      }
      const force = requested && this.refreshForcedId !== requestId;
      if (force) this.refreshForcedId = requestId;
      await refreshAll(force);
      if (force) this.acknowledgeRefresh(requestId);
    });
  }

  acknowledgeRefresh(requestId) {
    this.refreshRequestId = Math.max(this.refreshRequestId, requestId);
    if (this.refreshInFlightId === requestId) this.refreshInFlightId = 0;
    setShared(REFRESH_HANDLED, this.refreshRequestId);
  }

  requestRefresh() {
    const latest = Math.max(Number(shared(REFRESH_REQUEST)) || 0, Number(shared(REFRESH_HANDLED)) || 0);
    setShared(REFRESH_REQUEST, latest + 1);
  }

  async refreshSources(vis = visible(), choice = props()?.usage_source) {
    const sig = sourceSignature(vis, choice), generation = this.discoveryGeneration = (this.discoveryGeneration || 0) + 1;
    const stillCurrent = () => generation === this.discoveryGeneration && sourceSignature(visible(), props()?.usage_source) === sig;
    if (vis.length) {
      const list = [];
      for (const v of vis) list.push(...await sourcesFor(v, terminal => this.claudeDirOf(terminal), choice, stillCurrent));
      if (!stillCurrent()) return false;
      const next = { list: uniqueSources(list), idle: false };
      if (JSON.stringify(shared(SHOWN)) !== JSON.stringify(next)) setShared(SHOWN, next);
      return true;
    }

    const prev = shared(SHOWN);
    if (!prev?.list?.length) return true;
    const list = [];
    for (const src of prev.list) {
      if (!isOpenCodeSource(src)) { list.push(src); continue; }
      list.push(...await sourcesFor({ terminal: null, program: {
        key: "opencode", name: src.agent || "OpenCode", icon: src.icon, tint: src.tint,
      } }, terminal => this.claudeDirOf(terminal), choice, stillCurrent));
    }
    if (!stillCurrent() || JSON.stringify(shared(SHOWN)?.list) !== JSON.stringify(prev.list)) return false;
    const next = { ...prev, list: uniqueSources(list), idle: true };
    if (JSON.stringify(shared(SHOWN)) !== JSON.stringify(next)) setShared(SHOWN, next);
    return true;
  }

  render(cx) {
    if (props()?.overlay) return this.details();
    this.sync(cx);
    return props()?.compact ? this.compact() : this.bar();
  }

  // Bottom bar: popup sits above, card pinned to its bottom. Top bar: below, pinned to its top.
  open() {
    const b = this.anchor;
    const z = Number(settings()?.zoom) || 1;
    const list = shownList();
    const rows = list.reduce((n, s) => n + Math.max(1, shared(keyOf(s.id))?.windows?.length ?? 0), 0);
    const want = 90 + list.length * 100 + rows * 75;
    const below = b && b.y / z < 200;
    const height = !b || below ? want : Math.min(want, b.y / z - GAP);
    const x = b ? Math.max(0, b.x + b.width - (POPUP_W + GAP) * z) : 0;
    const at = !b ? undefined : below ? { x, y: b.y + b.height + GAP * z } : { x, y: b.y - (height + GAP) * z };
    openOverlay({ mod: MOD, kind: "popup", frame: "none", width: POPUP_W, height, at, props: { details: true, height, below, usage_source: props()?.usage_source } });
  }

  icon(s, size, dim) {
    if (!s.icon) return div().size(size).flex_none();
    const el = s.tint ? svg(s.icon).text_color(theme().muted) : image(s.icon);
    return el.size(size).flex_none().opacity(dim ? 0.5 : 1);
  }

  tip(s) {
    const u = shared(keyOf(s.id));
    if (s.note) return `${s.agent}: ${s.note}`;
    const ws = u?.windows ?? [];
    const source = s.from?.omarchy === "codex" ? ` — ${s.sub}` : "";
    return `${s.agent} (${s.label})${source}: ` + (ws.length
      ? ws.map(w => `${w.long} ${w.used}%, ${resets(w)}`).join("; ") + (u.error ? ` (${u.error})` : "")
      : u?.error ?? (u?.fetched ? "no limits reported" : "loading"));
  }

  shell(el) {
    const t = theme(), edge = props()?.border;
    return el.id("root").size_full().items_center().bg(t.chrome).overflow_hidden()
      .on_size_change((_size, cx) => {
        const narrow = globalThis.window.viewport_size().width < 1024;
        if (narrow !== this.narrow) { this.narrow = narrow; cx.notify(); }
      })
      .when(edge === "top", el => el.border_t(1).border_color(t.border))
      .when(edge === "bottom", el => el.border_b(1).border_color(t.border))
      .on_mouse_down("left", (e, cx) => { this.anchor = e.bounds; cx.stop_propagation(); })
      .on_click(() => this.open())
      .tooltip(shownList().map(s => this.tip(s)).join("\n") || "No agent in view");
  }

  bar() {
    const t = theme(), idle = shared(SHOWN)?.idle;
    const rows = shownList().map(s => {
      const u = shared(keyOf(s.id));
      const stale = idle || isStale(u);
      const ws = (u?.windows ?? []).slice(0, 2);
      return h_flex().h(19).gap(6).items_center().flex_none()
        .child(this.icon(s, 13, stale))
        .child(div().w(64).flex_none().whitespace_nowrap().font_semibold().text_color(stale ? t.dim : t.foreground).child(s.label))
        .when(Boolean(s.note) || !ws.length, el => el.child(div().text_color(t.dim).child(s.note ?? (u?.error ? "no data" : u?.fetched ? "no limits" : "…"))))
        .children(ws.map(w => h_flex().gap(4).items_center().flex_none()
          .child(div().text_color(t.dim).child(w.short))
          .child(div().w(70).child(meter(w, stale, t, 5)))
          .child(div().w(28).text_color(stale ? t.dim : w.used >= 80 ? color(w, stale, t) : t.muted).child(`${w.used}%`))
          .child(div().w(78).flex_none().whitespace_nowrap().text_size(11).text_color(!stale && w.used >= 80 ? color(w, stale, t) : t.dim).child(`↻ ${resetsShort(w)}`))));
    });
    return this.shell(h_flex()).pl(12).pr(8).gap(12).text_size(11.8).child(v_flex().gap(2).children(rows));
  }

  // 330px: one provider gets label, bar and two windows; two drop the label; more keep one window each.
  compact() {
    const t = theme(), list = shownList(), idle = shared(SHOWN)?.idle;
    const narrow = this.narrow ?? globalThis.window.viewport_size().width < 1024;
    const n = list.length;
    // Icon, then each window (5h, 7d) as its label, a bar and the percent. The popup has the rest.
    const barW = n === 1 ? 70 : n === 2 ? 48 : 32;
    const segs = list.map(s => {
      const u = shared(keyOf(s.id));
      const stale = idle || isStale(u);
      const [first, second] = u?.windows ?? [];
      const win = (w) => {
        const c = color(w, stale, t, s);
        return h_flex().gap(5).items_center().flex_none()
          .child(div().whitespace_nowrap().text_color(t.dim).child(w.short))
          // Narrow windows: no bar, the percent carries the color instead.
          .when(!narrow, el => el.child(div().relative().w(barW).h(6).bg(t.border).child(div().absolute().left(0).top(0).h_full().w(`${clamp(w.used)}%`).bg(c))))
          .child(div().whitespace_nowrap().text_color(narrow || stale || w.used >= 80 ? c : t.muted).child(`${w.used}%`));
      };
      return h_flex().gap(6).items_center().flex_none()
        .child(this.icon(s, 12, stale))
        // The profile's name, so a work and a personal Claude tell apart.
        .when(s.provider === "claude", el => el.child(div().whitespace_nowrap().text_color(stale ? t.dim : t.foreground).child(s.label)))
        .when(Boolean(s.note) || !first, el => el.child(div().whitespace_nowrap().text_color(t.dim).child(s.note ?? (u?.error ? "no data" : u?.fetched ? "no limits" : "…"))))
        .when(Boolean(first), el => el.child(win(first)))
        .when(Boolean(second), el => el.child(win(second)));
    });
    // The same │ the bar puts between space and folder, only between segments.
    const sep = i => div().id(`usage-sep-${i}`).flex_none().text_color(t.border).child("│");
    return this.shell(h_flex()).justify_end().px(10).gap(narrow ? 10 : 14).text_size(11).children(segs.flatMap((seg, i) => (i ? [sep(i), seg] : [seg])));
  }

  details() {
    const t = theme(), idle = shared(SHOWN)?.idle, list = shownList();
    const section = s => {
      const u = shared(keyOf(s.id));
      const stale = idle || isStale(u);
      const status = s.note ?? (!u?.fetched ? (u?.error ?? "not fetched yet")
        : u.error ? `fetch failed: ${u.error} · data from ${clock(Date.parse(u.fetched))}`
        : `updated ${clock(Date.parse(u.fetched))}`);
      const footer = [status, s.from?.omarchy === "codex" ? s.sub : null].filter(Boolean).join(" · ");
      return v_flex().gap(10).p(10).rounded(0).border(1).border_color(stale ? t.border : t.input)
        .child(h_flex().gap(6).items_center().min_w(0)
          .child(this.icon(s, 14, stale))
          .child(div().flex_none().text_size(12.5).font_bold().text_color(t.foreground).child(title(s)))
          .when(Boolean(s.sub), el => el.child(div().flex_1().min_w(0).truncate().text_size(11.5).text_color(t.dim).child(s.sub))))
        .children((u?.windows ?? []).map(w => v_flex().gap(6)
          .child(h_flex().justify_between().items_end()
            .child(div().text_color(t.foreground).child(w.long))
            .child(div().text_size(18).font_semibold().text_color(color(w, stale, t, s)).child(`${w.used}%`)))
          .child(meter(w, stale, t, 6, s))
          .child(div().text_size(11.5).text_color(t.dim).child(resets(w)))))
        .child(div().text_size(11.5).text_color(u?.error ? t.blocked : t.dim).child(footer));
    };
    return v_flex().w_full().h(props().height ?? 0).when(!props().below, el => el.justify_end()).child(v_flex().w_full().p(14).gap(14).text_size(12).text_color(t.muted)
      .bg(t.popover).border(1).border_color(t.border).rounded(0)
      .child(h_flex().justify_between().items_center()
        .child(div().text_size(13).font_semibold().text_color(t.foreground).child(idle ? "AI usage (last seen)" : "AI usage"))
        .child(div().id("refresh").px(6).py(2).rounded(0).text_color(t.dim).hover(s => s.bg(t.hover).text_color(t.foreground))
          .on_click(() => this.requestRefresh()).child("Refresh")))
      .when(!list.length, el => el.child(div().text_color(t.dim).child("No agent in view")))
      .children(list.map(section)));
  }
}

const clamp = v => Math.min(100, Math.max(0, v ?? 0));
// "Codex · codex" says it twice; add the label only when it names something more (a Claude account, "pi").
const title = s => {
  const name = s.provider ? PROVIDERS[s.provider].name : s.label;
  return s.provider && s.label.toLowerCase() !== name.toLowerCase() ? `${name} · ${s.label}` : name;
};

// Each provider's own brand color (Claude clay, Codex blue, Copilot purple) until it nears its limit.
function color(w, stale, t, s) {
  if (stale) return t.dim;
  if (w.used >= 95) return RED;
  if (w.used >= 80) return AMBER;
  return PROVIDERS[s?.provider]?.color ?? t.accent;
}

// The elapsed share of the window is drawn as a ghost fill: lit past it means running ahead of pace.
function meter(w, stale, t, height, s) {
  const ghost = stale ? null : pace(w);
  return div().relative().w_full().h(height).rounded(0).bg(t.border)
    .when(ghost !== null, el => el.child(div().absolute().left(0).top(0).h_full().w(`${ghost * 100}%`).rounded(0).bg(t.dim).opacity(0.35)))
    .child(div().absolute().left(0).top(0).h_full().w(`${clamp(w.used)}%`).rounded(0).bg(color(w, stale, t, s)));
}
