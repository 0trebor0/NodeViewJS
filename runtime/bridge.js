(() => {
  if (window.top !== window) return;

  const IPC_VERSION = 1;
  const IPC_MAX_SERIALIZED_BYTES = 256 * 1024;
  const IPC_MAX_DEPTH = 32;
  const IPC_MAX_NODES = 10000;
  const IPC_MAX_NAME_LENGTH = 128;
  const IPC_MAX_PENDING_REQUESTS = 64;
  const IPC_REQUEST_TIMEOUT_MS = 30000;
  const IPC_NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/;
  const DANGEROUS_KEYS = new Set(["__proto__", "constructor", "prototype"]);
  const pending = new Map();
  const listeners = new Map();

  function createInitialRequestId() {
    const values = new Uint32Array(2);
    if (window.crypto?.getRandomValues) {
      window.crypto.getRandomValues(values);
      return 1 + ((values[0] * 0x100000 + (values[1] & 0xfffff)) % (Number.MAX_SAFE_INTEGER - 1024));
    }
    return 1 + ((Date.now() * 0x100000 + Math.floor(Math.random() * 0x100000))
      % (Number.MAX_SAFE_INTEGER - 1024));
  }

  let nextId = createInitialRequestId();

  const webView2 = window.chrome?.webview;
  const webKit = window.webkit?.messageHandlers?.nodeview;

  function safeIsArray(value) {
    try {
      return Array.isArray(value);
    } catch {
      return undefined;
    }
  }

  function safeGetPrototypeOf(value) {
    try {
      return Object.getPrototypeOf(value);
    } catch {
      return undefined;
    }
  }

  function isPlainObject(value) {
    if (!value || typeof value !== "object") return false;
    const isArray = safeIsArray(value);
    if (isArray !== false) return false;
    const prototype = safeGetPrototypeOf(value);
    if (prototype === undefined) return false;
    let tag;
    try {
      tag = Object.prototype.toString.call(value);
    } catch {
      return false;
    }
    return prototype === null
      || prototype === Object.prototype
      || (tag === "[object Object]"
        && safeGetPrototypeOf(prototype) === null);
  }

  function hasExactKeys(value, required, optional = []) {
    const allowed = new Set([...required, ...optional]);
    let keys;
    try {
      keys = Object.keys(value);
    } catch {
      return false;
    }
    try {
      return required.every((key) => Object.prototype.hasOwnProperty.call(value, key))
        && keys.every((key) => allowed.has(key));
    } catch {
      return false;
    }
  }

  function isValidName(value) {
    return typeof value === "string"
      && value.length > 0
      && value.length <= IPC_MAX_NAME_LENGTH
      && IPC_NAME_PATTERN.test(value);
  }

  function safeEntries(value) {
    try {
      return Object.entries(value);
    } catch {
      return undefined;
    }
  }

  function safeArrayValues(value) {
    const values = [];
    try {
      const length = value.length;
      if (!Number.isSafeInteger(length) || length > IPC_MAX_NODES) {
        return undefined;
      }
      for (let index = 0; index < length; index += 1) {
        values.push(value[index]);
      }
    } catch {
      return undefined;
    }
    return values;
  }

  function isSafePayload(value) {
    const stack = [{ value, depth: 0 }];
    let nodes = 0;
    while (stack.length > 0) {
      const current = stack.pop();
      nodes += 1;
      if (nodes > IPC_MAX_NODES || current.depth > IPC_MAX_DEPTH) return false;
      const type = typeof current.value;
      if (current.value === null || type === "string" || type === "boolean") continue;
      if (type === "number") {
        if (!Number.isFinite(current.value)) return false;
        continue;
      }
      if (type !== "object") return false;
      const isArray = safeIsArray(current.value);
      if (isArray === undefined) return false;
      if (isArray) {
        const values = safeArrayValues(current.value);
        if (!values) return false;
        for (const child of values) stack.push({ value: child, depth: current.depth + 1 });
        continue;
      }
      if (!isPlainObject(current.value)) return false;
      const entries = safeEntries(current.value);
      if (!entries) return false;
      for (const [key, child] of entries) {
        if (DANGEROUS_KEYS.has(key)) return false;
        stack.push({ value: child, depth: current.depth + 1 });
      }
    }
    return true;
  }

  function serializedByteLength(value) {
    if (!isSafePayload(value)) return Infinity;
    let serialized;
    try {
      serialized = JSON.stringify(value);
    } catch {
      return Infinity;
    }
    let bytes = 0;
    for (let index = 0; index < serialized.length; index += 1) {
      const code = serialized.charCodeAt(index);
      if (code < 0x80) bytes += 1;
      else if (code < 0x800) bytes += 2;
      else if (code >= 0xd800 && code <= 0xdbff
          && index + 1 < serialized.length
          && serialized.charCodeAt(index + 1) >= 0xdc00
          && serialized.charCodeAt(index + 1) <= 0xdfff) {
        bytes += 4;
        index += 1;
      } else bytes += 3;
    }
    return bytes;
  }

  function receive(data) {
    let eventName;
    let eventPayload;
    try {
      if (!isPlainObject(data) || data.version !== IPC_VERSION || !isSafePayload(data)) return;

      if (data.type === "response") {
        const valid = data.ok === true
          ? hasExactKeys(data, ["version", "type", "id", "ok"], ["result"])
          : data.ok === false
            && hasExactKeys(data, ["version", "type", "id", "ok", "error"])
            && typeof data.error === "string";
        if (!valid || !Number.isSafeInteger(data.id) || data.id <= 0) return;
        const request = pending.get(data.id);
        if (!request) return;
        pending.delete(data.id);
        clearTimeout(request.timeout);
        data.ok ? request.resolve(data.result) : request.reject(new Error(data.error));
      } else if (data.type === "event") {
        if (!hasExactKeys(data, ["version", "type", "event"], ["payload"])
            || !isValidName(data.event)) return;
        eventName = data.event;
        eventPayload = data.payload;
      }
    } catch {
      return;
    }
    if (eventName !== undefined) dispatch(eventName, eventPayload);
  }

  const transport = webView2 ? {
    listen(handler) {
      webView2.addEventListener("message", ({ data }) => handler(data));
    },
    post(message) {
      webView2.postMessage(message);
    }
  } : webKit ? {
    listen(handler) {
      Object.defineProperty(window, "__nodeviewReceive", {
        value: handler,
        configurable: false,
        writable: false
      });
    },
    post(message) {
      webKit.postMessage(message);
    }
  } : null;

  if (!transport) {
    throw new Error("NodeViewJS native bridge transport is unavailable.");
  }

  function requireEventName(eventName, method) {
    if (typeof eventName !== "string" || eventName.length === 0) {
      throw new TypeError(`NodeViewJS.${method} requires a non-empty event name.`);
    }
    if (!isValidName(eventName)) {
      throw new TypeError(`NodeViewJS.${method} received an invalid event name.`);
    }
  }

  function dispatch(eventName, payload) {
    for (const handler of [...listeners.get(eventName) || []]) handler(payload);
  }

  transport.listen(receive);

  const api = Object.freeze({
    invoke(command, payload) {
      if (typeof command !== "string" || command.length === 0) {
        return Promise.reject(new TypeError("NodeViewJS.invoke requires a non-empty command name."));
      }
      if (!isValidName(command)) {
        return Promise.reject(new TypeError("NodeViewJS.invoke received an invalid command name."));
      }
      if (pending.size >= IPC_MAX_PENDING_REQUESTS) {
        return Promise.reject(new Error("Too many pending NodeViewJS IPC requests."));
      }
      const id = nextId++;
      if (nextId >= Number.MAX_SAFE_INTEGER) nextId = createInitialRequestId();
      const message = { version: IPC_VERSION, type: "invoke", id, command };
      if (payload !== undefined) message.payload = payload;
      if (serializedByteLength(message) > IPC_MAX_SERIALIZED_BYTES) {
        return Promise.reject(new RangeError("NodeViewJS IPC message exceeds the size or complexity limit."));
      }
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`NodeViewJS IPC request timed out after ${IPC_REQUEST_TIMEOUT_MS}ms.`));
        }, IPC_REQUEST_TIMEOUT_MS);
        pending.set(id, { resolve, reject, timeout });
        try {
          transport.post(message);
        } catch (error) {
          clearTimeout(timeout);
          pending.delete(id);
          reject(error);
        }
      });
    },
    on(eventName, handler) {
      requireEventName(eventName, "on");
      if (typeof handler !== "function") throw new TypeError("NodeViewJS.on requires a function.");
      const handlers = listeners.get(eventName) || new Set();
      handlers.add(handler);
      listeners.set(eventName, handlers);
      return () => handlers.delete(handler);
    },
    once(eventName, handler) {
      requireEventName(eventName, "once");
      if (typeof handler !== "function") throw new TypeError("NodeViewJS.once requires a function.");
      const off = this.on(eventName, (payload) => {
        off();
        handler(payload);
      });
      return off;
    },
    off(eventName, handler) {
      requireEventName(eventName, "off");
      if (typeof handler !== "function") throw new TypeError("NodeViewJS.off requires a function.");
      const handlers = listeners.get(eventName);
      if (!handlers) return;
      handlers.delete(handler);
      if (handlers.size === 0) listeners.delete(eventName);
    },
    emit(eventName, payload) {
      requireEventName(eventName, "emit");
      const message = { version: IPC_VERSION, type: "event", event: eventName };
      if (payload !== undefined) message.payload = payload;
      if (serializedByteLength(message) > IPC_MAX_SERIALIZED_BYTES) {
        throw new RangeError("NodeViewJS IPC message exceeds the size or complexity limit.");
      }
      transport.post(message);
    }
  });

  Object.defineProperty(window, "NodeViewJS", {
    value: api,
    configurable: false,
    writable: false
  });

  Object.defineProperty(window, "NodeView", {
    value: api,
    configurable: false,
    writable: false
  });
})();
