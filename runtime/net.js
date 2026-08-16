"use strict";

// Outbound HTTP for backend commands. Every value here can originate in the
// WebView, so the request is validated before it reaches the network and the
// response is bounded before it reaches the frontend.

const { assertDenseArray } = require("./validation");

const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001F\u007F]/;
const HEADER_NAME_PATTERN = /^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/;
const METHODS = new Set(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"]);

// Headers the caller must not control: they are set by the transport, carry
// ambient credentials, or let a frontend reshape the request framing.
const FORBIDDEN_HEADERS = new Set([
  "host", "connection", "content-length", "transfer-encoding", "upgrade",
  "keep-alive", "te", "trailer", "proxy-authorization", "cookie", "cookie2",
  "expect"
]);

const MAX_ORIGINS = 32;
const MAX_URL_LENGTH = 2048;
const MAX_HEADER_COUNT = 32;
const MAX_HEADER_NAME_LENGTH = 128;
const MAX_HEADER_VALUE_LENGTH = 2048;
const MAX_REQUEST_BODY_BYTES = 1024 * 1024;
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const MAX_REDIRECTS = 3;
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 120_000;

function assertPlainObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
}

function parseUrl(value, label) {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }
  if (value.length > MAX_URL_LENGTH) {
    throw new TypeError(`${label} must be at most ${MAX_URL_LENGTH} characters.`);
  }
  if (value.trim() !== value || CONTROL_CHARACTER_PATTERN.test(value)) {
    throw new TypeError(`${label} must not contain surrounding or control whitespace.`);
  }
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new TypeError(`${label} must be an absolute URL.`);
  }
  if (url.username || url.password) {
    throw new TypeError(`${label} must not contain credentials.`);
  }
  return url;
}

// Accepts an origin such as "https://api.example.com", "http://localhost:3000",
// or "http://192.168.1.50:8080". Listing an origin is the deliberate act that
// grants it, so http and private addresses are permitted here; the allowlist
// itself is the control, including for every redirect hop.
function normalizeOrigin(value) {
  const url = parseUrl(value, "Allowed origin");
  // Protocol first: an unusable scheme is the more fundamental problem, and
  // reporting a path error for "file:///etc/passwd" would be misleading.
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new TypeError(`Allowed origin must use http or https: ${value}`);
  }
  if (url.pathname !== "/" || url.search || url.hash) {
    throw new TypeError(`Allowed origin must not contain a path, query, or fragment: ${value}`);
  }
  return url.origin;
}

function normalizeAllowedOrigins(value) {
  if (value === undefined || value === null) return Object.freeze([]);
  if (!Array.isArray(value)) {
    throw new TypeError("allowedOrigins must be an array of origin strings.");
  }
  if (value.length > MAX_ORIGINS) {
    throw new RangeError(`allowedOrigins must contain at most ${MAX_ORIGINS} entries.`);
  }
  // map() skips holes, so a sparse array would put unvalidated entries into the
  // allowlist that guards every outbound request.
  assertDenseArray(value, "allowedOrigins");
  const origins = value.map(normalizeOrigin);
  return Object.freeze([...new Set(origins)]);
}

function assertOriginAllowed(url, allowedOrigins, label) {
  if (allowedOrigins.length === 0) {
    throw new Error("No allowed origins are configured for this application.");
  }
  if (!allowedOrigins.includes(url.origin)) {
    throw new Error(`${label} origin is not allowed: ${url.origin}`);
  }
}

function normalizeMethod(value) {
  if (value === undefined) return "GET";
  if (typeof value !== "string") {
    throw new TypeError("Request method must be a string.");
  }
  const method = value.toUpperCase();
  if (!METHODS.has(method)) {
    throw new TypeError(`Unsupported request method: ${value}`);
  }
  return method;
}

function normalizeHeaders(value) {
  if (value === undefined || value === null) return {};
  assertPlainObject(value, "Request headers");
  const entries = Object.entries(value);
  if (entries.length > MAX_HEADER_COUNT) {
    throw new RangeError(`Request headers must contain at most ${MAX_HEADER_COUNT} entries.`);
  }
  const headers = {};
  for (const [name, headerValue] of entries) {
    if (name.length > MAX_HEADER_NAME_LENGTH || !HEADER_NAME_PATTERN.test(name)) {
      throw new TypeError(`Unsupported request header name: ${name}`);
    }
    if (FORBIDDEN_HEADERS.has(name.toLowerCase())) {
      throw new TypeError(`Request header may not be set by the caller: ${name}`);
    }
    if (typeof headerValue !== "string") {
      throw new TypeError(`Request header ${name} must be a string.`);
    }
    if (headerValue.length > MAX_HEADER_VALUE_LENGTH) {
      throw new RangeError(`Request header ${name} exceeds ${MAX_HEADER_VALUE_LENGTH} characters.`);
    }
    if (CONTROL_CHARACTER_PATTERN.test(headerValue)) {
      throw new TypeError(`Request header ${name} must not contain control characters.`);
    }
    headers[name] = headerValue;
  }
  return headers;
}

function normalizeBody(value, method) {
  if (value === undefined || value === null) return undefined;
  if (method === "GET" || method === "HEAD") {
    throw new TypeError(`A ${method} request must not include a body.`);
  }
  if (typeof value !== "string") {
    throw new TypeError("Request body must be a string. Serialize objects before sending them.");
  }
  if (Buffer.byteLength(value, "utf8") > MAX_REQUEST_BODY_BYTES) {
    throw new RangeError(`Request body exceeds ${MAX_REQUEST_BODY_BYTES} bytes.`);
  }
  return value;
}

function normalizeTimeout(value) {
  if (value === undefined) return DEFAULT_TIMEOUT_MS;
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_TIMEOUT_MS) {
    throw new RangeError(`Request timeoutMs must be an integer between 1 and ${MAX_TIMEOUT_MS}.`);
  }
  return value;
}

function normalizeMaxResponseBytes(value) {
  if (value === undefined) return MAX_RESPONSE_BYTES;
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_RESPONSE_BYTES) {
    throw new RangeError(`Request maxResponseBytes must be an integer between 1 and ${MAX_RESPONSE_BYTES}.`);
  }
  return value;
}

// Reads the body with an explicit byte ceiling rather than trusting
// content-length, which the server controls.
async function readBoundedText(response, maxBytes) {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        throw new RangeError(`Response exceeded ${maxBytes} bytes.`);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock?.();
  }
  return Buffer.concat(chunks.map((c) => Buffer.from(c))).toString("utf8");
}

function collectResponseHeaders(response) {
  const headers = {};
  for (const [name, value] of response.headers) {
    if (name.toLowerCase() === "set-cookie") continue; // never surface to the frontend
    headers[name] = value;
  }
  return headers;
}

async function request(options = {}) {
  assertPlainObject(options, "Request options");

  const allowedOrigins = normalizeAllowedOrigins(options.allowedOrigins);
  const method = normalizeMethod(options.method);
  const headers = normalizeHeaders(options.headers);
  const body = normalizeBody(options.body, method);
  const timeoutMs = normalizeTimeout(options.timeoutMs);
  const maxResponseBytes = normalizeMaxResponseBytes(options.maxResponseBytes);

  let url = parseUrl(options.url, "Request url");
  assertOriginAllowed(url, allowedOrigins, "Request");

  const fetchImpl = options.fetch ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    throw new Error("Global fetch is unavailable in this Node.js runtime.");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref?.();

  try {
    for (let redirects = 0; ; redirects += 1) {
      const response = await fetchImpl(url.href, {
        method,
        headers,
        body,
        redirect: "manual",
        signal: controller.signal
      });

      // Redirects are resolved here so each hop is re-checked against the
      // allowlist. Following them automatically would let an allowed origin
      // hand the request to any other host.
      if (response.status >= 300 && response.status <= 399 && response.headers.get("location")) {
        if (redirects >= MAX_REDIRECTS) {
          throw new Error(`Request exceeded ${MAX_REDIRECTS} redirects.`);
        }
        const next = new URL(response.headers.get("location"), url.href);
        url = parseUrl(next.href, "Redirect target");
        assertOriginAllowed(url, allowedOrigins, "Redirect target");
        continue;
      }

      return {
        url: url.href,
        status: response.status,
        ok: response.ok,
        headers: collectResponseHeaders(response),
        body: await readBoundedText(response, maxResponseBytes)
      };
    }
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error(`Request timed out after ${timeoutMs}ms.`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = {
  MAX_REDIRECTS,
  MAX_REQUEST_BODY_BYTES,
  MAX_RESPONSE_BYTES,
  MAX_URL_LENGTH,
  normalizeAllowedOrigins,
  request
};
