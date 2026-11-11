# Agent notes

Where things live and how to test them: `DEVELOPMENT.md`. Before changing Herdr itself (layout, keys, mods), read `~/.config/herdr-app/AGENTS.md`.

## Ship without asking

For the owner (`shafiqimtiaz`) working in this repo: don't ask at each step. Once a change is asked for, take it all the way:

1. Branch from `main` (`feat/…`, `fix/…`, `refactor/…`).
2. `npm test` and `herdr-app check mods/<name>` for each changed mod. Add a test for new logic.
3. Review the diff and fix what the review finds.
4. Commit (Conventional Commits, no `Co-Authored-By`), push, open a PR into `main` (no attribution line) and merge it with a merge commit.
5. Update the live install: `herdr-app do omarchy-bar.update` applies the merged `main` to `~/.config/herdr-app`. Then check that the files match the repo and that the update record (`omarchy-bar.update` in `shared.json`) shows the new commit.
6. Delete the branch locally and on GitHub. Move leftovers in the live install, such as a renamed mod's old folder, to `~/archives/` rather than deleting them.

Still ask before anything that cannot be undone outside this repo, such as changing system settings or deleting the owner's files.

## Gotchas

- Stage explicit paths. A path that is already staged as a rename makes `git add <old path>` fail, and a chained command then carries on without the commit.
- `gpui-kit.d.ts` and `jsconfig.json` under `mods/` are git-ignored, so updates never ship them.
- Herdr hot-reloads a mod when its files change. That includes `omarchy-bar` while it applies an update, which is why the updater copies the bar's own folder last.
