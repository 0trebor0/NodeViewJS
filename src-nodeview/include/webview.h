#pragma once

#include <memory>
#include <string>

#include <napi.h>
#include <windows.h>

namespace nodeview {

class IpcBridge;
struct WebViewState;

class WebViewHost {
 public:
  explicit WebViewHost(IpcBridge& ipc);
  ~WebViewHost();

  WebViewHost(const WebViewHost&) = delete;
  WebViewHost& operator=(const WebViewHost&) = delete;

  void Initialize(
      HWND window,
      const std::wstring& entry_file,
      const std::wstring& data_directory,
      bool bridge_embedded);
  void SetDevToolsEnabled(bool enabled);
  void SetTransparent(bool enabled);
  void PostWebMessage(const Napi::Value& value);
  void Reload(Napi::Env env);
  void Resize();
  void Close();

 private:
  IpcBridge& ipc_;
  std::unique_ptr<WebViewState> state_;
};

void PostWebMessage(const Napi::CallbackInfo& info);
void ReloadWebView(const Napi::CallbackInfo& info);

}  // namespace nodeview
