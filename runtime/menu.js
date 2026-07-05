"use strict";

const MENU_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/;
const MAX_MENU_ITEMS = 256;
const MAX_MENU_DEPTH = 8;
const NAMED_KEYS = new Map([
  ["backspace", [0x08, "Backspace"]],
  ["tab", [0x09, "Tab"]],
  ["enter", [0x0d, "Enter"]],
  ["escape", [0x1b, "Escape"]],
  ["space", [0x20, "Space"]],
  ["pageup", [0x21, "PageUp"]],
  ["pagedown", [0x22, "PageDown"]],
  ["end", [0x23, "End"]],
  ["home", [0x24, "Home"]],
  ["left", [0x25, "Left"]],
  ["up", [0x26, "Up"]],
  ["right", [0x27, "Right"]],
  ["down", [0x28, "Down"]],
  ["insert", [0x2d, "Insert"]],
  ["delete", [0x2e, "Delete"]]
]);

function normalizeAccelerator(value) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError("Menu accelerator must be a non-empty string.");
  }
  const parts = value.split("+").map((part) => part.trim()).filter(Boolean);
  const modifiers = new Set();
  let key;

  for (const part of parts) {
    const token = part.toLowerCase();
    const modifier = token === "control" ? "ctrl" : token;
    if (["ctrl", "alt", "shift"].includes(modifier)) {
      if (modifiers.has(modifier)) throw new TypeError(`Duplicate accelerator modifier: ${part}`);
      modifiers.add(modifier);
      continue;
    }
    if (key) throw new TypeError(`Menu accelerator must contain one key: ${value}`);
    if (/^[a-z]$/i.test(part)) {
      key = { keyCode: part.toUpperCase().charCodeAt(0), display: part.toUpperCase() };
    } else if (/^[0-9]$/.test(part)) {
      key = { keyCode: part.charCodeAt(0), display: part };
    } else if (/^f(?:[1-9]|1[0-9]|2[0-4])$/i.test(part)) {
      const number = Number(part.slice(1));
      key = { keyCode: 0x70 + number - 1, display: `F${number}` };
    } else if (NAMED_KEYS.has(token)) {
      const [keyCode, display] = NAMED_KEYS.get(token);
      key = { keyCode, display };
    } else {
      throw new TypeError(`Unsupported menu accelerator key: ${part}`);
    }
  }
  if (!key) throw new TypeError(`Menu accelerator is missing a key: ${value}`);
  if (modifiers.size === 0 && /^[A-Z0-9]$/.test(key.display)) {
    throw new TypeError("Letter and number accelerators require Ctrl, Alt, or Shift.");
  }

  const ordered = ["ctrl", "alt", "shift"].filter((modifier) => modifiers.has(modifier));
  const names = { ctrl: "Ctrl", alt: "Alt", shift: "Shift" };
  return Object.freeze({
    display: [...ordered.map((modifier) => names[modifier]), key.display].join("+"),
    keyCode: key.keyCode,
    ctrl: modifiers.has("ctrl"),
    alt: modifiers.has("alt"),
    shift: modifiers.has("shift")
  });
}

function normalizeMenuTemplate(value, { allowNull = false } = {}) {
  if (allowNull && value === null) return null;
  if (!Array.isArray(value)) throw new TypeError("Menu template must be an array.");
  if (value.length === 0) throw new TypeError("Menu template must contain at least one item.");
  const ids = new Set();
  const accelerators = new Set();
  const state = { count: 0 };

  function visit(items, depth) {
    if (depth > MAX_MENU_DEPTH) throw new RangeError(`Menu nesting cannot exceed ${MAX_MENU_DEPTH} levels.`);
    return items.map((item) => {
      state.count += 1;
      if (state.count > MAX_MENU_ITEMS) {
        throw new RangeError(`Menu templates cannot contain more than ${MAX_MENU_ITEMS} items.`);
      }
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        throw new TypeError("Each menu item must be an object.");
      }
      const allowed = ["id", "label", "type", "enabled", "checked", "accelerator", "submenu"];
      const unknown = Object.keys(item).find((key) => !allowed.includes(key));
      if (unknown) throw new TypeError(`Unsupported menu item option: ${unknown}`);

      const type = item.type ?? (item.submenu === undefined ? "normal" : "submenu");
      if (!["normal", "checkbox", "separator", "submenu"].includes(type)) {
        throw new TypeError(`Unsupported menu item type: ${String(type)}`);
      }
      if (type === "separator") {
        if (Object.keys(item).some((key) => key !== "type")) {
          throw new TypeError("Separator menu items cannot have additional options.");
        }
        return Object.freeze({ type: "separator" });
      }

      if (typeof item.label !== "string" || item.label.trim().length === 0 ||
          item.label.length > 100 || /[\r\n\t]/.test(item.label)) {
        throw new TypeError("Menu item label must be between 1 and 100 characters without tabs or newlines.");
      }
      if (item.enabled !== undefined && typeof item.enabled !== "boolean") {
        throw new TypeError("Menu item enabled must be a boolean.");
      }

      if (type === "submenu") {
        if (!Array.isArray(item.submenu) || item.submenu.length === 0) {
          throw new TypeError("Submenu items require a non-empty submenu array.");
        }
        if (item.id !== undefined || item.accelerator !== undefined || item.checked !== undefined) {
          throw new TypeError("Submenu items cannot have id, accelerator, or checked options.");
        }
        return Object.freeze({
          type,
          label: item.label.trim(),
          enabled: item.enabled ?? true,
          submenu: Object.freeze(visit(item.submenu, depth + 1))
        });
      }

      if (typeof item.id !== "string" || !MENU_ID_PATTERN.test(item.id)) {
        throw new TypeError("Command menu items require a valid id.");
      }
      if (ids.has(item.id)) throw new TypeError(`Duplicate menu item id: ${item.id}`);
      ids.add(item.id);
      if (item.submenu !== undefined) throw new TypeError("Command menu items cannot have a submenu.");
      if (item.checked !== undefined && type !== "checkbox") {
        throw new TypeError("Only checkbox menu items can use checked.");
      }
      if (item.checked !== undefined && typeof item.checked !== "boolean") {
        throw new TypeError("Menu item checked must be a boolean.");
      }

      const accelerator = item.accelerator === undefined
        ? undefined
        : normalizeAccelerator(item.accelerator);
      if (accelerator) {
        if (accelerators.has(accelerator.display)) {
          throw new TypeError(`Duplicate menu accelerator: ${accelerator.display}`);
        }
        accelerators.add(accelerator.display);
      }
      return Object.freeze({
        type,
        id: item.id,
        label: item.label.trim(),
        enabled: item.enabled ?? true,
        checked: type === "checkbox" ? item.checked ?? false : false,
        accelerator
      });
    });
  }

  return Object.freeze(visit(value, 1));
}

function normalizeContextPosition(value = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Context menu position must be an object.");
  }
  const unknown = Object.keys(value).find((key) => !["x", "y"].includes(key));
  if (unknown) throw new TypeError(`Unsupported context menu position option: ${unknown}`);
  const hasX = value.x !== undefined;
  const hasY = value.y !== undefined;
  if (hasX !== hasY) throw new TypeError("Context menu position requires both x and y.");
  if (!hasX) return Object.freeze({});
  for (const [name, coordinate] of [["x", value.x], ["y", value.y]]) {
    if (!Number.isInteger(coordinate) || coordinate < -32768 || coordinate > 32767) {
      throw new RangeError(`Context menu ${name} must be an integer between -32768 and 32767.`);
    }
  }
  return Object.freeze({ x: value.x, y: value.y });
}

function normalizeTrayMenuTemplate(value, { allowNull = false } = {}) {
  const template = normalizeMenuTemplate(value, { allowNull });
  if (template === null) return null;

  function rejectAccelerators(items) {
    for (const item of items) {
      if (item.accelerator !== undefined) {
        throw new TypeError("Tray menu items cannot use accelerators.");
      }
      if (item.submenu) rejectAccelerators(item.submenu);
    }
  }

  rejectAccelerators(template);
  return template;
}

module.exports = {
  normalizeAccelerator,
  normalizeContextPosition,
  normalizeMenuTemplate,
  normalizeTrayMenuTemplate
};
