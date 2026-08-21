#include <napi.h>

#include "native_api.h"

Napi::Object Initialize(Napi::Env env, Napi::Object exports) {
  exports.Set("createWindow", Napi::Function::New(env, nodeview::CreateNativeWindow));
  exports.Set("closeWindow", Napi::Function::New(env, nodeview::CloseNativeWindow));
  exports.Set("closeAllWindows", Napi::Function::New(env, nodeview::CloseAllNativeWindows));
  exports.Set("showWindow", Napi::Function::New(env, nodeview::ShowNativeWindow));
  exports.Set("hideWindow", Napi::Function::New(env, nodeview::HideNativeWindow));
#ifdef _WIN32
  exports.Set("minimizeWindow", Napi::Function::New(env, nodeview::MinimizeNativeWindow));
  exports.Set("maximizeWindow", Napi::Function::New(env, nodeview::MaximizeNativeWindow));
  exports.Set("restoreWindow", Napi::Function::New(env, nodeview::RestoreNativeWindow));
  exports.Set("setWindowFullscreen", Napi::Function::New(env, nodeview::SetNativeWindowFullscreen));
  exports.Set("setWindowTitle", Napi::Function::New(env, nodeview::SetNativeWindowTitle));
  exports.Set("setWindowColors", Napi::Function::New(env, nodeview::SetNativeWindowColors));
  exports.Set("setWindowSize", Napi::Function::New(env, nodeview::SetNativeWindowSize));
  exports.Set("setWindowPosition", Napi::Function::New(env, nodeview::SetNativeWindowPosition));
  exports.Set("startWindowDrag", Napi::Function::New(env, nodeview::StartNativeWindowDrag));
  exports.Set("getWindowState", Napi::Function::New(env, nodeview::GetNativeWindowState));
  // Internal diagnostics used by the window-retention test.
  exports.Set("getWindowCounts", Napi::Function::New(env, nodeview::GetNativeWindowCounts));
  exports.Set("setMenuHandler", Napi::Function::New(env, nodeview::SetNativeMenuHandler));
  exports.Set("setApplicationMenu", Napi::Function::New(env, nodeview::SetNativeApplicationMenu));
  exports.Set("setWindowShortcuts", Napi::Function::New(env, nodeview::SetNativeWindowShortcuts));
  exports.Set("showContextMenu", Napi::Function::New(env, nodeview::ShowNativeContextMenu));
  exports.Set("setTaskbarProgress", Napi::Function::New(env, nodeview::SetNativeTaskbarProgress));
  exports.Set("setTaskbarOverlay", Napi::Function::New(env, nodeview::SetNativeTaskbarOverlay));
  exports.Set("requestWindowAttention", Napi::Function::New(env, nodeview::RequestNativeWindowAttention));
#endif
  exports.Set("setTray", Napi::Function::New(env, nodeview::SetTray));
  exports.Set("showMessageDialog", Napi::Function::New(env, nodeview::ShowMessageDialog));
  exports.Set("showNotification", Napi::Function::New(env, nodeview::ShowNotification));
  exports.Set("openFileDialog", Napi::Function::New(env, nodeview::OpenFileDialog));
  exports.Set("saveFileDialog", Napi::Function::New(env, nodeview::SaveFileDialog));
#ifdef _WIN32
  exports.Set("openMultipleFilesDialog", Napi::Function::New(env, nodeview::OpenMultipleFilesDialog));
  exports.Set("openDirectoryDialog", Napi::Function::New(env, nodeview::OpenDirectoryDialog));
  exports.Set("readClipboardText", Napi::Function::New(env, nodeview::ReadClipboardText));
  exports.Set("writeClipboardText", Napi::Function::New(env, nodeview::WriteClipboardText));
  exports.Set("claimSingleInstance", Napi::Function::New(env, nodeview::ClaimSingleInstance));
  exports.Set("releaseSingleInstance", Napi::Function::New(env, nodeview::ReleaseSingleInstance));
  exports.Set("openExternal", Napi::Function::New(env, nodeview::OpenExternal));
  exports.Set("openPath", Napi::Function::New(env, nodeview::OpenPath));
#endif
  exports.Set("loadFile", Napi::Function::New(env, nodeview::LoadFile));
  exports.Set("setMessageHandler", Napi::Function::New(env, nodeview::SetMessageHandler));
  exports.Set("postMessage", Napi::Function::New(env, nodeview::PostWebMessage));
  exports.Set("reload", Napi::Function::New(env, nodeview::ReloadWebView));
  exports.Set("run", Napi::Function::New(env, nodeview::Run));
  return exports;
}

NODE_API_MODULE(nodeview, Initialize)
