# macOS and Linux Test Plan

This plan lets volunteers provide reproducible platform evidence without npm
publishing, signing credentials, or access to private project infrastructure.

## Safety and scope

- Test from a fork or clone of the public repository.
- Do not use production signing identities, API keys, or private application data.
- Run live tests in a graphical desktop session. Linux CI may use Xvfb.
- Report security vulnerabilities privately through
  [GitHub Security Advisories](https://github.com/0trebor0/NodeViewJS/security/advisories/new).
- A passing report verifies the tested environment only. It does not establish
  macOS/Linux parity with the Windows security controls listed in `SECURITY.md`.

## Priority environments

| Priority | Platform | Architecture | Purpose |
| --- | --- | --- | --- |
| Required | macOS 14 or newer | Apple silicon | Current WKWebView build, bridge, packaging, and launch |
| Requested | macOS 12 or newer | Intel | Minimum-version and x64 compatibility |
| Required | Ubuntu 24.04 | x64 | CI-aligned GTK 3/WebKitGTK 4.1 validation |
| Requested | Ubuntu 22.04 or Debian 12 | x64 | Distribution compatibility |
| Requested | Linux with GTK/WebKitGTK 4.1 | arm64 | Architecture compatibility |

Use Node.js 22 for the baseline. Additional Node.js 20 or newer reports are
welcome because `package.json` declares Node.js 20 as the minimum.

## Prepare the machine

### macOS

Install Xcode command-line tools:

```bash
xcode-select --install
```

### Ubuntu 24.04

```bash
sudo apt-get update
sudo apt-get install --yes \
  build-essential python3 pkg-config \
  libgtk-3-dev libwebkit2gtk-4.1-dev
```

Add `xvfb` and `xauth` only when testing without an interactive display:

```bash
sudo apt-get install --yes xvfb xauth
```

## Record the environment

### macOS

```bash
sw_vers
uname -m
node --version
npm --version
xcode-select --print-path
```

### Linux

```bash
cat /etc/os-release
uname -m
node --version
npm --version
pkg-config --modversion gtk+-3.0 webkit2gtk-4.1
echo "${XDG_SESSION_TYPE:-unknown}"
```

## Automated test sequence

Start from a clean clone:

```bash
npm ci --ignore-scripts
npm run build
npm test
npm run test:bridge
npm run test:multi-window
```

For headless Linux:

```bash
xvfb-run --auto-servernum npm run test:bridge
xvfb-run --auto-servernum npm run test:multi-window
```

Package the example:

### macOS

```bash
npm run package:macos
test -d build/macos/NodeViewDemo.app
test -f build/macos/NodeViewDemo.dmg
```

### Linux

```bash
npm run package:linux
test -x build/linux/NodeViewDemo/NodeViewDemo
```

## Manual smoke checks

1. Launch the packaged `NodeViewDemo`.
2. Confirm one native window opens without a terminal crash.
3. Confirm the page renders and the Greet action returns `Hello World`.
4. Close the app and confirm the process exits.
5. Launch it again and confirm it starts normally.
6. Check that backend logs use the documented user-data location rather than
   appearing in the repository.

On macOS, also mount the DMG and launch the copied app. Unsigned development
builds may require the tester to use the Finder context-menu Open action; do not
disable system-wide Gatekeeper protections.

## Reporting results

Open an issue titled `[Platform test]: <platform and version>` and include:

- commit SHA;
- operating-system version and architecture;
- Node.js and npm versions;
- desktop session or Xvfb details;
- pass/fail for every automated command and manual check;
- the first failing command and complete sanitized output;
- relevant backend log excerpts;
- whether the package launched twice successfully.

Do not paste credentials, usernames, private filesystem paths, crash dumps
containing personal data, or signing identities. Attach large sanitized logs
instead of placing them inline.

## Completion criteria

macOS validation can move from pending when independent reports cover Apple
silicon and Intel, with build, unit, bridge, multi-window, package, DMG, and
repeat-launch checks passing.

Linux validation can move from pending when independent reports cover Ubuntu
24.04 x64 and one additional distribution or arm64 environment, with build,
unit, bridge, multi-window, package, and repeat-launch checks passing.

Security-parity roadmap items remain separate and must not be closed by general
platform smoke reports.
