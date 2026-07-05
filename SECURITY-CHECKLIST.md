# Windows Security Release Checklist

Run this checklist from a clean release candidate on Windows with Python 3, Visual Studio C++ Build Tools, and the built-in IExpress tool available.

## Automated gate

- [ ] Run `npm ci` from the committed lockfile.
- [ ] Run `npm run security:gate` and require a zero exit code.
- [ ] Confirm the production dependency audit has no high or critical findings.
- [ ] Confirm MSVC static analysis builds both the addon and launcher with no errors and the PE hardening test passes.
- [ ] Confirm malformed IPC and integrity-manifest corpus tests pass.
- [ ] Confirm package-input, package-tamper, updater, and installer tests pass.

The Windows CI job runs the same `security:gate` command. A release must not bypass or soften a failing gate.

## Privileged API review

- [ ] Compare `runtime/index.js` exports with this inventory: `App`, `AppWindow`, `clipboard`, `config`, `dialog`, `ipc`, `notification`, `shell`, and `Updater`.
- [ ] Confirm every new backend or native capability is documented in `README.md` and assigned an explicit trust boundary in `SECURITY.md`.
- [ ] Confirm no frontend code receives `require`, `process`, filesystem objects, native handles, arbitrary evaluation, or command execution.
- [ ] Confirm command and plugin permission checks remain deny-first and new privileged commands declare their required permissions.

## Release artifacts

- [ ] Build the final installer from the reviewed commit without modifying generated package contents.
- [ ] Authenticode-sign the launcher and installer, then verify both signatures.
- [ ] Verify the signed update manifest binds the expected app id, version, HTTPS URL, installer size, and SHA-256.
- [ ] Install, launch, update, and uninstall the signed candidate on a clean supported Windows machine.
- [ ] Record any accepted finding or platform limitation in `SECURITY.md` before release.

A release cannot pass with an open high or critical finding, an undocumented privileged API, a failed signature, or a failed integrity test.
