# Contributing to NodeViewJS

Thank you for helping test and improve NodeViewJS.

## Before opening an issue

- Use [GitHub Security Advisories](https://github.com/0trebor0/NodeViewJS/security/advisories/new) for vulnerabilities.
- Use an issue titled `[Platform test]: <platform and version>` for macOS or Linux test results.
- Search existing issues before filing a duplicate.
- Remove credentials, private paths, personal data, and signing material from logs.

## Platform testing

macOS and Linux testing is the current priority. Follow
[PLATFORM-TESTING.md](PLATFORM-TESTING.md) for the supported environments,
commands, manual checks, and evidence to include.

Reports are useful even when a command fails. Include the first failing command,
its complete sanitized output, operating-system version, architecture, Node.js
version, and whether the test ran in a graphical desktop session.

## Code changes

1. Create a focused branch from `main`.
2. Install dependencies with `npm ci`.
3. Make the smallest change needed for the issue.
4. Add or update focused tests when behavior changes.
5. Run `npm test` and the relevant native integration tests. On Windows,
   `npm run test:full` runs the default suite plus every native and WebView
   integration in one pass.
6. Document anything that could not be tested on your machine.

Do not commit generated build output, application data, logs, dependency
directories, credentials, environment files, signing keys, or package archives.

Pull requests should explain:

- what changed and why;
- which files changed;
- which tests were added or updated;
- the exact commands run and their results;
- remaining limitations or platform coverage gaps.
