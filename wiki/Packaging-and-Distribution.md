# Packaging and Distribution

## Prebuilt native binaries

Installing NodeViewJS runs `scripts/install-native.js`, which prefers a
published binary over a local compile so that `npm install nodeviewjs` does not
require a C++ toolchain.

The trust model is the important part:

- Expected SHA-256 digests live in `native-checksums.json`, which ships **inside
  the package**. Digests are never read from the download host, so a compromised
  or substituted host cannot authorise its own binary.
- The host must be `https` and must not carry credentials. Redirects are refused
  rather than followed, because a redirect sends the install somewhere the
  configuration did not name.
- An artifact that is missing, unreachable, oversized, or not listed for this
  target **falls back to a source build**. That is a normal outcome.
- An artifact whose digest does not match **fails the install**. It does not fall
  back: a wrong digest means the bytes are not the ones this package expects, and
  quietly compiling instead would hide that. Nothing is written to disk unless
  every file for the target verifies first.

A successful prebuilt install records `build/nodeview/provenance.json` with the
target, version, and host it came from.

Configure the host with `NODEVIEW_BINARY_HOST`, the `nodeview_binary_host` npm
config value, or `nodeviewjs.binaryHost` in `package.json`. Artifacts are fetched
from `<host>/<version>/<platform>-<arch>/<file>`.

### Publishing a release (maintainers)

No binaries are published yet. When they are, on each release platform:

```powershell
npm run build
npm run native:checksums
```

That records this platform's digests into `native-checksums.json` under its
`<platform>-<arch>` key. Commit the updated file, then upload the matching
`build/nodeview/` files to `<host>/<version>/<platform>-<arch>/`. A target with
no entry in the file is simply not offered as a prebuilt, so platforms can be
added one at a time.

Targets: `win32-x64`, `win32-arm64`, `darwin-x64`, `darwin-arm64`, `linux-x64`,
and `linux-arm64`.

One artifact per platform and architecture serves every supported Node release,
because the addon is built against a pinned N-API version rather than whatever
the build machine happened to offer:

```
"defines": ["NAPI_VERSION=8", "NAPI_CPP_EXCEPTIONS"]
```

N-API 8 is available in every Node.js release this package supports, and
`npm run test:napi` fails if the addon ever references a symbol outside the set
it is known to use — which is what would silently narrow the range of Node
versions a prebuilt binary can serve. Verifying that the same binary loads on
Node 20, 22, and 24 is a release-pipeline step; the local test can only check
the Node it runs on.


## Portable packages

```powershell
npx nodeviewjs package
```

Windows output is written under `build/portable`. Packaging validates project-contained inputs, rejects traversal and reparse points, copies the runtime, prepares HTML with a local external bridge script, and binds an integrity manifest into the launcher. If the native addon or launcher is missing, `nodeviewjs package` builds the runtime first.

The portable folder layout:

```text
MyApp/
  MyApp.exe
  resources/
    app/
      app.js
      index.html
      __nodeview/
        bridge.js
    runtime/
      node.exe
      nodeview.js
      apply-update.ps1
      nodeview.node
    integrity.manifest
```

The generated exe starts the bundled Node runtime without a console window,
waits for the app process, and writes runtime output to
`resources/<AppName>.log`.

### Integrity and secret protection

On Windows the manifest records every app and runtime file's path, size, and
SHA-256 digest, and is embedded byte-for-byte into the launcher. Before Node
starts, the launcher rejects manifest changes, missing or extra files, reparse
points, path escapes, size changes, and digest mismatches. The runtime log is
the only permitted unlisted resource file.

Packaging always excludes `node_modules`, `.git`, `.nodeview-webview`, `build`,
`.env`, `.env.*`, `.npmrc`, `.pypirc`, private-key and credential files such as
`*.pem`, `*.key`, `*.pfx`, `*.p12`, `credentials.json`, and
`service-account*.json`, and JavaScript source maps. Text inputs up to 1 MiB are
scanned for common private-key, access-key, token, and credential-assignment
patterns; warnings name only the file and pattern category, never the matched
value.

### Exe metadata and icon

Windows version metadata is compiled into the launcher during `npm run build`,
from the `nodeviewjs.metadata` block. Rebuild before packaging when it changes.
Metadata is separate from code signing; unsigned exes can still show SmartScreen
warnings.

`nodeviewjs package` copies the configured `icon` into `resources/app`, embeds it
in the generated exe, and sets `NODEVIEW_APP_ICON` before your app code runs:

```js
const app = new App({
  title: "My App",
  icon: process.env.NODEVIEW_APP_ICON,
  entry: path.join(__dirname, "index.html")
});
```

## Windows installer

```powershell
npm run package:installer
```

The installer is written to `build/installer/<AppName>-<version>-setup.exe` and
supports clean installation, replacement, rollback after corrupt payloads,
interrupted-update recovery, Start Menu registration, notification identity,
associations, and uninstall cleanup. It installs for the current user under
`%LOCALAPPDATA%\Programs\<AppName>` and needs no administrator access.
Association registration refuses to replace a protocol or app-specific file
handler owned by another application, and uninstallation removes only
registrations still owned by the installed executable. Replacement is
transactional: existing files are restored if extraction or registration fails.

## macOS and Linux

```powershell
npm run package:macos
npm run package:linux
```

macOS produces `build/macos/<AppName>.app` and a compressed DMG containing the
app and an Applications shortcut. The bundle holds a native Mach-O launcher, the
bundled Node runtime, native addon, runtime JavaScript, and app assets;
`nodeviewjs.appId` becomes `CFBundleIdentifier` and `nodeviewjs.macIcon` supplies
the optional `.icns`.

Linux produces `build/linux/<AppName>/` with one executable and one `resources/`
directory. The target system still needs compatible GTK 3 and WebKitGTK 4.1
runtime libraries.

Review [[Known Limitations]] before treating security behavior as equivalent to Windows.

## Signing

Windows release installers and launchers should be Authenticode signed. Set
either `NODEVIEW_SIGN_CERTIFICATE` to a PFX path (with optional
`NODEVIEW_SIGN_PASSWORD`) or `NODEVIEW_SIGN_THUMBPRINT`, and
`NODEVIEW_SIGN_TIMESTAMP_URL` to add an RFC 3161 timestamp. Packaging embeds the
integrity manifest before signing, so the signature protects the launcher trust
anchor.

On macOS, set `NODEVIEW_MAC_SIGN_IDENTITY` to a Developer ID Application identity
to sign the launcher, Node runtime, addon, and app with hardened-runtime
options, and `NODEVIEW_MAC_NOTARY_PROFILE` to a configured `notarytool` keychain
profile to submit and staple the signed app before its DMG is generated.

Configure signing through the release environment, never by committing
credentials. Unsigned launchers can be replaced together with their embedded
trust anchor; resource integrity is strongest when the launcher itself is
authenticated.

## Updates

Update metadata is Ed25519-signed and binds application identity, semantic
version, HTTPS installer URL, byte size, and SHA-256 digest. Keep the private key
outside the project and ship only the public key in the app.

```powershell
$env:NODEVIEW_UPDATE_PRIVATE_KEY = "C:\secure\my-app-update-private.pem"
npx nodeviewjs update-manifest https://updates.example.com/MyApp-1.2.0-setup.exe
```

Upload the generated `build/installer/update.json` and the installer to HTTPS
endpoints, then check for updates from the backend:

```js
const { Updater } = require("nodeviewjs");

const updater = new Updater({
  appId: process.env.NODEVIEW_APP_ID,
  currentVersion: process.env.NODEVIEW_APP_VERSION,
  manifestUrl: "https://updates.example.com/update.json",
  publicKey: "-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----"
});

const update = await updater.checkForUpdates();
if (update) {
  await updater.downloadUpdate(update);
  await updater.installAndRestart(app);
}
```

Checks reject unsigned metadata, wrong app identities, non-HTTPS URLs,
downgrades, unexpected fields, oversized responses, and mismatched installer
bytes. Downloads are staged under `%LOCALAPPDATA%\NodeViewJS\Updates`.
Installation waits for the app and launcher to exit, re-verifies the installer,
applies it quietly, and restarts the app — see [[Lifecycle]]. Updater events are
`checking`, `update-available`, `update-not-available`, `update-downloaded`,
`update-installing`, and `updater-error`.

Keep signing keys outside the repository and CI logs.

