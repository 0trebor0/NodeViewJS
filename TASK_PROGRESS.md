# Task Progress

## Objective

Work through two improvement plans for NodeViewJS: first the pre-0.1.0
improvement plan (runtime correctness, distribution, API stability, developer
experience, security hardening), then a second roadmap covering runtime
hardening, stress and security testing, distribution, developer experience, and
API validation through dogfooding.

## Status

Every actionable item in both plans is complete and tested. The only work left
needs infrastructure that is not available here: publishing prebuilt binaries
and verifying one binary across Node releases both require the release
pipeline, and CI work is paused at the repository owner's request.

Nothing is committed since `593a0cc`, which covered the first plan. The four
batches since then are in the working tree. `AGENTS.md` forbids committing
without an explicit request.

### First plan

All ten Immediate Next Actions, plus first-run diagnostics (item 5), the
canonical starter (15), runtime diagnostics (16), lifecycle documentation (17),
fuzz coverage (19), release-candidate smoke tests (11), and the install half of
prebuilt binaries (4).

### Second roadmap

| Item | State |
| --- | --- |
| P0.1 frontend event isolation | Done. Found a real defect. |
| P0.2 window lifecycle torture tests | Done. Found a real defect. |
| P0.3 deterministic shutdown | Done. Six-phase order, idempotent. |
| P0.4 pending IPC cleanup | Done. Found a real defect. |
| P1.5 resource exhaustion | Done. |
| P1.6 fuzz trust boundaries | Done in the first plan. Found two defect classes. |
| P1.7 updater failure testing | Done. |
| P1.8 packaging integrity edge cases | Done. |
| P2.9 prebuilt binaries | Install side done; publication needs the release pipeline. |
| P2.10 N-API compatibility | Pin and symbol guard done; cross-version run needs CI. |
| P2.11 make doctor excellent | Done in the first plan. |
| P3.12 serious example application | Done. Found a flaw in its own code. |
| P3.13 trim the README | Done in the first plan. 1243 lines to ~150. |
| P3.14 improve error messages | Done in the first plan. |
| P4.15 feature freeze | Observed. Findings recorded, API unchanged. |
| P4.16 dogfood three app shapes | Done. Five API findings recorded. |

## Defects found and fixed

1. **Native callbacks leaked unhandled rejections.** The window message handler
   started an async dispatch nobody consumed.
2. **Event handler failures were not isolated.** The first failure aborted the
   rest of the dispatch for that event.
3. **Closed windows were retained**, in both the JavaScript runtime and the
   native host. The native half could not be fixed in `OnWindowDestroyed`, which
   runs inside the window's own `WM_DESTROY` handling; destroyed windows are
   queued and released by the message pump instead.
4. **Unsubscribing leaked event names.** The function returned by `on()` removed
   the handler but left an empty entry behind.
5. **Sparse arrays bypassed validation.** `Array.prototype.map` skips holes, so
   `new Array(4)` walked through per-item validators unchecked and reached the
   permission policy, the network origin allowlist, protocol manifests, and
   menus. Found by fuzzing. It failed closed, so it was unvalidated data
   reaching a policy rather than an escalation.
6. **Error messages quoted untrusted values without bound**, including update
   manifest fields that arrive from a remote server. Found by fuzzing.
7. **Frontend listeners were not isolated.** One throwing `NodeViewJS.on()`
   listener swallowed the event for every listener registered after it.
8. **`createWindow()` left a phantom window in `app.windows`** when native
   creation failed. Found by the lifecycle torture tests.
9. **A command finishing after its window closed threw out of a native
   callback** while trying to deliver a response nobody could receive.
10. **`NAPI_VERSION` was not pinned**, so a binary built on a current Node could
    call symbols an older supported Node does not export — which would have
    forced one prebuilt artifact per Node major instead of one per platform.

## Files created

Runtime and scripts:

- `runtime/validation.js` — shared `assertDenseArray()` and bounded
  `safeDiagnosticString()`, replacing two divergent copies of the latter.
- `scripts/doctor.js`, `scripts/install-native.js`,
  `scripts/record-native-checksums.js`, `native-checksums.json`.

Types:

- `types/index.d.ts`, `types/ipc.d.ts`, `types/bridge.d.ts`, `types/test-d.ts`,
  `types/tsconfig.json`.

Examples (the three dogfood shapes):

- `examples/tasks/` — multi-window: `store.js`, `create-app.js`, `app.js`,
  `index.html`, `quick-add.html`, `README.md`.
- `examples/digest/` — simple utility: `app.js`, `index.html`.
- `examples/focus/` — plugin and OS integration: `timer-plugin.js`,
  `create-app.js`, `app.js`, `index.html`.

Tests:

- `test/window-lifecycle.js`, `test/package-exports.js`, `test/package-tarball.js`,
  `test/doctor.js`, `test/install-native.js`, `test/fuzz-boundaries.js`,
  `test/resource-limits.js`, `test/updater-failures.js`,
  `test/release-candidate.js`, `test/native-window-retention.js`,
  `test/example-tasks.js`, `test/example-shapes.js`,
  `test/napi-compatibility.js`.

Documentation:

- `wiki/Lifecycle.md`, `wiki/API-Findings.md`.

## Files modified

- `docs/index.html` — Tutorials section (18 walkthroughs) and its styling.

- `runtime/app.js` — callback promise consumption, one shared dispatch path,
  isolated handler failures, window disposal and `lifecycleState`, unsubscribe
  cleanup, six-phase `quit()` with `before-quit` and `isQuitting`, response
  dropping for departed windows, command and permission diagnostics, malformed
  message reporting, and the `_eventNames()` / `_ipcRequestStats()` internals.
- `runtime/bridge.js` — listener isolation, shared `removeListener()`, and
  removal of the `window.NodeView` alias.
- `runtime/native.js`, `runtime/updater.js` — actionable failure messages.
- `runtime/net.js`, `runtime/menu.js`, `runtime/launch-routing.js`,
  `runtime/taskbar.js`, `runtime/window-colors.js` — dense-array checks and
  bounded diagnostic quoting.
- `src-nodeview/src/app.cpp`, `include/app.h`, `src/addon.cpp`,
  `include/native_api.h` — deferred window purge and a diagnostics binding.
- `src-nodeview/src/webview.cpp`, `src/launcher.cpp` — WebView2 and integrity
  failures now explain themselves.
- `src-nodeview/binding.gyp` — pinned `NAPI_VERSION=8`.
- `bin/nodeviewjs.js` — the `doctor` command, and `create` now generates the
  canonical starter from `examples/basic`.
- `examples/basic/` — rewritten as the canonical starter.
- `scripts/check-native-prerequisites.js` — exports injectable Python detection.
- `package.json`, `package-lock.json` — exports map, types, dev dependencies,
  install script, and the new test scripts.
- `.github/workflows/ci.yml` — Node 20 matrix and a packed-artifact job. Not
  touched since CI work was paused.
- `README.md`, `docs/index.html`, and every `wiki/` page.
- `test/platform.js`, `test/runtime-api.js`, `test/menu.js`, `test/net.js`,
  `test/cli.js`, `test/package-integrity.js` — new regressions and updated
  contracts.

## Files deleted

None.

## Tests added or updated

29 suites run under `npm test`. The additions:

- Lifecycle and callbacks: handler isolation, menu callback failure, a throwing
  error reporter, 2000 transient windows, the full state table, quadruple close,
  use after dispose, failed native creation, shutdown during creation, shutdown
  order, shutdown with work in flight, and pending IPC release.
- Load: ten thousand commands and events, repeated maximum-size messages, a full
  concurrency window of never-finishing handlers, a page that never becomes
  ready, and 500 windows churning under traffic, with heap assertions under
  `--expose-gc`.
- Fuzzing: 24 boundary validators plus the inbound message path, under four
  properties, seeded and reproducible.
- Updater: failure injected at every stage, asserting an unsuccessful update
  never disturbs the working installation.
- Integrity: same-size modification, file replaced by a directory, file replaced
  by a symlink, duplicate and case-conflicting manifest paths, traversal, and
  malformed entries.
- Distribution: exports resolution, packed tarball install, prebuilt install
  with fetch injected, and the nine-step release-candidate gate.
- Native: window retention through a diagnostics binding, and N-API pinning with
  a symbol allowlist.
- Examples: the tasks app driven through IPC, the digest utility, and the focus
  timer including a `focus://` deep link routed through real startup argument
  handling.

## Tests run and results

### Tutorials section in docs/index.html

Documentation-only change to `docs/index.html`; no runtime code was touched, so the checks were
scoped to that file and the repository surface rather than the full suite.

- HTML structure check over the rendered document: `TAG BALANCE OK`; 91 real DOM ids with no
  duplicates; 85 sidebar links and 18 tutorial-index links, 0 broken; 107 code blocks each with a
  copy button; 48 tutorial steps; 0 stray elements inside `pre` (escaping intact).
- Layout: no horizontal overflow at 1280px or at 375px; the tutorial index collapses to one column
  on mobile.
- `npm run security:repo` -> `Repository security scan passed.` (exit 0)

### Earlier runtime and packaging work

- `npm test` — 29 suites, all passed.
- `npm run test:native` — all 8 live WebView suites passed.
- `npm run test:native-ui` — menu, tray menu, taskbar, and notification native
  suites all passed.
- `npm run test:rc` — passed: a real window, IPC both ways, packaging, integrity
  verification, and signed update metadata, all through an installed copy of the
  packed package.
- `npm run test:security-corpus`, `test:pe-hardening`, `security:repo` — passed.
- `npm run build` — the native host rebuilds cleanly after the C++ and N-API
  changes.
- Every defect above was confirmed against a failing reproduction before the fix
  and a passing run after, including the native retention fix, which was checked
  by disabling the purge, rebuilding, and observing 40 retained windows.

## Not verified

- `npm run test:installer` did not run: a pre-existing `NodeViewDemo`
  installation is present on this machine and the test refuses to overwrite it.
  Uninstall that application to run it.
- No prebuilt artifact has been downloaded from a real host, because none is
  published. The install path is verified only against an injected fetch.
- The same native binary has not been loaded on Node 20, 22, and 24. Only Node
  25 is available here; the N-API test states this limit rather than implying
  coverage.
- The WebView2-missing and package-integrity failure messages were not triggered
  for real. They need a machine without the WebView2 Runtime, and a deliberately
  corrupted package.
- `npm run native:checksums` was not executed: it would record this machine's
  build digests into the shipped file, and those are not release bytes.
- macOS and Linux were not exercised at all.

## Assumptions, limitations, and remaining risks

- N-API 8 was chosen because it is present in every release `engines: ">=20"`
  allows. Version 9 would drop Node 20.0 through 20.2.
- Shutdown is synchronous, so `before-quit` handlers cannot be awaited and a
  command already running is not cancelled. Both are documented contracts, and
  the dogfood applications persist as they go because of it.
- `ipc` remains on the root export, documented as advanced API versioned by the
  protocol rather than the package. Worth revisiting before 1.0.
- Handler failures are logged and isolated rather than fatal, and no dedicated
  runtime error event was added; that would widen the public surface during a
  feature freeze.
- Five API findings from dogfooding are recorded in `wiki/API-Findings.md` and
  deliberately not acted on. The two worth revisiting before 1.0 are the absence
  of a backend-side event bus and the inability of backend code to invoke a
  registered command.
- Internal test hooks were added where a private structure had to be observed to
  prove a contract: `_eventNames()`, `_ipcRequestStats()`, and the native
  `getWindowCounts()` binding.

## 2026-08-21 — Competitive gap review and roadmap entry

### Objective

Compare NodeViewJS features against another Node.js desktop runtime that draws
native widgets instead of using a WebView, without cloning or downloading it,
then record the resulting gaps in the project roadmap.

### Sources inspected

- `README.md`, `package.json`, `types/index.d.ts`, `runtime/` listing, and the
  queue sections of `PLAN.md` for our own surface.
- The other project's public README, generated API reference, and packaging
  documentation, read through page fetches only. Nothing was cloned or written
  to disk.

### Files changed

- `PLAN.md`: added a `Competitive Gap Queue` subsection under Execution Status
  with CG-01 (global keyboard shortcuts), CG-02 (directory picker and
  multi-select open dialog), and CG-03 (frontend framework integration guide);
  cross-referenced REL-02 and L-06/L-07/SEC-02..07 instead of duplicating them;
  recorded the deliberate non-gaps. Extended the Execution Status paragraph by
  one sentence so it no longer implies every queue is closed. Scoped the whole queue to
  Windows, since that is the only platform under active development.

### Not done

- No runtime, native, test, or documentation code was written. CG-01 through
  CG-03 are queued only.
- `CHANGELOG.md` was not updated: the change is unfinished roadmap work, which
  `AGENTS.md` excludes from the changelog.

### Verification

- Documentation-only change; no build, lint, or test command applies. The edited
  Markdown tables were re-read after the edit and have matching pipes, a header
  separator row, and four columns per row.

## 2026-08-21 — Competitive Gap Queue: CG-01, CG-02, and CG-03

### Objective

Work the Competitive Gap Queue in PLAN.md top to bottom. All three items are
complete: CG-01 (window keyboard shortcuts), CG-02 (directory picker and
multi-select open dialog), and CG-03 (frontend framework integration guide).

### CG-01 — window keyboard shortcuts

Scope decision: accelerators that fire for the window that registered them,
built on the existing W-06 accelerator table, not system-wide `RegisterHotKey`
hotkeys. The user had no preference; this is the Qt `QShortcut` equivalent the
comparison actually identified, and it cannot take a key from another
application.

Files changed:

- `runtime/menu.js`: `normalizeShortcutTemplate()` (ids, accelerators, 64-item
  limit, dense array, duplicate rejection) and `findAcceleratorConflict()`,
  which is what stops one combination belonging to both a menu item and a
  shortcut.
- `runtime/app.js`: `AppWindow.setShortcuts()`, `App.setShortcuts()`, conflict
  checks in both directions, application at window open, `shortcut:register`
  added to the permission vocabulary, and `MENU_EVENT_NAMES` mapping the native
  command source to the `menu`, `tray-menu`, or `shortcut` event.
- `src-nodeview/src/window.cpp`: shortcut command ids in a reserved range
  (`0xe000`-`0xefff`, menus lowered to `0xdfff`), `ApplyAcceleratorTable()`
  rebuilding the window's single table from the menu and shortcut sets,
  `ClearWindowShortcuts()` on `WM_DESTROY`, `WM_COMMAND` dispatch with source
  `shortcut`, and `NativeWindow::SetShortcuts()`.
- `src-nodeview/include/window.h`, `src-nodeview/include/native_api.h`,
  `src-nodeview/src/addon.cpp`: the `setWindowShortcuts` export.
- `types/index.d.ts`, `types/test-d.ts`: `Shortcut`, `setShortcuts` on both
  classes, the `shortcut` event, and the new permission.

### CG-02 — directory picker and multi-select open dialog

Files changed:

- `src-nodeview/src/window.cpp`: `ShowMultipleFilesDialog()` (`OFN_ALLOWMULTISELECT`,
  parsing the directory-then-names buffer into absolute paths) and
  `ShowDirectoryDialog()` (`IFileOpenDialog` with `FOS_PICKFOLDERS` and
  `FOS_FORCEFILESYSTEM`), plus the two exported wrappers. `<wrl/client.h>` is
  now included for `ComPtr`; no new dependency.
- `src-nodeview/include/window.h`, `src-nodeview/include/native_api.h`,
  `src-nodeview/src/addon.cpp`: the `openMultipleFilesDialog` and
  `openDirectoryDialog` exports, both Windows-only.
- `runtime/dialog.js`: `openFile({ multiple })` with option validation, and
  `openDirectory()`. Both report a clear error on other platforms.
- `types/index.d.ts`, `types/test-d.ts`: overloads for the two return shapes.

### Tests added

- `test/menu.js`: shortcut template normalization and accelerator-conflict cases.
- `test/runtime-api.js`: `setShortcuts` storage, clearing, and conflict
  rejection in both registration orders.
- `test/fuzz-boundaries.js`: `normalizeShortcutTemplate` as a fuzz target.
- `test/dialog.js` (new, wired into `npm test` as `test:dialog`): dialog option
  validation, all of it rejected before the native layer is reached.
- `test/fixtures/shortcut-native.js` and `test/shortcut-native.ps1` (new,
  `test:shortcut-native`): posts a real `WM_KEYDOWN` for F9 that the runtime
  pump translates through the accelerator table.
- `test/fixtures/dialog-native.js` and `test/dialog-native.ps1` (new,
  `test:dialog-native`): opens the directory dialog and the multi-select dialog
  for real, cancels each through the window's owned modal popup, and asserts no
  selection is reported.
- `test/napi-compatibility.js`: `napi_create_array_with_length` and
  `napi_set_element` added to the allowed symbols. Both are N-API version 1, so
  the pinned version 8 is unaffected.
- `package.json`: `test:dialog`, `test:shortcut-native`, `test:dialog-native`,
  the last two added to `test:native-ui`.

### Tests run

- `npm run build`: succeeded, no warnings from the changed files.
- `npm test`: every suite passes except `test:cli`, which fails for a
  pre-existing reason unrelated to this work (below). The run includes the two
  new suites, `test:dialog` and `test:frontend-build`.
- `npm run test:native-ui`: menu, shortcut, dialog, tray menu, taskbar, and
  notification integration tests all pass.
- `npm run test:types`, `test:menu`, `test:runtime`, `test:fuzz`,
  `test:native-lifecycle`, `test:window-lifecycle`: pass.

### Wider verification run

After the three items were finished, the heavy suites were run as well:

- `npm test`: all suites pass except `test:cli` (below).
- `npm run test:native`: native lifecycle, bridge integration, bridge parameter
  matrix, window retention (40 transient windows, 0 retained), IPC security
  integration, trusted document, WebView capabilities, multi-window — all pass.
- `npm run test:native-ui`: menu, shortcut, dialog, tray menu, taskbar, and
  notification — all pass.
- `npm run test:rc`: release-candidate gate passes end to end, including
  packaging the generated app and verifying its integrity manifest.
- `npm run test:security-corpus`, `test:pe-hardening`, `test:tarball`,
  `security:repo`, `security:audit` (0 vulnerabilities): all pass.
- `npm run build:security-analysis`: the warning-as-error MSVC analysis build
  succeeds, so the new C++ passes static analysis. The addon was rebuilt with
  `npm run build` afterwards so the working tree holds a normal build.
- `npm run test:installer`: failed for a pre-existing reason, since fixed (below).

### Two pre-existing failures, found by this run and fixed

Neither was caused by the Competitive Gap work; both were found because this
run reached suites the previous session had not.

`test/cli.js:134` failed because `bin/nodeviewjs.js` assumed the starter had LF
line endings. On a CRLF checkout the comment-strip regex never matched, so the
repository-only note was copied into generated applications, and `writeFile`
converted the endings a second time, writing CR CR LF into every generated
file. `renderStarter()` now normalizes the source to LF after reading it, and
`test/cli.js` asserts the generated files hold neither doubled carriage returns
nor bare newlines.

`test/installer-smoke.ps1:136` failed with "Installed app did not open its
native window". The script waited for a window titled "NodeViewJS Media
Loader", but commit 593a0cc renamed the example to "NodeViewJS Starter" without
updating the script. The installed application did open. The script now reads
`APP_TITLE` from the application it packages, so the two cannot drift again,
and the error message names the title it waited for.

That failing run installed `NodeViewDemo` and did not reach its uninstall step.
The leftover installation was removed with the application's own
`uninstall.ps1`, and the machine was confirmed clean afterwards; later installer
runs uninstall themselves as designed.

### Tests added while re-verifying the changed code

- `test/shortcut-native.ps1` and its fixture now run two cases. `menu-cleared`
  registers a menu and a shortcut, removes the menu, and asserts the shortcut
  still fires — the regression the shared accelerator table makes possible.
- `test/runtime-api.js` gains `testShortcutEventRouting()`: every native command
  source maps to its own event on both the window and the app, a shortcut
  payload carries only `id` and `window`, an unknown source falls back to
  `menu`, and a malformed native event dispatches nothing.
- `test/menu.js` accepts a list of exactly 64 shortcuts, next to the existing
  rejection at 65.

### Self-review of the diff

A read-through of the finished diff found one defect in this work:
`MENU_EVENT_NAMES` was a plain object, so a native command source of
"constructor" or "toString" would resolve through the prototype and produce a
function where an event name belongs. It is a `Map` now, and
`testShortcutEventRouting()` covers an inherited property name as a source. The
repository treats prototype reachability as a boundary property, so this was
worth fixing rather than noting.

### Full verification after the fixes

- `npm run test:full` (default suite, native suites, native UI suites, and the
  release-candidate gate) passes end to end. 45 reported suites, no failures.
- `npm run security:gate` passes end to end, including the MSVC
  warning-as-error analysis build, the PE hardening check, 0 dependency
  vulnerabilities, and the installer smoke test.
- `npm run test:fuzz` also run with seeds 11, 2718281, and 987654321;
  `normalizeShortcutTemplate` accepted 128-140 of 400 inputs per seed and
  rejected the rest without a property violation.
- The addon was rebuilt with `npm run build` after the analysis build, so the
  working tree holds a normal build; `test:napi` re-run against it.

### Not verified

- Choosing several files in the multi-select dialog, and therefore the C++ that
  splits the returned buffer into paths. Only the cancellation path is
  automated. Confirming a selection without real keyboard input was attempted
  and abandoned: the file-name field accepts `WM_SETTEXT` and reads back the
  typed names, but a posted `BM_CLICK` on the Open button and a posted
  `WM_COMMAND`/`IDOK` are both ignored, `VK_RETURN` posted to the field is
  ignored, and a *sent* `WM_COMMAND`/`IDOK` closes the dialog as a cancel
  rather than committing the names. Driving it for real would need
  `SetForegroundWindow` plus synthetic input, which steals focus from whoever
  is at the machine and makes the suite flaky, so the gap is recorded instead.
  A manual check is one run of `test/fixtures/dialog-native.js` with
  `NODEVIEW_DIALOG_KIND=multiple`, selecting two files: the result file then
  holds both absolute paths.

  The parsing itself was reviewed line by line in place of a test. The single
  selection case (one full path, no trailing entries), the directory-then-names
  case, a root directory that already ends in a separator, and a cursor that
  lands exactly on the end of the buffer are each handled. A selection too large
  for the 32 KiB buffer fails with `FNERR_BUFFERTOOSMALL` and surfaces as
  "Open file dialog failed (code 12291)". That case now reports "Too many files
  were selected to return their paths." instead. The branch is not covered by a
  test, because reaching it needs a real selection large enough to overflow a
  32 KiB buffer.
- Whether a key pressed while focus is inside the WebView content reaches the
  accelerator table. The live test posts the key message to the window, which
  is the same path menu accelerators use.
- macOS and Linux: both new APIs are Windows-only and throw a clear error
  elsewhere.

### CG-03 — frontend framework integration guide

Shape decision: documentation plus a real test, no new dependency. The user
chose this over a Vite/React example, so no example application ships and the
guide is bundler-agnostic.

Files changed:

- `wiki/Frontend-Build-Tools.md` (new): the two `entry` settings, what reaches a
  package, the page directory as web root, bridge timing relative to mount, the
  development watch-and-reload loop, and a checklist.
- `docs/index.html`: a `frontend-build` section carrying the same material in
  short form, before the Backend API section.
- `README.md`, `wiki/Home.md`, `wiki/_Sidebar.md`: links to the new page.
  `README.md` also corrects the permission count to eleven and mentions
  shortcuts and directory dialogs in the feature table.
- `test/frontend-build.js` (new, `test:frontend-build`, wired into `npm test`):
  builds a stand-in bundler output and asserts each documented claim — `dist/`
  is packaged while `*.map` and `node_modules` are not, the bridge tag lands
  ahead of the bundle script, `__nodeview/bridge.js` is written, and the dev
  watcher accepts the files under the page directory.

Every claim in the guide was checked against the implementation before it was
written; `content_root` is the entry page's parent directory, which is why the
web-root section says what it says.

### Remaining

- Nothing in the Competitive Gap Queue. CG-01, CG-02, and CG-03 are complete.

