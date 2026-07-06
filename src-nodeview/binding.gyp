{
  "variables": {
    "security_analysis%": 0
  },
  "targets": [
    {
      "target_name": "nodeview",
      "include_dirs": [
        "<!@(node -p \"require('node-addon-api').include\")",
        "include"
      ],
      "sources": [
        "src/addon.cpp",
        "src/bridge.cpp"
      ],
      "defines": ["NAPI_CPP_EXCEPTIONS"],
      "cflags!": ["-fno-exceptions"],
      "cflags_cc!": ["-fno-exceptions"],
      "conditions": [
        ["OS=='win'", {
          "include_dirs": [
            "../vendor/webview2/Microsoft.Web.WebView2.1.0.3800.47/build/native/include"
          ],
          "sources": [
            "src/app.cpp",
            "src/clipboard.cpp",
            "src/ipc.cpp",
            "src/shell.cpp",
            "src/single_instance.cpp",
            "src/window.cpp",
            "src/webview.cpp"
          ],
          "defines": ["UNICODE", "_UNICODE", "WIN32_LEAN_AND_MEAN"],
          "libraries": [
            "user32.lib",
            "advapi32.lib",
            "comdlg32.lib",
            "dwmapi.lib",
            "ole32.lib",
            "shell32.lib",
            "shlwapi.lib",
            "windowsapp.lib",
            "<(module_root_dir)/../vendor/webview2/Microsoft.Web.WebView2.1.0.3800.47/build/native/x64/WebView2LoaderStatic.lib"
          ],
          "msvs_settings": {
            "VCCLCompilerTool": {
              "ExceptionHandling": 1,
              "AdditionalOptions": ["/sdl", "/guard:cf", "/Qspectre"]
            },
            "VCLinkerTool": {
              "AdditionalOptions": ["/guard:cf", "/DYNAMICBASE", "/NXCOMPAT", "/CETCOMPAT"]
            }
          },
          "conditions": [
            ["security_analysis==1", {
              "msvs_settings": {
                "VCCLCompilerTool": {
                  "AdditionalOptions": ["/analyze"],
                  "WarnAsError": "true"
                }
              }
            }]
          ]
        }],
        ["OS=='mac'", {
          "sources": ["src/macos.mm"],
          "libraries": ["-framework Cocoa", "-framework WebKit"],
          "xcode_settings": {
            "CLANG_ENABLE_OBJC_ARC": "YES",
            "CLANG_CXX_LANGUAGE_STANDARD": "c++20",
            "GCC_ENABLE_CPP_EXCEPTIONS": "YES",
            "MACOSX_DEPLOYMENT_TARGET": "12.0"
          }
        }],
        ["OS=='linux'", {
          "sources": ["src/linux.cpp"],
          "cflags": ["<!@(pkg-config --cflags gtk+-3.0 webkit2gtk-4.1)"],
          "cflags_cc": ["-std=c++17", "<!@(pkg-config --cflags gtk+-3.0 webkit2gtk-4.1)"],
          "libraries": ["<!@(pkg-config --libs gtk+-3.0 webkit2gtk-4.1)"]
        }]
      ]
    }
  ],
  "conditions": [
    ["OS=='win'", {
      "targets": [
        {
          "target_name": "nodeview_launcher",
          "type": "executable",
          "sources": ["src/launcher.cpp", "generated/launcher_metadata.rc"],
          "defines": ["UNICODE", "_UNICODE", "WIN32_LEAN_AND_MEAN"],
          "libraries": ["user32.lib", "bcrypt.lib"],
          "msvs_settings": {
            "VCCLCompilerTool": {
              "AdditionalOptions": ["/sdl", "/guard:cf", "/Qspectre"]
            },
            "VCLinkerTool": {
              "AdditionalOptions": ["/guard:cf", "/DYNAMICBASE", "/NXCOMPAT", "/CETCOMPAT"]
            }
          },
          "conditions": [
            ["security_analysis==1", {
              "msvs_settings": {
                "VCCLCompilerTool": {
                  "AdditionalOptions": ["/analyze"],
                  "WarnAsError": "true"
                }
              }
            }]
          ]
        }
      ]
    }],
    ["OS=='mac'", {
      "targets": [
        {
          "target_name": "nodeview_launcher",
          "type": "executable",
          "sources": ["src/macos_launcher.mm"],
          "libraries": ["-framework Cocoa"],
          "xcode_settings": {
            "CLANG_ENABLE_OBJC_ARC": "YES",
            "CLANG_CXX_LANGUAGE_STANDARD": "c++20",
            "MACOSX_DEPLOYMENT_TARGET": "12.0"
          }
        }
      ]
    }],
    ["OS=='linux'", {
      "targets": [
        {
          "target_name": "nodeview_launcher",
          "type": "executable",
          "sources": ["src/linux_launcher.cpp"],
          "cflags_cc": ["-std=c++17"]
        }
      ]
    }]
  ]
}
