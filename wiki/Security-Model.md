# Security Model

NodeViewJS separates an untrusted WebView frontend from a trusted Node.js backend.

## Guarantees

- No raw `require()`, Node.js globals, or native addon in the frontend
- Only registered commands are callable
- Deny-first permission admission
- Versioned, exact-schema, bounded IPC
- Detached and revalidated JSON transport snapshots
- Windows top-frame and canonical trusted-document checks
- Windows app-root resource policy and blocked remote capabilities
- Outbound HTTP only through `net:fetch` commands, bound to an origin allowlist
- Isolated WebView profiles by stable application identity
- Package input containment and deterministic resource integrity
- Signed update metadata with identity, version, hash, size, and HTTPS binding
- Windows PE hardening and repeatable security gate

## Boundaries in detail

The frontend never receives `require()` or Node.js globals. Do not reintroduce
them; expose registered commands instead. The frontend can call only what the
backend registered.

Top-level WebView navigation is restricted to local files inside the configured
`entry` file's directory. Remote URLs and local files outside that directory are
blocked and logged to stderr.

On Windows the entry directory is mapped in memory to
`https://app.nodeview.example/` inside that WebView instance. It registers no
DNS, edits no hosts file, opens no port, contacts no server, and does not persist
after the WebView closes; the mapping avoids Chromium's unique `file:` origin
warnings while keeping canonical app-root checks and deny-CORS resource access.

On Windows, `window.NodeViewJS` is created only in the top-level document, and
native IPC verifies that each message came from the current canonical local
document under the app root. Child frames, outside-root files, unexpected
origins, and stale pages cannot invoke commands or emit events. Windows also
permits WebView resources only from the local app root: remote fetches, images,
scripts, and frame content receive blocked responses, and popups, downloads,
permission prompts, external URI schemes, and packaged DevTools are denied.
macOS and Linux parity for these boundaries is deferred — see
[[Known Limitations]].

IPC requires protocol version 1 and exact message schemas. Messages are limited
to 256 KiB, 32 levels, 10,000 payload nodes, and 128-character command and event
names; each window allows 64 active calls, applies a 30-second timeout, and
rejects duplicate or recently replayed request IDs. Windows enforces the limit at
the native forwarding boundary as well as in JavaScript.

## Backend responsibility

Structural IPC validation does not replace semantic validation. A command that accepts a path, identifier, query, or permission-sensitive action must validate and authorize that value inside the handler.

```js
app.command("records:read", async (payload) => {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new TypeError("records:read requires an object payload.");
  }
  const { id } = payload;
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new TypeError("Record id must be a positive integer.");
  }
  return readAuthorizedRecord(id);
});
```

## Outbound network access

The WebView cannot reach the network. A backend command holding `net:fetch` can, and `app.fetch()` restricts it to the origins listed in `allowedOrigins`. Redirects are re-checked against that allowlist on every hop, so an allowed origin cannot hand the request to another host.

Two limits are deliberate. `allowedOrigins` constrains code that goes through the helper; it is not a network sandbox, because backend code and plugins are trusted and can reach any host directly. And the allowlist matches the configured origin rather than the address it resolves to, so it does not defend against DNS rebinding.

Never concatenate frontend input into the host portion of a URL. Pass the frontend only the parts it needs to influence and validate them in the handler.

## Reporting vulnerabilities

Use [GitHub Security Advisories](https://github.com/0trebor0/NodeViewJS/security/advisories/new). Do not disclose working exploits, credentials, private data, or unpatched vulnerability details in a public issue.

For the authoritative policy and current guarantee matrix, read `SECURITY.md` in the repository.
