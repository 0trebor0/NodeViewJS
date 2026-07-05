#include <windows.h>

#include <napi.h>

#include <stdexcept>
#include <string>

#include "native_api.h"

namespace {

constexpr int kClipboardOpenAttempts = 10;
constexpr DWORD kClipboardRetryDelayMs = 5;

class ClipboardSession {
 public:
  ClipboardSession() {
    owner_ = CreateWindowEx(
        0,
        L"STATIC",
        L"NodeViewJS Clipboard",
        0,
        0,
        0,
        0,
        0,
        HWND_MESSAGE,
        nullptr,
        GetModuleHandle(nullptr),
        nullptr);
    if (owner_ == nullptr) {
      throw std::runtime_error("Could not create the clipboard owner window.");
    }

    for (int attempt = 0; attempt < kClipboardOpenAttempts; ++attempt) {
      if (OpenClipboard(owner_)) {
        open_ = true;
        return;
      }
      if (attempt + 1 < kClipboardOpenAttempts) Sleep(kClipboardRetryDelayMs);
    }

    const DWORD error = GetLastError();
    DestroyWindow(owner_);
    owner_ = nullptr;
    throw std::runtime_error(
        "Could not open the Windows clipboard (error " + std::to_string(error) + ").");
  }

  ~ClipboardSession() {
    if (open_) CloseClipboard();
    if (owner_ != nullptr) DestroyWindow(owner_);
  }

  ClipboardSession(const ClipboardSession&) = delete;
  ClipboardSession& operator=(const ClipboardSession&) = delete;

 private:
  HWND owner_ = nullptr;
  bool open_ = false;
};

std::u16string ReadUnicodeClipboardText() {
  ClipboardSession clipboard;
  if (!IsClipboardFormatAvailable(CF_UNICODETEXT)) return {};

  HANDLE handle = GetClipboardData(CF_UNICODETEXT);
  if (handle == nullptr) {
    throw std::runtime_error("Could not access Unicode text on the Windows clipboard.");
  }

  const auto* text = static_cast<const wchar_t*>(GlobalLock(handle));
  if (text == nullptr) {
    throw std::runtime_error("Could not lock Unicode clipboard text.");
  }

  const std::size_t capacity = GlobalSize(handle) / sizeof(wchar_t);
  std::size_t length = 0;
  while (length < capacity && text[length] != L'\0') ++length;
  std::u16string result;
  try {
    result.assign(reinterpret_cast<const char16_t*>(text), length);
  } catch (...) {
    GlobalUnlock(handle);
    throw;
  }
  GlobalUnlock(handle);
  return result;
}

void WriteUnicodeClipboardText(const std::u16string& value) {
  if (value.find(u'\0') != std::u16string::npos) {
    throw std::invalid_argument("Clipboard text must not contain null characters.");
  }

  ClipboardSession clipboard;
  const SIZE_T byte_count = (value.size() + 1) * sizeof(wchar_t);
  HGLOBAL handle = GlobalAlloc(GMEM_MOVEABLE, byte_count);
  if (handle == nullptr) {
    throw std::runtime_error("Could not allocate memory for clipboard text.");
  }

  auto* destination = static_cast<wchar_t*>(GlobalLock(handle));
  if (destination == nullptr) {
    GlobalFree(handle);
    throw std::runtime_error("Could not lock memory for clipboard text.");
  }
  CopyMemory(destination, value.data(), value.size() * sizeof(wchar_t));
  destination[value.size()] = L'\0';
  GlobalUnlock(handle);

  if (!EmptyClipboard()) {
    GlobalFree(handle);
    throw std::runtime_error("Could not clear the Windows clipboard.");
  }
  if (SetClipboardData(CF_UNICODETEXT, handle) == nullptr) {
    GlobalFree(handle);
    throw std::runtime_error("Could not write Unicode text to the Windows clipboard.");
  }
}

}  // namespace

namespace nodeview {

Napi::Value ReadClipboardText(const Napi::CallbackInfo& info) {
  if (info.Length() != 0) {
    throw Napi::TypeError::New(info.Env(), "readClipboardText does not accept arguments.");
  }
  try {
    return Napi::String::New(info.Env(), ReadUnicodeClipboardText());
  } catch (const std::exception& error) {
    throw Napi::Error::New(info.Env(), error.what());
  }
}

Napi::Value WriteClipboardText(const Napi::CallbackInfo& info) {
  if (info.Length() != 1 || !info[0].IsString()) {
    throw Napi::TypeError::New(info.Env(), "writeClipboardText expects one string.");
  }
  try {
    WriteUnicodeClipboardText(info[0].As<Napi::String>().Utf16Value());
    return Napi::Boolean::New(info.Env(), true);
  } catch (const std::invalid_argument& error) {
    throw Napi::TypeError::New(info.Env(), error.what());
  } catch (const std::exception& error) {
    throw Napi::Error::New(info.Env(), error.what());
  }
}

}  // namespace nodeview
