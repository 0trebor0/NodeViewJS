#include "app.h"

#include "window.h"

#include <windows.h>
#include <objbase.h>
#include <uv.h>

#include <cmath>
#include <cstdio>
#include <limits>
#include <map>
#include <set>
#include <vector>

namespace nodeview {

struct RuntimeState {
  std::map<std::uint32_t, std::unique_ptr<NativeWindow>> windows;
  std::set<std::uint32_t> live_windows;
  // A destroyed window cannot be erased while its own window procedure is
  // still running, so its id waits here until the next message pump.
  std::set<std::uint32_t> pending_removal;

  std::uint32_t next_window_id = 1;
  uv_timer_t* message_timer = nullptr;
  bool com_initialized = false;
  bool running = false;
};

void TraceRuntime(const wchar_t* message) {
  if (GetEnvironmentVariableW(L"NODEVIEW_NATIVE_TRACE", nullptr, 0) == 0) return;
  fwprintf(stderr, L"[NodeViewJS native trace] %ls\n", message);
  fflush(stderr);
}

NodeViewJSRuntime::NodeViewJSRuntime()
    : state_(std::make_unique<RuntimeState>()) {}

NodeViewJSRuntime::~NodeViewJSRuntime() {
  CloseAll();
  Stop();
}

std::uint32_t NodeViewJSRuntime::CreateWindowInstance(const Napi::Object& options) {
  const std::uint32_t id = state_->next_window_id++;
  auto window = std::make_unique<NativeWindow>(*this, id);
  NativeWindow* instance = window.get();
  state_->windows.emplace(id, std::move(window));

  try {
    instance->Create(options);
    state_->live_windows.insert(id);
  } catch (...) {
    state_->windows.erase(id);
    throw;
  }

  return id;
}

NativeWindow& NodeViewJSRuntime::Window(Napi::Env env, std::uint32_t id) {
  const auto window = state_->windows.find(id);
  if (window == state_->windows.end() || !state_->live_windows.contains(id)) {
    throw Napi::RangeError::New(env, "Unknown or closed window id.");
  }
  return *window->second;
}

NativeWindow& NodeViewJSRuntime::PrimaryWindow(Napi::Env env) {
  if (state_->live_windows.empty()) {
    throw Napi::Error::New(env, "No NodeView window is open.");
  }
  return *state_->windows.at(*state_->live_windows.begin());
}

void NodeViewJSRuntime::CloseWindow(Napi::Env env, std::uint32_t id) {
  const auto window = state_->windows.find(id);
  if (window == state_->windows.end()) {
    // Ids are handed out in order, so an id below the next one was created and
    // has since been destroyed and purged. Closing it again is a no-op, exactly
    // as it was before the object was released.
    if (id > 0 && id < state_->next_window_id) return;
    throw Napi::RangeError::New(env, "Unknown window id.");
  }
  if (state_->live_windows.contains(id)) {
    window->second->Close();
  }
}

void NodeViewJSRuntime::Run(Napi::Env env) {
  if (state_->running) {
    throw Napi::Error::New(env, "NodeViewJS is already running.");
  }
  if (state_->live_windows.empty()) {
    throw Napi::Error::New(env, "Call createWindow before run.");
  }

  const HRESULT com_result = CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);
  if (FAILED(com_result)) {
    throw Napi::Error::New(env, "Could not initialize the Windows COM apartment.");
  }
  state_->com_initialized = true;

  try {
    for (const std::uint32_t id : state_->live_windows) {
      state_->windows.at(id)->Start(env);
    }
  } catch (...) {
    Stop();
    throw;
  }

  auto* timer = new uv_timer_t();
  if (uv_timer_init(uv_default_loop(), timer) != 0) {
    delete timer;
    Stop();
    throw Napi::Error::New(env, "Could not start the NodeView Windows message pump.");
  }
  timer->data = this;
  if (uv_timer_start(
          timer,
          [](uv_timer_t* handle) {
            static_cast<NodeViewJSRuntime*>(handle->data)->PumpMessages();
          },
          0,
          10) != 0) {
    uv_close(reinterpret_cast<uv_handle_t*>(timer), [](uv_handle_t* handle) {
      delete reinterpret_cast<uv_timer_t*>(handle);
    });
    Stop();
    throw Napi::Error::New(env, "Could not start the NodeView Windows message pump.");
  }

  state_->message_timer = timer;
  state_->running = true;
  TraceRuntime(L"native message pump started");
}

void NodeViewJSRuntime::CloseAll() {
  const std::vector<std::uint32_t> ids(
      state_->live_windows.begin(),
      state_->live_windows.end());
  for (const std::uint32_t id : ids) {
    state_->windows.at(id)->Close();
  }
  PurgeDestroyedWindows();
}

void NodeViewJSRuntime::OnWindowDestroyed(std::uint32_t id) {
  state_->live_windows.erase(id);
  // This runs from inside the window's own WM_DESTROY handling, so the object
  // is still executing. Erasing it here would free it under its own feet;
  // PurgeDestroyedWindows() does it from the message pump instead.
  state_->pending_removal.insert(id);
  if (state_->running && state_->live_windows.empty()) {
    Stop();
    PostQuitMessage(0);
  }
}

// Releases the windows queued by OnWindowDestroyed. Only ever called from
// outside a window procedure: the message pump, CloseAll, and Stop.
void NodeViewJSRuntime::PurgeDestroyedWindows() {
  if (state_->pending_removal.empty()) return;
  const std::vector<std::uint32_t> ids(
      state_->pending_removal.begin(),
      state_->pending_removal.end());
  state_->pending_removal.clear();
  for (const std::uint32_t id : ids) {
    state_->windows.erase(id);
  }
}

// Internal diagnostics: lets a test prove that closed windows are actually
// released rather than accumulating for the life of the process.
NodeViewJSRuntime::WindowCounts NodeViewJSRuntime::CountWindows() const {
  return WindowCounts{
      state_->windows.size(),
      state_->live_windows.size(),
      state_->pending_removal.size()};
}

bool NodeViewJSRuntime::IsRunning() const {
  return state_->running;
}

void NodeViewJSRuntime::PumpMessages() {
  // Runs before any DispatchMessage below, so nothing here is nested inside a
  // window procedure.
  PurgeDestroyedWindows();

  const std::vector<std::uint32_t> ids(
      state_->live_windows.begin(),
      state_->live_windows.end());
  for (const std::uint32_t id : ids) {
    state_->windows.at(id)->InitializeWebViewIfNeeded();
  }

  MSG message{};
  while (PeekMessage(&message, nullptr, 0, 0, PM_REMOVE)) {
    if (message.message == WM_QUIT) {
      TraceRuntime(L"native message pump received WM_QUIT");
      uv_stop(uv_default_loop());
      return;
    }
    bool translated = false;
    for (const std::uint32_t id : state_->live_windows) {
      if (state_->windows.at(id)->TranslateAcceleratorMessage(&message)) {
        translated = true;
        break;
      }
    }
    if (translated) continue;
    TranslateMessage(&message);
    DispatchMessage(&message);
  }
}

void NodeViewJSRuntime::Stop() {
  state_->running = false;
  if (state_->message_timer != nullptr) {
    uv_timer_stop(state_->message_timer);
    uv_close(reinterpret_cast<uv_handle_t*>(state_->message_timer), [](uv_handle_t* handle) {
      delete reinterpret_cast<uv_timer_t*>(handle);
    });
    state_->message_timer = nullptr;
  }
  if (state_->com_initialized) {
    CoUninitialize();
    state_->com_initialized = false;
  }
}

Napi::Value GetNativeWindowCounts(const Napi::CallbackInfo& info) {
  const NodeViewJSRuntime::WindowCounts counts = GetRuntime().CountWindows();
  Napi::Object result = Napi::Object::New(info.Env());
  result.Set("tracked", Napi::Number::New(info.Env(), static_cast<double>(counts.tracked)));
  result.Set("live", Napi::Number::New(info.Env(), static_cast<double>(counts.live)));
  result.Set(
      "pendingRemoval",
      Napi::Number::New(info.Env(), static_cast<double>(counts.pending_removal)));
  return result;
}

NodeViewJSRuntime& GetRuntime() {
  static NodeViewJSRuntime runtime;
  return runtime;
}

std::uint32_t GetWindowId(const Napi::CallbackInfo& info, std::size_t index) {
  if (info.Length() <= index || !info[index].IsNumber()) {
    throw Napi::TypeError::New(info.Env(), "Window id must be a positive integer.");
  }
  const double value = info[index].As<Napi::Number>().DoubleValue();
  if (!std::isfinite(value) || value < 1 || std::floor(value) != value ||
      value > std::numeric_limits<std::uint32_t>::max()) {
    throw Napi::RangeError::New(info.Env(), "Window id must be a positive integer.");
  }
  return static_cast<std::uint32_t>(value);
}

}  // namespace nodeview
