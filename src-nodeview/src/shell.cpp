#include <windows.h>
#include <shellapi.h>

#include <cstdint>
#include <cwchar>
#include <cwctype>
#include <string>

#include "native_api.h"

namespace {

std::wstring RequireString(const Napi::CallbackInfo& info, const char* method) {
  if (info.Length() != 1 || !info[0].IsString()) {
    throw Napi::TypeError::New(info.Env(), std::string(method) + " expects one string.");
  }
  const std::u16string value = info[0].As<Napi::String>().Utf16Value();
  if (value.empty()) {
    throw Napi::TypeError::New(info.Env(), std::string(method) + " expects a non-empty string.");
  }
  return std::wstring(value.begin(), value.end());
}

bool StartsWithIgnoreCase(const std::wstring& value, const wchar_t* prefix) {
  const std::size_t length = std::wcslen(prefix);
  return value.size() >= length && _wcsnicmp(value.c_str(), prefix, length) == 0;
}

bool ContainsControlCharacter(const std::wstring& value) {
  for (const wchar_t character : value) {
    if (character <= 0x1F || character == 0x7F) return true;
  }
  return false;
}

bool HasEdgeWhitespace(const std::wstring& value) {
  return !value.empty() &&
         (std::iswspace(value.front()) != 0 || std::iswspace(value.back()) != 0);
}

Napi::Value OpenTarget(const Napi::CallbackInfo& info,
                       const std::wstring& target,
                       const char* label) {
  const HINSTANCE result = ShellExecuteW(
      nullptr, L"open", target.c_str(), nullptr, nullptr, SW_SHOWNORMAL);
  const auto code = reinterpret_cast<std::intptr_t>(result);
  if (code <= 32) {
    throw Napi::Error::New(
        info.Env(), std::string("Windows could not open the ") + label +
                        " (ShellExecuteW code " + std::to_string(code) + ").");
  }
  return Napi::Boolean::New(info.Env(), true);
}

}  // namespace

namespace nodeview {

Napi::Value OpenExternal(const Napi::CallbackInfo& info) {
  const std::wstring url = RequireString(info, "openExternal");
  if (HasEdgeWhitespace(url) || ContainsControlCharacter(url)) {
    throw Napi::TypeError::New(
        info.Env(),
        "openExternal URLs must not contain leading, trailing, or control whitespace.");
  }
  if (!StartsWithIgnoreCase(url, L"http://") &&
      !StartsWithIgnoreCase(url, L"https://") &&
      !StartsWithIgnoreCase(url, L"mailto:")) {
    throw Napi::TypeError::New(
        info.Env(), "openExternal supports only http, https, and mailto URLs.");
  }
  return OpenTarget(info, url, "external URL");
}

Napi::Value OpenPath(const Napi::CallbackInfo& info) {
  const std::wstring path = RequireString(info, "openPath");
  if (ContainsControlCharacter(path)) {
    throw Napi::TypeError::New(
        info.Env(), "openPath targets must not contain control characters.");
  }
  if (GetFileAttributesW(path.c_str()) == INVALID_FILE_ATTRIBUTES) {
    throw Napi::Error::New(info.Env(), "openPath target does not exist.");
  }
  return OpenTarget(info, path, "path");
}

}  // namespace nodeview
