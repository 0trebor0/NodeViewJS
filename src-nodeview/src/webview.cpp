#include "webview.h"

#include "app.h"
#include "bridge.h"
#include "ipc.h"
#include "window.h"

#include <Shlwapi.h>
#include <WebView2.h>
#include <wrl.h>

#include <cstdio>
#include <cstdint>
#include <cwchar>
#include <cwctype>
#include <filesystem>
#include <iomanip>
#include <sstream>
#include <string>
#include <vector>

namespace nodeview {

namespace {
constexpr size_t kMaxIpcMessageBytes = 256 * 1024;

bool ExceedsUtf8Limit(const std::u16string& value) {
  size_t bytes = 0;
  for (size_t index = 0; index < value.size(); ++index) {
    const char16_t code = value[index];
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && index + 1 < value.size()
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

struct WebViewState {
  HWND window = nullptr;
  Microsoft::WRL::ComPtr<ICoreWebView2Environment> environment;
  Microsoft::WRL::ComPtr<ICoreWebView2Controller> controller;
  Microsoft::WRL::ComPtr<ICoreWebView2> webview;
  Microsoft::WRL::ComPtr<ICoreWebView2_3> webview3;
  Microsoft::WRL::ComPtr<ICoreWebView2_4> webview4;
  Microsoft::WRL::ComPtr<ICoreWebView2_18> webview18;
  EventRegistrationToken web_message_token{};
  EventRegistrationToken navigation_starting_token{};
  EventRegistrationToken frame_navigation_starting_token{};
  EventRegistrationToken source_changed_token{};
  EventRegistrationToken content_loading_token{};
  EventRegistrationToken navigation_completed_token{};
  EventRegistrationToken new_window_token{};
  EventRegistrationToken permission_token{};
  EventRegistrationToken web_resource_token{};
  EventRegistrationToken download_token{};
  EventRegistrationToken external_uri_token{};
  std::filesystem::path content_root;
  std::filesystem::path trusted_document;
  std::uint64_t initialization_id = 0;
  bool web_message_handler_registered = false;
  bool navigation_handler_registered = false;
  bool frame_navigation_handler_registered = false;
  bool source_changed_handler_registered = false;
  bool content_loading_handler_registered = false;
  bool navigation_completed_handler_registered = false;
  bool new_window_handler_registered = false;
  bool permission_handler_registered = false;
  bool web_resource_handler_registered = false;
  bool web_resource_filter_registered = false;
  bool download_handler_registered = false;
  bool external_uri_handler_registered = false;
  bool devtools_enabled = false;
  bool transparent = false;
  bool bridge_embedded = false;
};

}  // namespace nodeview

namespace {

using Microsoft::WRL::Callback;
using nodeview::WebViewState;

constexpr wchar_t kAppVirtualHost[] = L"app.nodeview.example";
constexpr wchar_t kAppVirtualOrigin[] = L"https://app.nodeview.example/";

void ShowWebViewError(const WebViewState& state, const wchar_t* message) {
  fwprintf(stderr, L"[NodeViewJS native] %ls\n", message);
  fflush(stderr);
  if (GetEnvironmentVariableW(L"NODEVIEW_NATIVE_TRACE", nullptr, 0) != 0) return;
  MessageBox(state.window, message, L"NodeViewJS", MB_OK | MB_ICONERROR);
}

// A bare HRESULT tells a developer nothing. These are the failures that
// actually happen, each answered with the command that fixes it.
const wchar_t* ExplainWebViewFailure(HRESULT result) {
  switch (static_cast<unsigned long>(result)) {
    case 0x80040154UL:  // REGDB_E_CLASSNOTREG
    case 0x80070002UL:  // ERROR_FILE_NOT_FOUND
      return L"\n\nThe Microsoft Edge WebView2 Runtime does not appear to be installed.\n"
             L"NodeViewJS renders every window with it.\n\n"
             L"Install it:\n"
             L"    winget install Microsoft.EdgeWebView2Runtime\n\n"
             L"Then confirm the prerequisites:\n"
             L"    npx nodeviewjs doctor";
    case 0x800700AAUL:  // ERROR_BUSY
      return L"\n\nAnother process is already using this application's WebView2 profile.\n"
             L"Close the other instance, or give this application a different appId "
             L"so it uses its own profile.";
    case 0x80070005UL:  // E_ACCESSDENIED
      return L"\n\nAccess to the WebView2 data directory was denied.\n"
             L"Check that %LOCALAPPDATA%\\NodeViewJS is writable by this user.";
    default:
      return L"\n\nRun `npx nodeviewjs doctor` to check the WebView2 Runtime "
             L"and the other prerequisites.";
  }
}

void ReportWebViewError(const WebViewState& state, const wchar_t* message) {
  const std::wstring details =
      std::wstring(message) +
      L"\n\nRun `npx nodeviewjs doctor` to check the WebView2 Runtime "
      L"and the other prerequisites.";
  ShowWebViewError(state, details.c_str());
}

void TraceWebView(const wchar_t* message) {
  if (GetEnvironmentVariableW(L"NODEVIEW_NATIVE_TRACE", nullptr, 0) == 0) return;
  fwprintf(stderr, L"[NodeViewJS native trace] %ls\n", message);
  fflush(stderr);
}

std::wstring FormatHResult(HRESULT result) {
  std::wstringstream stream;
  stream << L"0x" << std::hex << static_cast<unsigned long>(result);
  return stream.str();
}

void TraceWebView(const wchar_t* message, HRESULT result) {
  if (GetEnvironmentVariableW(L"NODEVIEW_NATIVE_TRACE", nullptr, 0) == 0) return;
  fwprintf(
      stderr,
      L"[NodeViewJS native trace] %ls (HRESULT: %ls)\n",
      message,
      FormatHResult(result).c_str());
  fflush(stderr);
}

void TraceWebView(
    const wchar_t* message,
    COREWEBVIEW2_WEB_ERROR_STATUS status) {
  if (GetEnvironmentVariableW(L"NODEVIEW_NATIVE_TRACE", nullptr, 0) == 0) return;
  fwprintf(
      stderr,
      L"[NodeViewJS native trace] %ls (WebView status: %d)\n",
      message,
      static_cast<int>(status));
  fflush(stderr);
}

void ReportWebViewError(
    const WebViewState& state,
    const wchar_t* message,
    HRESULT result) {
  const std::wstring details = std::wstring(message) + L" (HRESULT: " + FormatHResult(result) + L")." +
                               ExplainWebViewFailure(result);
  ShowWebViewError(state, details.c_str());
}

std::wstring MakeFileUrl(const std::wstring& file_path) {
  const std::wstring absolute_path = std::filesystem::absolute(file_path).wstring();
  std::vector<wchar_t> url(32768);
  DWORD url_length = static_cast<DWORD>(url.size());
  if (FAILED(UrlCreateFromPath(absolute_path.c_str(), url.data(), &url_length, 0))) {
    return L"";
  }

  return std::wstring(url.data());
}

std::wstring HashPath(const std::filesystem::path& path) {
  std::uint64_t hash = 0xcbf29ce484222325ULL;
  for (const wchar_t character : path.wstring()) {
    const std::uint16_t normalized = static_cast<std::uint16_t>(std::towlower(character));
    for (int shift = 0; shift <= 8; shift += 8) {
      hash ^= static_cast<std::uint8_t>(normalized >> shift);
      hash *= 0x100000001b3ULL;
    }
  }

  std::wstringstream stream;
  stream << std::hex << std::setfill(L'0') << std::setw(16) << hash;
  return stream.str();
}

std::filesystem::path GetDefaultWebViewDataDirectory(
    const std::filesystem::path& entry_path) {
  const DWORD length = GetEnvironmentVariableW(L"LOCALAPPDATA", nullptr, 0);
  if (length == 0) {
    return {};
  }

  std::vector<wchar_t> local_app_data(length);
  const DWORD copied = GetEnvironmentVariableW(
          L"LOCALAPPDATA",
          local_app_data.data(),
          static_cast<DWORD>(local_app_data.size()));
  if (copied == 0 || copied >= local_app_data.size()) {
    return {};
  }

  return std::filesystem::path(local_app_data.data()) /
      L"NodeViewJS" / (L"native-" + HashPath(entry_path)) / L"WebView2";
}

bool IsPathWithin(const std::filesystem::path& root, const std::filesystem::path& candidate) {
  auto root_part = root.begin();
  auto candidate_part = candidate.begin();
  for (; root_part != root.end(); ++root_part, ++candidate_part) {
    if (candidate_part == candidate.end() ||
        _wcsicmp(root_part->c_str(), candidate_part->c_str()) != 0) {
      return false;
    }
  }
  return true;
}

bool ArePathsEqual(
    const std::filesystem::path& left,
    const std::filesystem::path& right) {
  auto left_part = left.begin();
  auto right_part = right.begin();
  while (left_part != left.end() && right_part != right.end()) {
    if (_wcsicmp(left_part->c_str(), right_part->c_str()) != 0) {
      return false;
    }
    ++left_part;
    ++right_part;
  }
  return left_part == left.end() && right_part == right.end();
}

bool EnsureDirectoryExists(const std::filesystem::path& directory) {
  if (directory.empty()) return false;

  const std::wstring directory_name = directory.wstring();
  if (GetEnvironmentVariableW(L"NODEVIEW_NATIVE_TRACE", nullptr, 0) != 0) {
    fwprintf(stderr, L"[NodeViewJS native trace] ensure directory %ls\n", directory_name.c_str());
    fflush(stderr);
  }
  const DWORD attributes = GetFileAttributesW(directory_name.c_str());
  if (attributes != INVALID_FILE_ATTRIBUTES) {
    return (attributes & FILE_ATTRIBUTE_DIRECTORY) != 0;
  }

  const std::filesystem::path parent = directory.parent_path();
  if (!parent.empty() && parent != directory && !EnsureDirectoryExists(parent)) {
    return false;
  }

  if (CreateDirectoryW(directory_name.c_str(), nullptr)) {
    return true;
  }

  const DWORD error = GetLastError();
  if (GetEnvironmentVariableW(L"NODEVIEW_NATIVE_TRACE", nullptr, 0) != 0) {
    fwprintf(stderr, L"[NodeViewJS native trace] CreateDirectoryW failed: %lu\n", error);
    fflush(stderr);
  }
  if (error != ERROR_ALREADY_EXISTS) {
    return false;
  }
  const DWORD created_attributes = GetFileAttributesW(directory_name.c_str());
  return created_attributes != INVALID_FILE_ATTRIBUTES &&
      (created_attributes & FILE_ATTRIBUTE_DIRECTORY) != 0;
}

bool TryGetAllowedDocumentPath(
    const WebViewState& state,
    const wchar_t* uri,
    std::filesystem::path* document_path) {
  if (uri == nullptr || _wcsicmp(uri, L"about:blank") == 0) {
    return false;
  }

  try {
    std::filesystem::path candidate;
    const std::size_t virtual_origin_length = wcslen(kAppVirtualOrigin);
    if (_wcsnicmp(uri, kAppVirtualOrigin, virtual_origin_length) == 0) {
      std::wstring relative(uri + virtual_origin_length);
      const std::size_t delimiter = relative.find_first_of(L"?#");
      if (delimiter != std::wstring::npos) relative.resize(delimiter);
      std::vector<wchar_t> decoded(relative.begin(), relative.end());
      decoded.push_back(L'\0');
      if (FAILED(UrlUnescapeW(decoded.data(), nullptr, nullptr, URL_UNESCAPE_INPLACE))) {
        return false;
      }
      candidate = std::filesystem::weakly_canonical(state.content_root / decoded.data());
    } else {
      std::vector<wchar_t> file_path(32768);
      DWORD file_path_length = static_cast<DWORD>(file_path.size());
      if (FAILED(PathCreateFromUrlW(uri, file_path.data(), &file_path_length, 0))) {
        return false;
      }
      candidate = std::filesystem::weakly_canonical(file_path.data());
    }
    if (!IsPathWithin(state.content_root, candidate)) {
      return false;
    }
    if (document_path != nullptr) {
      *document_path = candidate;
    }
    return true;
  } catch (const std::filesystem::filesystem_error&) {
    return false;
  }
}

bool IsAllowedNavigation(const WebViewState& state, const wchar_t* uri) {
  if (uri == nullptr) {
    return false;
  }
  if (_wcsicmp(uri, L"about:blank") == 0) {
    return true;
  }

  return TryGetAllowedDocumentPath(state, uri, nullptr);
}

bool IsAllowedFrameNavigation(const WebViewState& state, const wchar_t* uri) {
  if (uri == nullptr) return false;
  return IsAllowedNavigation(state, uri)
      || _wcsnicmp(uri, L"data:", 5) == 0
      || _wcsnicmp(uri, L"about:srcdoc", 12) == 0;
}

HRESULT HandleWebResourceRequested(
    WebViewState& state,
    ICoreWebView2WebResourceRequestedEventArgs* args) {
  Microsoft::WRL::ComPtr<ICoreWebView2WebResourceRequest> request;
  LPWSTR uri = nullptr;
  const bool allowed = SUCCEEDED(args->get_Request(&request)) &&
      request != nullptr &&
      SUCCEEDED(request->get_Uri(&uri)) &&
      IsAllowedNavigation(state, uri);
  if (allowed) {
    TraceWebView(L"allowed WebView resource request");
    CoTaskMemFree(uri);
    return S_OK;
  }

  fwprintf(
      stderr,
      L"[NodeViewJS security] Blocked WebView resource request to %ls\n",
      uri == nullptr ? L"an unknown URL" : uri);
  fflush(stderr);
  CoTaskMemFree(uri);

  if (!state.environment) return E_FAIL;
  Microsoft::WRL::ComPtr<ICoreWebView2WebResourceResponse> response;
  const HRESULT response_result = state.environment->CreateWebResourceResponse(
      nullptr,
      403,
      L"Blocked by NodeViewJS",
      L"Content-Type: text/plain\r\nCache-Control: no-store",
      &response);
  if (FAILED(response_result)) {
    fwprintf(stderr, L"[NodeViewJS security] Could not create blocked response: %ls\n",
        FormatHResult(response_result).c_str());
    fflush(stderr);
    return response_result;
  }
  const HRESULT set_response_result = args->put_Response(response.Get());
  if (FAILED(set_response_result)) {
    fwprintf(stderr, L"[NodeViewJS security] Could not set blocked response: %ls\n",
        FormatHResult(set_response_result).c_str());
    fflush(stderr);
  }
  return set_response_result;
}

HRESULT ConfigureSecurityPolicy(WebViewState& state) {
  Microsoft::WRL::ComPtr<ICoreWebView2Settings> settings;
  HRESULT result = state.webview->get_Settings(&settings);
  if (FAILED(result)) return result;

  const BOOL allow_devtools = state.devtools_enabled && !state.bridge_embedded;
  result = settings->put_AreDevToolsEnabled(allow_devtools);
  if (FAILED(result)) return result;

  result = state.webview->add_NewWindowRequested(
      Callback<ICoreWebView2NewWindowRequestedEventHandler>(
          [](ICoreWebView2*, ICoreWebView2NewWindowRequestedEventArgs* args) -> HRESULT {
            LPWSTR uri = nullptr;
            args->get_Uri(&uri);
            fwprintf(
                stderr,
                L"[NodeViewJS security] Blocked popup to %ls\n",
                uri == nullptr ? L"an unknown URL" : uri);
            fflush(stderr);
            CoTaskMemFree(uri);
            return args->put_Handled(TRUE);
          })
          .Get(),
      &state.new_window_token);
  if (FAILED(result)) return result;
  state.new_window_handler_registered = true;

  result = state.webview->add_PermissionRequested(
      Callback<ICoreWebView2PermissionRequestedEventHandler>(
          [](ICoreWebView2*, ICoreWebView2PermissionRequestedEventArgs* args) -> HRESULT {
            return args->put_State(COREWEBVIEW2_PERMISSION_STATE_DENY);
          })
          .Get(),
      &state.permission_token);
  if (FAILED(result)) return result;
  state.permission_handler_registered = true;

  WebViewState* state_pointer = &state;
  result = state.webview->add_WebResourceRequested(
      Callback<ICoreWebView2WebResourceRequestedEventHandler>(
          [state_pointer](ICoreWebView2*, ICoreWebView2WebResourceRequestedEventArgs* args) -> HRESULT {
            return HandleWebResourceRequested(*state_pointer, args);
          })
          .Get(),
      &state.web_resource_token);
  if (FAILED(result)) return result;
  state.web_resource_handler_registered = true;

  result = state.webview->AddWebResourceRequestedFilter(
      L"*",
      COREWEBVIEW2_WEB_RESOURCE_CONTEXT_ALL);
  if (FAILED(result)) return result;
  state.web_resource_filter_registered = true;

  result = state.webview.As(&state.webview4);
  if (FAILED(result)) return result;
  result = state.webview4->add_DownloadStarting(
      Callback<ICoreWebView2DownloadStartingEventHandler>(
          [](ICoreWebView2*, ICoreWebView2DownloadStartingEventArgs* args) -> HRESULT {
            fwprintf(stderr, L"[NodeViewJS security] Blocked WebView download\n");
            fflush(stderr);
            const HRESULT cancel_result = args->put_Cancel(TRUE);
            if (FAILED(cancel_result)) return cancel_result;
            return args->put_Handled(TRUE);
          })
          .Get(),
      &state.download_token);
  if (FAILED(result)) return result;
  state.download_handler_registered = true;

  result = state.webview.As(&state.webview18);
  if (FAILED(result)) return result;
  result = state.webview18->add_LaunchingExternalUriScheme(
      Callback<ICoreWebView2LaunchingExternalUriSchemeEventHandler>(
          [](ICoreWebView2*, ICoreWebView2LaunchingExternalUriSchemeEventArgs* args) -> HRESULT {
            LPWSTR uri = nullptr;
            args->get_Uri(&uri);
            fwprintf(
                stderr,
                L"[NodeViewJS security] Blocked external URI scheme %ls\n",
                uri == nullptr ? L"for an unknown URL" : uri);
            fflush(stderr);
            CoTaskMemFree(uri);
            return args->put_Cancel(TRUE);
          })
          .Get(),
      &state.external_uri_token);
  if (FAILED(result)) return result;
  state.external_uri_handler_registered = true;

  if (allow_devtools) return state.webview->OpenDevToolsWindow();
  return S_OK;
}

HRESULT HandleNavigationStarting(
    WebViewState& state,
    ICoreWebView2NavigationStartingEventArgs* args) {
  LPWSTR uri = nullptr;
  const HRESULT uri_result = args->get_Uri(&uri);
  const bool allowed = SUCCEEDED(uri_result) && IsAllowedNavigation(state, uri);
  TraceWebView(allowed ? L"allowed top-level navigation" : L"blocked top-level navigation");

  if (!allowed) {
    args->put_Cancel(TRUE);
    fwprintf(
        stderr,
        L"[NodeViewJS security] Blocked top-level navigation to %ls\n",
        uri == nullptr ? L"an unknown URL" : uri);
    fflush(stderr);
  } else {
    state.trusted_document.clear();
  }

  CoTaskMemFree(uri);
  return S_OK;
}

HRESULT HandleFrameNavigationStarting(
    const WebViewState& state,
    ICoreWebView2NavigationStartingEventArgs* args) {
  LPWSTR uri = nullptr;
  const HRESULT uri_result = args->get_Uri(&uri);
  const bool allowed = SUCCEEDED(uri_result) && IsAllowedFrameNavigation(state, uri);
  TraceWebView(allowed ? L"allowed frame navigation" : L"blocked frame navigation");
  if (!allowed) {
    args->put_Cancel(TRUE);
    fwprintf(
        stderr,
        L"[NodeViewJS security] Blocked frame navigation to %ls\n",
        uri == nullptr ? L"an unknown URL" : uri);
    fflush(stderr);
  }
  CoTaskMemFree(uri);
  return S_OK;
}

void TrustCurrentTopLevelDocument(WebViewState& state) {
  if (!state.webview) {
    state.trusted_document.clear();
    TraceWebView(L"trusted document cleared because WebView is not ready");
    return;
  }

  LPWSTR source = nullptr;
  std::filesystem::path document_path;
  const bool trusted = SUCCEEDED(state.webview->get_Source(&source)) &&
      TryGetAllowedDocumentPath(state, source, &document_path);
  CoTaskMemFree(source);
  if (trusted) {
    state.trusted_document = std::move(document_path);
    TraceWebView(L"trusted current top-level document");
  } else {
    state.trusted_document.clear();
    TraceWebView(L"trusted document cleared because current source is not allowed");
  }
}

bool IsTrustedWebMessage(
    WebViewState& state,
    ICoreWebView2WebMessageReceivedEventArgs* args) {
  if (!state.webview || state.trusted_document.empty()) {
    TraceWebView(L"blocked WebMessage because trusted document is empty");
    return false;
  }

  LPWSTR sender = nullptr;
  LPWSTR current = nullptr;
  std::filesystem::path sender_path;
  std::filesystem::path current_path;
  const bool trusted = SUCCEEDED(args->get_Source(&sender)) &&
      SUCCEEDED(state.webview->get_Source(&current)) &&
      TryGetAllowedDocumentPath(state, sender, &sender_path) &&
      TryGetAllowedDocumentPath(state, current, &current_path) &&
      ArePathsEqual(sender_path, current_path) &&
      ArePathsEqual(current_path, state.trusted_document);

  if (!trusted) {
    fwprintf(
        stderr,
        L"[NodeViewJS security] Blocked IPC from untrusted document %ls\n",
        sender == nullptr ? L"an unknown source" : sender);
    fflush(stderr);
  }
  if (trusted) {
    TraceWebView(L"accepted WebMessage from trusted document");
  }
  CoTaskMemFree(sender);
  CoTaskMemFree(current);
  return trusted;
}

bool IsCurrentInitialization(
    const WebViewState& state,
    std::uint64_t initialization_id) {
  return state.initialization_id == initialization_id && state.window != nullptr;
}

}  // namespace

namespace nodeview {

WebViewHost::WebViewHost(IpcBridge& ipc)
    : ipc_(ipc), state_(std::make_unique<WebViewState>()) {}

WebViewHost::~WebViewHost() = default;

void WebViewHost::Initialize(
    HWND window,
    const std::wstring& entry_file,
    const std::wstring& data_directory,
    bool bridge_embedded) {
  auto& state = *state_;
  TraceWebView(L"WebView initialization started");
  state.window = window;
  state.bridge_embedded = bridge_embedded;
  const std::uint64_t initialization_id = ++state.initialization_id;
  std::wstring entry_url;

  std::wstring user_data_folder;
  try {
    TraceWebView(L"canonicalizing entry path");
    const std::filesystem::path entry_path = std::filesystem::weakly_canonical(entry_file);
    state.content_root = entry_path.parent_path();
    TraceWebView(L"creating entry file URL");
    const std::wstring entry_file_url = MakeFileUrl(entry_path.wstring());
    const std::size_t filename_offset = entry_file_url.find_last_of(L'/');
    if (entry_file_url.empty() || filename_offset == std::wstring::npos) {
      ReportWebViewError(state, L"Could not create an app URL for the entry file.");
      return;
    }
    entry_url = std::wstring(kAppVirtualOrigin) + entry_file_url.substr(filename_offset + 1);
    TraceWebView(L"resolving WebView2 data directory");
    const std::filesystem::path data_path = data_directory.empty()
        ? GetDefaultWebViewDataDirectory(entry_path)
        : std::filesystem::absolute(data_directory);
    if (data_path.empty()) {
      ReportWebViewError(state, L"Could not resolve the Local AppData directory for WebView2.");
      return;
    }
    TraceWebView(L"capturing WebView2 data directory path");
    user_data_folder = data_path.wstring();
    TraceWebView(L"creating WebView2 data directory");
    if (!EnsureDirectoryExists(data_path)) {
      ReportWebViewError(state, L"Could not create NodeViewJS's WebView2 data directory.");
      return;
    }
  } catch (const std::filesystem::filesystem_error&) {
    ReportWebViewError(state, L"Could not create NodeViewJS's WebView2 data directory.");
    return;
  }
  TraceWebView(L"creating WebView2 environment");

  const HRESULT environment_result = CreateCoreWebView2EnvironmentWithOptions(
      nullptr,
      user_data_folder.c_str(),
      nullptr,
      Callback<ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler>(
          [this, entry_url, initialization_id](HRESULT result, ICoreWebView2Environment* environment) -> HRESULT {
            auto& state = *state_;
            TraceWebView(L"environment creation callback", result);
            if (!IsCurrentInitialization(state, initialization_id)) {
              return S_OK;
            }
            if (FAILED(result)) {
              ReportWebViewError(
                  state,
                  L"Could not create the WebView2 environment. Is WebView2 Runtime installed?",
                  result);
              return result;
            }
            state.environment = environment;

            return environment->CreateCoreWebView2Controller(
                state.window,
                Callback<ICoreWebView2CreateCoreWebView2ControllerCompletedHandler>(
                    [this, entry_url, initialization_id](HRESULT controller_result, ICoreWebView2Controller* controller) -> HRESULT {
                      auto& state = *state_;
                      TraceWebView(L"controller creation callback", controller_result);
                      if (!IsCurrentInitialization(state, initialization_id)) {
                        if (SUCCEEDED(controller_result) && controller != nullptr) {
                          controller->Close();
                        }
                        return S_OK;
                      }
                      if (FAILED(controller_result)) {
                        ReportWebViewError(state, L"Could not create the WebView2 controller", controller_result);
                        return controller_result;
                      }

                      state.controller = controller;
                      if (state.transparent) {
                        Microsoft::WRL::ComPtr<ICoreWebView2Controller2> controller2;
                        const HRESULT controller2_result = state.controller.As(&controller2);
                        if (FAILED(controller2_result)) {
                          ReportWebViewError(
                              state,
                              L"This WebView2 Runtime does not support transparent backgrounds",
                              controller2_result);
                          return controller2_result;
                        }

                        const COREWEBVIEW2_COLOR transparent_background{0, 0, 0, 0};
                        const HRESULT background_result =
                            controller2->put_DefaultBackgroundColor(transparent_background);
                        if (FAILED(background_result)) {
                          ReportWebViewError(
                              state,
                              L"Could not enable the transparent WebView2 background",
                              background_result);
                          return background_result;
                        }
                      }
                      const HRESULT webview_result = state.controller->get_CoreWebView2(&state.webview);
                      if (FAILED(webview_result)) {
                        ReportWebViewError(state, L"Could not access the WebView2 instance", webview_result);
                        return webview_result;
                      }
                      const HRESULT webview3_result = state.webview.As(&state.webview3);
                      if (FAILED(webview3_result)) {
                        ReportWebViewError(
                            state,
                            L"This WebView2 Runtime does not support local app host mapping",
                            webview3_result);
                        return webview3_result;
                      }
                      const HRESULT mapping_result = state.webview3->SetVirtualHostNameToFolderMapping(
                          kAppVirtualHost,
                          state.content_root.c_str(),
                          COREWEBVIEW2_HOST_RESOURCE_ACCESS_KIND_DENY_CORS);
                      if (FAILED(mapping_result)) {
                        ReportWebViewError(
                            state,
                            L"Could not create the private local app mapping",
                            mapping_result);
                        return mapping_result;
                      }
                      const HRESULT security_policy_result = ConfigureSecurityPolicy(state);
                      if (FAILED(security_policy_result)) {
                        ReportWebViewError(
                            state,
                            L"Could not install the WebView2 security policy",
                            security_policy_result);
                        return security_policy_result;
                      }
                      TraceWebView(L"security policy registered");
                      const HRESULT navigation_handler_result = state.webview->add_NavigationStarting(
                          Callback<ICoreWebView2NavigationStartingEventHandler>(
                              [this](ICoreWebView2*, ICoreWebView2NavigationStartingEventArgs* args) -> HRESULT {
                                return HandleNavigationStarting(*state_, args);
                              })
                              .Get(),
                          &state.navigation_starting_token);
                      if (FAILED(navigation_handler_result)) {
                        ReportWebViewError(
                            state,
                            L"Could not register the WebView2 navigation policy",
                            navigation_handler_result);
                        return navigation_handler_result;
                      }
                      state.navigation_handler_registered = true;

                      const HRESULT frame_navigation_handler_result =
                          state.webview->add_FrameNavigationStarting(
                              Callback<ICoreWebView2NavigationStartingEventHandler>(
                                  [this](ICoreWebView2*, ICoreWebView2NavigationStartingEventArgs* args) -> HRESULT {
                                    return HandleFrameNavigationStarting(*state_, args);
                                  })
                                  .Get(),
                              &state.frame_navigation_starting_token);
                      if (FAILED(frame_navigation_handler_result)) {
                        ReportWebViewError(
                            state,
                            L"Could not register the WebView2 frame navigation policy",
                            frame_navigation_handler_result);
                        return frame_navigation_handler_result;
                      }
                      state.frame_navigation_handler_registered = true;

                      const HRESULT source_changed_result = state.webview->add_SourceChanged(
                          Callback<ICoreWebView2SourceChangedEventHandler>(
                              [this](ICoreWebView2*, ICoreWebView2SourceChangedEventArgs*) -> HRESULT {
                                TraceWebView(L"source changed");
                                TrustCurrentTopLevelDocument(*state_);
                                return S_OK;
                              })
                              .Get(),
                          &state.source_changed_token);
                      if (FAILED(source_changed_result)) {
                        ReportWebViewError(
                            state,
                            L"Could not register trusted document source tracking",
                            source_changed_result);
                        return source_changed_result;
                      }
                      state.source_changed_handler_registered = true;

                      const HRESULT content_loading_result = state.webview->add_ContentLoading(
                          Callback<ICoreWebView2ContentLoadingEventHandler>(
                              [this](ICoreWebView2*, ICoreWebView2ContentLoadingEventArgs*) -> HRESULT {
                                TraceWebView(L"content loading");
                                TrustCurrentTopLevelDocument(*state_);
                                return S_OK;
                              })
                              .Get(),
                          &state.content_loading_token);
                      if (FAILED(content_loading_result)) {
                        ReportWebViewError(
                            state,
                            L"Could not register trusted document loading tracking",
                            content_loading_result);
                        return content_loading_result;
                      }
                      state.content_loading_handler_registered = true;

                      EventRegistrationToken navigation_completed_token{};
                      const HRESULT navigation_completed_result = state.webview->add_NavigationCompleted(
                          Callback<ICoreWebView2NavigationCompletedEventHandler>(
                              [](ICoreWebView2*, ICoreWebView2NavigationCompletedEventArgs* args) -> HRESULT {
                                BOOL success = FALSE;
                                COREWEBVIEW2_WEB_ERROR_STATUS web_error =
                                    COREWEBVIEW2_WEB_ERROR_STATUS_UNKNOWN;
                                args->get_IsSuccess(&success);
                                args->get_WebErrorStatus(&web_error);
                                TraceWebView(
                                    success ? L"navigation completed" : L"navigation failed",
                                    web_error);
                                return S_OK;
                              })
                              .Get(),
                          &navigation_completed_token);
                      if (FAILED(navigation_completed_result)) {
                        ReportWebViewError(
                            state,
                            L"Could not register trusted document completion tracking",
                            navigation_completed_result);
                        return navigation_completed_result;
                      }
                      state.navigation_completed_token = navigation_completed_token;
                      state.navigation_completed_handler_registered = true;

                      const HRESULT message_handler_result = state.webview->add_WebMessageReceived(
                          Callback<ICoreWebView2WebMessageReceivedEventHandler>(
                              [this](ICoreWebView2*, ICoreWebView2WebMessageReceivedEventArgs* args) -> HRESULT {
                                if (IsTrustedWebMessage(*state_, args)) {
                                  ipc_.ForwardWebMessage(args);
                                }
                                return S_OK;
                              })
                              .Get(),
                          &state.web_message_token);
                      if (FAILED(message_handler_result)) {
                        ReportWebViewError(
                            state,
                            L"Could not register the WebView2 message handler",
                            message_handler_result);
                        return message_handler_result;
                      }
                      state.web_message_handler_registered = true;
                      TraceWebView(L"WebMessageReceived handler registered");

                      if (state.bridge_embedded) {
                        Resize();
                        TraceWebView(L"navigating with embedded bridge");
                        const HRESULT navigate_result = state.webview->Navigate(entry_url.c_str());
                        TraceWebView(L"Navigate returned", navigate_result);
                        return navigate_result;
                      }

                      const HRESULT bridge_result = state.webview->AddScriptToExecuteOnDocumentCreated(
                          GetBridgeScript(),
                          Callback<ICoreWebView2AddScriptToExecuteOnDocumentCreatedCompletedHandler>(
                              [this, entry_url, initialization_id](HRESULT script_result, LPCWSTR) -> HRESULT {
                                auto& state = *state_;
                                if (!IsCurrentInitialization(state, initialization_id)) {
                                  return S_OK;
                                }
                                if (FAILED(script_result)) {
                                  ReportWebViewError(
                                      state,
                                      L"Could not register the NodeViewJS bridge",
                                      script_result);
                                  return script_result;
                                }
                                Resize();
                                TraceWebView(L"navigating after bridge registration");
                                const HRESULT navigate_result = state.webview->Navigate(entry_url.c_str());
                                TraceWebView(L"Navigate returned", navigate_result);
                                return navigate_result;
                              })
                              .Get());
                      if (FAILED(bridge_result)) {
                        ReportWebViewError(
                            state,
                            L"Could not start NodeViewJS bridge registration",
                            bridge_result);
                        return bridge_result;
                      }
                      return S_OK;
                    })
                    .Get());
          })
          .Get());

  if (FAILED(environment_result)) {
    ReportWebViewError(state, (
        L"Could not start WebView2 initialization (HRESULT: " +
        FormatHResult(environment_result) + L").").c_str());
  }
}

void WebViewHost::SetDevToolsEnabled(bool enabled) {
  state_->devtools_enabled = enabled;
}

void WebViewHost::SetTransparent(bool enabled) {
  state_->transparent = enabled;
}

void WebViewHost::PostWebMessage(const Napi::Value& value) {
  auto& state = *state_;
  if (!value.IsString()) {
    throw Napi::TypeError::New(value.Env(), "postMessage expects one JSON string.");
  }
  if (!state.webview) {
    throw Napi::Error::New(value.Env(), "WebView2 is not ready.");
  }

  const std::u16string json = value.As<Napi::String>().Utf16Value();
  if (ExceedsUtf8Limit(json)) {
    throw Napi::RangeError::New(value.Env(), "IPC message exceeds the serialized size limit.");
  }
  const std::wstring message(
      reinterpret_cast<const wchar_t*>(json.data()),
      json.size());
  if (FAILED(state.webview->PostWebMessageAsJson(message.c_str()))) {
    throw Napi::Error::New(value.Env(), "Could not post a message to the WebView.");
  }
}

void WebViewHost::Reload(Napi::Env env) {
  auto& state = *state_;
  if (!state.webview) {
    return;
  }
  state.trusted_document.clear();
  if (FAILED(state.webview->Reload())) {
    throw Napi::Error::New(env, "Could not reload the WebView.");
  }
}

void WebViewHost::Resize() {
  auto& state = *state_;
  if (!state.controller || state.window == nullptr) {
    return;
  }

  RECT bounds{};
  GetClientRect(state.window, &bounds);
  if (GetEnvironmentVariableW(L"NODEVIEW_NATIVE_TRACE", nullptr, 0) != 0) {
    fwprintf(
        stderr,
        L"[NodeViewJS native trace] resize WebView bounds %ldx%ld\n",
        bounds.right - bounds.left,
        bounds.bottom - bounds.top);
    fflush(stderr);
  }
  state.controller->put_Bounds(bounds);
}

void WebViewHost::Close() {
  auto& state = *state_;
  ++state.initialization_id;
  if (state.controller) {
    if (state.webview) {
      if (state.webview3) {
        state.webview3->ClearVirtualHostNameToFolderMapping(kAppVirtualHost);
      }
      if (state.external_uri_handler_registered && state.webview18) {
        state.webview18->remove_LaunchingExternalUriScheme(state.external_uri_token);
      }
      if (state.download_handler_registered && state.webview4) {
        state.webview4->remove_DownloadStarting(state.download_token);
      }
      if (state.web_resource_filter_registered) {
        state.webview->RemoveWebResourceRequestedFilter(
            L"*",
            COREWEBVIEW2_WEB_RESOURCE_CONTEXT_ALL);
      }
      if (state.web_resource_handler_registered) {
        state.webview->remove_WebResourceRequested(state.web_resource_token);
      }
      if (state.permission_handler_registered) {
        state.webview->remove_PermissionRequested(state.permission_token);
      }
      if (state.new_window_handler_registered) {
        state.webview->remove_NewWindowRequested(state.new_window_token);
      }
      if (state.navigation_handler_registered) {
        state.webview->remove_NavigationStarting(state.navigation_starting_token);
      }
      if (state.frame_navigation_handler_registered) {
        state.webview->remove_FrameNavigationStarting(state.frame_navigation_starting_token);
      }
      if (state.source_changed_handler_registered) {
        state.webview->remove_SourceChanged(state.source_changed_token);
      }
      if (state.content_loading_handler_registered) {
        state.webview->remove_ContentLoading(state.content_loading_token);
      }
      if (state.navigation_completed_handler_registered) {
        state.webview->remove_NavigationCompleted(state.navigation_completed_token);
      }
      if (state.web_message_handler_registered) {
        state.webview->remove_WebMessageReceived(state.web_message_token);
      }
    }
    state.controller->Close();
  }
  state.webview18.Reset();
  state.webview4.Reset();
  state.webview.Reset();
  state.webview3.Reset();
  state.controller.Reset();
  state.environment.Reset();
  state.download_handler_registered = false;
  state.external_uri_handler_registered = false;
  state.web_resource_filter_registered = false;
  state.web_resource_handler_registered = false;
  state.permission_handler_registered = false;
  state.new_window_handler_registered = false;
  state.web_message_handler_registered = false;
  state.navigation_handler_registered = false;
  state.frame_navigation_handler_registered = false;
  state.source_changed_handler_registered = false;
  state.content_loading_handler_registered = false;
  state.navigation_completed_handler_registered = false;
  state.content_root.clear();
  state.trusted_document.clear();
  ipc_.Clear();
  state.window = nullptr;
}

void PostWebMessage(const Napi::CallbackInfo& info) {
  if (info.Length() == 1) {
    GetRuntime().PrimaryWindow(info.Env()).WebView().PostWebMessage(info[0]);
    return;
  }
  if (info.Length() != 2) {
    throw Napi::TypeError::New(info.Env(), "postMessage expects a window id and JSON string.");
  }
  GetRuntime().Window(info.Env(), GetWindowId(info, 0)).WebView().PostWebMessage(info[1]);
}

void ReloadWebView(const Napi::CallbackInfo& info) {
  if (info.Length() == 0) {
    GetRuntime().PrimaryWindow(info.Env()).WebView().Reload(info.Env());
    return;
  }
  if (info.Length() != 1) {
    throw Napi::TypeError::New(info.Env(), "reload expects an optional window id.");
  }
  GetRuntime().Window(info.Env(), GetWindowId(info, 0)).WebView().Reload(info.Env());
}

}  // namespace nodeview
