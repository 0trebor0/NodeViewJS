#import <Cocoa/Cocoa.h>
#import <WebKit/WebKit.h>

#include <napi.h>
#include <uv.h>

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <limits>
#include <map>
#include <memory>
#include <string>
#include <vector>

#include "bridge.h"
#include "native_api.h"

namespace nodeview {
struct MacWindow;
void MarkWindowClosed(MacWindow* state);
void CloseAllWindows();
}

@interface NodeViewScriptHandler : NSObject <WKScriptMessageHandler>
@property(nonatomic, assign) nodeview::MacWindow* owner;
@end

@interface NodeViewNavigationDelegate : NSObject <WKNavigationDelegate>
@property(nonatomic, assign) nodeview::MacWindow* owner;
@end

@interface NodeViewWindowDelegate : NSObject <NSWindowDelegate>
@property(nonatomic, assign) nodeview::MacWindow* owner;
@end

@interface NodeViewTrayTarget : NSObject
@property(nonatomic, assign) nodeview::MacWindow* owner;
- (void)showWindow:(id)sender;
- (void)quitApplication:(id)sender;
@end

namespace nodeview {

struct MacWindow {
  std::uint32_t id = 0;
  bool live = true;
  bool close_to_hide = false;
  bool force_closing = false;
  bool transparent = false;
  bool devtools = false;
  bool bridge_embedded = false;
  __strong NSWindow* window = nil;
  __strong WKWebView* webview = nil;
  __strong NodeViewScriptHandler* script_handler = nil;
  __strong NodeViewNavigationDelegate* navigation_delegate = nil;
  __strong NodeViewWindowDelegate* window_delegate = nil;
  __strong NSStatusItem* status_item = nil;
  __strong NodeViewTrayTarget* tray_target = nil;
  __strong NSURL* entry_root = nil;
  Napi::FunctionReference message_handler;
  napi_env env = nullptr;
};

struct MacRuntime {
  std::map<std::uint32_t, std::unique_ptr<MacWindow>> windows;
  std::uint32_t next_id = 1;
  uv_timer_t* event_timer = nullptr;
  bool application_initialized = false;
  bool running = false;
};

MacRuntime& Runtime() {
  static MacRuntime runtime;
  return runtime;
}

NSString* ToNSString(const std::string& value) {
  return [[NSString alloc] initWithBytes:value.data()
                                  length:value.size()
                                encoding:NSUTF8StringEncoding];
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

MacWindow& GetWindow(Napi::Env env, std::uint32_t id) {
  auto& runtime = Runtime();
  const auto found = runtime.windows.find(id);
  if (found == runtime.windows.end() || !found->second->live) {
    throw Napi::RangeError::New(env, "Unknown or closed window id.");
  }
  return *found->second;
}

MacWindow& PrimaryWindow(Napi::Env env) {
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
  if (runtime.event_timer != nullptr) {
    uv_timer_stop(runtime.event_timer);
    uv_close(reinterpret_cast<uv_handle_t*>(runtime.event_timer), [](uv_handle_t* handle) {
      delete reinterpret_cast<uv_timer_t*>(handle);
    });
    runtime.event_timer = nullptr;
  }
}

void MarkWindowClosed(MacWindow* state) {
  if (state == nullptr || !state->live) return;
  state->live = false;
  state->message_handler.Reset();
  state->env = nullptr;
  [state->webview.configuration.userContentController removeScriptMessageHandlerForName:@"nodeview"];
  state->webview = nil;
  if (state->status_item != nil) {
    [[NSStatusBar systemStatusBar] removeStatusItem:state->status_item];
    state->status_item = nil;
  }
  state->window = nil;
  if (!HasLiveWindows()) StopEventPump();
}

void CloseWindow(MacWindow& state) {
  if (!state.live) return;
  state.force_closing = true;
  [state.window close];
  MarkWindowClosed(&state);
}

void CloseAllWindows() {
  std::vector<MacWindow*> windows;
  for (const auto& [id, window] : Runtime().windows) {
    if (window->live) windows.push_back(window.get());
  }
  for (MacWindow* window : windows) CloseWindow(*window);
}

void PumpCocoaEvents() {
  @autoreleasepool {
    while (true) {
      NSEvent* event = [NSApp nextEventMatchingMask:NSEventMaskAny
                                         untilDate:[NSDate distantPast]
                                            inMode:NSDefaultRunLoopMode
                                           dequeue:YES];
      if (event == nil) break;
      [NSApp sendEvent:event];
    }
    [NSApp updateWindows];
  }
}

NSString* QuoteJsonString(NSString* value) {
  NSData* data = [NSJSONSerialization dataWithJSONObject:@[value] options:0 error:nil];
  NSString* array = [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding];
  return [array substringWithRange:NSMakeRange(1, array.length - 2)];
}

Napi::Value CreateNativeWindow(const Napi::CallbackInfo& info) {
  if (info.Length() != 1 || !info[0].IsObject()) {
    throw Napi::TypeError::New(info.Env(), "createWindow expects an options object.");
  }
  const Napi::Object options = info[0].As<Napi::Object>();
  const double width = NumberOption(options, "width", 800);
  const double height = NumberOption(options, "height", 600);
  if (width <= 0 || height <= 0) {
    throw Napi::RangeError::New(info.Env(), "Window width and height must be positive.");
  }

  [NSApplication sharedApplication];
  if (!Runtime().application_initialized) {
    [NSApp setActivationPolicy:NSApplicationActivationPolicyRegular];
    [NSApp finishLaunching];
    Runtime().application_initialized = true;
  }

  auto state = std::make_unique<MacWindow>();
  state->id = Runtime().next_id++;
  state->close_to_hide = BoolOption(options, "closeToHide", false);
  state->transparent = BoolOption(options, "transparent", false);
  state->devtools = BoolOption(options, "devtools", false);
  state->bridge_embedded = BoolOption(options, "bridgeEmbedded", false);

  NSWindowStyleMask style = NSWindowStyleMaskTitled | NSWindowStyleMaskClosable |
      NSWindowStyleMaskMiniaturizable;
  if (BoolOption(options, "resizable", true)) style |= NSWindowStyleMaskResizable;
  state->window = [[NSWindow alloc]
      initWithContentRect:NSMakeRect(0, 0, width, height)
                styleMask:style
                  backing:NSBackingStoreBuffered
                    defer:NO];
  state->window.title = ToNSString(StringOption(options, "title", "NodeViewJS"));
  state->window.releasedWhenClosed = NO;
  state->window_delegate = [NodeViewWindowDelegate new];
  state->window_delegate.owner = state.get();
  state->window.delegate = state->window_delegate;

  const double min_width = NumberOption(options, "minWidth", 0);
  const double min_height = NumberOption(options, "minHeight", 0);
  if (min_width > 0 || min_height > 0) {
    state->window.contentMinSize = NSMakeSize(std::max(1.0, min_width), std::max(1.0, min_height));
  }
  const double max_width = NumberOption(options, "maxWidth", 0);
  const double max_height = NumberOption(options, "maxHeight", 0);
  if (max_width > 0 || max_height > 0) {
    state->window.contentMaxSize = NSMakeSize(
        max_width > 0 ? max_width : std::numeric_limits<double>::max(),
        max_height > 0 ? max_height : std::numeric_limits<double>::max());
  }
  if (BoolOption(options, "center", false)) [state->window center];
  if (BoolOption(options, "alwaysOnTop", false)) state->window.level = NSFloatingWindowLevel;
  if (state->transparent) {
    state->window.opaque = NO;
    state->window.backgroundColor = [NSColor clearColor];
  }
  if (BoolOption(options, "maximized", false)) [state->window zoom:nil];
  const std::string icon = StringOption(options, "icon", "");
  if (!icon.empty()) {
    NSImage* image = [[NSImage alloc] initWithContentsOfFile:ToNSString(icon)];
    if (image != nil) NSApp.applicationIconImage = image;
  }

  const std::uint32_t id = state->id;
  Runtime().windows.emplace(id, std::move(state));
  return Napi::Number::New(info.Env(), id);
}

void CloseNativeWindow(const Napi::CallbackInfo& info) {
  if (info.Length() == 0) {
    CloseWindow(PrimaryWindow(info.Env()));
    return;
  }
  if (info.Length() != 1) {
    throw Napi::TypeError::New(info.Env(), "closeWindow expects an optional window id.");
  }
  CloseWindow(GetWindow(info.Env(), WindowId(info, 0)));
}

void CloseAllNativeWindows(const Napi::CallbackInfo& info) {
  if (info.Length() != 0) {
    throw Napi::TypeError::New(info.Env(), "closeAllWindows expects no arguments.");
  }
  CloseAllWindows();
}

void ShowNativeWindow(const Napi::CallbackInfo& info) {
  if (info.Length() > 1) {
    throw Napi::TypeError::New(info.Env(), "showWindow expects an optional window id.");
  }
  MacWindow& state = info.Length() == 0
      ? PrimaryWindow(info.Env())
      : GetWindow(info.Env(), WindowId(info, 0));
  [state.window makeKeyAndOrderFront:nil];
  [NSApp activateIgnoringOtherApps:YES];
}

void HideNativeWindow(const Napi::CallbackInfo& info) {
  if (info.Length() > 1) {
    throw Napi::TypeError::New(info.Env(), "hideWindow expects an optional window id.");
  }
  MacWindow& state = info.Length() == 0
      ? PrimaryWindow(info.Env())
      : GetWindow(info.Env(), WindowId(info, 0));
  [state.window orderOut:nil];
}

void SetTray(const Napi::CallbackInfo& info) {
  const std::size_t options_index = info.Length() == 1 ? 0 : 1;
  MacWindow& state = info.Length() == 1
      ? PrimaryWindow(info.Env())
      : GetWindow(info.Env(), WindowId(info, 0));
  if (info.Length() <= options_index || !info[options_index].IsObject()) {
    throw Napi::TypeError::New(info.Env(), "setTray expects an options object.");
  }
  const Napi::Object options = info[options_index].As<Napi::Object>();
  if (state.status_item == nil) {
    state.status_item = [[NSStatusBar systemStatusBar] statusItemWithLength:NSVariableStatusItemLength];
    state.tray_target = [NodeViewTrayTarget new];
    state.tray_target.owner = &state;
  }
  state.status_item.button.title = ToNSString(StringOption(options, "title", "NodeViewJS"));
  NSMenu* menu = [NSMenu new];
  NSMenuItem* show = [[NSMenuItem alloc] initWithTitle:@"Show"
                                               action:@selector(showWindow:)
                                        keyEquivalent:@""];
  show.target = state.tray_target;
  [menu addItem:show];
  [menu addItem:[NSMenuItem separatorItem]];
  NSMenuItem* quit = [[NSMenuItem alloc] initWithTitle:@"Quit"
                                               action:@selector(quitApplication:)
                                        keyEquivalent:@""];
  quit.target = state.tray_target;
  [menu addItem:quit];
  state.status_item.menu = menu;
}

void ShowMessageDialog(const Napi::CallbackInfo& info) {
  const std::size_t options_index = info.Length() == 1 ? 0 : 1;
  if (info.Length() == 2) GetWindow(info.Env(), WindowId(info, 0));
  if ((info.Length() != 1 && info.Length() != 2) || !info[options_index].IsObject()) {
    throw Napi::TypeError::New(info.Env(), "showMessageDialog expects an optional window id and options object.");
  }
  const Napi::Object options = info[options_index].As<Napi::Object>();
  NSAlert* alert = [NSAlert new];
  alert.messageText = ToNSString(StringOption(options, "title", "NodeViewJS"));
  alert.informativeText = ToNSString(StringOption(options, "message", ""));
  [alert runModal];
}

void ShowNotification(const Napi::CallbackInfo& info) {
  const std::size_t options_index = info.Length() == 1 ? 0 : 1;
  if (info.Length() == 2) GetWindow(info.Env(), WindowId(info, 0));
  if ((info.Length() != 1 && info.Length() != 2) || !info[options_index].IsObject()) {
    throw Napi::TypeError::New(info.Env(), "showNotification expects an optional window id and options object.");
  }
  const Napi::Object options = info[options_index].As<Napi::Object>();
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wdeprecated-declarations"
  NSUserNotification* notification = [NSUserNotification new];
  notification.title = ToNSString(StringOption(options, "title", "NodeViewJS"));
  notification.informativeText = ToNSString(StringOption(options, "message", ""));
  [[NSUserNotificationCenter defaultUserNotificationCenter] deliverNotification:notification];
#pragma clang diagnostic pop
}

Napi::Value OpenFileDialog(const Napi::CallbackInfo& info) {
  if (info.Length() > 1) {
    throw Napi::TypeError::New(info.Env(), "openFileDialog expects an optional window id.");
  }
  if (info.Length() == 1) GetWindow(info.Env(), WindowId(info, 0));
  else PrimaryWindow(info.Env());
  NSOpenPanel* panel = [NSOpenPanel openPanel];
  panel.canChooseFiles = YES;
  panel.canChooseDirectories = NO;
  panel.allowsMultipleSelection = NO;
  if ([panel runModal] != NSModalResponseOK) return info.Env().Null();
  return Napi::String::New(info.Env(), panel.URL.path.UTF8String);
}

Napi::Value SaveFileDialog(const Napi::CallbackInfo& info) {
  if (info.Length() > 1) {
    throw Napi::TypeError::New(info.Env(), "saveFileDialog expects an optional window id.");
  }
  if (info.Length() == 1) GetWindow(info.Env(), WindowId(info, 0));
  else PrimaryWindow(info.Env());
  NSSavePanel* panel = [NSSavePanel savePanel];
  if ([panel runModal] != NSModalResponseOK) return info.Env().Null();
  return Napi::String::New(info.Env(), panel.URL.path.UTF8String);
}

void LoadFile(const Napi::CallbackInfo& info) {
  const std::size_t value_index = info.Length() == 1 ? 0 : 1;
  MacWindow& state = info.Length() == 1
      ? PrimaryWindow(info.Env())
      : GetWindow(info.Env(), WindowId(info, 0));
  if (info.Length() <= value_index || !info[value_index].IsString()) {
    throw Napi::TypeError::New(info.Env(), "loadFile expects a file path string.");
  }

  NSString* entry_path = ToNSString(info[value_index].As<Napi::String>().Utf8Value());
  NSURL* entry_url = [NSURL fileURLWithPath:entry_path].URLByStandardizingPath;
  state.entry_root = [entry_url URLByDeletingLastPathComponent];

  WKWebViewConfiguration* configuration = [WKWebViewConfiguration new];
  state.script_handler = [NodeViewScriptHandler new];
  state.script_handler.owner = &state;
  [configuration.userContentController addScriptMessageHandler:state.script_handler name:@"nodeview"];
  if (!state.bridge_embedded) {
    NSString* bridge = [NSString stringWithUTF8String:GetBridgeScriptUtf8()];
    WKUserScript* user_script = [[WKUserScript alloc]
        initWithSource:bridge
         injectionTime:WKUserScriptInjectionTimeAtDocumentStart
      forMainFrameOnly:NO];
    [configuration.userContentController addUserScript:user_script];
  }

  state.webview = [[WKWebView alloc] initWithFrame:state.window.contentView.bounds
                                    configuration:configuration];
  state.webview.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
  if (state.transparent) {
    state.webview.underPageBackgroundColor = [NSColor clearColor];
    state.webview.wantsLayer = YES;
    state.webview.layer.backgroundColor = [NSColor clearColor].CGColor;
  }
  if (@available(macOS 13.3, *)) state.webview.inspectable = state.devtools;
  state.navigation_delegate = [NodeViewNavigationDelegate new];
  state.navigation_delegate.owner = &state;
  state.webview.navigationDelegate = state.navigation_delegate;
  [state.window.contentView addSubview:state.webview];
  [state.webview loadFileURL:entry_url allowingReadAccessToURL:state.entry_root];
}

void SetMessageHandler(const Napi::CallbackInfo& info) {
  const std::size_t handler_index = info.Length() == 1 ? 0 : 1;
  MacWindow& state = info.Length() == 1
      ? PrimaryWindow(info.Env())
      : GetWindow(info.Env(), WindowId(info, 0));
  if (info.Length() <= handler_index || !info[handler_index].IsFunction()) {
    throw Napi::TypeError::New(info.Env(), "setMessageHandler expects a function.");
  }
  state.message_handler.Reset();
  state.env = info.Env();
  state.message_handler = Napi::Persistent(info[handler_index].As<Napi::Function>());
}

void PostWebMessage(const Napi::CallbackInfo& info) {
  const std::size_t value_index = info.Length() == 1 ? 0 : 1;
  MacWindow& state = info.Length() == 1
      ? PrimaryWindow(info.Env())
      : GetWindow(info.Env(), WindowId(info, 0));
  if (info.Length() <= value_index || !info[value_index].IsString()) {
    throw Napi::TypeError::New(info.Env(), "postMessage expects serialized JSON.");
  }
  NSString* json = ToNSString(info[value_index].As<Napi::String>().Utf8Value());
  NSString* script = [NSString stringWithFormat:@"window.__nodeviewReceive(JSON.parse(%@));",
                                               QuoteJsonString(json)];
  [state.webview evaluateJavaScript:script completionHandler:nil];
}

void ReloadWebView(const Napi::CallbackInfo& info) {
  MacWindow& state = info.Length() == 0
      ? PrimaryWindow(info.Env())
      : GetWindow(info.Env(), WindowId(info, 0));
  [state.webview reload];
}

void Run(const Napi::CallbackInfo& info) {
  if (info.Length() != 0) {
    throw Napi::TypeError::New(info.Env(), "run expects no arguments.");
  }
  auto& runtime = Runtime();
  if (runtime.running) throw Napi::Error::New(info.Env(), "NodeViewJS is already running.");
  if (!HasLiveWindows()) throw Napi::Error::New(info.Env(), "Call createWindow before run.");

  for (const auto& [id, window] : runtime.windows) {
    if (window->live) [window->window makeKeyAndOrderFront:nil];
  }
  [NSApp activateIgnoringOtherApps:YES];

  auto* timer = new uv_timer_t();
  if (uv_timer_init(uv_default_loop(), timer) != 0) {
    delete timer;
    throw Napi::Error::New(info.Env(), "Could not start the macOS event pump.");
  }
  if (uv_timer_start(timer, [](uv_timer_t*) { PumpCocoaEvents(); }, 0, 10) != 0) {
    uv_close(reinterpret_cast<uv_handle_t*>(timer), [](uv_handle_t* handle) {
      delete reinterpret_cast<uv_timer_t*>(handle);
    });
    throw Napi::Error::New(info.Env(), "Could not start the macOS event pump.");
  }
  runtime.event_timer = timer;
  runtime.running = true;
}

}  // namespace nodeview

@implementation NodeViewScriptHandler
- (void)userContentController:(WKUserContentController*)controller
      didReceiveScriptMessage:(WKScriptMessage*)message {
  nodeview::MacWindow* state = self.owner;
  if (state == nullptr || !state->live || state->message_handler.IsEmpty() || state->env == nullptr) return;
  if (![NSJSONSerialization isValidJSONObject:message.body]) return;
  NSData* data = [NSJSONSerialization dataWithJSONObject:message.body options:0 error:nil];
  NSString* json = [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding];
  Napi::Env env(state->env);
  Napi::HandleScope scope(env);
  state->message_handler.Call({Napi::String::New(env, json.UTF8String)});
}
@end

@implementation NodeViewNavigationDelegate
- (void)webView:(WKWebView*)webView
    decidePolicyForNavigationAction:(WKNavigationAction*)action
                    decisionHandler:(void (^)(WKNavigationActionPolicy))decisionHandler {
  nodeview::MacWindow* state = self.owner;
  if (action.targetFrame != nil && !action.targetFrame.mainFrame) {
    decisionHandler(WKNavigationActionPolicyAllow);
    return;
  }
  if (action.targetFrame.mainFrame && state != nullptr && action.request.URL.isFileURL) {
    NSString* path = action.request.URL.URLByStandardizingPath.path;
    NSString* root = state->entry_root.path;
    if ([path isEqualToString:root] || [path hasPrefix:[root stringByAppendingString:@"/"]]) {
      decisionHandler(WKNavigationActionPolicyAllow);
      return;
    }
  }
  NSLog(@"NodeViewJS blocked top-level navigation to %@", action.request.URL.absoluteString);
  decisionHandler(WKNavigationActionPolicyCancel);
}
@end

@implementation NodeViewWindowDelegate
- (BOOL)windowShouldClose:(NSWindow*)sender {
  if (self.owner != nullptr && self.owner->close_to_hide && !self.owner->force_closing) {
    [sender orderOut:nil];
    return NO;
  }
  return YES;
}
- (void)windowWillClose:(NSNotification*)notification {
  nodeview::MarkWindowClosed(self.owner);
}
@end

@implementation NodeViewTrayTarget
- (void)showWindow:(id)sender {
  if (self.owner == nullptr || !self.owner->live) return;
  [self.owner->window makeKeyAndOrderFront:nil];
  [NSApp activateIgnoringOtherApps:YES];
}
- (void)quitApplication:(id)sender {
  nodeview::CloseAllWindows();
}
@end
