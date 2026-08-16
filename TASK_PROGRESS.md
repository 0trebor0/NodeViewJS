# Task Progress

## Objective

Execute the NodeViewJS improvement plan's Immediate Next Actions: harden async
native callback error handling, settle window lifecycle semantics, fix event
unsubscribe cleanup, add a package exports map, remove the browser compatibility
alias, add TypeScript declarations, test the minimum supported Node version in
CI, and shorten the README with advanced material moved into the docs.

## Status

Eight of the ten immediate actions are complete and tested, plus plan item 5
(first-run diagnostics) and item 19 (fuzz coverage at the trust boundaries),
which found and fixed two classes of validation defect. Prebuilt binary
distribution has not been started, and the feature freeze is a project policy
rather than a repository change. Nothing is committed; the working tree holds
the changes.

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
- `scripts/install-native.js` — prebuilt binary download, verification, and
  source fallback; replaces `npm run build` as the package install script.
- `scripts/record-native-checksums.js` — records this platform's build digests
  into `native-checksums.json` for a release.
- `native-checksums.json` — the digests that authorise a prebuilt download.
  Empty until binaries are published.
- `test/install-native.js` — the install path with fetch injected.
- `runtime/validation.js` — shared `assertDenseArray()` and bounded
  `safeDiagnosticString()`, replacing two divergent copies of the latter.
- `test/fuzz-boundaries.js` — seeded structure-aware fuzzing of every trust
  boundary validator.

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
- `runtime/net.js`, `runtime/menu.js`, `runtime/launch-routing.js`,
  `runtime/taskbar.js`, `runtime/window-colors.js`, `runtime/updater.js` —
  dense-array checks and bounded diagnostic quoting at the boundaries the fuzz
  suite exercised.
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
15. **Native host: window retention and diagnostics.** `NodeViewJSRuntime` kept
   every `NativeWindow` it ever created. The erase could not simply be added to
   `OnWindowDestroyed`, which runs from inside that window's own `WM_DESTROY`
   handling and would free the object while its window procedure was still
   executing; `Stop()` is reachable from the same path, so it could not be done
   there either. Destroyed ids are queued and released by
   `PurgeDestroyedWindows()`, called from the message pump before any
   `DispatchMessage` and at the end of `CloseAll()`. Closing an already released
   window stays a no-op, decided from the monotonic id counter rather than by
   keeping a set of dead ids around.
   WebView2 startup failures and packaged integrity failures now carry
   actionable guidance instead of a bare `HRESULT` or a bare file name.
14. **Release-candidate smoke tests (plan item 11).** `npm run test:rc` runs the
   plan's release sequence against the packed artifact rather than the source
   tree: pack, install into a clean project, generate an app with the installed
   CLI, run it so a window opens, exercise IPC in both directions, exit cleanly,
   package with the installed CLI, verify every integrity manifest entry by
   recomputing size and digest, and verify signed update metadata including
   refusal of a tampered manifest. It is the last step of `npm run test:full`.
   By default the addon is staged from this repository's build to keep the gate
   near a minute; `NODEVIEW_RC_BUILD=1` compiles inside the project instead.
13. **Runtime diagnostics (plan item 16).** The errors the plan lists now answer
   what failed, why, and what to do next, in the backend log. The split matters:
   the message returned over IPC stays terse, because guidance would describe
   backend configuration to an untrusted page. Unknown commands list the
   registered commands; permission denials name which policy refused and show
   its allow and deny lists; malformed frontend messages, previously dropped in
   complete silence, are now recorded with a bounded quote and rate limited to
   five per application; a missing or unloadable addon points at
   `nodeviewjs doctor` and distinguishes a Node version mismatch; a failed
   update signature explains that the manifest is well formed but untrusted.
12. **Canonical starter application (plan item 15).** `examples/basic` is now the
   one sample that demonstrates the recommended architecture: window creation,
   a declared permission policy, one validated backend command per privileged
   operation (`note:load` with `fs:read`, `note:save` with `fs:write`), a
   backend-to-frontend event, a native menu whose items raise events rather
   than running native code, packaging configuration, error handling, and a
   commented `Updater` stub. `nodeviewjs create` no longer emits a second,
   simpler app: it generates this one, retargeted from `require("../../runtime")`
   to `require("nodeviewjs")` with the app's own name substituted, and the
   repository-only header comment stripped. `test/cli.js` normalizes both files
   and fails if they drift.
11. **Prebuilt binary install path (plan item 4, install side).** `npm install`
   now runs `scripts/install-native.js`, which prefers a published binary and
   otherwise compiles. Digests ship inside the package and are never read from
   the host; the host must be https without credentials; redirects are refused;
   artifacts are size-capped and downloaded to memory, verified in full, and
   only then written, so a partial or tampered install cannot land. A missing,
   unreachable, or unpublished artifact falls back to a source build; a digest
   mismatch fails the install rather than hiding itself behind a compile.
   `NODEVIEW_BUILD_FROM_SOURCE=1` forces a compile. With no host configured —
   the current default — the decision is immediate and behaviour is identical to
   the previous `npm run build` install.
10. **Fuzz coverage at the trust boundaries (plan item 19).** A seeded,
   structure-aware mutator drives every boundary validator and enforces four
   properties: total (returns or throws), typed failure (a real `Error` with a
   bounded message), no prototype pollution, and a per-target invariant on
   anything accepted. It found two defect classes, both fixed with pinned
   regression tests:
   - **Sparse arrays bypassed validation.** `Array.prototype.map` skips holes,
     so `new Array(4)` or `["a", , "b"]` produced a result whose items were
     never checked. This reached the permission policy, the network origin
     allowlist, protocol and file-association manifests, and menu templates.
     `assertDenseArray()` now rejects an array with an empty item at each of
     those boundaries. It failed closed rather than granting anything — an
     `undefined` grant matches no permission and an `undefined` origin matches
     no host — so this was unvalidated data reaching a policy, not an escalation.
   - **Unbounded values quoted in error messages.** Permission entries, protocol
     and file-association options, menu items and accelerators, window colors,
     taskbar states and icon paths, and update manifest fields were interpolated
     at full length into errors that are written to the backend log.
     `safeDiagnosticString()` now truncates to 120 characters and appends the
     original length. The update manifest path matters most: those fields come
     from a remote server.
9. **First-run diagnostics (plan item 5).** `nodeviewjs doctor` checks the Node
   version, native addon presence and loadability, Python 3, the platform C++
   toolchain, the system WebView runtime, and packaging prerequisites, printing
   the install command for each failure and exiting non-zero when a required
   check fails. `--signing` adds release-only signing checks; `--json` emits
   machine-readable output. Every probe is injectable, so the failure paths are
   tested on a machine where the tools are present.

## Outstanding

- **Prebuilt native binaries (plan item 4) — install side done, publish side
  not.** The download, verification, and fallback path is implemented and
  tested, and `npm run native:checksums` records digests for a release. What
  remains needs a release pipeline and hosting, which is out of scope while CI
  work is paused: building the six targets, uploading them to a host, and
  running a clean-machine install against a real published artifact. Until
  artifacts exist, every install compiles from source, so the compiler
  requirement stands.
- Plan item 16 covered the runtime and installation errors. The remaining
  entries in its list live in the C++ host — missing WebView runtime and package
  integrity failure — and still surface as native messages. `doctor` diagnoses
  the WebView case before an app is ever run, but the failure text inside the
  native host was not changed.
- `nodeviewjs doctor` is not run in CI. It would gate on the runner's installed
  software rather than on the code, so `test/doctor.js` asserts the command's
  contract and the checks against injected probes instead.
- Plan item 16's native entries are now covered too, so the only item-16 work
  left is whatever new error paths future features add.
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
- `test/release-candidate.js`: the nine-step release gate above, driven through
  an installed copy of the packed package.
- `test/window-lifecycle.js`: the diagnostics split — the wire response stays
  terse while the log gains the explanation; the unknown-command help lists
  registered commands; a denial by the app policy and a denial by a narrowed
  window policy each name the right policy and show its lists; malformed
  messages are reported five times and then not again, with a bounded quote.
- `test/cli.js`: the generated starter is valid JavaScript, is retargeted at the
  package with no path back into the repository, is named after the created app,
  keeps every feature the starter is meant to demonstrate, and — after
  normalizing comments, names, and the require path — is byte-identical to
  `examples/basic`.
- `test/install-native.js`: target and host resolution, https and credential
  rules, checksum file parsing, a successful install writing both files plus
  provenance and requesting the right URLs with redirects refused, a tampered
  artifact rejected with nothing written, a second-file mismatch leaving no
  partial install, nine distinct fallback reasons, an oversized declared
  length, and a malformed digest treated as a packaging error. Every network
  call is injected; the suite never reaches the network.
- `test/fuzz-boundaries.js`: 24 boundary validators plus the inbound frontend
  message path, under the four properties above.
- `test/runtime-api.js`, `test/menu.js`, `test/net.js`: pinned regressions for
  both defect classes the fuzzer found — sparse permission arrays, allow/deny
  lists, protocols, file associations, command permissions, menu templates and
  submenus, and the origin allowlist; plus a bounded error message for an
  over-long permission and an unchanged message for a short one.
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

- `npm test` — 24 suites, all passed.
- `npm run test:fuzz` — passed on 11 seeds, five of them at 1500 iterations per
  target (default 400). Every target exercises both its accept and reject paths
  except `validateManifest`, which rejects everything by design because the
  fuzzer supplies no valid signature.
- `npm run test:security-corpus`, `test:native-lifecycle`, `test:multi-window`
  — passed after the validator changes.
- `npm run build` — the native host rebuilt cleanly after the C++ changes.
- `npm run test:native` — all eight native suites passed against the rebuilt
  host, including the new `test:window-retention`.
- `npm run test:pe-hardening` — passed against the rebuilt launcher.
- The retention fix was confirmed against a failing reproduction: disabling
  `PurgeDestroyedWindows()` and rebuilding fails the new test with 40 retained
  windows; restoring it and rebuilding passes.
- `npm run test:rc` — passed. A real window opened from a CLI-generated app
  installed from the packed tarball, IPC completed in both directions, the app
  exited cleanly, packaging produced a launcher whose integrity manifest
  verified file by file, and signed update metadata was accepted while a
  tampered manifest was refused.
- The starter was launched live (`node examples/basic/app.js`): the window
  opened, the page loaded its saved note, a save round-tripped from the page
  through `note:save` to `note.json` in the user's application-data directory,
  and the backend log recorded no errors.
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

- `npm run test:installer` did not run: it found a pre-existing `NodeViewDemo`
  installation on this machine and refused to overwrite it, which is the test
  protecting the environment rather than a failure. Uninstall that app first to
  run it.
- The WebView2 and integrity failure messages were not triggered for real. They
  need a machine without the WebView2 Runtime, and a deliberately corrupted
  package, respectively.

- No prebuilt artifact has been downloaded from a real host, because none is
  published. The install path is verified only against an injected fetch.
- `npm run native:checksums` was not executed, because running it would record
  this machine's build digests into `native-checksums.json` and those bytes are
  not the ones a release would publish.

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
