// Type declarations for the frontend bridge injected into every top-level
// page. Include this file from a frontend tsconfig ("types": ["nodeviewjs/..."]
// is not used because the bridge is a global, not a module):
//
//   /// <reference path="../node_modules/nodeviewjs/types/bridge.d.ts" />

export interface NodeViewJSBridge {
  /** Flushes buffered events and tells the backend the page is ready. */
  ready(): Promise<void>;
  invoke<T = unknown>(command: string, payload?: unknown): Promise<T>;
  on(eventName: string, handler: (payload?: any) => void): () => void;
  once(eventName: string, handler: (payload?: any) => void): () => void;
  off(eventName: string, handler: (payload?: any) => void): void;
  emit(eventName: string, payload?: unknown): void;
}

declare global {
  interface Window {
    /** The only NodeViewJS browser global. */
    readonly NodeViewJS: NodeViewJSBridge;
  }

  // `var` rather than `const` so the bridge is also reachable as
  // globalThis.NodeViewJS.
  var NodeViewJS: NodeViewJSBridge;
}
