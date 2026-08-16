// Type declarations for the NodeViewJS public API.
//
// Stability: everything exported from "nodeviewjs" is public API. The `ipc`
// member (also reachable as "nodeviewjs/ipc") is advanced API: it exposes the
// wire protocol between the backend and the page, and its message shapes may
// change with the protocol version.

/// <reference types="node" />

import { EventEmitter } from "node:events";

export type CommandPermission =
  | "fs:read"
  | "fs:write"
  | "dialog:open"
  | "dialog:save"
  | "clipboard:read"
  | "clipboard:write"
  | "shell:open"
  | "notification:show"
  | "window:control"
  | "net:fetch";

/** A bare permission, a scoped permission (`fs:read:config`), or a group (`fs:*`). */
export type PermissionGrant = CommandPermission | (string & {});

export interface PermissionPolicy {
  allow?: readonly PermissionGrant[];
  deny?: readonly PermissionGrant[];
}

export interface MenuItem {
  label?: string;
  id?: string;
  type?: "normal" | "separator" | "checkbox" | "submenu";
  accelerator?: string;
  checked?: boolean;
  enabled?: boolean;
  submenu?: readonly MenuItem[];
}

export interface WindowColors {
  titleBar?: string;
  titleText?: string;
  border?: string;
}

export interface TrayOptions {
  title?: string;
  icon?: string;
  menu?: readonly MenuItem[] | null;
}

export interface NotificationOptions {
  title?: string;
  message: string;
}

export interface WindowOptions {
  /** Absolute or relative path to the HTML entry file. Required. */
  entry?: string;
  title?: string;
  appId?: string;
  icon?: string;
  width?: number;
  height?: number;
  minWidth?: number;
  minHeight?: number;
  maxWidth?: number;
  maxHeight?: number;
  resizable?: boolean;
  frame?: boolean;
  closable?: boolean;
  minimizable?: boolean;
  maximizable?: boolean;
  maximized?: boolean;
  center?: boolean;
  alwaysOnTop?: boolean;
  closeToHide?: boolean;
  transparent?: boolean;
  windowColors?: WindowColors;
  devtools?: boolean;
  startupTiming?: boolean;
  singleInstance?: boolean;
  permissions?: readonly PermissionGrant[] | PermissionPolicy;
  allowedOrigins?: readonly string[];
  menu?: readonly MenuItem[] | null;
  tray?: TrayOptions | boolean;
}

export interface ProtocolDefinition {
  scheme: string;
  name?: string;
}

export interface FileAssociationDefinition {
  extension: string;
  name?: string;
  description?: string;
}

export interface AppOptions extends WindowOptions {
  entry: string;
  protocols?: readonly (string | ProtocolDefinition)[];
  fileAssociations?: readonly (string | FileAssociationDefinition)[];
}

export interface CommandOptions {
  permission?: PermissionGrant;
  permissions?: readonly PermissionGrant[];
  scope?: string;
}

export type CommandHandler = (payload?: unknown) => unknown;

export type EventHandler = (payload?: any) => unknown;

/** Removes the handler. Calling it more than once is harmless. */
export type Unsubscribe = () => void;

export interface WindowState {
  isOpen: boolean;
  [key: string]: unknown;
}

/**
 * Where a window is in its lifecycle.
 *
 * - `configured`: created but never opened; still reopenable by `app.run()`.
 * - `open`: a native window exists.
 * - `closed`: closed before the app started running, so a startup retry can
 *   reopen it.
 * - `disposed`: closed while the app was running. The window has been removed
 *   from `app.windows`, its handlers are released, and it cannot reopen.
 */
export type WindowLifecycleState = "configured" | "open" | "closed" | "disposed";

export interface MenuEventPayload {
  id: string;
  checked?: boolean;
  window: AppWindow;
}

export interface SecondInstancePayload {
  args: string[];
  cwd: string;
}

export interface OpenUrlPayload {
  url: string;
  initial: boolean;
}

export interface OpenFilePayload {
  path: string;
  initial: boolean;
}

export class AppWindow {
  readonly options: WindowOptions;
  /** Native window id while open, otherwise `undefined`. */
  readonly id: number | undefined;
  readonly isOpen: boolean;
  readonly isClosed: boolean;
  readonly lifecycleState: WindowLifecycleState;

  on(eventName: string, handler: EventHandler): Unsubscribe;
  once(eventName: string, handler: EventHandler): Unsubscribe;
  off(eventName: string, handler: EventHandler): this;
  /** Sends an event to this window's page. Throws once the window is closed. */
  emit(eventName: string, payload?: unknown): this;

  show(): this;
  hide(): this;
  close(): this;
  reload(): this;
  minimize(): this;
  maximize(): this;
  restore(): this;
  setFullscreen(fullscreen?: boolean): this;
  setTitle(title: string): this;
  setSize(width: number, height: number): this;
  setPosition(x: number, y: number): this;
  startDrag(): this;
  getState(): WindowState;
  setMenu(template: readonly MenuItem[] | null): this;
  showContextMenu(template: readonly MenuItem[], position?: { x?: number; y?: number }): this;
  setTaskbarProgress(value: number, state?: "normal" | "paused" | "error" | "indeterminate"): this;
  setTaskbarOverlay(icon: string, description?: string): this;
  requestAttention(type?: "informational" | "critical" | "stop"): this;
  setWindowColors(colors?: WindowColors): this;
  showNotification(options: NotificationOptions): this;
  setTray(options?: TrayOptions | boolean): this;
}

export interface PluginContext {
  readonly name: string;
  readonly version: string;
  readonly appId: string;
  readonly permissions: readonly PermissionGrant[];
  command(name: string, handler: CommandHandler): PluginContext;
  command(name: string, options: CommandOptions, handler: CommandHandler): PluginContext;
  on(name: string, handler: EventHandler): Unsubscribe;
  once(name: string, handler: EventHandler): Unsubscribe;
  emit(name: string, payload?: unknown): PluginContext;
}

export interface Plugin {
  name: string;
  version?: string;
  permissions?: readonly PermissionGrant[];
  setup?(context: PluginContext, options: Readonly<Record<string, unknown>>): void | (() => void);
  start?(context: PluginContext): void;
  stop?(context: PluginContext): void;
}

export interface PluginMetadata {
  readonly name: string;
  readonly version: string;
  readonly permissions: readonly PermissionGrant[];
}

export interface FetchOptions {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
  maxResponseBytes?: number;
}

export interface FetchResult {
  url: string;
  status: number;
  ok: boolean;
  headers: Record<string, string>;
  body: string;
}

export class App {
  constructor(options: AppOptions);

  readonly options: WindowOptions;
  readonly mainWindow: AppWindow;
  /** The windows the app currently owns. Disposed windows are not listed. */
  readonly windows: AppWindow[];
  readonly plugins: PluginMetadata[];
  readonly logPath: string;

  createWindow(options?: WindowOptions): AppWindow;
  use(plugin: Plugin, options?: Record<string, unknown>): this;
  command(name: string, handler: CommandHandler): this;
  command(name: string, options: CommandOptions, handler: CommandHandler): this;

  on(eventName: "menu", handler: (payload: MenuEventPayload) => unknown): Unsubscribe;
  on(eventName: "tray-menu", handler: (payload: MenuEventPayload) => unknown): Unsubscribe;
  on(eventName: "second-instance", handler: (payload: SecondInstancePayload) => unknown): Unsubscribe;
  on(eventName: "open-url", handler: (payload: OpenUrlPayload) => unknown): Unsubscribe;
  on(eventName: "open-file", handler: (payload: OpenFilePayload) => unknown): Unsubscribe;
  on(eventName: string, handler: EventHandler): Unsubscribe;
  once(eventName: string, handler: EventHandler): Unsubscribe;
  off(eventName: string, handler: EventHandler): this;
  /** Broadcasts an event to every live window. */
  emit(eventName: string, payload?: unknown): this;

  /** Returns false when another instance owns the single-instance lock. */
  run(): boolean;
  quit(): void;
  show(): this;
  hide(): this;
  /** Performs a validated outbound request against this app's allowedOrigins. */
  fetch(options: FetchOptions): Promise<FetchResult>;
  setTray(options?: TrayOptions | boolean): this;
  setMenu(template: readonly MenuItem[] | null): this;
  setWindowColors(colors?: WindowColors): this;
  setTaskbarProgress(value: number, state?: "normal" | "paused" | "error" | "indeterminate"): this;
  setTaskbarOverlay(icon: string, description?: string): this;
  requestAttention(type?: "informational" | "critical" | "stop"): this;
  showNotification(options: NotificationOptions): this;
}

export interface UpdateManifest {
  schemaVersion: number;
  appId: string;
  version: string;
  url: string;
  size: number;
  sha256: string;
  signature: string;
  notes?: string;
}

export interface DownloadedUpdate {
  update: UpdateManifest;
  path: string;
}

export interface UpdaterOptions {
  appId: string;
  currentVersion: string;
  manifestUrl: string;
  publicKey: string;
  maxDownloadBytes?: number;
  stagingDirectory?: string;
  restartExecutable?: string;
}

export class Updater extends EventEmitter {
  constructor(options: UpdaterOptions);

  readonly appId: string;
  readonly currentVersion: string;
  readonly manifestUrl: string;
  readonly maxDownloadBytes: number;
  readonly stagingDirectory: string;
  readonly restartExecutable: string | undefined;

  /** Resolves with the available update, or null when already up to date. */
  checkForUpdates(): Promise<UpdateManifest | null>;
  downloadUpdate(update: UpdateManifest): Promise<DownloadedUpdate>;
  installAndRestart(app?: App): Promise<void>;
}

export interface ConfigOptions {
  appName?: string;
  directory?: string;
  fileName?: string;
}

export declare const config: {
  read<T = Record<string, unknown>>(options?: ConfigOptions & { defaults?: T }): Promise<T>;
  write<T = unknown>(options: ConfigOptions & { data: T }): Promise<T>;
  resolveConfigDirectory(options?: ConfigOptions): string;
  resolveConfigPath(options?: ConfigOptions): string;
};

export declare const clipboard: {
  readText(): string;
  writeText(value: string): boolean;
};

export declare const dialog: {
  message(options: { title?: string; message: string }): void;
  openFile(): string | undefined;
  saveFile(): string | undefined;
};

export declare const notification: {
  show(options: NotificationOptions): void;
  normalizeNotificationOptions(options: NotificationOptions): Readonly<NotificationOptions>;
};

export declare const shell: {
  openExternal(url: string): boolean;
  openPath(target: string): boolean;
};

export interface NetRequestOptions extends FetchOptions {
  allowedOrigins?: readonly string[];
  fetch?: typeof globalThis.fetch;
}

export declare const net: {
  readonly MAX_REDIRECTS: number;
  readonly MAX_REQUEST_BODY_BYTES: number;
  readonly MAX_RESPONSE_BYTES: number;
  readonly MAX_URL_LENGTH: number;
  request(options: NetRequestOptions): Promise<FetchResult>;
  normalizeAllowedOrigins(origins?: readonly string[]): readonly string[];
};

export * as ipc from "./ipc.js";
