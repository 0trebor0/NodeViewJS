#include <windows.h>
#include <bcrypt.h>

#include <algorithm>
#include <array>
#include <cstdint>
#include <cwctype>
#include <limits>
#include <set>
#include <string>
#include <vector>

#pragma comment(linker, "/SUBSYSTEM:WINDOWS")

namespace {

constexpr wchar_t kManifestName[] = L"integrity.manifest";
constexpr char kManifestHeader[] = "NODEVIEWJS-INTEGRITY 1 SHA256";
constexpr size_t kMaxManifestBytes = 16 * 1024 * 1024;
constexpr size_t kMaxManifestEntries = 100000;
constexpr int kIntegrityResourceId = 301;

struct ManifestEntry {
  std::wstring relative_path;
  std::array<unsigned char, 32> sha256{};
  std::uint64_t size = 0;
};

std::wstring Lowercase(std::wstring value) {
  for (wchar_t& character : value) character = std::towlower(character);
  return value;
}

bool IsHex(char value) {
  return (value >= '0' && value <= '9') || (value >= 'a' && value <= 'f');
}

unsigned char HexValue(char value) {
  return value <= '9' ? static_cast<unsigned char>(value - '0')
                      : static_cast<unsigned char>(value - 'a' + 10);
}

bool DecodeUtf8Path(const std::string& encoded, std::wstring* output) {
  if (encoded.empty() || encoded.size() % 2 != 0) return false;
  std::string utf8;
  utf8.reserve(encoded.size() / 2);
  for (size_t index = 0; index < encoded.size(); index += 2) {
    if (!IsHex(encoded[index]) || !IsHex(encoded[index + 1])) return false;
    utf8.push_back(static_cast<char>((HexValue(encoded[index]) << 4) | HexValue(encoded[index + 1])));
  }
  if (utf8.find('\0') != std::string::npos) return false;
  const int length = MultiByteToWideChar(
      CP_UTF8, MB_ERR_INVALID_CHARS, utf8.data(), static_cast<int>(utf8.size()), nullptr, 0);
  if (length <= 0) return false;
  output->resize(length);
  if (MultiByteToWideChar(
          CP_UTF8,
          MB_ERR_INVALID_CHARS,
          utf8.data(),
          static_cast<int>(utf8.size()),
          output->data(),
          length) != length) {
    return false;
  }
  return true;
}

bool IsUnsafePathCharacter(wchar_t character) {
  return (character >= 0 && character <= 0x1F) || character == 0x7F ||
      (character >= 0x202A && character <= 0x202E) ||
      (character >= 0x2066 && character <= 0x2069);
}

bool IsSafeRelativePath(const std::wstring& path) {
  if (path.empty() || path.front() == L'/' || path.back() == L'/' ||
      path.find(L'\\') != std::wstring::npos || path.find(L':') != std::wstring::npos) {
    return false;
  }
  if (std::any_of(path.begin(), path.end(), IsUnsafePathCharacter)) return false;
  size_t start = 0;
  while (start < path.size()) {
    const size_t end = path.find(L'/', start);
    const std::wstring part = path.substr(start, end == std::wstring::npos ? path.size() - start : end - start);
    if (part.empty() || part == L"." || part == L"..") return false;
    if (end == std::wstring::npos) break;
    start = end + 1;
  }
  return true;
}

bool ParseUnsigned(const std::string& value, std::uint64_t* output) {
  if (value.empty() || (value.size() > 1 && value.front() == '0')) return false;
  std::uint64_t result = 0;
  for (char digit : value) {
    if (digit < '0' || digit > '9') return false;
    const std::uint64_t number = static_cast<unsigned>(digit - '0');
    if (result > (std::numeric_limits<std::uint64_t>::max() - number) / 10) return false;
    result = result * 10 + number;
  }
  *output = result;
  return true;
}

bool ParseManifest(const std::string& manifest, std::vector<ManifestEntry>* entries) {
  if (manifest.empty() || manifest.size() > kMaxManifestBytes) return false;
  const std::string header = std::string(kManifestHeader) + "\n";
  if (manifest.rfind(header, 0) != 0 || manifest.back() != '\n') return false;

  std::set<std::wstring> seen;
  size_t position = header.size();
  while (position < manifest.size()) {
    const size_t end = manifest.find('\n', position);
    if (end == std::string::npos || end == position || entries->size() >= kMaxManifestEntries) return false;
    const std::string line = manifest.substr(position, end - position);
    position = end + 1;

    const size_t first_space = line.find(' ');
    const size_t second_space = first_space == std::string::npos ? std::string::npos : line.find(' ', first_space + 1);
    if (first_space != 64 || second_space == std::string::npos ||
        line.find(' ', second_space + 1) != std::string::npos) {
      return false;
    }

    ManifestEntry entry;
    for (size_t index = 0; index < 32; ++index) {
      const char high = line[index * 2];
      const char low = line[index * 2 + 1];
      if (!IsHex(high) || !IsHex(low)) return false;
      entry.sha256[index] = static_cast<unsigned char>((HexValue(high) << 4) | HexValue(low));
    }
    if (!ParseUnsigned(line.substr(first_space + 1, second_space - first_space - 1), &entry.size) ||
        !DecodeUtf8Path(line.substr(second_space + 1), &entry.relative_path) ||
        !IsSafeRelativePath(entry.relative_path)) {
      return false;
    }
    const std::wstring key = Lowercase(entry.relative_path);
    if (!seen.insert(key).second) return false;
    entries->push_back(std::move(entry));
  }
  return !entries->empty();
}

bool ReadFileBytes(const std::wstring& path, size_t maximum, std::string* output) {
  HANDLE file = CreateFileW(
      path.c_str(), GENERIC_READ, FILE_SHARE_READ, nullptr, OPEN_EXISTING,
      FILE_ATTRIBUTE_NORMAL | FILE_FLAG_SEQUENTIAL_SCAN, nullptr);
  if (file == INVALID_HANDLE_VALUE) return false;
  LARGE_INTEGER size{};
  const bool valid_size = GetFileSizeEx(file, &size) && size.QuadPart >= 0 &&
      static_cast<std::uint64_t>(size.QuadPart) <= maximum;
  if (!valid_size) {
    CloseHandle(file);
    return false;
  }
  output->resize(static_cast<size_t>(size.QuadPart));
  size_t offset = 0;
  while (offset < output->size()) {
    DWORD read = 0;
    const DWORD requested = static_cast<DWORD>(std::min<size_t>(output->size() - offset, 1024 * 1024));
    if (!ReadFile(file, output->data() + offset, requested, &read, nullptr) || read == 0) {
      CloseHandle(file);
      return false;
    }
    offset += read;
  }
  CloseHandle(file);
  return true;
}

bool ReadEmbeddedManifest(std::string* output) {
  HRSRC resource = FindResourceW(nullptr, MAKEINTRESOURCEW(kIntegrityResourceId), RT_RCDATA);
  if (resource == nullptr) return false;
  const DWORD size = SizeofResource(nullptr, resource);
  if (size == 0 || size > kMaxManifestBytes) return false;
  HGLOBAL loaded = LoadResource(nullptr, resource);
  const void* bytes = loaded == nullptr ? nullptr : LockResource(loaded);
  if (bytes == nullptr) return false;
  output->assign(static_cast<const char*>(bytes), size);
  return true;
}

std::wstring FinalPath(HANDLE handle) {
  std::vector<wchar_t> buffer(32768);
  const DWORD length = GetFinalPathNameByHandleW(
      handle, buffer.data(), static_cast<DWORD>(buffer.size()), FILE_NAME_NORMALIZED);
  if (length == 0 || length >= buffer.size()) return L"";
  return std::wstring(buffer.data(), length);
}

bool IsWithinRoot(const std::wstring& root, const std::wstring& candidate) {
  if (candidate.size() <= root.size() || _wcsnicmp(root.c_str(), candidate.c_str(), root.size()) != 0) return false;
  return candidate[root.size()] == L'\\';
}

bool HashFile(
    BCRYPT_ALG_HANDLE algorithm,
    const std::wstring& resources_root,
    const std::wstring& path,
    std::uint64_t expected_size,
    std::array<unsigned char, 32>* digest) {
  const DWORD attributes = GetFileAttributesW(path.c_str());
  if (attributes == INVALID_FILE_ATTRIBUTES || (attributes & (FILE_ATTRIBUTE_DIRECTORY | FILE_ATTRIBUTE_REPARSE_POINT))) {
    return false;
  }
  HANDLE file = CreateFileW(
      path.c_str(), GENERIC_READ, FILE_SHARE_READ, nullptr, OPEN_EXISTING,
      FILE_ATTRIBUTE_NORMAL | FILE_FLAG_SEQUENTIAL_SCAN, nullptr);
  if (file == INVALID_HANDLE_VALUE) return false;
  const std::wstring final_path = FinalPath(file);
  LARGE_INTEGER size{};
  if (final_path.empty() || !IsWithinRoot(resources_root, final_path) ||
      !GetFileSizeEx(file, &size) || size.QuadPart < 0 ||
      static_cast<std::uint64_t>(size.QuadPart) != expected_size) {
    CloseHandle(file);
    return false;
  }

  DWORD object_size = 0;
  DWORD copied = 0;
  if (BCryptGetProperty(
          algorithm,
          BCRYPT_OBJECT_LENGTH,
          reinterpret_cast<PUCHAR>(&object_size),
          sizeof(object_size),
          &copied,
          0) != 0) {
    CloseHandle(file);
    return false;
  }
  std::vector<unsigned char> hash_object(object_size);
  BCRYPT_HASH_HANDLE hash = nullptr;
  if (BCryptCreateHash(algorithm, &hash, hash_object.data(), object_size, nullptr, 0, 0) != 0) {
    CloseHandle(file);
    return false;
  }

  std::vector<unsigned char> buffer(1024 * 1024);
  bool success = true;
  for (;;) {
    DWORD read = 0;
    if (!ReadFile(file, buffer.data(), static_cast<DWORD>(buffer.size()), &read, nullptr)) {
      success = false;
      break;
    }
    if (read == 0) break;
    if (BCryptHashData(hash, buffer.data(), read, 0) != 0) {
      success = false;
      break;
    }
  }
  if (success && BCryptFinishHash(hash, digest->data(), static_cast<ULONG>(digest->size()), 0) != 0) {
    success = false;
  }
  BCryptDestroyHash(hash);
  CloseHandle(file);
  return success;
}

bool EnumerateFiles(
    const std::wstring& directory,
    const std::wstring& relative,
    const std::wstring& allowed_log,
    const std::set<std::wstring>& expected) {
  WIN32_FIND_DATAW data{};
  HANDLE search = FindFirstFileW((directory + L"\\*").c_str(), &data);
  if (search == INVALID_HANDLE_VALUE) return false;
  bool success = true;
  do {
    const std::wstring name = data.cFileName;
    if (name == L"." || name == L"..") continue;
    if (data.dwFileAttributes & FILE_ATTRIBUTE_REPARSE_POINT) {
      success = false;
      break;
    }
    const std::wstring child_relative = relative.empty() ? name : relative + L"/" + name;
    const std::wstring child = directory + L"\\" + name;
    if (data.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY) {
      if (!EnumerateFiles(child, child_relative, allowed_log, expected)) {
        success = false;
        break;
      }
    } else {
      const std::wstring key = Lowercase(child_relative);
      if (key != Lowercase(kManifestName) && key != allowed_log && expected.find(key) == expected.end()) {
        success = false;
        break;
      }
    }
  } while (FindNextFileW(search, &data));
  FindClose(search);
  return success;
}

bool VerifyIntegrity(
    const std::wstring& resources_directory,
    const std::wstring& app_name,
    std::wstring* failure) {
  std::string embedded;
  std::string disk;
  if (!ReadEmbeddedManifest(&embedded) ||
      !ReadFileBytes(resources_directory + L"\\" + kManifestName, kMaxManifestBytes, &disk) ||
      embedded != disk) {
    *failure = L"The package integrity manifest is missing or has been modified.";
    return false;
  }

  std::vector<ManifestEntry> entries;
  if (!ParseManifest(embedded, &entries)) {
    *failure = L"The package integrity manifest is invalid.";
    return false;
  }

  const DWORD root_attributes = GetFileAttributesW(resources_directory.c_str());
  if (root_attributes == INVALID_FILE_ATTRIBUTES || !(root_attributes & FILE_ATTRIBUTE_DIRECTORY) ||
      (root_attributes & FILE_ATTRIBUTE_REPARSE_POINT)) {
    *failure = L"The package resources directory is not trusted.";
    return false;
  }
  HANDLE root_handle = CreateFileW(
      resources_directory.c_str(), 0, FILE_SHARE_READ, nullptr, OPEN_EXISTING,
      FILE_FLAG_BACKUP_SEMANTICS, nullptr);
  if (root_handle == INVALID_HANDLE_VALUE) {
    *failure = L"The package resources directory could not be opened.";
    return false;
  }
  const std::wstring resources_root = FinalPath(root_handle);
  CloseHandle(root_handle);
  if (resources_root.empty()) {
    *failure = L"The package resources directory could not be canonicalized.";
    return false;
  }

  BCRYPT_ALG_HANDLE algorithm = nullptr;
  if (BCryptOpenAlgorithmProvider(&algorithm, BCRYPT_SHA256_ALGORITHM, nullptr, 0) != 0) {
    *failure = L"SHA-256 verification is unavailable.";
    return false;
  }
  std::set<std::wstring> expected;
  bool success = true;
  for (const ManifestEntry& entry : entries) {
    std::wstring relative = entry.relative_path;
    for (wchar_t& character : relative) if (character == L'/') character = L'\\';
    std::array<unsigned char, 32> digest{};
    if (!HashFile(
            algorithm,
            resources_root,
            resources_directory + L"\\" + relative,
            entry.size,
            &digest) || digest != entry.sha256) {
      *failure = L"A packaged application file failed integrity verification: " + entry.relative_path;
      success = false;
      break;
    }
    expected.insert(Lowercase(entry.relative_path));
  }
  BCryptCloseAlgorithmProvider(algorithm, 0);
  if (!success) return false;

  const std::wstring allowed_log = Lowercase(app_name + L".log");
  if (!EnumerateFiles(resources_directory, L"", allowed_log, expected)) {
    *failure = L"The package contains an unlisted file or reparse point.";
    return false;
  }
  return true;
}

// The audience for an integrity failure is whoever is trying to run the app,
// not a developer, so the guidance is about recovering the installation rather
// than about the build.
std::wstring ExplainIntegrityFailure(const std::wstring& message, const std::wstring& log_path) {
  return message +
         L"\n\nThe application will not start, because its files no longer match the ones "
         L"it was published with.\n\n"
         L"This usually means a file was modified, replaced, or corrupted after "
         L"installation, or that antivirus software quarantined one of them.\n\n"
         L"What to do:\n"
         L"    \x2022 Reinstall the application from its original installer or download.\n"
         L"    \x2022 If you packaged it yourself, run the packaging step again.\n\n"
         L"Details: " + log_path;
}

void ReportError(
    const std::wstring& raw_message,
    const std::wstring& resources_directory,
    const std::wstring& log_path) {
  const std::wstring message = ExplainIntegrityFailure(raw_message, log_path);
  const DWORD root_attributes = GetFileAttributesW(resources_directory.c_str());
  const DWORD log_attributes = GetFileAttributesW(log_path.c_str());
  const bool safe_log = root_attributes != INVALID_FILE_ATTRIBUTES &&
      (root_attributes & FILE_ATTRIBUTE_DIRECTORY) &&
      !(root_attributes & FILE_ATTRIBUTE_REPARSE_POINT) &&
      (log_attributes == INVALID_FILE_ATTRIBUTES ||
        !(log_attributes & (FILE_ATTRIBUTE_DIRECTORY | FILE_ATTRIBUTE_REPARSE_POINT)));
  HANDLE log = safe_log ? CreateFileW(
      log_path.c_str(), GENERIC_WRITE, FILE_SHARE_READ, nullptr, OPEN_ALWAYS,
      FILE_ATTRIBUTE_NORMAL, nullptr) : INVALID_HANDLE_VALUE;
  if (log != INVALID_HANDLE_VALUE) {
    SetFilePointer(log, 0, nullptr, FILE_END);
    const int length = WideCharToMultiByte(
        CP_UTF8, 0, message.data(), static_cast<int>(message.size()), nullptr, 0, nullptr, nullptr);
    if (length > 0) {
      std::string utf8(static_cast<size_t>(length), '\0');
      WideCharToMultiByte(
          CP_UTF8, 0, message.data(), static_cast<int>(message.size()), utf8.data(), length, nullptr, nullptr);
      DWORD written = 0;
      WriteFile(log, utf8.data(), static_cast<DWORD>(utf8.size()), &written, nullptr);
    }
    CloseHandle(log);
  }
  wchar_t suppress[2]{};
  if (GetEnvironmentVariableW(L"NODEVIEW_NO_ERROR_DIALOG", suppress, 2) == 0) {
    MessageBoxW(nullptr, message.c_str(), L"NodeViewJS integrity failure", MB_OK | MB_ICONERROR);
  }
}

}  // namespace

int WINAPI wWinMain(
    _In_ HINSTANCE,
    _In_opt_ HINSTANCE,
    _In_ PWSTR command_line,
    _In_ int) {
  std::vector<wchar_t> executable_path(32768);
  const DWORD length = GetModuleFileNameW(
      nullptr, executable_path.data(), static_cast<DWORD>(executable_path.size()));
  if (length == 0 || length == executable_path.size()) return 1;

  std::wstring directory(executable_path.data(), length);
  directory = directory.substr(0, directory.find_last_of(L"\\/"));
  std::wstring executable_name(executable_path.data(), length);
  executable_name = executable_name.substr(executable_name.find_last_of(L"\\/") + 1);
  const size_t extension_position = executable_name.find_last_of(L'.');
  const std::wstring app_name = extension_position == std::wstring::npos
      ? executable_name
      : executable_name.substr(0, extension_position);
  const std::wstring resources_directory = directory + L"\\resources";
  const std::wstring node_path = resources_directory + L"\\runtime\\node.exe";
  const std::wstring app_path = resources_directory + L"\\app\\app.js";
  const std::wstring log_path = resources_directory + L"\\" + app_name + L".log";

  std::wstring integrity_failure;
  if (!VerifyIntegrity(resources_directory, app_name, &integrity_failure)) {
    ReportError(integrity_failure, resources_directory, log_path);
    return 1;
  }

  std::wstring command = L"\"" + node_path + L"\" \"" + app_path + L"\"";
  if (command_line != nullptr && command_line[0] != L'\0') {
    command += L" ";
    command += command_line;
  }

  SetEnvironmentVariableW(L"NODEVIEW_LAUNCHER_PATH", std::wstring(executable_path.data(), length).c_str());
  SetEnvironmentVariableW(L"NODEVIEW_LAUNCHER_PID", std::to_wstring(GetCurrentProcessId()).c_str());

  SECURITY_ATTRIBUTES security{};
  security.nLength = sizeof(security);
  security.bInheritHandle = TRUE;
  HANDLE log_file = CreateFileW(
      log_path.c_str(), GENERIC_WRITE, FILE_SHARE_READ, &security, OPEN_ALWAYS,
      FILE_ATTRIBUTE_NORMAL, nullptr);
  if (log_file == INVALID_HANDLE_VALUE) return 1;
  SetFilePointer(log_file, 0, nullptr, FILE_END);

  STARTUPINFOW startup{};
  startup.cb = sizeof(startup);
  startup.dwFlags = STARTF_USESTDHANDLES;
  startup.hStdOutput = log_file;
  startup.hStdError = log_file;
  startup.hStdInput = GetStdHandle(STD_INPUT_HANDLE);
  PROCESS_INFORMATION process{};
  if (!CreateProcessW(
          nullptr, command.data(), nullptr, nullptr, TRUE, CREATE_NO_WINDOW, nullptr,
          resources_directory.c_str(), &startup, &process)) {
    CloseHandle(log_file);
    ReportError(L"Could not start the bundled NodeViewJS runtime.", resources_directory, log_path);
    return 1;
  }

  WaitForSingleObject(process.hProcess, INFINITE);
  DWORD exit_code = 0;
  GetExitCodeProcess(process.hProcess, &exit_code);
  CloseHandle(log_file);
  CloseHandle(process.hThread);
  CloseHandle(process.hProcess);
  return static_cast<int>(exit_code);
}
