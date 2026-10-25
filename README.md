# Power-Up

Small, opt-in upgrades for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness).
The first upgrade is a **right-click action menu in the Trajectory view**.

## Install

```bash
dsh plugin --profile web add @restregular/dsh-powerup
```

Then open a session, switch to **Trajectory**, and right-click a record row.

## What it does

Right-click a trajectory record:

- **Copy content** — copy the full text of the record.
- **Copy as quote** — produce a Markdown blockquote with the record kind.
- **Quote in composer** — insert that quote into the current input box.
- **Open record details** — open the host's record inspector.
- **Fork from here** — fork the session at that record (inclusive).
- **Copy session ID**.

Right-click empty space in the ledger:

- **Export trajectory JSON** — save the current trajectory snapshot.
- **Copy session ID**.
- **Open the Power-Up page** — the sidebar control panel.

The sidebar **Power-Up** page turns the menu on or off and lists the available
actions. The setting is stored in the browser.

### Menu keys

`↑` / `↓` move, `Home` / `End` jump, `Enter` runs, `Esc` closes.

## Update a plugin

Open the built-in **Plugins** page. Every third-party card under **Installed
plugins** gains a small update icon in its action area. Clicking it opens the
update dialog:

1. The dialog reads the package's published versions from the Host's configured
   registries — the same list the **Add plugin** dialog offers, including the
   npmmirror fallback. Star any registry to make it Power-Up's default for
   later updates; otherwise the list starts from the Add dialog's remembered
   choice.
2. Type a version or pick one from the floating version list. The current
   installed version is tagged **Current**; the newest is tagged **latest**, and
   a version that is both uses one **Current · latest** tag.
3. Confirming removes the installed copy, checks the new spec the way **Add
   plugin** does, and installs the selected version without enabling it.
4. The dialog then asks whether to enable the new version.
5. After enabling, it asks whether to restart DSH. On the desktop app the
   `lib/restart-helper.cjs` helper relaunches the exact executable after the old
   Host exits; under `dsh web` the dialog explains that the terminal owns the
   process.
6. A management call that reports `restart-required` keeps a **Restart needed**
   tag on the card and adds the plugin to the count beside the **Installed
   plugins** heading. The heading bar is always present — with **No plugins need
   a restart** and the restart button when nothing is pending — and a **Restart
   DSH** button confirms and performs the same restart. The Host also audits
   profile bundle directories written after it started, so updates made through
   the built-in **Add plugin** / **Update** UI, or before this page loaded, are
   marked too.

Power-Up updates itself through the same dialog. Because removing the plugin
unloads this panel, the Host answers first and then hands `removeBundle` →
`inspect` → `installBundle(enabled: true)` to the built-in manager service,
which keeps running after the Power-Up Host fiber is unloaded. The panel closes;
refresh the page when the install finishes.

## Design notes

- **Theme-safe by construction.** Every surface, border, text color, hover and
  switch state uses the host's `--dsw-alias-*` tokens. The switch follows the
  host convention (`--dsw-alias-border-l3` / `--dsw-alias-switch-thumb` off,
  `--dsw-alias-brand-primary` + `--dsw-alias-label-primary-foreground` on), so
  it stays readable in both light and dark themes. The only literal colors live
  inside the plugin's brand SVG artwork.
- **Two icons, two jobs.** `icon.svg` is the 256px brand tile shown by the
  Plugin Manager. The sidebar uses the same double-chevron mark as a 16-grid,
  `fill:none`, `stroke:currentColor` line drawing, but without the tile frame:
  the mark gets the full grid, so the chevrons and the amber baseline never
  collide with a border. The reference line artwork is
  `design/sidebar-icon.svg`; the runtime copy lives in `client.js`.
- **No imports from Harness Client packages.** The menu is plain React + CSS and
  observes the trajectory package's own `data-*` contracts. If those attributes
  change, row-specific actions degrade gracefully; session-level actions in the
  empty ledger area keep working.
- **The update entry uses the built-in page's contracts.** The Plugins page has
  no per-card slot, so the overlay injects one button into every
  `[data-plugin-group="bundles"] [data-plugin-package]` card and re-asserts it
  after React renders. Version listing is a plain registry `GET`; removal and
  installation use the same `remote.pluginManager` calls as **Add plugin**. The
  Host adds two loopback-only routes: `/dsh-powerup/api/restart` for the
  process restart, and `/dsh-powerup/api/self-update` for the self-update
  handoff.
- **Self-update outlives its own unload.** The Host route sends its answer, then
  a timer starts `removeBundle` → `inspect` → `installBundle(enabled: true)`
  through the built-in manager service. Removing the bundle unloads Power-Up's
  own Host fiber, but the manager service and the pending promise stay in the
  Host process, so the reinstall finishes; failures are appended to
  `~/.dsh/powerup/self-update.log`.
- **Restart status lives in this browser session.** A management result that
  says `restart-required` is written to `sessionStorage`; the card gets a
  **Restart needed** tag and the group heading gets a count plus a restart
  button. The Client also wraps the shared `remote.pluginManager` methods so an
  update started from the built-in Add plugin/Update dialogs is observed, and
  asks the Host audit route for profile bundles whose files are newer than the
  Host process. A real app restart clears the session, while a page refresh
  keeps the markers.
- **The dialog mirrors the host modal.** The backdrop is
  `--dsw-alias-bg-mask-1` with the shared mask blur, the surface is
  `--dsw-alias-bg-layer-2` with `--dsw-radius-panel` and
  `--dsw-elevation-prominent`, and the primary button uses
  `--dsw-alias-button-primary-fill` / `-hover`, so the dialog follows both
  themes instead of inventing its own palette. The registry picker and version
  list are custom controls built from `--dsw-alias-*` tokens; both open as
  fixed-position popovers anchored to their triggers, so they never grow the
  dialog or get clipped by its scroll area.

## Development

```bash
node test/smoke.mjs
```

The smoke test loads the real Client module with React/browser doubles, applies
it to a fake slot context, and checks registrations, icons, helpers, theme
tokens, and the manifest.

## License

MIT © RestRegular
