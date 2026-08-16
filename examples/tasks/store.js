"use strict";

// The application's data layer, deliberately separate from NodeViewJS: it knows
// nothing about windows or IPC, so it can be tested on its own and reasoned
// about without a running app. Command handlers validate at the boundary and
// then call into this.

const crypto = require("node:crypto");

const { config } = require("nodeviewjs");

const MAX_TITLE_LENGTH = 200;
const MAX_TASKS = 500;
const CONTROL_CHARACTERS = /[\u0000-\u001F\u007F]/;

function storeOptions(options = {}) {
  return {
    appName: options.appName ?? "NodeViewJS Tasks",
    fileName: options.fileName ?? "tasks.json",
    ...(options.directory ? { directory: options.directory } : {})
  };
}

// Validation lives here rather than in the page, because the page is untrusted
// and a command handler is the last place a value can be checked.
function normalizeTitle(value) {
  if (typeof value !== "string") {
    throw new TypeError("A task title must be a string.");
  }
  const title = value.trim();
  if (title.length === 0) {
    throw new TypeError("A task title cannot be empty.");
  }
  if (title.length > MAX_TITLE_LENGTH) {
    throw new RangeError(`A task title cannot exceed ${MAX_TITLE_LENGTH} characters.`);
  }
  if (CONTROL_CHARACTERS.test(title)) {
    throw new TypeError("A task title cannot contain control characters.");
  }
  return title;
}

function normalizeId(value) {
  if (typeof value !== "string" || !/^[0-9a-f-]{36}$/.test(value)) {
    throw new TypeError("A task id must be one this application issued.");
  }
  return value;
}

// Anything read back from disk is treated as untrusted: the file is editable by
// the user and by anything else running as them.
function normalizeStoredTask(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  if (typeof value.id !== "string" || !/^[0-9a-f-]{36}$/.test(value.id)) return undefined;
  if (typeof value.title !== "string") return undefined;
  const title = value.title.slice(0, MAX_TITLE_LENGTH);
  if (title.trim().length === 0 || CONTROL_CHARACTERS.test(title)) return undefined;
  return {
    id: value.id,
    title,
    done: value.done === true,
    createdAt: typeof value.createdAt === "string" ? value.createdAt : new Date(0).toISOString()
  };
}

async function read(options) {
  const stored = await config.read({ ...storeOptions(options), defaults: { tasks: [] } });
  const tasks = Array.isArray(stored?.tasks) ? stored.tasks : [];
  return tasks
    .map(normalizeStoredTask)
    .filter((task) => task !== undefined)
    .slice(0, MAX_TASKS);
}

async function write(tasks, options) {
  await config.write({ ...storeOptions(options), data: { tasks } });
  return tasks;
}

async function add(title, options) {
  const tasks = await read(options);
  if (tasks.length >= MAX_TASKS) {
    throw new RangeError(`This list is limited to ${MAX_TASKS} tasks.`);
  }
  const task = {
    id: crypto.randomUUID(),
    title: normalizeTitle(title),
    done: false,
    createdAt: new Date().toISOString()
  };
  await write([...tasks, task], options);
  return task;
}

async function toggle(id, options) {
  const wanted = normalizeId(id);
  const tasks = await read(options);
  const task = tasks.find((candidate) => candidate.id === wanted);
  if (!task) throw new Error("That task no longer exists.");
  const updated = tasks.map((candidate) => (
    candidate.id === wanted ? { ...candidate, done: !candidate.done } : candidate
  ));
  await write(updated, options);
  return updated.find((candidate) => candidate.id === wanted);
}

async function remove(id, options) {
  const wanted = normalizeId(id);
  const tasks = await read(options);
  if (!tasks.some((candidate) => candidate.id === wanted)) {
    throw new Error("That task no longer exists.");
  }
  await write(tasks.filter((candidate) => candidate.id !== wanted), options);
  return { removed: wanted };
}

module.exports = { MAX_TASKS, MAX_TITLE_LENGTH, add, read, remove, toggle, write };
