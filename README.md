<div align="center">

# Omarchy for Herdr

**A [Herdr](https://herdr.dev) layout that looks like the [Omarchy](https://github.com/basecamp/omarchy) desktop.**

[Features](#features) · [Install](#install) · [Keys](#keys) · [What is inside](#what-is-inside) · [Development](#development)

![Omarchy layout in Herdr](preview.png)

</div>

The Omarchy desktop, rebuilt inside Herdr. Your terminals and coding agents sit in flat, square, bordered tiles that float over a wallpaper. Everything you need while agents work is on one screen: which spaces and agents are busy, how much AI quota is left, your files, your Git changes and the whole commit graph. It follows Omarchy closely, down to the themes, the wallpapers, the theme switcher and the keys.

## Highlights

- **Agents at a glance.** The sidebar lists every agent with its live status: working, needs you, done or idle. Tabs show each agent's icon, what it works on and a spinner while it runs. `alt-shift-up` and `alt-shift-down` step through every agent, and `alt-shift-left` and `alt-shift-right` jump to the next tab where one is working or waiting on you.
- **AI usage in the top bar.** The 5-hour and 7-day quotas of the agents on screen sit at the right of the bar, each with a bar in its provider's color. Claude profiles are named, so a work and a personal account are easy to tell apart. Click for reset times.
- **Closed a tab by mistake? Bring it back.** `ctrl-alt-shift-t` reopens the last closed tab in the same place, with the same splits and sizes. Claude, Codex and pi come back in their own conversations, with their flags and profiles.
- **Git without leaving the window.** The side panel shows your changes with a diff (wrap long lines, drag the split), commits, pushes, pulls, stashes and switches or creates branches. One click opens the full commit graph, with branch lanes, labels and right-click menus for checkout, merge, rebase, reset and tags.
- **Omarchy's themes and wallpapers.** Every Omarchy theme ships with all of its wallpapers. The theme switcher is Omarchy 4's: big desktop previews, left and right to choose. A theme brings its own wallpaper, and `super-ctrl-w` cycles them. Light themes switch Herdr to light mode, dark ones back to dark.
- **Omarchy's keys.** The layout uses Omarchy's own keys wherever GNOME leaves them free. `super-k` lists every key in plain English, grouped by type (spaces, tabs, panes, agents and more). Click a group to fold it, and the fold stays. The keys that came with the layout are set apart.
- **Square dialogs that match.** The command palette, Settings, the go-to picker, notifications, right-click menus, a Keybindings list and a mod manager that browses, reviews and installs community mods all share the same look.

OpenCode uses its original model-based OAuth route by default. To opt into Omarchy agents' cached Codex quota for an OpenAI OpenCode provider, add `usage_source: "omarchy"` to the `ai-usage` block's `content.props` in an existing `layouts/omarchy.json`, keeping `compact: true`:

```json
"props": { "compact": true, "usage_source": "omarchy" }
```

This reads only `~/.local/state/omarchy/agents/usage/codex.json`, maintained by Omarchy agents. It accepts a ready, non-stale cache fetched within 12 minutes and does not read OpenCode credentials, make a quota request, log in, or refresh the cache. It shows Omarchy's ChatGPT subscription; the account is not verified against OpenCode. Without the property, the original routing remains active.

## Features

- **Top bar**: the menu, sidebar, browser and search buttons and the current space on the left; AI usage and the window buttons on the right. The browser button opens a blank browser tab in the space.
- **Sidebar**: spaces and agents with their status. Hover a space or an agent to close it with its × button. One with an agent working or waiting on you asks for a second click. Resize the sidebar, or fold it into an icon rail. The footer opens Settings, Keybindings and Mods.
- **Tabs**: agent icons, what each one works on, its status, and a close button on hover.
- **Side panel**: Files with colored icons, and Changes with the commit graph inside it.
- **Themes**: every Omarchy color theme, each with its wallpapers.
- **Browser panes**: a local page reloads when you save a file in its folder (pages directly in `/tmp` do not). The toolbar counts the page's console errors, opens DevTools on it, or opens the page in a real Chrome window.

## Install

Ask your agent in Herdr:

```text
Read ~/.config/herdr-app/AGENTS.md, then add the layout from github.com/shafiqimtiaz/herdr-omarchy.
```

The agent copies the layout, mods, themes and wallpapers into `~/.config/herdr-app`, then runs `sh patches/apply-herdr-browser.sh` from the repo. The script patches Herdr's browser helper for the DevTools button and the page's error count, and restarts the helper if it is running. Run it again after each Herdr update, because an update replaces the helper. Your own layout stays. Press `ctrl-shift-l` to change between layouts.

> [!NOTE]
> Some mods use the network or run programs:
> - `omarchy-ai-usage` reads local login files for direct provider usage (Claude, Codex, Copilot, OpenCode and Pi). With the explicit `usage_source: "omarchy"` option, OpenCode/OpenAI instead uses Omarchy agents' Codex quota cache; that subscription may differ from OpenCode's account. This cache route reads no credentials and makes no network request.
> - `omarchy-spaces`, `omarchy-files` and `omarchy-changes` run `git` in your folders. The commit graph in `omarchy-changes` also runs `find` to look for repos in a folder that is not one.
> - `omarchy-pane` runs `google-chrome` or `chromium` for the browser toolbar's DevTools and Chrome-window buttons, and your system's opener for links.
> - `patches/apply-herdr-browser.sh` changes the files of `~/.local/share/herdr-browser`. It stops and starts `herdr-browser` when the helper is running.
> - `omarchy-bar` starts `herdr-browser view` through your shell for its browser button.
> - `omarchy-mod-manager` searches GitHub for mods. It runs `git` and `gh` to download and install them.

## Keys

These keys work only in the Omarchy layout, except Ctrl+arrows, which also apply in terminals across layouts. They follow Omarchy: its Herdr keymap and its desktop keys. Keys that GNOME already uses are left out. `super-k` lists every key.

| Key | Action |
| --- | --- |
| `alt-1` … `alt-9` | Go to tab 1 to 9 |
| `alt-left` / `alt-right` | Previous / next tab |
| `alt-up` / `alt-down` | Previous / next space |
| `alt-shift-left` / `alt-shift-right` | Previous / next tab with a working or blocked agent; every tab when no other has one |
| `alt-shift-up` / `alt-shift-down` | Previous / next agent |
| `ctrl-left` / `ctrl-right` / `ctrl-up` / `ctrl-down` | Move between panes |
| `alt-enter` / `alt-shift-enter` | Split the pane right / down |
| `super-return` | New terminal |
| `ctrl-alt-shift-t` | Reopen the last closed tab, with its agents resumed |
| `ctrl-alt-o` | Open the browser pane's page in a Chrome window |
| `ctrl-alt-i` | Open DevTools on the browser pane's page |
| `super-w` | Close the pane |
| `super-f` | Zoom the pane |
| `super-c` / `super-v` | Copy / paste |
| `super-alt-space` | Open the command palette (also `ctrl-shift-p`) |
| `super-shift-space` | Show or hide the top bar |
| `super-k` | Show every key binding |
| `super-ctrl-t` or `super-ctrl-shift-space` | Pick a theme |
| `super-ctrl-w` or `super-ctrl-space` | Change to the theme's next wallpaper |
| `ctrl-,` | Open Settings |
| `ctrl-shift-m` | Open the mod manager |
| `ctrl-shift-l` | Change to a different layout |

Left out because GNOME uses them: Omarchy Herdr's `ctrl-space` prefix (input method), `alt-esc` (cycle windows), `ctrl-alt-arrows` and `ctrl-alt-shift-arrows` (workspaces). Herdr's own `alt-h/j/k/l` still move between panes.

Ctrl+arrows take priority over terminal shortcuts, including Ctrl+Left/Right word movement.

## What is inside

The repo has the same structure as a Herdr home folder:

| Path | Contents |
| --- | --- |
| `layouts/omarchy.json` | The layout: tile tree, sizes and spacing |
| `mods/` | One folder for each mod. Each mod installs on its own, with its own icons. It includes the layout's own notifications, terminal menu, go-to picker and add-machine dialog. |
| `patches/` | The browser helper patch and the script that applies it |
| `themes/` | The Omarchy color themes |
| `backgrounds/omarchy/` | The wallpapers of each theme |
| `keys.json` | The layout keys |
| `RECIPE.md` | The full brief. An agent can build the layout again from it. |

## Development

Run the tests from the repo root. They use the Node test runner and need no install step:

```sh
npm test
```

Check each mod that you change:

```sh
herdr-app check mods/omarchy-settings
```

[`DEVELOPMENT.md`](DEVELOPMENT.md) shows which file to change for each part of the layout.

> [!TIP]
> Your edits in this repo do not change the copy in `~/.config/herdr-app`. Copy the changed files there to see them in Herdr.
