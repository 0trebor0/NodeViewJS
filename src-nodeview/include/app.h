#pragma once

#include <cstddef>
#include <cstdint>
#include <memory>

#include <napi.h>

namespace nodeview {

class NativeWindow;
struct RuntimeState;

class NodeViewJSRuntime {
 public:
  NodeViewJSRuntime();
  ~NodeViewJSRuntime();

  std::uint32_t CreateWindowInstance(const Napi::Object& options);
  NativeWindow& Window(Napi::Env env, std::uint32_t id);
  NativeWindow& PrimaryWindow(Napi::Env env);
  void CloseWindow(Napi::Env env, std::uint32_t id);
  void Run(Napi::Env env);
  void CloseAll();
  void OnWindowDestroyed(std::uint32_t id);
  bool IsRunning() const;

 private:
  void PumpMessages();
  void Stop();

  std::unique_ptr<RuntimeState> state_;
};

NodeViewJSRuntime& GetRuntime();
std::uint32_t GetWindowId(const Napi::CallbackInfo& info, std::size_t index);

}  // namespace nodeview
