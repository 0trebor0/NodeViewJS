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
