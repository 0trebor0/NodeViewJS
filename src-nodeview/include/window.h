#pragma once

#include <memory>
#include <cstdint>
#include <string>

#include <windows.h>
#include <napi.h>

#include "ipc.h"
#include "native_api.h"
#include "webview.h"

namespace nodeview {

class NodeViewJSRuntime;
struct WindowState;

class NativeWindow {
 public:
  NativeWindow(NodeViewJSRuntime& runtime, std::uint32_t id);
  ~NativeWindow();

  NativeWindow(const NativeWindow&) = delete;
  NativeWindow& operator=(const NativeWindow&) = delete;

  void Create(const Napi::Object& options);
  void Close();
  void Show();
  void Hide();
  void Minimize(Napi::Env env);
  void Maximize(Napi::Env env);
  void Restore(Napi::Env env);
  void SetFullscreen(Napi::Env env, bool fullscreen);
  void SetTitle(const Napi::Value& value);
  void SetWindowColors(Napi::Env env, const Napi::Object& colors);
  void SetSize(Napi::Env env, int width, int height);
  void SetPosition(Napi::Env env, int x, int y);
  void StartDrag();
  Napi::Object GetState(Napi::Env env);
  void SetMenuHandler(const Napi::Function& handler);
  void SetApplicationMenu(const Napi::Value& menu_template);
  void ShowContextMenu(const Napi::Array& menu_template, const Napi::Object& position);
  bool TranslateAcceleratorMessage(MSG* message);
  void DispatchMenuCommand(
      const std::string& id,
      bool checkbox,
      bool checked,
      const char* source = "application");
  void ClearMenuHandler();
  void SetTaskbarProgress(Napi::Env env, double value, const std::string& state);
  void SetTaskbarOverlay(Napi::Env env, const std::wstring& icon_path, const std::wstring& description);
  void RequestAttention(Napi::Env env, const std::string& type);
  void SetTray(const Napi::Object& options);
  void ShowMessageDialog(const Napi::Object& options);
  void ShowNotification(const Napi::Object& options);
  Napi::Value OpenFileDialog(Napi::Env env);
  Napi::Value SaveFileDialog(Napi::Env env);
  void LoadFile(const Napi::Value& value);
  void Start(Napi::Env env);
  void InitializeWebViewIfNeeded();

  std::uint32_t Id() const;
  WindowState& State();
  IpcBridge& Ipc();
  WebViewHost& WebView();
  NodeViewJSRuntime& Runtime();

 private:
  NodeViewJSRuntime& runtime_;
  std::uint32_t id_;
  IpcBridge ipc_;
  WebViewHost webview_;
  std::unique_ptr<WindowState> state_;
  Napi::FunctionReference menu_handler_;
  napi_env menu_env_ = nullptr;
};

}  // namespace nodeview
