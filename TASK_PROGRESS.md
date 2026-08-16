# Task Progress

## Objective

Execute the NodeViewJS improvement plan's Immediate Next Actions: harden async
native callback error handling, settle window lifecycle semantics, fix event
unsubscribe cleanup, add a package exports map, remove the browser compatibility
alias, add TypeScript declarations, test the minimum supported Node version in
CI, and shorten the README with advanced material moved into the docs.

## Status

Eight of the ten immediate actions are complete and tested, plus plan item 5
(first-run diagnostics). Prebuilt binary distribution has not been started, and
the feature freeze is a project policy rather than a repository change. Nothing
is committed; the working tree holds the changes.

## Files inspected

- `runtime/app.js`, `runtime/bridge.js`, `runtime/ipc.js`, `runtime/native.js`,
  `runtime/index.js`, `runtime/net.js`, `runtime/config.js`, `runtime/dialog.js`,
  `runtime/clipboard.js`, `runtime/shell.js`, `runtime/notification.js`,
  `runtime/updater.js`, `runtime/single-instance.js`, `runtime/menu.js`,
  `runtime/taskbar.js`, `runtime/window-colors.js`
- `src-nodeview/src/app.cpp`, `src-nodeview/src/ipc.cpp`,
  `src-nodeview/src/window.cpp`, `src-nodeview/src/webview.cpp`
- `test/runtime-api.js`, `test/plugins.js`, `test/platform.js`, `test/net.js`
- `package.json`, `.github/workflows/ci.yml`, `README.md`, `CHANGELOG.md`,
  `AGENTS.md`, `docs/index.html`, every file in `wiki/`

## Files created

- `test/window-lifecycle.js` — native callback isolation, window retention, and
  event cleanup, against a mocked native host.
- `test/package-exports.js` — exports-map resolution from an installed package.
- `test/package-tarball.js` — packed-tarball install into a clean project.
- `types/index.d.ts`, `types/ipc.d.ts`, `types/bridge.d.ts`, `types/test-d.ts`,
  `types/tsconfig.json` — public API declarations and their type test.
- `wiki/Lifecycle.md` — lifecycle and error-semantics contract.
- `scripts/doctor.js` — the `nodeviewjs doctor` prerequisite diagnostics.
- `test/doctor.js` — doctor checks with every probe injected.

## Files modified

- `runtime/app.js` — native callback promise consumption, one shared handler
  dispatch path, isolated handler failures, non-throwing failure reporting,
  window disposal and `lifecycleState`, unsubscribe delegating to `off()`, and
  `_eventNames()` / `_dispose()` / `_retireWindow()` internals.
- `runtime/bridge.js` — shared `removeListener()` for `off()` and the returned
  unsubscribe function; removed the `window.NodeView` alias.
- `src-nodeview/generated/bridge_script.h` — regenerated from `runtime/bridge.js`.
- `package.json` — `exports` map, `types`, `types/` in `files`, `typescript` and
  `@types/node` dev dependencies, and the new test scripts.
- `package-lock.json` — the two dev dependencies.
- `.github/workflows/ci.yml` — Windows matrix on Node 20 and 22, security gate
  scoped to Node 22, and a Node 20 packed-artifact job.
- `test/platform.js` — asserts the alias is gone.
- `scripts/check-native-prerequisites.js` — exports `hasUsablePython()` with
  injectable exec/env/platform and only self-executes when run directly, so the
  doctor reuses the same detection instead of duplicating it.
- `bin/nodeviewjs.js` — `doctor` command and help text.
- `README.md` — rewritten as an onboarding document (1243 → ~150 lines).
- `wiki/Backend-API.md`, `wiki/Getting-Started.md`, `wiki/Frontend-Bridge.md`,
  `wiki/Packaging-and-Distribution.md`, `wiki/Security-Model.md`,
  `wiki/Testing.md`, `wiki/Windows-and-Multiple-Windows.md`, `wiki/Home.md`,
  `wiki/_Sidebar.md` — received the reference material moved out of the README,
  plus the new lifecycle and typing documentation.
- `docs/index.html` — alias note corrected.
- `CHANGELOG.md` — Added, Removed, Fixed, and Changed entries.

## Files deleted

None.

## Completed

1. **Async native callback handling.** `setMessageHandler` started an async
   dispatch whose rejection had no consumer. Both native callbacks now consume
   their promise. `App._dispatchHandlers()` is the single dispatch path for app,
   window, and menu events; a failing handler is reported and isolated, and the
   remaining handlers still run. `App._reportHandlerFailure()` cannot throw, so a
   failing logger does not become an unhandled rejection. Single-instance and
   launch-routing failures were routed onto the same path.
2. **Window lifecycle.** States are `configured`, `open`, `closed`, `disposed`,
   exposed as `AppWindow.lifecycleState`. Closing while the app runs disposes the
   window: it leaves `app.windows`, and its handlers and buffered messages are
   released. Closing before `run()` keeps it listed so a failed startup can retry.
   A disposed window refuses `emit()` and reopening; `close()` stays idempotent.
3. **Event cleanup.** The unsubscribe function returned by `on()`/`once()` now
   calls `off()` on `App` and `AppWindow`, and a shared `removeListener()` in the
   bridge, so the event name is removed with its last handler and repeat calls
   are harmless.
4. **Exports map.** `.` and `./ipc` (plus `./package.json`) are the only
   resolvable specifiers; internal runtime files are no longer deep-importable.
   `ipc` remains on the root export as documented, now labelled advanced API
   versioned by the IPC protocol rather than the package.
5. **Browser alias removed.** `window.NodeViewJS` is the only global.
6. **TypeScript declarations** for the public API, the advanced ipc surface, and
   the frontend bridge global, checked by `tsc --noEmit` against a usage file
   that resolves the package by name.
7. **CI.** Windows runs on Node 20 and 22; a Node 20 job packs the artifact and
   runs the export, type, and tarball-install checks.
8. **Documentation.** README rewritten around positioning, install, a runnable
   example, and an explicit platform maturity table; reference material moved
   into the wiki; lifecycle semantics documented.
9. **First-run diagnostics (plan item 5).** `nodeviewjs doctor` checks the Node
   version, native addon presence and loadability, Python 3, the platform C++
   toolchain, the system WebView runtime, and packaging prerequisites, printing
   the install command for each failure and exiting non-zero when a required
   check fails. `--signing` adds release-only signing checks; `--json` emits
   machine-readable output. Every probe is injectable, so the failure paths are
   tested on a machine where the tools are present.

## Outstanding

- **Prebuilt native binaries (plan item 4) — not started.** This is the highest
  value remaining item and the largest: a CI build matrix across six targets,
  artifact hosting, published checksums or signatures, an install-time download
  with source-build fallback, and clean-machine install tests. Installing still
  requires a compiler toolchain.
- The canonical starter application (plan item 15) and the targeted fuzz work
  (plan item 19) not started.
- `nodeviewjs doctor` is not run in CI. It would gate on the runner's installed
  software rather than on the code, so `test/doctor.js` asserts the command's
  contract and the checks against injected probes instead.
- Native-side window retention: `NodeViewJSRuntime::OnWindowDestroyed` erases the
  id from `live_windows` but the `NativeWindow` stays in `state_->windows`, so
  closed windows retain a small native object for the process lifetime. The JS
  callback references are released (`ipc_.Clear()`, `menu_handler_.Reset()`), so
  this does not retain JS handlers. It was left alone deliberately: the erase
  would run from inside the window's own `WM_DESTROY` path and needs a deferred
  purge to avoid a use-after-free, which cannot be verified in this session's
  headless-capable suites.
- The feature freeze is a project policy; no repository change was made for it.
- Version is still `0.1.0` with everything under `Unreleased`; nothing is tagged.

## Tests added or updated

- `test/window-lifecycle.js`: sync throw, async rejection, and healthy handlers
  on one event, asserting all run and each failure is reported; menu callback
  failure; command failure and unknown command answered to the frontend; a
  throwing error reporter; 2000 transient windows leaving `app.windows`
  unchanged, with handler release, disposal state, reopen refusal, idempotent
  close, and broadcast skipping; startup windows surviving a pre-`run()` close;
  5000 subscribe/unsubscribe cycles per target returning the internal event map
  to empty, double unsubscribe, shared-name handling, and `once()` release. A
  process-level `unhandledRejection` hook asserts none escaped; the native
  callbacks are invoked fire-and-forget, the way the addon calls them.
- `test/package-exports.js`: exports map shape, target existence, resolution of
  `nodeviewjs`, `nodeviewjs/ipc`, and `nodeviewjs/package.json`, six blocked deep
  imports, and the root export key set.
- `test/package-tarball.js`: packed file list, install into a clean project, and
  a probe that resolves both entry points, rejects a deep import, and configures
  an `App` without the native addon.
- `types/test-d.ts`: compile-time use of app/window/plugin/updater/net/config/
  dialog/clipboard/shell/ipc APIs and the frontend global.
- `test/doctor.js`: option validation including a supplied `null`; healthy
  reports on all three platforms; a bare machine failing every required check
  with a fix for each; the Node minimum; a present-but-unloadable addon; a
  user-scoped WebView2 registration; missing IExpress warning rather than
  failing; a configured `PYTHON`; a Python 2 interpreter rejected; signing and
  update-signing checks appearing only with `--signing`, including an
  untimestamped certificate and macOS signing without `codesign`; an
  unsupported platform; and the CLI's JSON output and exit-code contract.
- `test/platform.js`: asserts `window.NodeView` is `undefined`.

## Tests run and results

- `npm test` — 22 suites, all passed.
- `npm run test:tarball` — passed.
- `npm run test:native-lifecycle` — passed.
- `npm run test:bridge` (live WebView2) — passed, including the parameter matrix.
- `npm run test:multi-window`, `test:ipc-security-integration`,
  `test:trusted-document`, `test:webview-capabilities` — all passed.
- `npm run security:repo` — passed.
- The new dispatch test was confirmed against a failing reproduction: reverting
  `_dispatchHandlers` to the previous report-and-rethrow behavior fails
  `test/window-lifecycle.js` on the first handler, and restoring the fix passes.

## Not verified

- `npm run security:gate` and `npm run test:native-ui` were not run in this
  session; the gate performs an MSVC analysis build and installer smoke test.
- macOS and Linux were not exercised. The CI changes for those jobs are
  configuration only and have not run against this tree.
- The new CI jobs themselves have not executed; `test:tarball`, `test:exports`,
  and `test:types` were verified locally on Windows and Node 25, not on Node 20.

## Blockers, assumptions, limitations, risks

- `typescript` and `@types/node` were added as dev dependencies because the plan
  requires `tsc --noEmit` declaration tests. `npm install` reified the tree and
  removed 11 packages that were on disk but in neither `package.json` nor the
  lockfile; the full suite and a native build-dependent test pass afterwards.
- `ipc` was deliberately kept on the root export rather than moved behind the
  advanced subpath alone, to avoid breaking the currently documented surface.
  Its stability level is now documented instead. Revisit before 1.0.
- Handler failures are logged and isolated rather than fatal, and no dedicated
  runtime error event was added. That is a deliberate choice among the three the
  plan offered; adding an error event would widen the public surface during a
  feature freeze.
- `AppWindow._eventNames()` was added as an internal test hook, following the
  existing `_post` / `_dispatch` convention, because the event maps are private
  and the plan requires proving they return to their original size.
