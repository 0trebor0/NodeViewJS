#include <gtk/gtk.h>
#include <jsc/jsc.h>
#include <napi.h>
#include <uv.h>
#include <webkit2/webkit2.h>

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <limits>
#include <map>
#include <memory>
#include <sstream>
#include <string>
#include <vector>

#include "bridge.h"
#include "native_api.h"

namespace nodeview {

struct LinuxWindow {
  std::uint32_t id = 0;
  bool live = true;
  bool close_to_hide = false;
  bool force_closing = false;
  bool transparent = false;
  bool devtools = false;
  bool bridge_embedded = false;
  GtkWidget* window = nullptr;
  WebKitWebView* webview = nullptr;
  WebKitUserContentManager* content_manager = nullptr;
  GtkStatusIcon* status_icon = nullptr;
  GtkWidget* tray_menu = nullptr;
  std::string entry_root_uri;
  std::string webview_data_directory;
  Napi::FunctionReference message_handler;
  napi_env env = nullptr;
};

struct LinuxRuntime {
  std::map<std::uint32_t, std::unique_ptr<LinuxWindow>> windows;
  std::uint32_t next_id = 1;
  uv_timer_t* event_timer = nullptr;
  GApplication* application = nullptr;
  bool initialized = false;
  bool running = false;
};

LinuxRuntime& Runtime() {
  static LinuxRuntime runtime;
  return runtime;
}

std::string StringOption(const Napi::Object& options, const char* name, const std::string& fallback) {
  const Napi::Value value = options.Get(name);
  if (value.IsUndefined()) return fallback;
  if (!value.IsString()) {
    throw Napi::TypeError::New(options.Env(), std::string(name) + " must be a string.");
  }
  return value.As<Napi::String>().Utf8Value();
}

bool BoolOption(const Napi::Object& options, const char* name, bool fallback) {
  const Napi::Value value = options.Get(name);
  if (value.IsUndefined()) return fallback;
  if (!value.IsBoolean()) {
    throw Napi::TypeError::New(options.Env(), std::string(name) + " must be a boolean.");
  }
  return value.As<Napi::Boolean>().Value();
}

double NumberOption(const Napi::Object& options, const char* name, double fallback) {
  const Napi::Value value = options.Get(name);
  if (value.IsUndefined()) return fallback;
  if (!value.IsNumber() || !std::isfinite(value.As<Napi::Number>().DoubleValue())) {
    throw Napi::TypeError::New(options.Env(), std::string(name) + " must be a finite number.");
  }
  return value.As<Napi::Number>().DoubleValue();
}

std::uint32_t WindowId(const Napi::CallbackInfo& info, std::size_t index) {
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

LinuxWindow& GetWindow(Napi::Env env, std::uint32_t id) {
  const auto found = Runtime().windows.find(id);
  if (found == Runtime().windows.end() || !found->second->live) {
    throw Napi::RangeError::New(env, "Unknown or closed window id.");
  }
  return *found->second;
}

LinuxWindow& PrimaryWindow(Napi::Env env) {
  for (const auto& [id, window] : Runtime().windows) {
    if (window->live) return *window;
  }
  throw Napi::Error::New(env, "No NodeView window is open.");
}

bool HasLiveWindows() {
  for (const auto& [id, window] : Runtime().windows) {
    if (window->live) return true;
  }
  return false;
}

void StopEventPump() {
  auto& runtime = Runtime();
  runtime.running = false;
  if (runtime.event_timer == nullptr) return;
  uv_timer_stop(runtime.event_timer);
  uv_close(reinterpret_cast<uv_handle_t*>(runtime.event_timer), [](uv_handle_t* handle) {
    delete reinterpret_cast<uv_timer_t*>(handle);
  });
  runtime.event_timer = nullptr;
}

void MarkWindowClosed(LinuxWindow* state) {
  if (state == nullptr || !state->live) return;
  state->live = false;
  state->message_handler.Reset();
  state->env = nullptr;
  state->window = nullptr;
  state->webview = nullptr;
  state->content_manager = nullptr;
  if (state->status_icon != nullptr) {
    g_object_unref(state->status_icon);
    state->status_icon = nullptr;
  }
  state->tray_menu = nullptr;
  if (!HasLiveWindows()) StopEventPump();
}

gboolean HandleDelete(GtkWidget* widget, GdkEvent*, gpointer data) {
  auto* state = static_cast<LinuxWindow*>(data);
  if (state != nullptr && state->close_to_hide && !state->force_closing) {
    gtk_widget_hide(widget);
    return TRUE;
  }
  return FALSE;
}

void HandleDestroy(GtkWidget*, gpointer data) {
  MarkWindowClosed(static_cast<LinuxWindow*>(data));
}

void CloseWindow(LinuxWindow& state) {
  if (!state.live) return;
  state.force_closing = true;
  gtk_widget_destroy(state.window);
  MarkWindowClosed(&state);
}

void CloseAllWindows() {
  std::vector<LinuxWindow*> windows;
  for (const auto& [id, window] : Runtime().windows) {
    if (window->live) windows.push_back(window.get());
  }
  for (LinuxWindow* window : windows) CloseWindow(*window);
}

void EnsureGtk(Napi::Env env) {
  auto& runtime = Runtime();
  if (runtime.initialized) return;
  if (!gtk_init_check(nullptr, nullptr)) {
    throw Napi::Error::New(env, "Could not initialize GTK. Check that a graphical display is available.");
  }
  runtime.application = g_application_new("io.github.nodeviewjs.Runtime", G_APPLICATION_NON_UNIQUE);
  GError* error = nullptr;
  if (!g_application_register(runtime.application, nullptr, &error)) {
    const std::string message = error == nullptr ? "unknown error" : error->message;
    if (error != nullptr) g_error_free(error);
    g_object_unref(runtime.application);
    runtime.application = nullptr;
    throw Napi::Error::New(env, "Could not initialize Linux application services: " + message);
  }
  runtime.initialized = true;
}

std::string QuoteJavaScriptString(const std::string& value) {
  std::ostringstream output;
  output << '"';
  for (const unsigned char character : value) {
    switch (character) {
      case '\\': output << "\\\\"; break;
      case '"': output << "\\\""; break;
      case '\b': output << "\\b"; break;
      case '\f': output << "\\f"; break;
      case '\n': output << "\\n"; break;
      case '\r': output << "\\r"; break;
      case '\t': output << "\\t"; break;
      default:
        if (character < 0x20) {
          const char hex[] = "0123456789abcdef";
          output << "\\u00" << hex[character >> 4] << hex[character & 0x0f];
        } else {
          output << character;
        }
    }
  }
  output << '"';
  return output.str();
}

void HandleScriptMessage(WebKitUserContentManager*, WebKitJavascriptResult* result, gpointer data) {
  auto* state = static_cast<LinuxWindow*>(data);
  if (state == nullptr || !state->live || state->message_handler.IsEmpty() || state->env == nullptr) return;
  JSCValue* value = webkit_javascript_result_get_js_value(result);
  gchar* json = jsc_value_to_json(value, 0);
  if (json == nullptr) return;
  Napi::Env env(state->env);
  Napi::HandleScope scope(env);
  state->message_handler.Call({Napi::String::New(env, json)});
  g_free(json);
}

gboolean DecidePolicy(WebKitWebView*, WebKitPolicyDecision* decision,
                      WebKitPolicyDecisionType type, gpointer data) {
  if (type != WEBKIT_POLICY_DECISION_TYPE_NAVIGATION_ACTION) return FALSE;
  auto* state = static_cast<LinuxWindow*>(data);
  WebKitURIRequest* request = webkit_navigation_policy_decision_get_request(
      WEBKIT_NAVIGATION_POLICY_DECISION(decision));
  const char* uri = webkit_uri_request_get_uri(request);
  if (state != nullptr && uri != nullptr &&
      std::string(uri).rfind(state->entry_root_uri, 0) == 0) {
    return FALSE;
  }
  g_warning("NodeViewJS blocked top-level navigation to %s", uri == nullptr ? "<unknown>" : uri);
  webkit_policy_decision_ignore(decision);
  return TRUE;
}

Napi::Value CreateNativeWindow(const Napi::CallbackInfo& info) {
  if (info.Length() != 1 || !info[0].IsObject()) {
    throw Napi::TypeError::New(info.Env(), "createWindow expects an options object.");
  }
  EnsureGtk(info.Env());
  const Napi::Object options = info[0].As<Napi::Object>();
  const double width = NumberOption(options, "width", 800);
  const double height = NumberOption(options, "height", 600);
  if (width <= 0 || height <= 0) {
    throw Napi::RangeError::New(info.Env(), "Window width and height must be positive.");
  }

  auto state = std::make_unique<LinuxWindow>();
  state->id = Runtime().next_id++;
  state->close_to_hide = BoolOption(options, "closeToHide", false);
  state->transparent = BoolOption(options, "transparent", false);
  state->devtools = BoolOption(options, "devtools", false);
  state->bridge_embedded = BoolOption(options, "bridgeEmbedded", false);
  state->webview_data_directory = StringOption(options, "dataDirectory", "");
  state->window = gtk_window_new(GTK_WINDOW_TOPLEVEL);
  gtk_window_set_title(GTK_WINDOW(state->window), StringOption(options, "title", "NodeViewJS").c_str());
  gtk_window_set_default_size(GTK_WINDOW(state->window), static_cast<int>(width), static_cast<int>(height));
  gtk_window_set_resizable(GTK_WINDOW(state->window), BoolOption(options, "resizable", true));
  gtk_window_set_keep_above(GTK_WINDOW(state->window), BoolOption(options, "alwaysOnTop", false));
  if (BoolOption(options, "center", false)) {
    gtk_window_set_position(GTK_WINDOW(state->window), GTK_WIN_POS_CENTER);
  }
  if (BoolOption(options, "maximized", false)) gtk_window_maximize(GTK_WINDOW(state->window));

  GdkGeometry geometry{};
  GdkWindowHints hints = static_cast<GdkWindowHints>(0);
  const double min_width = NumberOption(options, "minWidth", 0);
  const double min_height = NumberOption(options, "minHeight", 0);
  const double max_width = NumberOption(options, "maxWidth", 0);
  const double max_height = NumberOption(options, "maxHeight", 0);
  if (min_width > 0 || min_height > 0) {
    geometry.min_width = static_cast<int>(std::max(1.0, min_width));
    geometry.min_height = static_cast<int>(std::max(1.0, min_height));
    hints = static_cast<GdkWindowHints>(hints | GDK_HINT_MIN_SIZE);
  }
  if (max_width > 0 || max_height > 0) {
    geometry.max_width = static_cast<int>(max_width > 0 ? max_width : G_MAXINT);
    geometry.max_height = static_cast<int>(max_height > 0 ? max_height : G_MAXINT);
    hints = static_cast<GdkWindowHints>(hints | GDK_HINT_MAX_SIZE);
  }
  if (hints != 0) gtk_window_set_geometry_hints(GTK_WINDOW(state->window), nullptr, &geometry, hints);

  const std::string icon = StringOption(options, "icon", "");
  if (!icon.empty()) {
    GError* icon_error = nullptr;
    if (!gtk_window_set_icon_from_file(GTK_WINDOW(state->window), icon.c_str(), &icon_error)) {
      g_warning("NodeViewJS could not load window icon: %s", icon_error->message);
      g_error_free(icon_error);
    }
  }
  g_signal_connect(state->window, "delete-event", G_CALLBACK(HandleDelete), state.get());
  g_signal_connect(state->window, "destroy", G_CALLBACK(HandleDestroy), state.get());

  const std::uint32_t id = state->id;
  Runtime().windows.emplace(id, std::move(state));
  return Napi::Number::New(info.Env(), id);
}

void CloseNativeWindow(const Napi::CallbackInfo& info) {
  if (info.Length() > 1) throw Napi::TypeError::New(info.Env(), "closeWindow expects an optional window id.");
  CloseWindow(info.Length() == 0 ? PrimaryWindow(info.Env()) : GetWindow(info.Env(), WindowId(info, 0)));
}

void CloseAllNativeWindows(const Napi::CallbackInfo& info) {
  if (info.Length() != 0) throw Napi::TypeError::New(info.Env(), "closeAllWindows expects no arguments.");
  CloseAllWindows();
}

void ShowNativeWindow(const Napi::CallbackInfo& info) {
  if (info.Length() > 1) throw Napi::TypeError::New(info.Env(), "showWindow expects an optional window id.");
  LinuxWindow& state = info.Length() == 0 ? PrimaryWindow(info.Env()) : GetWindow(info.Env(), WindowId(info, 0));
  gtk_widget_show_all(state.window);
  gtk_window_present(GTK_WINDOW(state.window));
}

void HideNativeWindow(const Napi::CallbackInfo& info) {
  if (info.Length() > 1) throw Napi::TypeError::New(info.Env(), "hideWindow expects an optional window id.");
  LinuxWindow& state = info.Length() == 0 ? PrimaryWindow(info.Env()) : GetWindow(info.Env(), WindowId(info, 0));
  gtk_widget_hide(state.window);
}

void TrayShow(GtkMenuItem*, gpointer data) {
  auto* state = static_cast<LinuxWindow*>(data);
  if (state == nullptr || !state->live) return;
  gtk_widget_show_all(state->window);
  gtk_window_present(GTK_WINDOW(state->window));
}

void TrayQuit(GtkMenuItem*, gpointer) {
  CloseAllWindows();
}

void TrayPopup(GtkStatusIcon* icon, guint button, guint time, gpointer data) {
  auto* state = static_cast<LinuxWindow*>(data);
  if (state != nullptr && state->tray_menu != nullptr) {
    gtk_menu_popup(GTK_MENU(state->tray_menu), nullptr, nullptr,
                   gtk_status_icon_position_menu, icon, button, time);
  }
}

void SetTray(const Napi::CallbackInfo& info) {
  const std::size_t options_index = info.Length() == 1 ? 0 : 1;
  LinuxWindow& state = info.Length() == 1 ? PrimaryWindow(info.Env()) : GetWindow(info.Env(), WindowId(info, 0));
  if ((info.Length() != 1 && info.Length() != 2) || !info[options_index].IsObject()) {
    throw Napi::TypeError::New(info.Env(), "setTray expects an options object.");
  }
  const Napi::Object options = info[options_index].As<Napi::Object>();
  if (state.status_icon == nullptr) {
    state.status_icon = gtk_status_icon_new_from_icon_name("applications-system");
    state.tray_menu = gtk_menu_new();
    GtkWidget* show = gtk_menu_item_new_with_label("Show");
    GtkWidget* quit = gtk_menu_item_new_with_label("Quit");
    gtk_menu_shell_append(GTK_MENU_SHELL(state.tray_menu), show);
    gtk_menu_shell_append(GTK_MENU_SHELL(state.tray_menu), quit);
    g_signal_connect(show, "activate", G_CALLBACK(TrayShow), &state);
    g_signal_connect(quit, "activate", G_CALLBACK(TrayQuit), &state);
    g_signal_connect(state.status_icon, "popup-menu", G_CALLBACK(TrayPopup), &state);
    gtk_widget_show_all(state.tray_menu);
  }
  gtk_status_icon_set_tooltip_text(state.status_icon, StringOption(options, "title", "NodeViewJS").c_str());
  gtk_status_icon_set_visible(state.status_icon, TRUE);
}

void ShowMessageDialog(const Napi::CallbackInfo& info) {
  const std::size_t options_index = info.Length() == 1 ? 0 : 1;
  LinuxWindow& state = info.Length() == 1 ? PrimaryWindow(info.Env()) : GetWindow(info.Env(), WindowId(info, 0));
  if ((info.Length() != 1 && info.Length() != 2) || !info[options_index].IsObject()) {
    throw Napi::TypeError::New(info.Env(), "showMessageDialog expects an optional window id and options object.");
  }
  const Napi::Object options = info[options_index].As<Napi::Object>();
  GtkWidget* dialog = gtk_message_dialog_new(GTK_WINDOW(state.window), GTK_DIALOG_MODAL,
      GTK_MESSAGE_INFO, GTK_BUTTONS_OK, "%s", StringOption(options, "message", "").c_str());
  gtk_window_set_title(GTK_WINDOW(dialog), StringOption(options, "title", "NodeViewJS").c_str());
  gtk_dialog_run(GTK_DIALOG(dialog));
  gtk_widget_destroy(dialog);
}

void ShowNotification(const Napi::CallbackInfo& info) {
  const std::size_t options_index = info.Length() == 1 ? 0 : 1;
  if (info.Length() == 2) GetWindow(info.Env(), WindowId(info, 0));
  else PrimaryWindow(info.Env());
  if ((info.Length() != 1 && info.Length() != 2) || !info[options_index].IsObject()) {
    throw Napi::TypeError::New(info.Env(), "showNotification expects an optional window id and options object.");
  }
  const Napi::Object options = info[options_index].As<Napi::Object>();
  GNotification* notification = g_notification_new(StringOption(options, "title", "NodeViewJS").c_str());
  g_notification_set_body(notification, StringOption(options, "message", "").c_str());
  g_application_send_notification(Runtime().application, nullptr, notification);
  g_object_unref(notification);
}

Napi::Value FileDialog(const Napi::CallbackInfo& info, GtkFileChooserAction action) {
  LinuxWindow& state = info.Length() == 0 ? PrimaryWindow(info.Env()) : GetWindow(info.Env(), WindowId(info, 0));
  const char* accept = action == GTK_FILE_CHOOSER_ACTION_OPEN ? "_Open" : "_Save";
  GtkWidget* dialog = gtk_file_chooser_dialog_new(
      action == GTK_FILE_CHOOSER_ACTION_OPEN ? "Open File" : "Save File",
      GTK_WINDOW(state.window), action, "_Cancel", GTK_RESPONSE_CANCEL,
      accept, GTK_RESPONSE_ACCEPT, nullptr);
  if (action == GTK_FILE_CHOOSER_ACTION_SAVE) {
    gtk_file_chooser_set_do_overwrite_confirmation(GTK_FILE_CHOOSER(dialog), TRUE);
  }
  Napi::Value result = info.Env().Null();
  if (gtk_dialog_run(GTK_DIALOG(dialog)) == GTK_RESPONSE_ACCEPT) {
    char* filename = gtk_file_chooser_get_filename(GTK_FILE_CHOOSER(dialog));
    result = Napi::String::New(info.Env(), filename);
    g_free(filename);
  }
  gtk_widget_destroy(dialog);
  return result;
}

Napi::Value OpenFileDialog(const Napi::CallbackInfo& info) {
  if (info.Length() > 1) throw Napi::TypeError::New(info.Env(), "openFileDialog expects an optional window id.");
  return FileDialog(info, GTK_FILE_CHOOSER_ACTION_OPEN);
}

Napi::Value SaveFileDialog(const Napi::CallbackInfo& info) {
  if (info.Length() > 1) throw Napi::TypeError::New(info.Env(), "saveFileDialog expects an optional window id.");
  return FileDialog(info, GTK_FILE_CHOOSER_ACTION_SAVE);
}

void LoadFile(const Napi::CallbackInfo& info) {
  const std::size_t value_index = info.Length() == 1 ? 0 : 1;
  LinuxWindow& state = info.Length() == 1 ? PrimaryWindow(info.Env()) : GetWindow(info.Env(), WindowId(info, 0));
  if (info.Length() <= value_index || !info[value_index].IsString()) {
    throw Napi::TypeError::New(info.Env(), "loadFile expects a file path string.");
  }
  const std::string entry = info[value_index].As<Napi::String>().Utf8Value();
  char* directory = g_path_get_dirname(entry.c_str());
  char* root_uri = g_filename_to_uri(directory, nullptr, nullptr);
  char* entry_uri = g_filename_to_uri(entry.c_str(), nullptr, nullptr);
  g_free(directory);
  if (root_uri == nullptr || entry_uri == nullptr) {
    g_free(root_uri);
    g_free(entry_uri);
    throw Napi::Error::New(info.Env(), "Could not create a file URL for the app entry file.");
  }
  state.entry_root_uri = std::string(root_uri) + "/";
  g_free(root_uri);

  state.content_manager = webkit_user_content_manager_new();
  g_signal_connect(state.content_manager, "script-message-received::nodeview",
                   G_CALLBACK(HandleScriptMessage), &state);
  if (!webkit_user_content_manager_register_script_message_handler(state.content_manager, "nodeview")) {
    g_free(entry_uri);
    throw Napi::Error::New(info.Env(), "Could not register the NodeViewJS WebKit message handler.");
  }
  if (!state.bridge_embedded) {
    WebKitUserScript* bridge = webkit_user_script_new(
        GetBridgeScriptUtf8(), WEBKIT_USER_CONTENT_INJECT_ALL_FRAMES,
        WEBKIT_USER_SCRIPT_INJECT_AT_DOCUMENT_START, nullptr, nullptr);
    webkit_user_content_manager_add_script(state.content_manager, bridge);
    webkit_user_script_unref(bridge);
  }

  if (state.webview_data_directory.empty()) {
    state.webview = WEBKIT_WEB_VIEW(webkit_web_view_new_with_user_content_manager(state.content_manager));
  } else {
    WebKitWebsiteDataManager* manager = webkit_website_data_manager_new(
        "base-data-directory", state.webview_data_directory.c_str(),
        "base-cache-directory", state.webview_data_directory.c_str(), nullptr);
    WebKitWebContext* context = webkit_web_context_new_with_website_data_manager(manager);
    state.webview = WEBKIT_WEB_VIEW(g_object_new(
        WEBKIT_TYPE_WEB_VIEW, "web-context", context,
        "user-content-manager", state.content_manager, nullptr));
    g_object_unref(context);
    g_object_unref(manager);
  }
  WebKitSettings* settings = webkit_web_view_get_settings(state.webview);
  webkit_settings_set_enable_developer_extras(settings, state.devtools);
  if (state.transparent) {
    const GdkRGBA transparent{0, 0, 0, 0};
    webkit_web_view_set_background_color(state.webview, &transparent);
    gtk_widget_set_app_paintable(state.window, TRUE);
  }
  g_signal_connect(state.webview, "decide-policy", G_CALLBACK(DecidePolicy), &state);
  gtk_container_add(GTK_CONTAINER(state.window), GTK_WIDGET(state.webview));
  webkit_web_view_load_uri(state.webview, entry_uri);
  g_free(entry_uri);
}

void SetMessageHandler(const Napi::CallbackInfo& info) {
  const std::size_t handler_index = info.Length() == 1 ? 0 : 1;
  LinuxWindow& state = info.Length() == 1 ? PrimaryWindow(info.Env()) : GetWindow(info.Env(), WindowId(info, 0));
  if (info.Length() <= handler_index || !info[handler_index].IsFunction()) {
    throw Napi::TypeError::New(info.Env(), "setMessageHandler expects a function.");
  }
  state.message_handler.Reset();
  state.env = info.Env();
  state.message_handler = Napi::Persistent(info[handler_index].As<Napi::Function>());
}

void PostWebMessage(const Napi::CallbackInfo& info) {
  const std::size_t value_index = info.Length() == 1 ? 0 : 1;
  LinuxWindow& state = info.Length() == 1 ? PrimaryWindow(info.Env()) : GetWindow(info.Env(), WindowId(info, 0));
  if (info.Length() <= value_index || !info[value_index].IsString()) {
    throw Napi::TypeError::New(info.Env(), "postMessage expects serialized JSON.");
  }
  const std::string json = info[value_index].As<Napi::String>().Utf8Value();
  const std::string script = "window.__nodeviewReceive(JSON.parse(" + QuoteJavaScriptString(json) + "));";
  webkit_web_view_evaluate_javascript(state.webview, script.c_str(), -1, nullptr, nullptr,
                                      nullptr, nullptr, nullptr);
}

void ReloadWebView(const Napi::CallbackInfo& info) {
  if (info.Length() > 1) throw Napi::TypeError::New(info.Env(), "reload expects an optional window id.");
  LinuxWindow& state = info.Length() == 0 ? PrimaryWindow(info.Env()) : GetWindow(info.Env(), WindowId(info, 0));
  webkit_web_view_reload(state.webview);
}

void Run(const Napi::CallbackInfo& info) {
  if (info.Length() != 0) throw Napi::TypeError::New(info.Env(), "run expects no arguments.");
  auto& runtime = Runtime();
  if (runtime.running) throw Napi::Error::New(info.Env(), "NodeViewJS is already running.");
  if (!HasLiveWindows()) throw Napi::Error::New(info.Env(), "Call createWindow before run.");
  for (const auto& [id, window] : runtime.windows) {
    if (window->live) gtk_widget_show_all(window->window);
  }
  auto* timer = new uv_timer_t();
  if (uv_timer_init(uv_default_loop(), timer) != 0) {
    delete timer;
    throw Napi::Error::New(info.Env(), "Could not start the Linux event pump.");
  }
  if (uv_timer_start(timer, [](uv_timer_t*) {
        while (gtk_events_pending()) gtk_main_iteration_do(FALSE);
      }, 0, 10) != 0) {
    uv_close(reinterpret_cast<uv_handle_t*>(timer), [](uv_handle_t* handle) {
      delete reinterpret_cast<uv_timer_t*>(handle);
    });
    throw Napi::Error::New(info.Env(), "Could not start the Linux event pump.");
  }
  runtime.event_timer = timer;
  runtime.running = true;
}

}  // namespace nodeview
