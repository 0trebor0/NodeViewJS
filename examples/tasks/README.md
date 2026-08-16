# Tasks

A small but real desktop application, used to dogfood the NodeViewJS API. It is
not a feature tour: it is the kind of app someone might actually keep open, and
it exists to find out whether the primitives stay pleasant at that size.

```powershell
npm run example:tasks
```

## What it exercises

| Area | How |
| --- | --- |
| Multiple windows | A main list window and a separate quick-add window, kept in sync by broadcast events |
| Per-window permissions | The app holds `fs:read` and `fs:write`; the quick-add window narrows that to `fs:write`, so it can add a task but cannot read the list |
| Commands | `tasks:list`, `tasks:add`, `tasks:toggle`, `tasks:remove`, each validating its payload before touching the store |
| Events | `tasks:changed` is broadcast after every mutation, so no window polls |
| Menu and tray | Both raise events that the backend turns into actions; neither runs privileged code directly |
| Persistence | The `config` helper, in the user's application-data directory |
| Packaging | See below |
| Updates | Wired for real, but only when the release environment is configured |

## Architecture worth copying

`store.js` is the data layer and knows nothing about NodeViewJS: no windows, no
IPC. It validates everything, including data read back from disk, because the
task file is editable by anything running as the user.

`create-app.js` builds the application and returns it without running it.
`app.js` is a four-line entry point that runs it. That split is what makes
`test/example-tasks.js` possible: the whole backend is constructed in a test and
driven through the real IPC layer, with no window ever opening.

The page never receives a task object it did not get from a command, and titles
are rendered with `textContent` rather than `innerHTML`, because a task title is
user data.

## Packaging

Add a `nodeviewjs` block to your project's `package.json` and point it at the
entry:

```json
{
  "nodeviewjs": {
    "name": "Tasks",
    "appId": "com.example.nodeviewjs-tasks",
    "entry": "examples/tasks/app.js",
    "icon": "assets/app.ico"
  }
}
```

Then `npx nodeviewjs package`. See
[Packaging and Distribution](../../wiki/Packaging-and-Distribution.md).

## Updates

The updater activates only when both variables are present, so the example runs
unchanged without them:

```powershell
$env:NODEVIEW_UPDATE_URL = "https://updates.example.com/tasks.json"
$env:NODEVIEW_UPDATE_KEY = "-----BEGIN PUBLIC KEY-----`n...`n-----END PUBLIC KEY-----"
```

A failed update check is logged and ignored: not being able to check for an
update is never a reason to stop working.
