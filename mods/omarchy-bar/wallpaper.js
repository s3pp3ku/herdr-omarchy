import { exec, appHome, layout, home, settings } from "herdr";

export const desktopDirectory = () => `${home()}/.local/state/omarchy/current`;

async function desktopWallpaper() {
  const script = `
    src=$(readlink -f "$1") || exit 1
    case "$src" in
      *.[pP][nN][gG]) ext=png ;;
      *.[jJ][pP][gG]|*.[jJ][pP][eE][gG]) ext=jpg ;;
      *.[wW][eE][bB][pP]) ext=webp ;;
      *) exit 1 ;;
    esac
    hash=$(sha256sum < "$src") || exit 1
    hash=\${hash%% *}
    file="$2/current-$hash.$ext"
    mkdir -p "$2" || exit 1
    if [ ! -f "$file" ]; then cp -- "$src" "$file" || exit 1; fi
    for old in "$2"/current-*; do
      if [ "$old" != "$file" ] && [ -f "$old" ]; then rm -f -- "$old"; fi
    done
    printf 'backgrounds/desktop/current-%s.%s' "$hash" "$ext"
  `;
  const r = await exec("sh", ["-c", script, "sh", `${desktopDirectory()}/background`, `${appHome()}/backgrounds/desktop`]).catch(() => null);
  return r?.code === 0 ? r.stdout.trim() : null;
}

let updating = Promise.resolve();

export function matchWallpaper(name) {
  updating = updating.catch(() => {}).then(async () => {
    const desktop = await desktopWallpaper();
    if (desktop) {
      if (layout()?.background?.image !== desktop) await setWallpaper(desktop);
      return;
    }
    if (layout()?.background?.image?.startsWith(`backgrounds/omarchy/${name}/`)) return;
    const [first] = await wallpapers(name);
    if (first && settings().theme === name) await setWallpaper(first);
  });
  return updating;
}

export async function nextWallpaper() {
  const desktop = await exec("test", ["-f", `${desktopDirectory()}/background`]).catch(() => null);
  if (desktop?.code === 0) {
    await exec("omarchy-theme-bg-next", []).catch(() => null);
    return;
  }
  const all = await wallpapers(settings().theme);
  if (!all.length) return;
  await setWallpaper(all[(all.indexOf(layout()?.background?.image) + 1) % all.length]);
}

// A theme's wallpapers: backgrounds/omarchy/<theme>/, in name order. None: [].
export async function wallpapers(name) {
  const dir = `backgrounds/omarchy/${name}`;
  const r = await exec("ls", ["-1", `${appHome()}/${dir}`]).catch(() => null);
  if (r?.code !== 0) return [];
  return r.stdout.split("\n").filter((f) => /\.(webp|jpe?g|png)$/i.test(f)).map((f) => `${dir}/${f}`);
}

// Through the CLI: run() refuses an argument nested deeper than 16 levels, and this layout's tree is deeper.
export async function setWallpaper(image) {
  const l = layout();
  if (!l) return;
  await exec("herdr-app", ["do", "layout.set", JSON.stringify({ layout: { ...l, background: { ...l.background, image } } })]);
}

function withNode(node, id, edit) {
  if (node?.id === id) return edit(node);
  if (!node?.children) return node;
  return { ...node, children: node.children.map((c) => withNode(c, id, edit)) };
}

// A zoomed pane gets a thicker frame, so a zoomed tab looks different.
export const ZOOM_BORDER = 4;

export async function setZoomBorder(zoomed) {
  const l = layout();
  if (!l) return;
  const width = zoomed ? ZOOM_BORDER : 2;
  const look = (b) => ({ ...b, width });
  const next = withNode(l, "main", (main) => {
    const pane = main.content.pane;
    return { ...main, content: { ...main.content, pane: { ...pane, border: look(pane.border), focus: look(pane.focus) } } };
  });
  await exec("herdr-app", ["do", "layout.set", JSON.stringify({ layout: next })]);
}
