// Spaces with an agent working, waiting on you, or done first, latest activity on
// top; the rest keep their order. Each worktree space goes under its main checkout's,
// and lifts that group when it is the active one.
const ACTIVE = new Set(["working", "blocked", "done"]);

const recency = (w) => ACTIVE.has(w.status) ? Math.max(0, ...(w.tabs ?? []).map((t) => t.changed_at ?? 0)) : -1;

// `list`: [{ w: SpaceInfo, g: git info or null }] in space order.
export function arrange(list) {
  const mains = new Set(list.filter((r) => r.g && !r.g.linked).map((r) => r.g.repo));
  const nested = (r) => r.g?.linked && mains.has(r.g.repo);
  const repoScore = {};
  for (const r of list) if (nested(r)) repoScore[r.g.repo] = Math.max(repoScore[r.g.repo] ?? -1, recency(r.w));
  const score = (r) => Math.max(recency(r.w), r.g && !r.g.linked ? repoScore[r.g.repo] ?? -1 : -1);
  // space.move can't leave a machine's block: sort inside each one.
  const block = (r) => list.findIndex((k) => (k.w.machine ?? null) === (r.w.machine ?? null));
  const top = list.filter((r) => !nested(r)).map((r) => ({ r, m: block(r), s: score(r) }))
    .sort((a, b) => a.m - b.m || b.s - a.s).map((x) => x.r);
  const out = [];
  const placed = new Set(); // repos whose worktrees are listed (under the first of its spaces)
  for (const r of top) {
    out.push({ ...r, tree: null });
    if (!r.g || r.g.linked || placed.has(r.g.repo)) continue;
    placed.add(r.g.repo);
    const kids = list.filter((k) => nested(k) && k.g.repo === r.g.repo);
    kids.forEach((k, n) => out.push({ ...k, tree: n === kids.length - 1 ? "└─" : "├─" }));
  }
  return out;
}
