# Task Progress

## Objective

Debug the project end to end, fix the defects found, restore continuous
integration, publish a complete HTML project guide, and audit every exported
class, method, and function against the validation rules in `AGENTS.md`.

## Status

Audit complete. Earlier work is pushed to `main`; the API audit and its fix
are uncommitted, pending an explicit request to commit. The remaining items
are environment and account actions that cannot be performed from the
repository.

## API surface audit

- 104 exported members enumerated at runtime across 9 public modules and 10
  internal modules.
- 94 members cross-referenced against the 36 files in `test/`. Five were never
  referenced: `AppWindow.id`, `config.resolveConfigDirectory`, `dialog.message`,
  `ipc.isValidName`, `data-directory.resolveLogDirectory`.
- Roughly 200 adversarial inputs applied to every validator: null, undefined,
  wrong type, empty, oversized, boundary, control characters, path traversal,
  prototype-pollution keys, cyclic objects, and non-JSON values.
- One defect found and fixed: `config.resolveConfigPath()` had no file-name
  length limit.
- Three candidates investigated and dismissed as correct behavior: Windows
  reserved device names round-trip normally on this platform; `.UP` to `.up`
  extension folding is the documented contract; plugin `setup`, `start`, and
  `stop` hooks are all optional by design.

## Files inspected

- `runtime/app.js`, `runtime/ipc.js`, `runtime/notification.js`,
  `runtime/error-logger.js`, `runtime/dev-watcher.js`, `runtime/native.js`,
  `runtime/clipboard.js`, `runtime/shell.js`, `runtime/dialog.js`,
  `runtime/taskbar.js`
- `test/runtime-api.js`, `test/bridge-integration.js`
- `package.json`, `package-lock.json`, `.github/workflows/ci.yml`
- `README.md`, `PLAN.md`, `PLATFORM-TESTING.md`, `CHANGELOG.md`,
  `CONTRIBUTING.md`, `wiki/*.md`
- `src-nodeview/src/app.cpp` (error-message origin only)

## Files created

- `runtime/net.js` — validated outbound HTTP for backend commands.
- `test/net.js` — network permission, allowlist, and SSRF tests.
- `docs/index.html` — single-page project guide.
- `setup.bat` — Windows prerequisite installer using `winget`.
- `TASK_PROGRESS.md` — this file.

## Files modified

- `runtime/config.js` — file-name length limit.
- `runtime/app.js` — closed-window event handling and `isClosed`.
- `runtime/notification.js` — validate options before loading the native addon.
- `test/runtime-api.js` — regression test for closed-window event handling.
- `package.json` — `undici` override; `test:native`, `test:native-ui`,
  `test:full` scripts.
- `package-lock.json` — `undici` 6.28.0.
- `.github/workflows/ci.yml` — restored, plus Windows native build step and
  removal of suites a headless runner cannot host.
- `README.md`, `wiki/Testing.md`, `CONTRIBUTING.md`, `CHANGELOG.md` —
  documentation for the above.

## Files deleted

None.

## Completed

- Fixed `app.emit()` buffering into closed windows, and made
  `AppWindow.emit()` fail fast on a closed window.
- Fixed `notification.show()` loading the native addon before validating
  its arguments.
- Pinned `undici` to a patched release; dependency audit is clean.
- Restored the CI workflow deleted in `3bf4e42`, added the missing Windows
  native build step, and scoped the Windows job to what a runner can host.
- Added aggregate test scripts for 11 suites that had no runner.
- Published `docs/index.html`.

## Outstanding

- macOS and Linux CI jobs have never completed a run against this tree.
- GitHub Pages serves the repository root, so the guide is at `/docs/`
  rather than the site root.
- `README.md` does not link to the published guide.
- Local `node_modules` holds `undici` 6.27.0 against the lockfile's 6.28.0,
  and roughly 100 packages on disk are in neither `package.json` nor the
  lockfile. Syncing requires a full `npm install`, which would prune them.
- No version has been tagged; `package.json` remains `0.1.0` and every
  change sits under `Unreleased` in the changelog.

## Tests added or updated

- `test/net.js`: origin allowlist normalization; rejection of non-https,
  pathful, credentialed, and over-count origins; URL, method, header, body,
  timeout, and response-size validation; header-injection and forbidden-header
  rejection; private and link-local address refusal; live loopback server
  covering success, off-allowlist redirect refusal, in-allowlist redirect
  following, redirect-loop termination, response-size ceiling, timeout,
  non-2xx passthrough, and `set-cookie` stripping; `net:fetch` enforcement at
  invoke time, scoped grants, and `app.fetch()` binding the app allowlist.
- `test/runtime-api.js`: config file-name length limit — an over-long name is
  rejected with a clear error, and a 250-character name is still accepted.
- `test/runtime-api.js`: closed-window event handling — `isClosed` state,
  pre-`run()` buffering still permitted, `AppWindow.emit()` throws on a closed
  window, `app.emit()` skips closed windows and still reaches open ones
  (asserted with delivery counters), and repeated `close()` stays harmless.

## Documentation audit

Each feature shipped in this session was checked against every documentation
file. Seventeen gaps were found and closed: network access was missing from
`SECURITY.md`, `docs/index.html`, `wiki/Backend-API.md`, and
`wiki/Security-Model.md`; `isClosed` and the closed-window emit rule were
missing from `wiki/Backend-API.md`, `wiki/Windows-and-Multiple-Windows.md`,
and `wiki/Frontend-Bridge.md`; `setup.bat` was missing from `docs/index.html`,
`wiki/Getting-Started.md`, and `CONTRIBUTING.md`; and `test:full` was missing
from `README.md`. A re-run of the audit reports zero gaps.

## Not verified

- `setup.bat` detection was confirmed against a machine where every
  prerequisite is already present, and the argument handling and usage paths
  were exercised. The `winget install` branches were not executed, because
  doing so would install software on this machine. They remain unverified on
  a machine that is actually missing a prerequisite.

## Tests run and results

- `npm run test:full` — 29 suites, all passed.
- Every leaf test and security script run individually, plus the three test
  files reachable only through aggregate scripts — 36 checks, 36 passed,
  0 failed. Includes `build:security-analysis`, `test:pe-hardening`,
  `test:installer`, `security:repo`, and `security:audit`.
- Each fix was confirmed against a failing reproduction before the change and
  a passing run after.

## Blockers, assumptions, limitations, risks

- Live WebView suites require an interactive desktop session. A GitHub runner
  can create a WebView2 controller but cannot complete browser navigation
  (`PLAN.md` DBG-01), so `test:native` and `test:native-ui` are a local gate
  rather than a CI gate.
- Code review covered the runtime modules listed above. `updater.js`,
  `single-instance.js`, `launch-routing.js`, `menu.js`, `bridge.js`,
  `config.js`, `data-directory.js`, and the C++ sources were not reviewed.
  The closed-window defect was found by reading rather than by a failing
  test, so the unreviewed modules may hold similar defects.
- macOS and Linux retain the documented parity gaps in trusted-document
  checks, capability lockdown, native IPC limits, package containment, and
  integrity verification.
