# Known Limitations

- NodeViewJS is not an operating-system sandbox for backend code or plugins.
- Plugins are trusted code after admission.
- Applications must validate command-specific payload semantics and user authorization.
- Packaged Windows applications disable DevTools.
- WebView2 may initiate a remote frame request before cancellation, although response content is blocked. Never place secrets in remote frame URLs.
- macOS and Linux do not yet have complete parity with Windows trusted-document checks, capability lockdown, native IPC limits, package containment, integrity, and security release gates.
- Code signing and notarization depend on external release credentials and configuration.
- Payloads are JSON-style data, not arbitrary JavaScript objects or Node.js values.
- `emit()` is one-way and does not acknowledge completion.
- IPC and readiness queues are deliberately bounded.

The authoritative security limitations are maintained in `SECURITY.md`; roadmap work is tracked in `PLAN.md`.

