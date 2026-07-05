#include "bridge.h"

#include "../generated/bridge_script.h"

namespace nodeview {

const wchar_t* GetBridgeScript() {
  return generated::kBridgeScript;
}

const char* GetBridgeScriptUtf8() {
  return generated::kBridgeScriptUtf8;
}

}  // namespace nodeview
