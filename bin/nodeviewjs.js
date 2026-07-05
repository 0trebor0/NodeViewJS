#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");

const packageRoot = path.join(__dirname, "..");

function printHelp() {
  console.log(`NodeViewJS

Usage:
  nodeviewjs create <app-name>
  nodeviewjs setup
  nodeviewjs build
  nodeviewjs start [entry]
  nodeviewjs dev [entry]
  nodeviewjs package
  nodeviewjs installer
  nodeviewjs update-manifest <installer-url>

Commands:
  create       Create a starter NodeViewJS app
  setup        Prepare generated/runtime build files
  build        Build the native addon and launcher
  start        Run an app entry file with Node.js
  dev          Run with DevTools, live reload, and clearer errors
  package      Create the portable app folder
  installer    Create a per-user Windows installer
  update-manifest  Sign update metadata for a packaged installer
`);
}

function run(command, args, options = {}) {
  const child = spawn(command, args, {
    stdio: "inherit",
    env: { ...process.env, ...options.env }
  });

  child.on("error", (error) => {
    console.error(`[NodeViewJS] Could not start ${command}: ${error.message}`);
    process.exitCode = 1;
  });

  child.on("exit", (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exitCode = code ?? 0;
  });
}

function npmRun(script) {
  run(process.platform === "win32" ? "npm.cmd" : "npm", ["run", script]);
}

function packagePortable(projectRoot = process.cwd()) {
  if (process.platform === "darwin") {
    run(process.execPath, [
      path.join(packageRoot, "scripts", "package-macos.js"),
      "--project-root", projectRoot
    ]);
    return;
  }
  if (process.platform === "linux") {
    run(process.execPath, [
      path.join(packageRoot, "scripts", "package-linux.js"),
      "--project-root", projectRoot
    ]);
    return;
  }
  if (process.platform !== "win32") {
    console.error(`Packaging is not implemented for ${process.platform} yet.`);
    process.exitCode = 1;
    return;
  }
  const script = path.join(packageRoot, "scripts", "package-portable.ps1");
  run("powershell", ["-ExecutionPolicy", "Bypass", "-File", script, "-ProjectRoot", projectRoot]);
}

function packageInstaller(projectRoot = process.cwd()) {
  if (process.platform !== "win32") {
    console.error("The per-user installer command is only available on Windows.");
    process.exitCode = 1;
    return;
  }
  const script = path.join(packageRoot, "scripts", "package-installer.ps1");
  run("powershell", ["-ExecutionPolicy", "Bypass", "-File", script, "-ProjectRoot", projectRoot]);
}

function generateUpdateManifest(args) {
  const installerUrl = args[0];
  if (!installerUrl) {
    console.error("Usage: nodeviewjs update-manifest <installer-url>");
    process.exitCode = 1;
    return;
  }
  run(process.execPath, [
    path.join(packageRoot, "scripts", "generate-update-manifest.js"),
    "--project-root", process.cwd(),
    "--url", installerUrl
  ]);
}

function toPackageName(appName) {
  return appName
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

function toTitle(appName) {
  return appName
    .replace(/[-_]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function writeFile(filePath, contents) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents.trimStart().replace(/\n/g, "\r\n"));
}

function createApp(args) {
  const appName = args[0];
  if (!appName) {
    console.error("Usage: nodeviewjs create <app-name>");
    process.exitCode = 1;
    return;
  }

  const target = path.resolve(appName);
  if (fs.existsSync(target) && fs.readdirSync(target).length > 0) {
    console.error(`Target folder is not empty: ${target}`);
    process.exitCode = 1;
    return;
  }

  const packageName = toPackageName(path.basename(target));
  const title = toTitle(path.basename(target));
  fs.mkdirSync(target, { recursive: true });

  writeFile(path.join(target, "package.json"), `${JSON.stringify({
    name: packageName,
    version: "0.1.0",
    private: true,
    main: "app.js",
    nodeviewjs: {
      name: title.replace(/\s+/g, ""),
      appId: packageName,
      entry: "app.js",
      include: ["assets"],
      exclude: []
    },
    scripts: {
      dev: "nodeviewjs dev app.js",
      package: "nodeviewjs package",
      installer: "nodeviewjs installer",
      "update:manifest": "nodeviewjs update-manifest"
    },
    dependencies: {
      nodeviewjs: "github:0trebor0/NodeViewJS"
    }
  }, null, 2)}\n`);

  writeFile(path.join(target, "app.js"), `
"use strict";

const path = require("node:path");
const { App } = require("nodeviewjs");

const app = new App({
  title: "${title}",
  appId: "${packageName}",
  width: 900,
  height: 600,
  center: true,
  icon: process.env.NODEVIEW_APP_ICON,
  entry: path.join(__dirname, "index.html")
});

app.command("greet", async (name) => {
  return \`Hello \${name || "there"} from ${title}\`;
});

app.run();
`);

  writeFile(path.join(target, "index.html"), `
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title}</title>
    <style>
      body {
        font-family: system-ui, sans-serif;
        margin: 48px;
      }

      input,
      button {
        font: inherit;
      }
    </style>
  </head>
  <body>
    <h1>${title}</h1>
    <p>NodeViewJS is rendering this local file.</p>

    <label>
      Your name
      <input id="name" value="Robert" />
    </label>
    <button id="greet">Greet</button>
    <p id="output"></p>

    <script>
      const nameInput = document.querySelector("#name");
      const greetButton = document.querySelector("#greet");
      const output = document.querySelector("#output");

      greetButton.onclick = async () => {
        output.textContent = await NodeViewJS.invoke("greet", nameInput.value);
      };
    </script>
  </body>
</html>
`);

  fs.mkdirSync(path.join(target, "assets"), { recursive: true });
  writeFile(path.join(target, "assets", ".gitkeep"), "\n");
  writeFile(path.join(target, "assets", "README.md"), `
# Assets

Place your app assets here.

For a window/taskbar icon, add a Windows .ico file named:

\`\`\`text
app.ico
\`\`\`

Then add this to the \`nodeviewjs\` block in \`package.json\`:

\`\`\`json
"icon": "assets/app.ico"
\`\`\`
`);

  console.log(`Created ${title} at ${target}`);
  console.log("");
  console.log("Next steps:");
  console.log(`  cd ${path.relative(process.cwd(), target) || "."}`);
  console.log("  npm install");
  console.log("  npm run dev");
  console.log("  npm run package");
}

function runEntry(args, env = {}, nodeArgs = []) {
  const entry = path.resolve(args[0] ?? "examples/basic/app.js");
  if (!fs.existsSync(entry)) {
    console.error(`App entry file was not found: ${entry}`);
    process.exitCode = 1;
    return;
  }

  run(process.execPath, [...nodeArgs, entry], { env });
}

const [command, ...args] = process.argv.slice(2);

switch (command) {
  case undefined:
  case "help":
  case "--help":
  case "-h":
    printHelp();
    break;
  case "create":
    createApp(args);
    break;
  case "setup":
    npmRun("setup");
    break;
  case "build":
    npmRun("build");
    break;
  case "start":
    runEntry(args);
    break;
  case "dev":
    runEntry(args, {
      NODEVIEW_DEVTOOLS: "1",
      NODEVIEW_DEV_WATCH: "1",
      NODEVIEW_STARTUP_TIMING: "1"
    }, ["--require", path.join(packageRoot, "runtime", "dev-errors.js")]);
    break;
  case "package":
    packagePortable(args[0]);
    break;
  case "installer":
    packageInstaller(args[0]);
    break;
  case "update-manifest":
    generateUpdateManifest(args);
    break;
  default:
    console.error(`Unknown command: ${command}`);
    printHelp();
    process.exitCode = 1;
    break;
}
