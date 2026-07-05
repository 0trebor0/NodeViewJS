"use strict";

const crypto = require("node:crypto");
const net = require("node:net");

const MAX_MESSAGE_BYTES = 64 * 1024;
const FORWARD_TIMEOUT_MS = 2_000;
const RETRY_DELAY_MS = 25;

let nativeAddon;

function native() {
  if (process.platform !== "win32") {
    throw new Error("Single-instance applications are currently available only on Windows.");
  }
  nativeAddon ??= require("./native");
  return nativeAddon;
}

function createKey(appId) {
  return crypto.createHash("sha256").update(appId, "utf8").digest("hex").slice(0, 32);
}

function validatePayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload) ||
      !Array.isArray(payload.args) || !payload.args.every((value) => typeof value === "string") ||
      typeof payload.cwd !== "string") {
    throw new TypeError("Second-instance payload must contain string args and cwd.");
  }
  const message = `${JSON.stringify({ args: payload.args, cwd: payload.cwd })}\n`;
  if (Buffer.byteLength(message) > MAX_MESSAGE_BYTES) {
    throw new RangeError("Second-instance arguments exceed the 64 KiB message limit.");
  }
  return message;
}

class SingleInstanceCoordinator {
  #key;
  #pipe;
  #server;
  #ownsMutex = false;
  #activeConnections = 0;
  #closeRequested = false;

  constructor(appId) {
    this.#key = createKey(appId);
    this.#pipe = `\\\\.\\pipe\\nodeviewjs-${this.#key}`;
  }

  request(payload, onSecondInstance, onError = console.error) {
    const message = validatePayload(payload);
    if (typeof onSecondInstance !== "function") {
      throw new TypeError("Second-instance handler must be a function.");
    }
    if (typeof onError !== "function") {
      throw new TypeError("Single-instance error handler must be a function.");
    }

    this.#ownsMutex = native().claimSingleInstance(this.#key);
    if (!this.#ownsMutex) {
      return { primary: false, forwarded: this.#forward(message) };
    }

    try {
      this.#server = net.createServer({ allowHalfOpen: true }, (socket) => {
        this.#activeConnections += 1;
        socket.once("close", () => {
          this.#activeConnections -= 1;
          if (this.#closeRequested && this.#activeConnections === 0) this.#closeNow();
        });
        socket.setEncoding("utf8");
        let received = "";
        let handled = false;
        socket.on("data", async (chunk) => {
          if (handled) return;
          received += chunk;
          if (Buffer.byteLength(received) > MAX_MESSAGE_BYTES) {
            handled = true;
            socket.destroy();
            return;
          }
          const newline = received.indexOf("\n");
          if (newline === -1) return;
          handled = true;
          try {
            const parsed = JSON.parse(received.slice(0, newline));
            validatePayload(parsed);
            await onSecondInstance(parsed);
            socket.end("ok");
          } catch (error) {
            socket.destroy();
            onError(error);
          }
        });
      });
      this.#server.on("error", (error) => {
        this.close();
        onError(error);
      });
      this.#server.listen(this.#pipe);
      this.#server.unref();
    } catch (error) {
      this.close();
      throw error;
    }

    return { primary: true, forwarded: Promise.resolve() };
  }

  close() {
    if (this.#activeConnections > 0) {
      this.#closeRequested = true;
      return;
    }
    this.#closeNow();
  }

  #closeNow() {
    this.#closeRequested = false;
    try { this.#server?.close(); } catch {}
    this.#server = undefined;
    if (this.#ownsMutex) {
      native().releaseSingleInstance();
      this.#ownsMutex = false;
    }
  }

  #forward(message) {
    const deadline = Date.now() + FORWARD_TIMEOUT_MS;
    return new Promise((resolve, reject) => {
      const attempt = () => {
        let acknowledged = false;
        let connected = false;
        let response = "";
        const socket = net.createConnection(this.#pipe);
        socket.setEncoding("utf8");
        socket.setTimeout(Math.max(1, deadline - Date.now()));
        socket.once("connect", () => {
          connected = true;
          socket.write(message);
        });
        socket.on("data", (value) => {
          response += value;
          if (response.includes("ok")) acknowledged = true;
        });
        socket.once("timeout", () => socket.destroy(new Error("Timed out forwarding second-instance arguments.")));
        socket.once("error", (error) => {
          socket.destroy();
          if (["ENOENT", "ECONNREFUSED", "EBUSY"].includes(error.code) && Date.now() < deadline) {
            setTimeout(attempt, RETRY_DELAY_MS);
          } else {
            reject(error);
          }
        });
        socket.once("close", () => {
          if (acknowledged) resolve();
          else if (connected) reject(new Error("The primary app did not acknowledge the second launch."));
          else if (Date.now() >= deadline) reject(new Error("The primary app did not acknowledge the second launch."));
        });
      };
      attempt();
    });
  }
}

module.exports = { SingleInstanceCoordinator };
