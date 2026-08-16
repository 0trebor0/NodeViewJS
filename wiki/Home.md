# NodeViewJS Wiki

NodeViewJS is a lightweight desktop runtime that combines a Node.js backend with the operating system's native WebView. Frontend pages use the safe `window.NodeViewJS` bridge instead of receiving direct access to Node.js APIs.

## Start here

- [[Getting Started]] — create, run, and package a first application.
- [[Frontend Bridge]] — commands, events, readiness, payloads, and limits.
- [[Backend API]] — application, window, plugin, and helper APIs.
- [[Lifecycle]] — startup and shutdown order, window states, and callback error semantics.
- [[Packaging and Distribution]] — portable apps, installers, signing, and updates.
- [[Security Model]] — trust boundaries, permissions, integrity, and limitations.
- [[Testing]] — unit, native, bridge, packaging, and security suites.
- [[Troubleshooting]] — common build, WebView2, packaging, and bridge problems.
- [[Known Limitations]] — current platform boundaries and unsupported behavior.
- [[API Findings]] — what building three real applications against the API surfaced.

## Current status

Windows is the primary locally verified platform. The Windows native build, live WebView2 bridge, IPC security, multi-window routing, menus, tray, taskbar, notifications, portable packaging, packaged launch, installer rollback/recovery, integrity, and security suites pass.

macOS and Linux hosts compile and their packaging/platform-boundary tests pass in CI-oriented coverage. Some security controls do not yet have parity with the Windows host; see [[Known Limitations]].

## Core architecture

```text
HTML / CSS / JavaScript
        │
        │ window.NodeViewJS
        ▼
Validated versioned IPC
        │
        ▼
Registered Node.js commands
        │
        ▼
Native window and OS helpers
```

The WebView never receives `require()`, Node.js globals, or direct native-addon access.

