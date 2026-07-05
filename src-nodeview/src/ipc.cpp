#include "ipc.h"

#include "app.h"
#include "window.h"

#include <windows.h>
#include <objbase.h>
#include <WebView2.h>

#include <string>

namespace nodeview {

namespace {
constexpr size_t kMaxIpcMessageBytes = 256 * 1024;

bool ExceedsUtf8Limit(const wchar_t* value, size_t length) {
  size_t bytes = 0;
  for (size_t index = 0; index < length; ++index) {
    const wchar_t code = value[index];
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && index + 1 < length
        && value[index + 1] >= 0xdc00 && value[index + 1] <= 0xdfff) {
      bytes += 4;
      ++index;
    } else {
      bytes += 3;
    }
    if (bytes > kMaxIpcMessageBytes) return true;
  }
  return false;
}
}

void IpcBridge::SetMessageHandler(const Napi::Function& handler) {
  Clear();
  env_ = handler.Env();
  message_handler_ = Napi::Persistent(handler);
}

void IpcBridge::ForwardWebMessage(ICoreWebView2WebMessageReceivedEventArgs* args) {
  if (message_handler_.IsEmpty() || env_ == nullptr) {
    return;
  }

  LPWSTR message = nullptr;
  if (FAILED(args->get_WebMessageAsJson(&message)) || message == nullptr) {
    return;
  }

  const size_t message_length = wcslen(message);
  if (ExceedsUtf8Limit(message, message_length)) {
    CoTaskMemFree(message);
    OutputDebugStringW(L"NodeViewJS blocked an oversized IPC message.\n");
    return;
  }
  const std::u16string json(
      reinterpret_cast<const char16_t*>(message),
      message_length);
  CoTaskMemFree(message);

  const Napi::Env env(env_);
  Napi::HandleScope scope(env);
  message_handler_.Call({Napi::String::New(env, json)});
}

void IpcBridge::Clear() {
  message_handler_.Reset();
  env_ = nullptr;
}

void SetMessageHandler(const Napi::CallbackInfo& info) {
  if (info.Length() == 1 && info[0].IsFunction()) {
    GetRuntime().PrimaryWindow(info.Env()).Ipc().SetMessageHandler(info[0].As<Napi::Function>());
    return;
  }
  if (info.Length() != 2 || !info[1].IsFunction()) {
    throw Napi::TypeError::New(info.Env(), "setMessageHandler expects a window id and function.");
  }
  GetRuntime()
      .Window(info.Env(), GetWindowId(info, 0))
      .Ipc()
      .SetMessageHandler(info[1].As<Napi::Function>());
}

}  // namespace nodeview
