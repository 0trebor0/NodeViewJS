#pragma once

#include <napi.h>

namespace nodeview {

Napi::Value CreateNativeWindow(const Napi::CallbackInfo& info);
void CloseNativeWindow(const Napi::CallbackInfo& info);
void CloseAllNativeWindows(const Napi::CallbackInfo& info);
void ShowNativeWindow(const Napi::CallbackInfo& info);
void HideNativeWindow(const Napi::CallbackInfo& info);
void MinimizeNativeWindow(const Napi::CallbackInfo& info);
void MaximizeNativeWindow(const Napi::CallbackInfo& info);
void RestoreNativeWindow(const Napi::CallbackInfo& info);
void SetNativeWindowFullscreen(const Napi::CallbackInfo& info);
void SetNativeWindowTitle(const Napi::CallbackInfo& info);
void SetNativeWindowColors(const Napi::CallbackInfo& info);
void SetNativeWindowSize(const Napi::CallbackInfo& info);
void SetNativeWindowPosition(const Napi::CallbackInfo& info);
void StartNativeWindowDrag(const Napi::CallbackInfo& info);
Napi::Value GetNativeWindowState(const Napi::CallbackInfo& info);
Napi::Value GetNativeWindowCounts(const Napi::CallbackInfo& info);
void SetNativeMenuHandler(const Napi::CallbackInfo& info);
void SetNativeApplicationMenu(const Napi::CallbackInfo& info);
void SetNativeWindowShortcuts(const Napi::CallbackInfo& info);
void ShowNativeContextMenu(const Napi::CallbackInfo& info);
void SetNativeTaskbarProgress(const Napi::CallbackInfo& info);
void SetNativeTaskbarOverlay(const Napi::CallbackInfo& info);
void RequestNativeWindowAttention(const Napi::CallbackInfo& info);
void SetTray(const Napi::CallbackInfo& info);
void ShowMessageDialog(const Napi::CallbackInfo& info);
void ShowNotification(const Napi::CallbackInfo& info);
Napi::Value OpenFileDialog(const Napi::CallbackInfo& info);
Napi::Value OpenMultipleFilesDialog(const Napi::CallbackInfo& info);
Napi::Value OpenDirectoryDialog(const Napi::CallbackInfo& info);
Napi::Value SaveFileDialog(const Napi::CallbackInfo& info);
Napi::Value ReadClipboardText(const Napi::CallbackInfo& info);
Napi::Value WriteClipboardText(const Napi::CallbackInfo& info);
Napi::Value ClaimSingleInstance(const Napi::CallbackInfo& info);
void ReleaseSingleInstance(const Napi::CallbackInfo& info);
Napi::Value OpenExternal(const Napi::CallbackInfo& info);
Napi::Value OpenPath(const Napi::CallbackInfo& info);
void LoadFile(const Napi::CallbackInfo& info);
void SetMessageHandler(const Napi::CallbackInfo& info);
void PostWebMessage(const Napi::CallbackInfo& info);
void ReloadWebView(const Napi::CallbackInfo& info);
void Run(const Napi::CallbackInfo& info);

}  // namespace nodeview
