"use strict";

// Shared validation helpers for the option and manifest boundaries. Both
// properties enforced here are checked by test/fuzz-boundaries.js.

// Error messages quote the value they rejected, which is how a developer finds
// the offending option. The quote has to be bounded and non-throwing: the value
// is untrusted, it may be enormous, and converting it to a string can itself
// throw.
const MAX_DIAGNOSTIC_LENGTH = 120;

function safeDiagnosticString(value) {
  let text;
  try {
    text = String(value);
  } catch {
    return "<unprintable>";
  }
  return text.length > MAX_DIAGNOSTIC_LENGTH
    ? `${text.slice(0, MAX_DIAGNOSTIC_LENGTH)}... (${text.length} characters)`
    : text;
}

// Array.prototype.map and forEach skip holes, so a sparse array walks straight
// through a per-item validator without any item being checked. Reject the hole
// instead of guessing what the caller meant by it.
function assertDenseArray(value, label) {
  if (!Array.isArray(value)) {
    throw new TypeError(`${label} must be an array.`);
  }
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) {
      throw new TypeError(`${label} must not contain empty items.`);
    }
  }
  return value;
}

module.exports = { MAX_DIAGNOSTIC_LENGTH, assertDenseArray, safeDiagnosticString };
