# NodeViewJS Security Policy

## Reporting a vulnerability

Please report vulnerabilities privately through [GitHub Security Advisories](https://github.com/0trebor0/NodeViewJS/security/advisories/new). Include the affected version or commit, platform, reproduction steps, impact, and any suggested mitigation.

Do not publish working exploits, private data, credentials, or undisclosed vulnerability details in a public issue. General hardening ideas that do not disclose an exploitable weakness may use the public issue tracker.

Security fixes currently target the latest `main` branch. NodeViewJS is pre-1.0 and does not maintain security-fix branches for older releases yet.

## Security objective

NodeViewJS separates a WebView frontend from a trusted Node.js backend. Frontend code may request named operations through `window.NodeViewJS`, but it must not receive direct Node.js, filesystem, shell, or native-addon access.

The primary objective is to prevent compromised or malformed frontend content from crossing that boundary except through explicitly registered, validated, permission-admitted backend commands.

## Trust boundaries

### Trusted components

- The application backend and every dependency it imports have full Node.js privileges.
- Explicitly loaded plugins are trusted backend code. Plugin permissions control admission and routing; they are not an operating-system sandbox.
- NodeViewJS native binaries, the packaged Node.js runtime, and build/release infrastructure are trusted.
- The application developer and release signer control package configuration and update keys.

### Untrusted inputs

- Every value received from the WebView, including command names, event names, payloads, and navigation requests.
- Remote content, remote frames, downloaded data, clipboard contents, opened files, custom URLs, file-association arguments, and second-instance arguments.
- Update manifests and installers until their signatures, identity, size, and hashes are verified.
- Files discovered through package include paths until their canonical source and destination are validated.

### Application-controlled content

Packaged local HTML, CSS, and JavaScript are application code, but they remain untrusted relative to the backend boundary because an application bug such as cross-site scripting may compromise the page. Backend commands must validate payloads even when the caller is a local page.

## Current guarantees

- Raw `require()`, Node.js globals, and the native addon are not exposed to the WebView.
- Only registered commands can be invoked from the frontend.
- Command permission requirements are checked before handlers run; deny rules take precedence.
- Native shell execution is not exposed. External URLs and paths use constrained backend helpers.
- Top-level navigation is restricted to local files under the configured entry directory.
- On Windows, the bridge exists only in the top-level frame and native IPC requires the sender, current source, and active trusted document to resolve to the same canonical local file under the app root.
- Windows WebView2 allows local app-root resources and denies remote resource responses, remote or outside-root frame content, popups, downloads, permission requests, external URI schemes, and DevTools in packaged apps.
- WebView profile data is isolated by stable application identity.
- Single-instance messages are bounded and delivered through a per-app local channel.
- Update metadata is Ed25519-signed and binds application identity, version, HTTPS URL, size, and SHA-256. Downloads are rechecked before installation.
- Packaged builds reference a copied local bridge script from prepared HTML and direct native hosts to skip development bridge injection.
- Windows packaging accepts only canonical project-contained inputs and destinations, rejects links/reparse points and traversal, excludes common secret-bearing files, and emits redacted optional credential-pattern warnings.
- Windows packages bind a deterministic manifest for every `resources` file into the launcher. The launcher rejects modified manifests, paths, links, missing/extra files, size changes, or SHA-256 mismatches before starting Node.
- Windows release builds enable SDL checks, Spectre mitigation, Control Flow Guard, ASLR, DEP, and CET compatibility for the addon and launcher. CI verifies the resulting PE headers and also runs repository and package-surface secret and hidden-character scanning before and after generated native build files exist, production dependency auditing, warning-as-error MSVC analysis, malformed-input corpora, package tamper checks, and installer smoke through `npm run security:gate`.

## Known limitations and non-goals

- NodeViewJS is not an operating-system sandbox for backend code or plugins.
- The current permission model does not restrict what trusted backend code can do after it is loaded.
- Applications are responsible for validating command payload semantics and authorizing actions for their own users.
- WebView2 can initiate a remote frame request before native cancellation, although the response is replaced and its content cannot execute. Do not put secrets in remote frame URLs.
- macOS and Linux capability-lockdown parity is deferred; do not mix remote content with privileged pages on those hosts.
- macOS and Linux trusted-document parity is deferred; do not mix remote frames with privileged pages on those hosts.
- macOS and Linux native IPC-limit parity is deferred; the shared JavaScript parser is strict, but equivalent host-side forwarding limits still need platform verification.
- macOS and Linux package-input containment parity is deferred.
- Unsigned portable launchers can still be replaced or binary-patched together with their embedded manifest. Use Authenticode for release launchers/installers; local integrity verification protects the resources bound to that launcher.
- macOS and Linux packaged-integrity parity is deferred.
- Code signing depends on release configuration and is not automatically provided by a local build.
- macOS and Linux security-release-gate parity is deferred.

These limitations are tracked in the Security-First Queue in `PLAN.md`. They should not be interpreted as supported security guarantees.

## Abuse-case and verification matrix

| Boundary | Abuse case | Current control | Verification / roadmap |
| --- | --- | --- | --- |
| WebView to backend | Invoke an unregistered or unauthorized command | Command registry, deny-first permission policy, strict message schemas, and bounded payloads | `test/runtime-api.js`, `test/bridge-integration.js`, `test/ipc-security.js` |
| WebView document identity | Remote, outside-root, child, or stale document sends privileged IPC | Windows top-frame bridge guard plus canonical native sender/current/trusted-document equality | `test/trusted-document-integration.js`; macOS/Linux SEC-02 parity deferred |
| IPC parser | Oversized, deeply nested, replayed, or malformed messages consume resources or bypass routing | Version 1 and exact schemas; 256 KiB, depth, node, name, concurrency, replay, response, and timeout limits | `test/ipc-security.js`, `test/ipc-security-integration.js`; macOS/Linux native parity deferred |
| WebView capabilities | Popup, download, permission request, external scheme, frame, or remote resource escapes app policy | Windows denies capability events and replaces non-app-root resource responses; packaged DevTools are disabled | `test/webview-capabilities-integration.js`, `test/platform.js`; macOS/Linux parity deferred |
| Backend command | Valid IPC carries dangerous application-specific payload | Handler is explicit, may declare permissions, and receives only structurally bounded JSON | Application responsibility for command-specific semantic validation |
| Plugin to backend | Plugin registers undeclared privileged commands | Explicit loading, declared permissions, transactional setup, namespacing | `test/plugins.js` |
| Shell and clipboard | Frontend reaches privileged OS helpers directly | Helpers remain backend-only and require registered command routing | `test/runtime-api.js`, `test/platform.js`, `test/native-lifecycle.js` |
| Local navigation | Page navigates outside its application root | Root-bound navigation policy and cancellation | `test/bridge-integration.js`, `test/multi-window-integration.js`; cross-host canonicalization remains part of SEC-02 |
| Package input | Include path, link/reparse point, traversal, collision, or secret escapes package policy | Windows canonical containment, safe destinations, link rejection, default secret exclusions, and redacted warnings | `test/package-input-security.js`, `test/cli.js`; macOS/Linux parity deferred |
| Packaged integrity | Backend, HTML, bridge, runtime, addon, Node, or manifest is changed after packaging | Windows launcher-embedded deterministic manifest plus canonical SHA-256 verification before Node startup | `test/package-integrity.js`, `test/cli.js`; Authenticode protects the launcher anchor, macOS/Linux parity deferred |
| Update channel | Manifest, installer, downgrade, or staged file is tampered with | Ed25519, HTTPS, application/version binding, size and SHA-256 checks, transactional replacement | `test/updater.js`, `test/installer-smoke.ps1` |
| Single-instance channel | Another process floods or forges launch data | Per-app local endpoint, bounded payload, validation | `test/single-instance.js`, `test/app-single-instance.js` |
| Native lifetime | Late callback or stale window accesses destroyed state | Instance ownership and initialization generation checks | `test/native-lifecycle.js`, `test/multi-window-integration.js` |
| Release pipeline | Secret, hidden source character, vulnerable dependency, compiler-hardening regression, malformed input, or tampered package ships | Windows `security:gate` with repository and package-surface scanning, production audit, warning-as-error MSVC analysis, hardened PE builds, corpora, tamper tests, and installer smoke | `scripts/security-scan.js`, `test/security-corpus.js`, `test/package-integrity.js`, `test/installer-smoke.ps1`, `SECURITY-CHECKLIST.md`; macOS/Linux parity deferred |

## Rules for application developers

- Treat all frontend payloads as untrusted and validate type, size, range, and authorization in each command.
- Grant only the permissions required by registered commands. Prefer scoped permissions and explicit deny rules.
- Never expose `require`, `process`, filesystem objects, native handles, arbitrary evaluation, or command execution to frontend code.
- Keep remote content in an unprivileged browser context. Do not place remote frames inside a window that can invoke privileged commands.
- Keep update private keys, signing certificates, tokens, `.env` files, and credentials outside the project and package inputs.
- Disable DevTools in production and avoid logging secrets or full sensitive payloads.
- Review backend dependencies as privileged code.

## Security completion standard

A security roadmap item is complete only when its JavaScript and native boundaries are implemented, adversarial tests pass, documentation reflects the actual guarantee, and known platform differences are recorded. Source-pattern assertions alone are not sufficient evidence for a security boundary.
