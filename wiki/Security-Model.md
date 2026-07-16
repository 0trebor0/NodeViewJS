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
- Isolated WebView profiles by stable application identity
- Package input containment and deterministic resource integrity
- Signed update metadata with identity, version, hash, size, and HTTPS binding
- Windows PE hardening and repeatable security gate

## Backend responsibility

Structural IPC validation does not replace semantic validation. A command that accepts a path, identifier, query, or permission-sensitive action must validate and authorize that value inside the handler.

```js
app.command("records:read", async ({ id }) => {
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new TypeError("Record id must be a positive integer.");
  }
  return readAuthorizedRecord(id);
});
```

## Reporting vulnerabilities

Use [GitHub Security Advisories](https://github.com/0trebor0/NodeViewJS/security/advisories/new). Do not disclose working exploits, credentials, private data, or unpatched vulnerability details in a public issue.

For the authoritative policy and current guarantee matrix, read `SECURITY.md` in the repository.

