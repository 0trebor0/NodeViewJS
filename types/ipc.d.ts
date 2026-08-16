// Advanced API: the wire protocol between the backend and the page.
//
// Stability: these shapes follow IPC_VERSION rather than the package version.
// A protocol change may change them in a minor release. Applications should
// prefer app.command(), app.emit(), and window.on().

export declare const IPC_VERSION: number;
export declare const IPC_MAX_SERIALIZED_BYTES: number;
export declare const IPC_MAX_DEPTH: number;
export declare const IPC_MAX_NODES: number;
export declare const IPC_MAX_NAME_LENGTH: number;
export declare const IPC_MAX_CONCURRENT_REQUESTS: number;
export declare const IPC_MAX_COMPLETED_REQUEST_IDS: number;
export declare const IPC_REQUEST_TIMEOUT_MS: number;

export interface InvokeMessage {
  version: number;
  type: "invoke";
  id: number;
  command: string;
  payload?: unknown;
}

export interface EventMessage {
  version: number;
  type: "event";
  event: string;
  payload?: unknown;
}

export interface SuccessResponseMessage {
  version: number;
  type: "response";
  id: number;
  ok: true;
  result?: unknown;
}

export interface ErrorResponseMessage {
  version: number;
  type: "response";
  id: number;
  ok: false;
  error: string;
}

export type ResponseMessage = SuccessResponseMessage | ErrorResponseMessage;
export type IpcMessage = InvokeMessage | EventMessage | ResponseMessage;

/** Returns undefined for anything that is not a valid inbound message. */
export declare function parseMessage(serialized: string): InvokeMessage | EventMessage | undefined;
export declare function createEventMessage(eventName: string, payload?: unknown): EventMessage;
export declare function createResponseMessage(id: number, ok: true, result?: unknown): SuccessResponseMessage;
export declare function createResponseMessage(id: number, ok: false, error: unknown): ErrorResponseMessage;
export declare function serialize(message: IpcMessage): string;
export declare function isSafePayload(value: unknown): boolean;
export declare function isValidName(value: unknown): boolean;
