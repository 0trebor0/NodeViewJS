#include <windows.h>

#include <napi.h>

#include <string>

#include "native_api.h"

namespace {

HANDLE g_single_instance_mutex = nullptr;
std::wstring g_single_instance_name;

std::wstring GetMutexName(const Napi::Value& value) {
  if (!value.IsString()) {
    throw Napi::TypeError::New(value.Env(), "Single-instance key must be a string.");
  }
  const std::u16string key = value.As<Napi::String>().Utf16Value();
  if (key.empty()) {
    throw Napi::TypeError::New(value.Env(), "Single-instance key must not be empty.");
  }
  return L"Local\\NodeViewJS." + std::wstring(key.begin(), key.end());
}

}  // namespace

namespace nodeview {

Napi::Value ClaimSingleInstance(const Napi::CallbackInfo& info) {
  if (info.Length() != 1) {
    throw Napi::TypeError::New(info.Env(), "claimSingleInstance expects one key string.");
  }
  const std::wstring name = GetMutexName(info[0]);
  if (g_single_instance_mutex != nullptr) {
    if (g_single_instance_name != name) {
      throw Napi::Error::New(info.Env(), "This process already owns a different single-instance key.");
    }
    return Napi::Boolean::New(info.Env(), true);
  }

  HANDLE mutex = CreateMutexW(nullptr, FALSE, name.c_str());
  if (mutex == nullptr) {
    throw Napi::Error::New(
        info.Env(),
        "Could not create the Windows single-instance mutex (error " +
            std::to_string(GetLastError()) + ").");
  }
  if (GetLastError() == ERROR_ALREADY_EXISTS) {
    CloseHandle(mutex);
    return Napi::Boolean::New(info.Env(), false);
  }

  g_single_instance_mutex = mutex;
  g_single_instance_name = name;
  return Napi::Boolean::New(info.Env(), true);
}

void ReleaseSingleInstance(const Napi::CallbackInfo& info) {
  if (info.Length() != 0) {
    throw Napi::TypeError::New(info.Env(), "releaseSingleInstance does not accept arguments.");
  }
  if (g_single_instance_mutex != nullptr) {
    CloseHandle(g_single_instance_mutex);
    g_single_instance_mutex = nullptr;
    g_single_instance_name.clear();
  }
}

}  // namespace nodeview
