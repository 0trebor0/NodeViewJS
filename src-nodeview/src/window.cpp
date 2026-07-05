#include "window.h"

#include "app.h"
#include "webview.h"

#include <windows.h>
#include <commdlg.h>
#include <shellapi.h>
#include <shobjidl.h>

#include <cmath>
#include <iomanip>
#include <stdexcept>
#include <map>
#include <set>
#include <sstream>
#include <string>
#include <vector>

namespace nodeview {

struct MenuCommand {
  std::string id;
  bool checkbox = false;
  bool checked = false;
};

struct WindowState {
  HWND window = nullptr;
  std::wstring entry_file;
  std::wstring webview_data_directory;
  bool webview_started = false;
  int min_width = 0;
  int min_height = 0;
  int max_width = 0;
  int max_height = 0;
  bool frame = true;
  bool frame_on_hover = false;
  bool frame_visible = true;
  bool closable = true;
  bool minimizable = true;
  bool maximizable = true;
  bool maximized = false;
  bool fullscreen = false;
  bool close_to_hide = false;
  bool transparent = false;
  bool bridge_embedded = false;
  bool notification_icon_added = false;
  bool tray_icon_added = false;
  HICON window_icon = nullptr;
  HICON tray_icon = nullptr;
  HMENU application_menu = nullptr;
  HACCEL accelerator_table = nullptr;
  std::map<UINT, MenuCommand> menu_commands;
  std::string taskbar_progress_state = "none";
  double taskbar_progress_value = 0;
  bool taskbar_overlay = false;
  DWORD framed_style = 0;
  DWORD frameless_style = 0;
  DWORD windowed_style = 0;
  DWORD windowed_extended_style = 0;
  WINDOWPLACEMENT windowed_placement{sizeof(WINDOWPLACEMENT)};
};

}  // namespace nodeview

namespace {

using nodeview::WindowState;

constexpr wchar_t kWindowClassName[] = L"NodeViewWindow";
constexpr UINT kNotificationIconId = 1;
constexpr UINT kTrayIconId = 2;
constexpr UINT kNotificationCallbackMessage = WM_APP + 1;
constexpr UINT kTrayCallbackMessage = WM_APP + 2;
constexpr UINT kTrayShowCommand = 1001;
constexpr UINT kTrayQuitCommand = 1002;
constexpr UINT kFirstMenuCommand = 2000;
constexpr UINT kLastMenuCommand = 0xefff;
constexpr COLORREF kTransparentColorKey = RGB(1, 0, 1);
constexpr int kHoverFrameRevealHeight = 8;

std::string FormatHResult(HRESULT result) {
  std::ostringstream message;
  message << "0x" << std::uppercase << std::hex << static_cast<unsigned long>(result);
  return message.str();
}

class WindowsTaskbarList {
 public:
  WindowsTaskbarList(Napi::Env env, const char* operation) {
    HRESULT result = CoCreateInstance(
        CLSID_TaskbarList,
        nullptr,
        CLSCTX_INPROC_SERVER,
        IID_PPV_ARGS(&taskbar_));
    if (SUCCEEDED(result)) result = taskbar_->HrInit();
    if (FAILED(result)) {
      if (taskbar_ != nullptr) taskbar_->Release();
      taskbar_ = nullptr;
      throw Napi::Error::New(
          env,
          std::string("Could not initialize Windows taskbar integration for ") + operation +
              " (HRESULT:" + FormatHResult(result) + "). Call this after app.run().");
    }
  }

  ~WindowsTaskbarList() {
    if (taskbar_ != nullptr) taskbar_->Release();
  }

  ITaskbarList3* operator->() const { return taskbar_; }

 private:
  ITaskbarList3* taskbar_ = nullptr;
};

void SetHoverFrameVisible(nodeview::NativeWindow& native_window, bool visible) {
  auto& state = native_window.State();
  if (!state.frame_on_hover || state.fullscreen || state.frame_visible == visible ||
      state.window == nullptr) {
    return;
  }

  state.frame_visible = visible;
  SetWindowLongPtr(
      state.window,
      GWL_STYLE,
      visible ? state.framed_style : state.frameless_style);
  SetWindowPos(
      state.window,
      nullptr,
      0,
      0,
      0,
      0,
      SWP_FRAMECHANGED | SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE);
  if (visible && !state.closable) {
    HMENU system_menu = GetSystemMenu(state.window, FALSE);
    if (system_menu != nullptr) {
      EnableMenuItem(system_menu, SC_CLOSE, MF_BYCOMMAND | MF_DISABLED | MF_GRAYED);
      DrawMenuBar(state.window);
    }
  }
}

bool PointerIsAtTopEdge(HWND window) {
  POINT cursor{};
  RECT rectangle{};
  return GetCursorPos(&cursor) && GetWindowRect(window, &rectangle) &&
      cursor.y >= rectangle.top && cursor.y <= rectangle.top + kHoverFrameRevealHeight;
}

void TrackNativeFrameLeave(HWND window) {
  TRACKMOUSEEVENT tracking{sizeof(TRACKMOUSEEVENT), TME_LEAVE | TME_NONCLIENT, window, 0};
  TrackMouseEvent(&tracking);
}

void RemoveNotifyIcon(nodeview::NativeWindow& native_window, UINT id) {
  auto& state = native_window.State();
  if (state.window == nullptr) {
    return;
  }

  NOTIFYICONDATA notification{};
  notification.cbSize = sizeof(notification);
  notification.hWnd = state.window;
  notification.uID = id;
  Shell_NotifyIcon(NIM_DELETE, &notification);
}

void ClearApplicationMenu(nodeview::NativeWindow& native_window) {
  auto& state = native_window.State();
  if (state.window != nullptr && state.application_menu != nullptr) {
    SetMenu(state.window, nullptr);
  }
  if (state.application_menu != nullptr) {
    DestroyMenu(state.application_menu);
    state.application_menu = nullptr;
  }
  if (state.accelerator_table != nullptr) {
    DestroyAcceleratorTable(state.accelerator_table);
    state.accelerator_table = nullptr;
  }
  state.menu_commands.clear();
}

void ShowAppWindow(nodeview::NativeWindow& native_window) {
  auto& state = native_window.State();
  if (state.window == nullptr) {
    return;
  }

  ShowWindow(state.window, state.maximized ? SW_MAXIMIZE : SW_SHOWNORMAL);
  SetForegroundWindow(state.window);
}

void QuitAppWindow(nodeview::NativeWindow& native_window) {
  auto& state = native_window.State();
  if (state.window != nullptr) {
    DestroyWindow(state.window);
  }
}

void ShowTrayMenu(nodeview::NativeWindow& native_window) {
  auto& state = native_window.State();
  if (state.window == nullptr) {
    return;
  }

  HMENU menu = CreatePopupMenu();
  if (menu == nullptr) {
    return;
  }

  AppendMenu(menu, MF_STRING, kTrayShowCommand, L"Show");
  AppendMenu(menu, MF_STRING, kTrayQuitCommand, L"Quit");

  POINT cursor{};
  GetCursorPos(&cursor);
  SetForegroundWindow(state.window);
  TrackPopupMenu(menu, TPM_RIGHTBUTTON, cursor.x, cursor.y, 0, state.window, nullptr);
  DestroyMenu(menu);
}

LRESULT CALLBACK WindowProcedure(HWND window, UINT message, WPARAM w_param, LPARAM l_param) {
  if (message == WM_NCCREATE) {
    const auto* create = reinterpret_cast<const CREATESTRUCT*>(l_param);
    auto* native_window = static_cast<nodeview::NativeWindow*>(create->lpCreateParams);
    SetWindowLongPtr(window, GWLP_USERDATA, reinterpret_cast<LONG_PTR>(native_window));
    native_window->State().window = window;
  }

  auto* native_window = reinterpret_cast<nodeview::NativeWindow*>(
      GetWindowLongPtr(window, GWLP_USERDATA));
  if (native_window == nullptr) {
    return DefWindowProc(window, message, w_param, l_param);
  }
  auto& state = native_window->State();
  switch (message) {
    case WM_DESTROY: {
      ClearApplicationMenu(*native_window);
      native_window->ClearMenuHandler();
      if (state.notification_icon_added) {
        RemoveNotifyIcon(*native_window, kNotificationIconId);
        state.notification_icon_added = false;
      }
      if (state.tray_icon_added) {
        RemoveNotifyIcon(*native_window, kTrayIconId);
        state.tray_icon_added = false;
      }
      if (state.tray_icon != nullptr) {
        DestroyIcon(state.tray_icon);
        state.tray_icon = nullptr;
      }
      if (state.window_icon != nullptr) {
        DestroyIcon(state.window_icon);
        state.window_icon = nullptr;
      }
      native_window->WebView().Close();
      state.window = nullptr;
      state.entry_file.clear();
      state.webview_data_directory.clear();
      state.webview_started = false;
      native_window->Runtime().OnWindowDestroyed(native_window->Id());
      return 0;
    }
    case WM_CLOSE:
      if (!state.closable) {
        return 0;
      }
      if (state.close_to_hide) {
        ShowWindow(window, SW_HIDE);
        return 0;
      }
      return DefWindowProc(window, message, w_param, l_param);
    case WM_MOUSEMOVE:
      if (state.frame_on_hover && !state.frame_visible && PointerIsAtTopEdge(window)) {
        SetHoverFrameVisible(*native_window, true);
        TrackNativeFrameLeave(window);
      }
      return DefWindowProc(window, message, w_param, l_param);
    case WM_NCMOUSEMOVE:
      if (state.frame_on_hover) {
        if (!state.frame_visible && PointerIsAtTopEdge(window)) {
          SetHoverFrameVisible(*native_window, true);
        }
        if (state.frame_visible) TrackNativeFrameLeave(window);
      }
      return DefWindowProc(window, message, w_param, l_param);
    case WM_NCMOUSELEAVE:
      SetHoverFrameVisible(*native_window, false);
      return 0;
    case WM_ERASEBKGND: {
      RECT client{};
      GetClientRect(window, &client);
      if (state.transparent) {
        HBRUSH transparent_brush = CreateSolidBrush(kTransparentColorKey);
        FillRect(reinterpret_cast<HDC>(w_param), &client, transparent_brush);
        DeleteObject(transparent_brush);
      } else {
        FillRect(reinterpret_cast<HDC>(w_param), &client, GetSysColorBrush(COLOR_WINDOW));
      }
      return 1;
    }
    case WM_SIZE:
      if (!state.fullscreen) {
        if (w_param == SIZE_MAXIMIZED) state.maximized = true;
        if (w_param == SIZE_RESTORED) state.maximized = false;
      }
      native_window->WebView().Resize();
      return 0;
    case WM_GETMINMAXINFO: {
      auto* info = reinterpret_cast<MINMAXINFO*>(l_param);
      if (state.min_width > 0) info->ptMinTrackSize.x = state.min_width;
      if (state.min_height > 0) info->ptMinTrackSize.y = state.min_height;
      if (state.max_width > 0) info->ptMaxTrackSize.x = state.max_width;
      if (state.max_height > 0) info->ptMaxTrackSize.y = state.max_height;
      return 0;
    }
    case WM_COMMAND:
      if (LOWORD(w_param) == kTrayShowCommand) {
        ShowAppWindow(*native_window);
        return 0;
      }
      if (LOWORD(w_param) == kTrayQuitCommand) {
        QuitAppWindow(*native_window);
        return 0;
      }
      if (const auto command = state.menu_commands.find(LOWORD(w_param));
          command != state.menu_commands.end()) {
        if (command->second.checkbox) {
          command->second.checked = !command->second.checked;
          CheckMenuItem(
              state.application_menu,
              command->first,
              MF_BYCOMMAND | (command->second.checked ? MF_CHECKED : MF_UNCHECKED));
        }
        native_window->DispatchMenuCommand(
            command->second.id,
            command->second.checkbox,
            command->second.checked);
        return 0;
      }
      return DefWindowProc(window, message, w_param, l_param);
    case kTrayCallbackMessage:
      if (l_param == WM_LBUTTONDBLCLK) {
        ShowAppWindow(*native_window);
        return 0;
      }
      if (l_param == WM_RBUTTONUP || l_param == WM_CONTEXTMENU) {
        ShowTrayMenu(*native_window);
        return 0;
      }
      return 0;
    default:
      return DefWindowProc(window, message, w_param, l_param);
  }
}

void RegisterWindowClass() {
  WNDCLASS window_class{};
  window_class.lpfnWndProc = WindowProcedure;
  window_class.hInstance = GetModuleHandle(nullptr);
  window_class.lpszClassName = kWindowClassName;
  window_class.hCursor = LoadCursor(nullptr, IDC_ARROW);
  window_class.hbrBackground = nullptr;

  if (!RegisterClass(&window_class) && GetLastError() != ERROR_CLASS_ALREADY_EXISTS) {
    throw std::runtime_error("Could not register the NodeView window class.");
  }
}

std::wstring GetRequiredString(const Napi::Object& options, const char* name) {
  const Napi::Value value = options.Get(name);
  if (!value.IsString()) {
    throw Napi::TypeError::New(options.Env(), std::string("Option '") + name + "' must be a string.");
  }

  const std::u16string utf16_value = value.As<Napi::String>().Utf16Value();
  return std::wstring(
      reinterpret_cast<const wchar_t*>(utf16_value.data()),
      utf16_value.size());
}

std::wstring GetOptionalString(const Napi::Object& options, const char* name) {
  const Napi::Value value = options.Get(name);
  if (value.IsUndefined()) return L"";
  if (!value.IsString()) {
    throw Napi::TypeError::New(options.Env(), std::string("Option '") + name + "' must be a string.");
  }
  const std::u16string utf16_value = value.As<Napi::String>().Utf16Value();
  return std::wstring(reinterpret_cast<const wchar_t*>(utf16_value.data()), utf16_value.size());
}

int GetDimension(const Napi::Object& options, const char* name, int fallback) {
  const Napi::Value value = options.Get(name);
  if (value.IsUndefined()) {
    return fallback;
  }
  if (!value.IsNumber()) {
    throw Napi::TypeError::New(options.Env(), std::string("Option '") + name + "' must be a number.");
  }

  const double dimension = value.As<Napi::Number>().DoubleValue();
  if (dimension <= 0 || dimension > 32767) {
    throw Napi::RangeError::New(options.Env(), std::string("Option '") + name + "' must be between 1 and 32767.");
  }

  return static_cast<int>(dimension);
}

bool GetBoolean(const Napi::Object& options, const char* name, bool fallback) {
  const Napi::Value value = options.Get(name);
  if (value.IsUndefined()) return fallback;
  if (!value.IsBoolean()) {
    throw Napi::TypeError::New(options.Env(), std::string("Option '") + name + "' must be a boolean.");
  }
  return value.As<Napi::Boolean>().Value();
}

std::wstring GetMenuString(const Napi::Object& item, const char* name) {
  const Napi::Value value = item.Get(name);
  if (!value.IsString()) {
    throw Napi::TypeError::New(item.Env(), std::string("Menu item '") + name + "' must be a string.");
  }
  const std::u16string utf16 = value.As<Napi::String>().Utf16Value();
  return std::wstring(reinterpret_cast<const wchar_t*>(utf16.data()), utf16.size());
}

void AppendMenuItems(
    HMENU menu,
    const Napi::Array& items,
    std::map<UINT, nodeview::MenuCommand>& commands,
    std::vector<ACCEL>& accelerators,
    UINT& next_command) {
  for (std::uint32_t index = 0; index < items.Length(); ++index) {
    const Napi::Value value = items.Get(index);
    if (!value.IsObject() || value.IsArray()) {
      throw Napi::TypeError::New(items.Env(), "Native menu items must be objects.");
    }
    const Napi::Object item = value.As<Napi::Object>();
    const std::string type = item.Get("type").As<Napi::String>().Utf8Value();
    if (type == "separator") {
      if (!AppendMenuW(menu, MF_SEPARATOR, 0, nullptr)) {
        throw Napi::Error::New(items.Env(), "Could not append a native menu separator.");
      }
      continue;
    }

    std::wstring label = GetMenuString(item, "label");
    const bool enabled = item.Get("enabled").As<Napi::Boolean>().Value();
    const UINT enabled_flag = enabled ? MF_ENABLED : MF_GRAYED;
    if (type == "submenu") {
      const Napi::Value submenu_value = item.Get("submenu");
      if (!submenu_value.IsArray()) {
        throw Napi::TypeError::New(items.Env(), "Native submenu must be an array.");
      }
      HMENU submenu = CreatePopupMenu();
      if (submenu == nullptr) {
        throw Napi::Error::New(items.Env(), "Could not create a native submenu.");
      }
      try {
        AppendMenuItems(
            submenu,
            submenu_value.As<Napi::Array>(),
            commands,
            accelerators,
            next_command);
      } catch (...) {
        DestroyMenu(submenu);
        throw;
      }
      if (!AppendMenuW(
              menu,
              MF_POPUP | enabled_flag,
              reinterpret_cast<UINT_PTR>(submenu),
              label.c_str())) {
        DestroyMenu(submenu);
        throw Napi::Error::New(items.Env(), "Could not append a native submenu.");
      }
      continue;
    }

    if (next_command > kLastMenuCommand) {
      throw Napi::RangeError::New(items.Env(), "Native menu contains too many commands.");
    }
    const UINT command_id = next_command++;
    const std::string id = item.Get("id").As<Napi::String>().Utf8Value();
    const bool checkbox = type == "checkbox";
    const bool checked = checkbox && item.Get("checked").As<Napi::Boolean>().Value();
    const Napi::Value accelerator_value = item.Get("accelerator");
    if (accelerator_value.IsObject()) {
      const Napi::Object accelerator = accelerator_value.As<Napi::Object>();
      const std::u16string display = accelerator.Get("display").As<Napi::String>().Utf16Value();
      label += L"\t";
      label.append(reinterpret_cast<const wchar_t*>(display.data()), display.size());
      BYTE flags = FVIRTKEY;
      if (accelerator.Get("ctrl").As<Napi::Boolean>().Value()) flags |= FCONTROL;
      if (accelerator.Get("alt").As<Napi::Boolean>().Value()) flags |= FALT;
      if (accelerator.Get("shift").As<Napi::Boolean>().Value()) flags |= FSHIFT;
      accelerators.push_back(ACCEL{
          flags,
          static_cast<WORD>(accelerator.Get("keyCode").As<Napi::Number>().Uint32Value()),
          static_cast<WORD>(command_id)});
    }

    UINT flags = MF_STRING | enabled_flag;
    if (checked) flags |= MF_CHECKED;
    if (!AppendMenuW(menu, flags, command_id, label.c_str())) {
      throw Napi::Error::New(items.Env(), "Could not append a native menu command.");
    }
    commands.emplace(command_id, nodeview::MenuCommand{id, checkbox, checked});
  }
}

POINT GetCenteredWindowPosition(int width, int height) {
  RECT work_area{};
  if (!SystemParametersInfo(SPI_GETWORKAREA, 0, &work_area, 0)) {
    return {CW_USEDEFAULT, CW_USEDEFAULT};
  }

  return {
      work_area.left + ((work_area.right - work_area.left) - width) / 2,
      work_area.top + ((work_area.bottom - work_area.top) - height) / 2};
}

std::wstring GetFilePath(const Napi::Value& value) {
  if (!value.IsString()) {
    throw Napi::TypeError::New(value.Env(), "loadFile expects a file path string.");
  }

  const std::u16string utf16_value = value.As<Napi::String>().Utf16Value();
  return std::wstring(
      reinterpret_cast<const wchar_t*>(utf16_value.data()),
      utf16_value.size());
}

}  // namespace

namespace nodeview {

NativeWindow::NativeWindow(NodeViewJSRuntime& runtime, std::uint32_t id)
    : runtime_(runtime),
      id_(id),
      webview_(ipc_),
      state_(std::make_unique<WindowState>()) {}

NativeWindow::~NativeWindow() = default;

WindowState& NativeWindow::State() {
  return *state_;
}

std::uint32_t NativeWindow::Id() const {
  return id_;
}

IpcBridge& NativeWindow::Ipc() {
  return ipc_;
}

WebViewHost& NativeWindow::WebView() {
  return webview_;
}

NodeViewJSRuntime& NativeWindow::Runtime() {
  return runtime_;
}

void NativeWindow::Create(const Napi::Object& options) {
  auto& g_state = *state_;
  const Napi::Env env = options.Env();
  const std::wstring title = GetRequiredString(options, "title");
  const std::wstring icon_path = GetOptionalString(options, "icon");
  g_state.webview_data_directory = GetOptionalString(options, "dataDirectory");
  const int width = GetDimension(options, "width", 800);
  const int height = GetDimension(options, "height", 600);
  const bool resizable = GetBoolean(options, "resizable", true);
  const bool devtools = GetBoolean(options, "devtools", false);
  const bool center = GetBoolean(options, "center", false);
  const bool always_on_top = GetBoolean(options, "alwaysOnTop", false);
  g_state.transparent = GetBoolean(options, "transparent", false);
  g_state.bridge_embedded = GetBoolean(options, "bridgeEmbedded", false);
  g_state.close_to_hide = GetBoolean(options, "closeToHide", false);
  g_state.frame = GetBoolean(options, "frame", true);
  g_state.frame_on_hover = GetBoolean(options, "frameOnHover", false);
  if (g_state.frame_on_hover) g_state.frame = false;
  g_state.frame_visible = g_state.frame;
  g_state.closable = GetBoolean(options, "closable", true);
  g_state.minimizable = GetBoolean(options, "minimizable", true);
  g_state.maximizable = GetBoolean(options, "maximizable", true);
  g_state.maximized = GetBoolean(options, "maximized", false);
  g_state.min_width = GetDimension(options, "minWidth", 0);
  g_state.min_height = GetDimension(options, "minHeight", 0);
  g_state.max_width = GetDimension(options, "maxWidth", 0);
  g_state.max_height = GetDimension(options, "maxHeight", 0);
  if ((g_state.max_width && g_state.max_width < g_state.min_width) ||
      (g_state.max_height && g_state.max_height < g_state.min_height)) {
    throw Napi::RangeError::New(env, "Maximum window dimensions cannot be smaller than minimum dimensions.");
  }
  webview_.SetDevToolsEnabled(devtools);
  webview_.SetTransparent(g_state.transparent);

  try {
    RegisterWindowClass();
  } catch (const std::exception& error) {
    throw Napi::Error::New(env, error.what());
  }

  RECT rectangle{0, 0, width, height};
  g_state.framed_style = WS_OVERLAPPED | WS_CAPTION | WS_SYSMENU;
  g_state.frameless_style = WS_POPUP;
  if (resizable) {
    g_state.framed_style |= WS_THICKFRAME;
    g_state.frameless_style |= WS_THICKFRAME;
  }
  if (g_state.minimizable) g_state.framed_style |= WS_MINIMIZEBOX;
  if (g_state.maximizable && resizable) g_state.framed_style |= WS_MAXIMIZEBOX;
  const DWORD window_style = g_state.frame ? g_state.framed_style : g_state.frameless_style;
  const DWORD extended_style =
      (always_on_top ? WS_EX_TOPMOST : 0) |
      (g_state.transparent ? WS_EX_LAYERED : 0) |
      (!g_state.frame ? WS_EX_APPWINDOW : 0);
  AdjustWindowRectEx(&rectangle, window_style, FALSE, extended_style);
  const int window_width = rectangle.right - rectangle.left;
  const int window_height = rectangle.bottom - rectangle.top;
  const POINT position = center ? GetCenteredWindowPosition(window_width, window_height) : POINT{CW_USEDEFAULT, CW_USEDEFAULT};
  g_state.window = CreateWindowEx(
      extended_style,
      kWindowClassName,
      title.c_str(),
      window_style,
      position.x,
      position.y,
      window_width,
      window_height,
      nullptr,
      nullptr,
      GetModuleHandle(nullptr),
      this);

  if (g_state.window == nullptr) {
    throw Napi::Error::New(env, "Could not create the NodeView window.");
  }

  if (g_state.frame_visible && !g_state.closable) {
    HMENU system_menu = GetSystemMenu(g_state.window, FALSE);
    if (system_menu != nullptr) {
      EnableMenuItem(system_menu, SC_CLOSE, MF_BYCOMMAND | MF_DISABLED | MF_GRAYED);
      DrawMenuBar(g_state.window);
    }
  }

  if (g_state.transparent &&
      !SetLayeredWindowAttributes(g_state.window, kTransparentColorKey, 255, LWA_COLORKEY)) {
    DestroyWindow(g_state.window);
    g_state.window = nullptr;
    throw Napi::Error::New(env, "Could not enable transparent window composition.");
  }

  if (!icon_path.empty()) {
    HICON icon = static_cast<HICON>(LoadImage(nullptr, icon_path.c_str(), IMAGE_ICON, 0, 0, LR_LOADFROMFILE));
    if (icon == nullptr) {
      DestroyWindow(g_state.window);
      g_state.window = nullptr;
      throw Napi::Error::New(env, "Could not load the window icon. Use a valid .ico file path.");
    }
    SendMessage(g_state.window, WM_SETICON, ICON_BIG, reinterpret_cast<LPARAM>(icon));
    SendMessage(g_state.window, WM_SETICON, ICON_SMALL, reinterpret_cast<LPARAM>(icon));
    g_state.window_icon = icon;
  }
}

void NativeWindow::Close() {
  auto& g_state = *state_;
  if (g_state.window != nullptr) {
    DestroyWindow(g_state.window);
  }
}

void NativeWindow::Show() {
  ShowAppWindow(*this);
}

void NativeWindow::Hide() {
  auto& g_state = *state_;
  if (g_state.window != nullptr) {
    ShowWindow(g_state.window, SW_HIDE);
  }
}

void NativeWindow::Minimize(Napi::Env env) {
  auto& state = *state_;
  if (!state.minimizable) {
    throw Napi::Error::New(env, "This window is not minimizable.");
  }
  ShowWindow(state.window, SW_MINIMIZE);
}

void NativeWindow::Maximize(Napi::Env env) {
  auto& state = *state_;
  if (!state.maximizable) {
    throw Napi::Error::New(env, "This window is not maximizable.");
  }
  ShowWindow(state.window, SW_MAXIMIZE);
  state.maximized = true;
}

void NativeWindow::Restore(Napi::Env env) {
  auto& state = *state_;
  if (state.fullscreen) SetFullscreen(env, false);
  ShowWindow(state.window, SW_RESTORE);
  state.maximized = false;
}

void NativeWindow::SetFullscreen(Napi::Env env, bool fullscreen) {
  auto& state = *state_;
  if (state.fullscreen == fullscreen) return;

  if (fullscreen) {
    if (state.frame_on_hover && state.frame_visible) {
      SetHoverFrameVisible(*this, false);
    }
    const bool was_visible = IsWindowVisible(state.window);
    state.windowed_style = static_cast<DWORD>(GetWindowLongPtr(state.window, GWL_STYLE));
    state.windowed_extended_style = static_cast<DWORD>(GetWindowLongPtr(state.window, GWL_EXSTYLE));
    state.windowed_placement.length = sizeof(WINDOWPLACEMENT);
    if (!GetWindowPlacement(state.window, &state.windowed_placement)) {
      throw Napi::Error::New(env, "Could not save the window placement before fullscreen.");
    }
    MONITORINFO monitor{sizeof(MONITORINFO)};
    if (!GetMonitorInfo(MonitorFromWindow(state.window, MONITOR_DEFAULTTONEAREST), &monitor)) {
      throw Napi::Error::New(env, "Could not resolve the fullscreen monitor.");
    }
    SetWindowLongPtr(
        state.window,
        GWL_STYLE,
        WS_POPUP | (was_visible ? WS_VISIBLE : 0));
    SetWindowLongPtr(
        state.window,
        GWL_EXSTYLE,
        state.windowed_extended_style & ~(WS_EX_WINDOWEDGE | WS_EX_CLIENTEDGE));
    SetWindowPos(
        state.window,
        HWND_TOP,
        monitor.rcMonitor.left,
        monitor.rcMonitor.top,
        monitor.rcMonitor.right - monitor.rcMonitor.left,
        monitor.rcMonitor.bottom - monitor.rcMonitor.top,
        SWP_FRAMECHANGED | (was_visible ? SWP_SHOWWINDOW : 0));
    state.fullscreen = true;
    return;
  }

  SetWindowLongPtr(state.window, GWL_STYLE, state.windowed_style);
  SetWindowLongPtr(state.window, GWL_EXSTYLE, state.windowed_extended_style);
  SetWindowPlacement(state.window, &state.windowed_placement);
  SetWindowPos(
      state.window,
      nullptr,
      0,
      0,
      0,
      0,
      SWP_FRAMECHANGED | SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE);
  state.fullscreen = false;
  state.maximized = state.windowed_placement.showCmd == SW_SHOWMAXIMIZED;
}

void NativeWindow::SetTitle(const Napi::Value& value) {
  if (!value.IsString()) {
    throw Napi::TypeError::New(value.Env(), "Window title must be a string.");
  }
  const std::u16string utf16 = value.As<Napi::String>().Utf16Value();
  const std::wstring title(utf16.begin(), utf16.end());
  if (title.empty()) {
    throw Napi::TypeError::New(value.Env(), "Window title must be a non-empty string.");
  }
  SetWindowText(state_->window, title.c_str());
}

void NativeWindow::SetSize(Napi::Env env, int width, int height) {
  auto& state = *state_;
  if (state.fullscreen) {
    throw Napi::Error::New(env, "Exit fullscreen before changing the window size.");
  }
  RECT rectangle{0, 0, width, height};
  const DWORD style = static_cast<DWORD>(GetWindowLongPtr(state.window, GWL_STYLE));
  const DWORD extended_style = static_cast<DWORD>(GetWindowLongPtr(state.window, GWL_EXSTYLE));
  AdjustWindowRectEx(&rectangle, style, FALSE, extended_style);
  SetWindowPos(
      state.window,
      nullptr,
      0,
      0,
      rectangle.right - rectangle.left,
      rectangle.bottom - rectangle.top,
      SWP_NOMOVE | SWP_NOZORDER | SWP_NOACTIVATE);
}

void NativeWindow::SetPosition(Napi::Env env, int x, int y) {
  if (state_->fullscreen) {
    throw Napi::Error::New(env, "Exit fullscreen before changing the window position.");
  }
  SetWindowPos(
      state_->window,
      nullptr,
      x,
      y,
      0,
      0,
      SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE);
}

void NativeWindow::StartDrag() {
  ReleaseCapture();
  SendMessage(state_->window, WM_NCLBUTTONDOWN, HTCAPTION, 0);
}

Napi::Object NativeWindow::GetState(Napi::Env env) {
  auto& state = *state_;
  RECT window_rectangle{};
  RECT client_rectangle{};
  GetWindowRect(state.window, &window_rectangle);
  GetClientRect(state.window, &client_rectangle);
  const int title_length = GetWindowTextLength(state.window);
  std::vector<wchar_t> title(static_cast<std::size_t>(title_length) + 1);
  GetWindowText(state.window, title.data(), static_cast<int>(title.size()));
  const std::u16string utf16_title(
      reinterpret_cast<const char16_t*>(title.data()),
      static_cast<std::size_t>(title_length));
  const DWORD style = static_cast<DWORD>(GetWindowLongPtr(state.window, GWL_STYLE));

  Napi::Object result = Napi::Object::New(env);
  result.Set("title", Napi::String::New(env, utf16_title));
  result.Set("x", Napi::Number::New(env, window_rectangle.left));
  result.Set("y", Napi::Number::New(env, window_rectangle.top));
  result.Set("width", Napi::Number::New(env, client_rectangle.right - client_rectangle.left));
  result.Set("height", Napi::Number::New(env, client_rectangle.bottom - client_rectangle.top));
  result.Set("visible", Napi::Boolean::New(env, IsWindowVisible(state.window)));
  result.Set("minimized", Napi::Boolean::New(env, IsIconic(state.window)));
  result.Set("maximized", Napi::Boolean::New(env, IsZoomed(state.window)));
  result.Set("fullscreen", Napi::Boolean::New(env, state.fullscreen));
  result.Set("frame", Napi::Boolean::New(env, (style & WS_CAPTION) == WS_CAPTION));
  result.Set("frameOnHover", Napi::Boolean::New(env, state.frame_on_hover));
  result.Set("closable", Napi::Boolean::New(env, state.closable));
  result.Set("minimizable", Napi::Boolean::New(env, state.minimizable));
  result.Set("maximizable", Napi::Boolean::New(env, state.maximizable));
  result.Set("hasMenu", Napi::Boolean::New(env, state.application_menu != nullptr));
  result.Set("menuCommandCount", Napi::Number::New(env, state.menu_commands.size()));
  result.Set("taskbarProgressState", Napi::String::New(env, state.taskbar_progress_state));
  result.Set("taskbarProgressValue", Napi::Number::New(env, state.taskbar_progress_value));
  result.Set("hasTaskbarOverlay", Napi::Boolean::New(env, state.taskbar_overlay));
  return result;
}

void NativeWindow::SetMenuHandler(const Napi::Function& handler) {
  ClearMenuHandler();
  menu_env_ = handler.Env();
  menu_handler_ = Napi::Persistent(handler);
}

void NativeWindow::SetApplicationMenu(const Napi::Value& menu_template) {
  auto& state = *state_;
  if (menu_template.IsNull()) {
    ClearApplicationMenu(*this);
    DrawMenuBar(state.window);
    return;
  }
  if (!menu_template.IsArray()) {
    throw Napi::TypeError::New(menu_template.Env(), "Application menu template must be an array or null.");
  }

  HMENU new_menu = CreateMenu();
  if (new_menu == nullptr) {
    throw Napi::Error::New(menu_template.Env(), "Could not create the native application menu.");
  }
  std::map<UINT, MenuCommand> commands;
  std::vector<ACCEL> accelerators;
  UINT next_command = kFirstMenuCommand;
  HACCEL new_accelerator_table = nullptr;
  try {
    AppendMenuItems(
        new_menu,
        menu_template.As<Napi::Array>(),
        commands,
        accelerators,
        next_command);
    if (!accelerators.empty()) {
      new_accelerator_table = CreateAcceleratorTableW(
          accelerators.data(),
          static_cast<int>(accelerators.size()));
      if (new_accelerator_table == nullptr) {
        throw Napi::Error::New(menu_template.Env(), "Could not create the native accelerator table.");
      }
    }
    if (!SetMenu(state.window, new_menu)) {
      throw Napi::Error::New(menu_template.Env(), "Could not attach the native application menu.");
    }
  } catch (...) {
    if (new_accelerator_table != nullptr) DestroyAcceleratorTable(new_accelerator_table);
    DestroyMenu(new_menu);
    throw;
  }

  if (state.application_menu != nullptr) DestroyMenu(state.application_menu);
  if (state.accelerator_table != nullptr) DestroyAcceleratorTable(state.accelerator_table);
  state.application_menu = new_menu;
  state.accelerator_table = new_accelerator_table;
  state.menu_commands = std::move(commands);
  DrawMenuBar(state.window);
}

void NativeWindow::ShowContextMenu(
    const Napi::Array& menu_template,
    const Napi::Object& position) {
  auto& state = *state_;
  HMENU menu = CreatePopupMenu();
  if (menu == nullptr) {
    throw Napi::Error::New(menu_template.Env(), "Could not create the native context menu.");
  }
  std::map<UINT, MenuCommand> commands;
  std::vector<ACCEL> ignored_accelerators;
  UINT next_command = kFirstMenuCommand;
  try {
    AppendMenuItems(menu, menu_template, commands, ignored_accelerators, next_command);
  } catch (...) {
    DestroyMenu(menu);
    throw;
  }

  POINT location{};
  const Napi::Value x = position.Get("x");
  const Napi::Value y = position.Get("y");
  if (x.IsNumber() && y.IsNumber()) {
    location.x = x.As<Napi::Number>().Int32Value();
    location.y = y.As<Napi::Number>().Int32Value();
    ClientToScreen(state.window, &location);
  } else {
    GetCursorPos(&location);
  }

  SetForegroundWindow(state.window);
  const UINT selected = TrackPopupMenuEx(
      menu,
      TPM_RETURNCMD | TPM_RIGHTBUTTON | TPM_NONOTIFY,
      location.x,
      location.y,
      state.window,
      nullptr);
  if (selected != 0) {
    const auto command = commands.find(selected);
    if (command != commands.end()) {
      try {
        if (command->second.checkbox) command->second.checked = !command->second.checked;
        DispatchMenuCommand(
            command->second.id,
            command->second.checkbox,
            command->second.checked);
      } catch (...) {
        DestroyMenu(menu);
        PostMessage(state.window, WM_NULL, 0, 0);
        throw;
      }
    }
  }
  DestroyMenu(menu);
  PostMessage(state.window, WM_NULL, 0, 0);
}

bool NativeWindow::TranslateAcceleratorMessage(MSG* message) {
  const auto& state = *state_;
  return state.window != nullptr && state.accelerator_table != nullptr &&
      TranslateAcceleratorW(state.window, state.accelerator_table, message) != 0;
}

void NativeWindow::DispatchMenuCommand(
    const std::string& id,
    bool checkbox,
    bool checked) {
  if (menu_handler_.IsEmpty() || menu_env_ == nullptr) return;
  const Napi::Env env(menu_env_);
  Napi::HandleScope scope(env);
  Napi::Object event = Napi::Object::New(env);
  event.Set("id", Napi::String::New(env, id));
  if (checkbox) event.Set("checked", Napi::Boolean::New(env, checked));
  menu_handler_.Call({event});
}

void NativeWindow::ClearMenuHandler() {
  menu_handler_.Reset();
  menu_env_ = nullptr;
}

void NativeWindow::SetTaskbarProgress(
    Napi::Env env,
    double value,
    const std::string& progress_state) {
  TBPFLAG flag = TBPF_NOPROGRESS;
  if (progress_state == "normal") flag = TBPF_NORMAL;
  else if (progress_state == "paused") flag = TBPF_PAUSED;
  else if (progress_state == "error") flag = TBPF_ERROR;
  else if (progress_state == "indeterminate") flag = TBPF_INDETERMINATE;
  else if (progress_state != "none") {
    throw Napi::TypeError::New(env, "Unsupported taskbar progress state.");
  }

  WindowsTaskbarList taskbar(env, "progress");
  HRESULT result = taskbar->SetProgressState(state_->window, flag);
  if (SUCCEEDED(result) && flag != TBPF_NOPROGRESS && flag != TBPF_INDETERMINATE) {
    constexpr ULONGLONG kProgressTotal = 10000;
    const ULONGLONG completed = static_cast<ULONGLONG>(value * kProgressTotal);
    result = taskbar->SetProgressValue(state_->window, completed, kProgressTotal);
  }
  if (FAILED(result)) {
    throw Napi::Error::New(
        env,
        "Could not update Windows taskbar progress (HRESULT:" + FormatHResult(result) + ").");
  }
  state_->taskbar_progress_state = progress_state;
  state_->taskbar_progress_value = value;
}

void NativeWindow::SetTaskbarOverlay(
    Napi::Env env,
    const std::wstring& icon_path,
    const std::wstring& description) {
  WindowsTaskbarList taskbar(env, "overlay icon");
  HICON icon = nullptr;
  if (!icon_path.empty()) {
    icon = static_cast<HICON>(LoadImageW(
        nullptr,
        icon_path.c_str(),
        IMAGE_ICON,
        0,
        0,
        LR_LOADFROMFILE | LR_DEFAULTSIZE));
    if (icon == nullptr) {
      throw Napi::Error::New(env, "Could not load the taskbar overlay icon. Use a valid .ico file.");
    }
  }
  // The documented API uses a null icon to remove the current overlay.
#pragma warning(suppress : 6387)
  const HRESULT result = taskbar->SetOverlayIcon(
      state_->window,
      icon,
      description.empty() ? nullptr : description.c_str());
  if (icon != nullptr) DestroyIcon(icon);
  if (FAILED(result)) {
    throw Napi::Error::New(
        env,
        "Could not update the Windows taskbar overlay (HRESULT:" + FormatHResult(result) + ").");
  }
  state_->taskbar_overlay = !icon_path.empty();
}

void NativeWindow::RequestAttention(Napi::Env env, const std::string& type) {
  DWORD flags = FLASHW_TRAY | FLASHW_TIMERNOFG;
  UINT count = 3;
  if (type == "critical") flags = FLASHW_ALL | FLASHW_TIMERNOFG;
  else if (type == "stop") {
    flags = FLASHW_STOP;
    count = 0;
  } else if (type != "informational") {
    throw Napi::TypeError::New(env, "Unsupported window attention type.");
  }
  FLASHWINFO flash{
      sizeof(FLASHWINFO),
      state_->window,
      flags,
      count,
      0};
  FlashWindowEx(&flash);
}

void NativeWindow::SetTray(const Napi::Object& options) {
  auto& g_state = *state_;
  const Napi::Env env = options.Env();
  if (g_state.window == nullptr) {
    throw Napi::Error::New(env, "Call createWindow before setTray.");
  }

  const std::wstring title = GetRequiredString(options, "title");
  const std::wstring icon_path = GetOptionalString(options, "icon");

  HICON icon = LoadIcon(nullptr, IDI_APPLICATION);
  HICON loaded_icon = nullptr;
  if (!icon_path.empty()) {
    loaded_icon = static_cast<HICON>(LoadImage(nullptr, icon_path.c_str(), IMAGE_ICON, 0, 0, LR_LOADFROMFILE));
    if (loaded_icon == nullptr) {
      throw Napi::Error::New(env, "Could not load the tray icon. Use a valid .ico file path.");
    }
    icon = loaded_icon;
  }

  NOTIFYICONDATA tray{};
  tray.cbSize = sizeof(tray);
  tray.hWnd = g_state.window;
  tray.uID = kTrayIconId;
  tray.uFlags = NIF_MESSAGE | NIF_ICON | NIF_TIP;
  tray.uCallbackMessage = kTrayCallbackMessage;
  tray.hIcon = icon;
  wcsncpy_s(tray.szTip, title.c_str(), _TRUNCATE);

  const DWORD action = g_state.tray_icon_added ? NIM_MODIFY : NIM_ADD;
  if (!Shell_NotifyIcon(action, &tray)) {
    if (loaded_icon != nullptr) {
      DestroyIcon(loaded_icon);
    }
    throw Napi::Error::New(env, "Could not set the tray icon.");
  }

  if (g_state.tray_icon != nullptr) {
    DestroyIcon(g_state.tray_icon);
  }
  g_state.tray_icon = loaded_icon;
  g_state.tray_icon_added = true;
}

void NativeWindow::ShowMessageDialog(const Napi::Object& options) {
  auto& g_state = *state_;
  const std::wstring title = GetRequiredString(options, "title");
  const std::wstring message = GetRequiredString(options, "message");
  MessageBox(g_state.window, message.c_str(), title.c_str(), MB_OK | MB_ICONINFORMATION);
}

void NativeWindow::ShowNotification(const Napi::Object& options) {
  auto& g_state = *state_;
  const Napi::Env env = options.Env();
  if (g_state.window == nullptr) {
    throw Napi::Error::New(env, "Call createWindow before showNotification.");
  }

  const std::wstring title = GetRequiredString(options, "title");
  const std::wstring message = GetRequiredString(options, "message");

  NOTIFYICONDATA notification{};
  notification.cbSize = sizeof(notification);
  notification.hWnd = g_state.window;
  notification.uID = kNotificationIconId;
  notification.uFlags = NIF_MESSAGE | NIF_ICON | NIF_TIP | NIF_INFO;
  notification.uCallbackMessage = kNotificationCallbackMessage;
  notification.hIcon = LoadIcon(nullptr, IDI_APPLICATION);
  wcsncpy_s(notification.szTip, title.c_str(), _TRUNCATE);
  wcsncpy_s(notification.szInfoTitle, title.c_str(), _TRUNCATE);
  wcsncpy_s(notification.szInfo, message.c_str(), _TRUNCATE);
  notification.dwInfoFlags = NIIF_INFO;

  if (!g_state.notification_icon_added) {
    if (!Shell_NotifyIcon(NIM_ADD, &notification)) {
      throw Napi::Error::New(env, "Could not register the notification icon.");
    }
    g_state.notification_icon_added = true;
  }

  if (!Shell_NotifyIcon(NIM_MODIFY, &notification)) {
    throw Napi::Error::New(env, "Could not show the notification.");
  }
}

Napi::Value ShowFileDialog(NativeWindow& native_window, Napi::Env env, bool save) {
  auto& g_state = native_window.State();
  std::vector<wchar_t> file_path(32768);
  OPENFILENAME dialog{};
  dialog.lStructSize = sizeof(dialog);
  dialog.hwndOwner = g_state.window;
  dialog.lpstrFile = file_path.data();
  dialog.nMaxFile = static_cast<DWORD>(file_path.size());
  dialog.lpstrFilter = L"All files\0*.*\0\0";
  dialog.Flags = OFN_EXPLORER | OFN_NOCHANGEDIR | OFN_PATHMUSTEXIST;
  if (save) {
    dialog.Flags |= OFN_OVERWRITEPROMPT;
  } else {
    dialog.Flags |= OFN_FILEMUSTEXIST;
  }

  const BOOL selected = save ? GetSaveFileName(&dialog) : GetOpenFileName(&dialog);
  if (!selected) {
    const DWORD error = CommDlgExtendedError();
    if (error != 0) {
      throw Napi::Error::New(
          env,
          std::string(save ? "Save file dialog failed" : "Open file dialog failed") +
              " (code " + std::to_string(error) + ").");
    }
    return env.Null();
  }

  const std::u16string utf16_path(
      reinterpret_cast<const char16_t*>(file_path.data()),
      wcslen(file_path.data()));
  return Napi::String::New(env, utf16_path);
}

Napi::Value NativeWindow::OpenFileDialog(Napi::Env env) {
  return ShowFileDialog(*this, env, false);
}

Napi::Value NativeWindow::SaveFileDialog(Napi::Env env) {
  return ShowFileDialog(*this, env, true);
}

void NativeWindow::LoadFile(const Napi::Value& value) {
  auto& g_state = *state_;
  if (g_state.window == nullptr) {
    throw Napi::Error::New(value.Env(), "Call createWindow before loadFile.");
  }

  g_state.entry_file = GetFilePath(value);
}

void NativeWindow::Start(Napi::Env env) {
  auto& g_state = *state_;
  if (g_state.window == nullptr) {
    throw Napi::Error::New(env, "Call createWindow before run.");
  }
  if (g_state.entry_file.empty()) {
    throw Napi::Error::New(env, "Call loadFile before run.");
  }

  ShowWindow(g_state.window, g_state.maximized ? SW_MAXIMIZE : SW_SHOWNORMAL);
  SetWindowPos(g_state.window, HWND_TOP, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW);
  SetForegroundWindow(g_state.window);
  UpdateWindow(g_state.window);

}

void NativeWindow::InitializeWebViewIfNeeded() {
  auto& state = *state_;
  if (state.webview_started || state.window == nullptr || state.entry_file.empty()) {
    return;
  }
  state.webview_started = true;
  webview_.Initialize(
      state.window,
      state.entry_file,
      state.webview_data_directory,
      state.bridge_embedded);
}

Napi::Object GetOptionsArgument(
    const Napi::CallbackInfo& info,
    std::size_t index,
    const char* operation) {
  if (info.Length() <= index || !info[index].IsObject() || info[index].IsArray()) {
    throw Napi::TypeError::New(
        info.Env(),
        std::string(operation) + " expects an options object.");
  }
  return info[index].As<Napi::Object>();
}

int GetIntegerArgument(
    const Napi::CallbackInfo& info,
    std::size_t index,
    const char* name,
    int minimum,
    int maximum) {
  if (info.Length() <= index || !info[index].IsNumber()) {
    throw Napi::TypeError::New(info.Env(), std::string(name) + " must be an integer.");
  }
  const double value = info[index].As<Napi::Number>().DoubleValue();
  if (!std::isfinite(value) || std::floor(value) != value ||
      value < minimum || value > maximum) {
    throw Napi::RangeError::New(
        info.Env(), std::string(name) + " is outside the supported range.");
  }
  return static_cast<int>(value);
}

Napi::Value CreateNativeWindow(const Napi::CallbackInfo& info) {
  if (info.Length() != 1) {
    throw Napi::TypeError::New(info.Env(), "createWindow expects one options object.");
  }
  const std::uint32_t id = GetRuntime().CreateWindowInstance(
      GetOptionsArgument(info, 0, "createWindow"));
  return Napi::Number::New(info.Env(), id);
}

void CloseNativeWindow(const Napi::CallbackInfo& info) {
  if (info.Length() == 0) {
    GetRuntime().PrimaryWindow(info.Env()).Close();
    return;
  }
  if (info.Length() != 1) {
    throw Napi::TypeError::New(info.Env(), "closeWindow expects an optional window id.");
  }
  GetRuntime().CloseWindow(info.Env(), GetWindowId(info, 0));
}

void CloseAllNativeWindows(const Napi::CallbackInfo& info) {
  if (info.Length() != 0) {
    throw Napi::TypeError::New(info.Env(), "closeAllWindows expects no arguments.");
  }
  GetRuntime().CloseAll();
}

void ShowNativeWindow(const Napi::CallbackInfo& info) {
  if (info.Length() == 0) {
    GetRuntime().PrimaryWindow(info.Env()).Show();
    return;
  }
  if (info.Length() != 1) {
    throw Napi::TypeError::New(info.Env(), "showWindow expects an optional window id.");
  }
  GetRuntime().Window(info.Env(), GetWindowId(info, 0)).Show();
}

void HideNativeWindow(const Napi::CallbackInfo& info) {
  if (info.Length() == 0) {
    GetRuntime().PrimaryWindow(info.Env()).Hide();
    return;
  }
  if (info.Length() != 1) {
    throw Napi::TypeError::New(info.Env(), "hideWindow expects an optional window id.");
  }
  GetRuntime().Window(info.Env(), GetWindowId(info, 0)).Hide();
}

void MinimizeNativeWindow(const Napi::CallbackInfo& info) {
  if (info.Length() != 1) {
    throw Napi::TypeError::New(info.Env(), "minimizeWindow expects a window id.");
  }
  GetRuntime().Window(info.Env(), GetWindowId(info, 0)).Minimize(info.Env());
}

void MaximizeNativeWindow(const Napi::CallbackInfo& info) {
  if (info.Length() != 1) {
    throw Napi::TypeError::New(info.Env(), "maximizeWindow expects a window id.");
  }
  GetRuntime().Window(info.Env(), GetWindowId(info, 0)).Maximize(info.Env());
}

void RestoreNativeWindow(const Napi::CallbackInfo& info) {
  if (info.Length() != 1) {
    throw Napi::TypeError::New(info.Env(), "restoreWindow expects a window id.");
  }
  GetRuntime().Window(info.Env(), GetWindowId(info, 0)).Restore(info.Env());
}

void SetNativeWindowFullscreen(const Napi::CallbackInfo& info) {
  if (info.Length() != 2 || !info[1].IsBoolean()) {
    throw Napi::TypeError::New(
        info.Env(), "setWindowFullscreen expects a window id and boolean.");
  }
  GetRuntime()
      .Window(info.Env(), GetWindowId(info, 0))
      .SetFullscreen(info.Env(), info[1].As<Napi::Boolean>().Value());
}

void SetNativeWindowTitle(const Napi::CallbackInfo& info) {
  if (info.Length() != 2) {
    throw Napi::TypeError::New(
        info.Env(), "setWindowTitle expects a window id and title string.");
  }
  GetRuntime().Window(info.Env(), GetWindowId(info, 0)).SetTitle(info[1]);
}

void SetNativeWindowSize(const Napi::CallbackInfo& info) {
  if (info.Length() != 3) {
    throw Napi::TypeError::New(
        info.Env(), "setWindowSize expects a window id, width, and height.");
  }
  const int width = GetIntegerArgument(info, 1, "Window width", 1, 32767);
  const int height = GetIntegerArgument(info, 2, "Window height", 1, 32767);
  GetRuntime().Window(info.Env(), GetWindowId(info, 0)).SetSize(info.Env(), width, height);
}

void SetNativeWindowPosition(const Napi::CallbackInfo& info) {
  if (info.Length() != 3) {
    throw Napi::TypeError::New(
        info.Env(), "setWindowPosition expects a window id, x, and y.");
  }
  const int x = GetIntegerArgument(info, 1, "Window x", -32768, 32767);
  const int y = GetIntegerArgument(info, 2, "Window y", -32768, 32767);
  GetRuntime().Window(info.Env(), GetWindowId(info, 0)).SetPosition(info.Env(), x, y);
}

void StartNativeWindowDrag(const Napi::CallbackInfo& info) {
  if (info.Length() != 1) {
    throw Napi::TypeError::New(info.Env(), "startWindowDrag expects a window id.");
  }
  GetRuntime().Window(info.Env(), GetWindowId(info, 0)).StartDrag();
}

Napi::Value GetNativeWindowState(const Napi::CallbackInfo& info) {
  if (info.Length() != 1) {
    throw Napi::TypeError::New(info.Env(), "getWindowState expects a window id.");
  }
  return GetRuntime().Window(info.Env(), GetWindowId(info, 0)).GetState(info.Env());
}

void SetNativeMenuHandler(const Napi::CallbackInfo& info) {
  if (info.Length() != 2 || !info[1].IsFunction()) {
    throw Napi::TypeError::New(info.Env(), "setMenuHandler expects a window id and function.");
  }
  GetRuntime()
      .Window(info.Env(), GetWindowId(info, 0))
      .SetMenuHandler(info[1].As<Napi::Function>());
}

void SetNativeApplicationMenu(const Napi::CallbackInfo& info) {
  if (info.Length() != 2 || (!info[1].IsArray() && !info[1].IsNull())) {
    throw Napi::TypeError::New(
        info.Env(), "setApplicationMenu expects a window id and menu array or null.");
  }
  GetRuntime()
      .Window(info.Env(), GetWindowId(info, 0))
      .SetApplicationMenu(info[1]);
}

void ShowNativeContextMenu(const Napi::CallbackInfo& info) {
  if (info.Length() != 3 || !info[1].IsArray() || !info[2].IsObject() || info[2].IsArray()) {
    throw Napi::TypeError::New(
        info.Env(), "showContextMenu expects a window id, menu array, and position object.");
  }
  GetRuntime()
      .Window(info.Env(), GetWindowId(info, 0))
      .ShowContextMenu(info[1].As<Napi::Array>(), info[2].As<Napi::Object>());
}

void SetNativeTaskbarProgress(const Napi::CallbackInfo& info) {
  if (info.Length() != 3 || !info[1].IsNumber() || !info[2].IsString()) {
    throw Napi::TypeError::New(
        info.Env(), "setTaskbarProgress expects a window id, value, and state string.");
  }
  const double value = info[1].As<Napi::Number>().DoubleValue();
  if (!std::isfinite(value) || value < 0 || value > 1) {
    throw Napi::RangeError::New(info.Env(), "Taskbar progress value must be between 0 and 1.");
  }
  GetRuntime()
      .Window(info.Env(), GetWindowId(info, 0))
      .SetTaskbarProgress(info.Env(), value, info[2].As<Napi::String>().Utf8Value());
}

void SetNativeTaskbarOverlay(const Napi::CallbackInfo& info) {
  if (info.Length() != 3 || (!info[1].IsString() && !info[1].IsNull()) || !info[2].IsString()) {
    throw Napi::TypeError::New(
        info.Env(), "setTaskbarOverlay expects a window id, icon path or null, and description.");
  }
  std::wstring icon_path;
  if (info[1].IsString()) {
    const std::u16string utf16 = info[1].As<Napi::String>().Utf16Value();
    icon_path.assign(reinterpret_cast<const wchar_t*>(utf16.data()), utf16.size());
  }
  const std::u16string description_utf16 = info[2].As<Napi::String>().Utf16Value();
  const std::wstring description(
      reinterpret_cast<const wchar_t*>(description_utf16.data()),
      description_utf16.size());
  GetRuntime()
      .Window(info.Env(), GetWindowId(info, 0))
      .SetTaskbarOverlay(info.Env(), icon_path, description);
}

void RequestNativeWindowAttention(const Napi::CallbackInfo& info) {
  if (info.Length() != 2 || !info[1].IsString()) {
    throw Napi::TypeError::New(
        info.Env(), "requestWindowAttention expects a window id and attention type.");
  }
  GetRuntime()
      .Window(info.Env(), GetWindowId(info, 0))
      .RequestAttention(info.Env(), info[1].As<Napi::String>().Utf8Value());
}

void SetTray(const Napi::CallbackInfo& info) {
  if (info.Length() == 1) {
    GetRuntime().PrimaryWindow(info.Env()).SetTray(GetOptionsArgument(info, 0, "setTray"));
    return;
  }
  if (info.Length() != 2) {
    throw Napi::TypeError::New(info.Env(), "setTray expects a window id and options object.");
  }
  GetRuntime()
      .Window(info.Env(), GetWindowId(info, 0))
      .SetTray(GetOptionsArgument(info, 1, "setTray"));
}

void ShowMessageDialog(const Napi::CallbackInfo& info) {
  if (info.Length() == 1) {
    GetRuntime().PrimaryWindow(info.Env()).ShowMessageDialog(
        GetOptionsArgument(info, 0, "showMessageDialog"));
    return;
  }
  if (info.Length() != 2) {
    throw Napi::TypeError::New(
        info.Env(), "showMessageDialog expects an optional window id and options object.");
  }
  GetRuntime()
      .Window(info.Env(), GetWindowId(info, 0))
      .ShowMessageDialog(GetOptionsArgument(info, 1, "showMessageDialog"));
}

void ShowNotification(const Napi::CallbackInfo& info) {
  if (info.Length() == 1) {
    GetRuntime().PrimaryWindow(info.Env()).ShowNotification(
        GetOptionsArgument(info, 0, "showNotification"));
    return;
  }
  if (info.Length() != 2) {
    throw Napi::TypeError::New(
        info.Env(), "showNotification expects an optional window id and options object.");
  }
  GetRuntime()
      .Window(info.Env(), GetWindowId(info, 0))
      .ShowNotification(GetOptionsArgument(info, 1, "showNotification"));
}

Napi::Value OpenFileDialog(const Napi::CallbackInfo& info) {
  if (info.Length() == 0) {
    return GetRuntime().PrimaryWindow(info.Env()).OpenFileDialog(info.Env());
  }
  if (info.Length() != 1) {
    throw Napi::TypeError::New(info.Env(), "openFileDialog expects an optional window id.");
  }
  return GetRuntime().Window(info.Env(), GetWindowId(info, 0)).OpenFileDialog(info.Env());
}

Napi::Value SaveFileDialog(const Napi::CallbackInfo& info) {
  if (info.Length() == 0) {
    return GetRuntime().PrimaryWindow(info.Env()).SaveFileDialog(info.Env());
  }
  if (info.Length() != 1) {
    throw Napi::TypeError::New(info.Env(), "saveFileDialog expects an optional window id.");
  }
  return GetRuntime().Window(info.Env(), GetWindowId(info, 0)).SaveFileDialog(info.Env());
}

void LoadFile(const Napi::CallbackInfo& info) {
  if (info.Length() == 1) {
    GetRuntime().PrimaryWindow(info.Env()).LoadFile(info[0]);
    return;
  }
  if (info.Length() != 2) {
    throw Napi::TypeError::New(info.Env(), "loadFile expects a window id and file path.");
  }
  GetRuntime().Window(info.Env(), GetWindowId(info, 0)).LoadFile(info[1]);
}

void Run(const Napi::CallbackInfo& info) {
  if (info.Length() != 0) {
    throw Napi::TypeError::New(info.Env(), "run expects no arguments.");
  }
  GetRuntime().Run(info.Env());
}

}  // namespace nodeview
