# Power-Up

Small, opt-in upgrades for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness).
The upgrades include a **right-click action menu in the Trajectory view**, a
**copyable step reference** that an agent can resolve back into the raw session
data, an optional **stop reason for background jobs**, an in-place
**plugin installer**, and a **sidebar launcher** that turns the left sidebar's
panel list into an adaptive icon grid with drag sorting and folders.

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
- **Copy step reference** — copy `dsh-step:<session-id>/<step-id>`; the
  `powerup_step_read` tool turns that string back into the raw session data.
- **Copy session ID**.

Right-click empty space in the ledger:

- **Export trajectory JSON** — save the current trajectory snapshot.
- **Copy session ID**.
- **Open the Power-Up page** — the sidebar control panel.

The sidebar **Power-Up** page turns the menu on or off and lists the available
actions. The setting is stored in the browser. It also holds the defaults for
**one-click install** (auto-enable and auto-restart), which the plugin installer
uses.

### Stop a background job with a reason

The session header's background jobs panel keeps the host's list, live output,
and stop button. Clicking a running job's stop button opens a themed Power-Up
dialog instead of the host's two-press stop. The dialog is portaled to the
document body, so it renders above the jobs menu (which is itself a body portal)
and is not clipped by any slot's stacking context; its colors come only from
`--dsw-alias-*` tokens, so light and dark themes both work.

- The reason field is optional; an empty field keeps the host's default
  `cancelled by the user` reason. `Enter` confirms while `Esc` cancels.
- Confirming stops the job through the Host route, which records
  `cancelled by the user: <reason>`. The completion notice injected into the
  session and the shell tool's result therefore carry the reason.
- If the button cannot be resolved to a live job, the click is left alone and
  the host's original stop flow runs unchanged.

### Menu keys

`↑` / `↓` move, `Home` / `End` jump, `Enter` runs, `Esc` closes.

### Step references

**Copy step reference** copies a single line such as
`dsh-step:session-1a2b…/turn.0.step.3`. The reference carries the session id
plus a stable step id:

| Step id | Copied from | Resolves to |
| --- | --- | --- |
| `turn.<turn>.step.<step>` | an assistant row | every raw event between `step/start` and `step/end` |
| `call.<call-id>` | a tool row | that tool call and its `tool/result` |
| `seq.<n>` | any other raw-event row | that single event |
| `index.<n>` | a synthetic row | nothing — the menu disables the action |

Paste the line into the session and the agent can call
**`powerup_step_read`**, a read-only Host tool registered while both `tools` and
`sessionQuery` are composed:

```json
{ "ref": "dsh-step:session-1a2b…/turn.0.step.3", "requests": false }
```

It returns the raw events as JSON. Optional arguments: `before` / `after` add up
to 50 neighboring events on each side, and `requests: true` also includes the
`request/header` snapshots (the full system prompt and tool schemas), which are
omitted by default because they are large. The tool is workspace-agnostic: it
reads the session named in the reference through `ctx.sessionQuery`, so an agent
can open a step in a session it never had to locate on disk.

### Sidebar launcher

The left sidebar's global panel buttons (Conversation, Files, Plugins, and the
entries other plugins add) become an icon grid instead of a one-per-row list:

- **Columns follow the width.** The list is an `auto-fill` grid of
  `minmax(58px, 1fr)` cells, so widening the sidebar adds columns and narrowing
  it removes them — there is no fixed column count to break.
- **Icons above labels.** Each tile stacks a 20px icon over an 11px caption, one
  line with an ellipsis when the label is long.
- **Drag to sort.** Press and drag a tile; a ghost follows the pointer and a
  thin accent line marks the insertion point. Order is stored per browser.
- **Drop onto a tile's middle to build a folder.** Dropping on the middle of
  another icon folds both into a folder tile (like a Windows Start menu folder);
  dropping on a folder adds to it; dropping a folder onto an icon or another
  folder merges them. Click a folder and the contained icons appear in a flyout
  anchored to the tile, scaling in from its edge. Inside the flyout: click an
  entry to open that panel, `×` removes it from the folder, click the title to
  rename the folder, and **Ungroup** returns every member to the grid.
- **Collapsed sidebar stays native.** When the sidebar collapses to its 56px
  rail there are no labels to stack, so the launcher steps aside and the host's
  rail rendering takes over untouched.
- The grid can be switched off on the Power-Up page; order and folders survive
  the switch and are kept in `localStorage`.

## Install a plugin

Open the built-in **Plugins** page. Every third-party card under **Installed
plugins** gains a small install icon in its action area. Clicking it opens the
install dialog:

1. The dialog reads the package's published versions from the Host's configured
   registries — the same list the **Add plugin** dialog offers, including the
   npmmirror fallback. It stays on its loading state until that list has settled
   (loaded or failed) and only then shows the chooser. Star any registry to make
   it Power-Up's default for later installs; otherwise the list starts from the
   Add dialog's remembered choice.
2. Type a version or pick one from the floating version list. The version in the
   input is authoritative: both install actions install exactly that version, so
   reinstalling or downgrading works. The installed version is tagged
   **Current**; the newest is tagged **latest**, and a version that is both uses
   one **Current · latest** tag.
3. **One-click install** installs the version in the input and skips both
   questions: by default the new copy is enabled and DSH restarts automatically.
   The Power-Up page can turn either default off. With auto-enable off, the new
   version is left disabled and nothing restarts. With auto-restart off (or when
   the current runtime cannot restart itself), the completion panel closes
   itself after a few seconds instead of staying on screen. Power-Up's own
   install keeps its background handoff and does not offer one-click.
4. Otherwise, confirming removes the installed copy, checks the spec the way
   **Add plugin** does, and installs the selected version without enabling it.
   Because the old copy is already gone at that point, a refused check or a
   failed install automatically re-installs the removed version with its
   previous enabled state; the dialog reports both the failure and the rollback
   result.
5. The dialog then asks whether to enable the new version.
6. After enabling, it asks whether to restart DSH. On the desktop app the
   `lib/restart-helper.cjs` helper relaunches the exact executable after the old
   Host exits; under `dsh web` the dialog explains that the terminal owns the
   process.
7. A management call that reports `restart-required` keeps a **Restart needed**
   tag on the card and adds the plugin to the count beside the **Installed
   plugins** heading. The heading bar is always present — with **No plugins need
   a restart** and the restart button when nothing is pending — and a **Restart
   DSH** button confirms and performs the same restart. The Host also audits
   profile bundle directories written after it started, so installs made through
   the built-in **Add plugin** / **Install** UI, or before this page loaded, are
   marked too.

Power-Up installs itself through the same dialog (the one-click action is hidden
for itself). Because removing the plugin unloads this panel, the Host answers
first and then hands `removeBundle` → `inspect` → `installBundle(enabled: true)`
to the built-in manager service, which keeps running after the Power-Up Host
fiber is unloaded. The panel closes; refresh the page when the install finishes.

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
- **The step reference is plain coordinates plus one Host reader.** The Client
  copies only `dsh-step:<session-id>/<step-id>` — no data, no URL, no port — so
  the line survives restarts and can be pasted into any agent. The Host half
  registers `powerup_step_read` when `tools` and `sessionQuery` are composed,
  resolves the step through `sessionQuery.readSession` (raw events, ascending
  seq), and returns the matching event window as JSON. A nested `run_code`
  sub-call has no raw `tool/call` event of its own, so it falls back to the step
  that owns it. Nothing is written to disk and no public route is added.
- **No imports from Harness Client packages.** The menu is plain React + CSS and
  observes the trajectory package's own `data-*` contracts. If those attributes
  change, row-specific actions degrade gracefully; session-level actions in the
  empty ledger area keep working.
- **The stop reason rides the host's own job registry.** The panel belongs to
  `@deepseek-ai/dsh-client-ui-jobs`, so Power-Up does not replace it: a capture
  listener recognizes its `button[data-kill-state]`, maps the button to the live
  row (DOM order plus the row's `title` label), and opens the reason dialog.
  The typed reason goes to `POST /dsh-powerup/api/job-kill`, which calls the
  registry's `kill(id, session, reason)` — the same admission the built-in
  Remote uses, with the reason settlement merges into the job's `detail` line.
- **The launcher upgrades the host list in place.** It never re-renders the
  host's own panel rows: it marks the `<nav>`, applies grid/tile CSS, appends
  synthetic folder tiles, hides the rows that moved into a folder with an
  inline `display` (React rewrites `className` when the active panel changes and
  would drop an added class), and sorts with the grid's `order` property. A
  `MutationObserver` re-applies that after every host render, and the module
  falls back to the native rail whenever the wide layout disappears.
- **Launcher state is tiny and self-healing.** `dsh-powerup:launcher:v1` stores
  only an order array plus group records. `normalizeLauncherState` drops panels
  that no longer exist (unregistered or unpinned), appends new ones in host
  order, and dissolves empty folders, so plugin changes never wedge the layout
  or lose the settings of the panels that remain.
- **The install entry uses the built-in page's contracts.** The Plugins page has
  no per-card slot, so the overlay injects one button into every
  `[data-plugin-group="bundles"] [data-plugin-package]` card and re-asserts it
  after React renders. Version listing is a plain registry `GET`; removal and
  installation use the same `remote.pluginManager` calls as **Add plugin**. The
  Host adds two loopback-only routes: `/dsh-powerup/api/restart` for the
  process restart, and `/dsh-powerup/api/self-update` for the self-install
  handoff.
- **Power-Up's own install outlives its unload.** The Host route sends its
  answer, then a timer starts `removeBundle` → `inspect` →
  `installBundle(enabled: true)` through the built-in manager service. Removing
  the bundle unloads Power-Up's own Host fiber, but the manager service and the
  pending promise stay in the Host process, so the reinstall finishes; failures
  are appended to `~/.dsh/powerup/self-update.log`. The Host captures the
  version it was loaded from before removal and re-installs that version if the
  check or install fails, so a failed self-install does not leave Power-Up
  missing.
- **One-click install is a client-side decision.** Both install actions use the
  version in the dialog input (so reinstall and downgrade are allowed) and both
  defaults live in the shared settings store (`dsh-powerup:settings:v1`), so the
  Power-Up page and an open dialog agree without a reload. A one-click run
  installs disabled — the same shape as **Add plugin** — then enables through
  `setBundleEnabled`, and posts the restart only when the defaults allow it. With
  auto-enable off the new copy stays disabled and nothing restarts. When no
  restart happens the completion panel closes on a timer; install, enable, and
  restart failures stay on screen with their reason instead.
- **The stop dialog is a body portal with host-dialog chrome.** `shell.overlay`
  is an absolute layer at `z-index: 20`, and the host jobs menu is a
  `document.body` portal at `z-index: 100`; a high z-index inside the overlay
  layer therefore still loses. The reason popover is rendered through
  `react-dom`'s `createPortal` into `document.body` and uses `z-index: 1400`.
  Its surface (`--dsw-alias-bg-layer-2`, `--dsw-radius-panel`,
  `--dsw-elevation-prominent`), 34px input, and buttons mirror the host dialog
  and menu primitives; the confirm button reuses the host's armed-stop
  treatment (red border, 12% red fill, red text) instead of inventing a solid
  danger style. Without `react-dom` it falls back to in-place rendering.
- **Restart status lives in this browser session.** A management result that
  says `restart-required` is written to `sessionStorage`; the card gets a
  **Restart needed** tag and the group heading gets a count plus a restart
  button. The Client also wraps the shared `remote.pluginManager` methods so an
  install started from the built-in Add plugin/Install dialogs is observed, and
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
npm test
```

`node test/smoke.mjs` loads the real Client module with React/browser doubles,
applies it to a fake slot context, and checks registrations, icons, helpers,
theme tokens, the step-reference copy path, the stop-reason mapping, the Host
routes, and the manifest. `node test/host.mjs` exercises the step-reference codec
and resolver plus the `powerup_step_read` tool against a fake `sessionQuery` and
a raw event log.

## License

MIT © RestRegular
