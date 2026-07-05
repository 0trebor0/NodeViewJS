#pragma once

#include <napi.h>

struct ICoreWebView2WebMessageReceivedEventArgs;

namespace nodeview {

class IpcBridge {
 public:
  void SetMessageHandler(const Napi::Function& handler);
  void ForwardWebMessage(ICoreWebView2WebMessageReceivedEventArgs* args);
  void Clear();

 private:
  Napi::FunctionReference message_handler_;
  napi_env env_ = nullptr;
};

void SetMessageHandler(const Napi::CallbackInfo& info);

}  // namespace nodeview
