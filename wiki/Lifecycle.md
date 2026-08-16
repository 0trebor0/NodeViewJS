# Lifecycle

This page is the contract for when things start, when they stop, and what
happens when a callback fails. The runtime is tested against it.

## Application

1. `new App(options)` validates options, resolves the permission policy, creates
   the main `AppWindow` in the `configured` state, and installs nothing native.
2. Commands, plugins, and event handlers are registered. Both
   `app.command()` and `app.use()` throw after `app.run()`.
3. `app.run()` installs the error logger, claims the single-instance lock when
   requested, opens every configured window natively, starts plugins, and enters
   the native message loop. It returns `true` for the primary instance and
   `false` for a secondary launch that forwarded its arguments.
4. `app.quit()` shuts down in a fixed order, each phase completing before the
   next begins:

   | Phase | What happens |
   | --- | --- |
   | 1. Stop new work | `isQuitting` becomes true. `createWindow()` throws, and messages arriving from any page are ignored. |
   | 2. Notify the application | `before-quit` handlers run, with `{ windows }`. |
   | 3. Notify plugins | `stop`, then the `setup` cleanup, in reverse registration order. |
   | 4. Close windows | Every window is closed and disposed. |
   | 5. Release IPC state | Pending-request bookkeeping is dropped for every window. |
   | 6. Release resources | Native windows, the single-instance lock, and the error logger. |

   Shutdown is synchronous, so a `before-quit` handler must do its work
   synchronously; a promise it returns is reported but not awaited. Flush state
   there, or in a plugin `stop` hook.

   A failure in any phase is reported and shutdown continues — leaving native
   resources behind would be worse — and the first error is rethrown at the end.
   Calling `quit()` again is a no-op: handlers do not run twice.

   A command still running when shutdown begins is not cancelled, because it may
   be midway through a write. It finishes, but its answer is dropped: the window
   that asked is gone. Design long-running commands to be safe to abandon.

`app.run()` may be called only once. If startup throws, the app reports the
error, releases the single-instance lock, stops plugins, and closes the windows
it had opened — leaving them reopenable, so a caller that fixes the cause (a
missing icon, for example) can call `run()` again.

## Windows

An `AppWindow` moves through four observable states, readable from
`window.lifecycleState`:

| State | Meaning |
| --- | --- |
| `configured` | Created but never opened. `app.run()` will open it. |
| `open` | A native window exists. `window.id` is defined. |
| `closed` | Closed before the app was running. Still listed in `app.windows` and reopenable by a startup retry. |
| `disposed` | Closed while the app was running. Removed from `app.windows`, handlers released, not reopenable. |

Opening and closing are synchronous, so no caller can observe an intermediate
state.

The split between `closed` and `disposed` is deliberate. Before `run()`, a close
is part of startup recovery, so the window stays listed. Once the app is
running, a closed window is finished: it is removed from `app.windows`, its event
handlers and buffered messages are released, and it cannot reopen. Without that,
an app that opens a transient window per document would retain every one of them
for the life of the process.

```js
const preview = app.createWindow({ title: "Preview", entry: "preview.html" });
preview.close();

preview.lifecycleState; // "disposed" once the app is running
app.windows.includes(preview); // false
preview.emit("late");  // throws: Window has been disposed.
```

`isOpen` reports whether a native window exists. `isClosed` reports whether
`close()` has been called — a window that has never been opened is neither open
nor closed, so it still buffers events emitted before `run()`.

Closing is idempotent. Calling `close()` on a closed or disposed window is
harmless.

## Handlers

Event handlers are attached whenever `on()` or `once()` is called and detached
by `off()`, by the unsubscribe function either one returns, or when the window
is disposed. The unsubscribe function and `off()` run identical cleanup,
including removing the event name once its last handler is gone, and both are
safe to call repeatedly.

`once()` releases its wrapper on first delivery.

## When a callback throws

Native callbacks — window messages, menu commands — have no caller to reject
into, so every promise they start is consumed inside the runtime. Nothing the
runtime dispatches escapes as an unhandled rejection.

Application and window event handler failures are **logged and isolated**:

- the failure is written to `app.logPath` and to `console.error`;
- the remaining handlers for that event still run;
- the process is not terminated;
- no error is sent to the frontend, because `emit()` is one-way.

This applies to `app.on()`, `window.on()`, `menu`, `tray-menu`,
`second-instance`, `open-url`, and `open-file` handlers alike — they share one
dispatch path.

Frontend listeners are isolated the same way. A `NodeViewJS.on()` listener that
throws, or returns a promise that rejects, is reported to the page console and
the remaining listeners for that event still run.

Command handlers are different, because `invoke()` has a caller waiting. A
command that throws or rejects is reported to the backend log and the failure is
returned to the frontend, where `NodeViewJS.invoke()` rejects with that message.
Commands time out after 30 seconds.

Failures inside the error reporter itself are swallowed. Reporting runs on
callback boundaries where a throw would have nowhere to go.

## Plugins

`setup` runs during `app.use()` and is transactional: if it throws, the plugin's
event subscriptions are removed, its cleanup function runs, and no commands are
registered. `start` runs during `app.run()`. `stop` and the cleanup function
returned by `setup` run during `app.quit()`, in reverse registration order. All
four hooks must be synchronous; returning a promise is an error.

## Updater

The updater is independent of window lifecycle. `installAndRestart(app)`
re-verifies the staged installer's size and digest, spawns a detached helper,
emits `update-installing`, and then calls `app.quit()`. The helper waits for the
app and launcher processes to exit before applying the installer and restarting.
Shutdown therefore follows the ordinary `app.quit()` sequence above, so flush
state in a plugin `stop` hook or before calling it.
