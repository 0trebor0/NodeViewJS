#include <fcntl.h>
#include <sys/wait.h>
#include <unistd.h>

#include <cerrno>
#include <cstdio>
#include <cstdlib>
#include <filesystem>
#include <string>
#include <vector>

namespace {

std::filesystem::path ExecutablePath() {
  std::vector<char> buffer(4096);
  const ssize_t length = readlink("/proc/self/exe", buffer.data(), buffer.size() - 1);
  if (length < 0 || static_cast<std::size_t>(length) >= buffer.size() - 1) return {};
  buffer[static_cast<std::size_t>(length)] = '\0';
  return std::filesystem::path(buffer.data());
}

}  // namespace

int main() {
  const std::filesystem::path executable = ExecutablePath();
  if (executable.empty()) {
    std::fputs("NodeViewJS could not resolve its launcher path.\n", stderr);
    return 1;
  }
  const std::filesystem::path resources = executable.parent_path() / "resources";
  const std::filesystem::path node = resources / "runtime" / "node";
  const std::filesystem::path app = resources / "app" / "app.js";
  if (access(node.c_str(), X_OK) != 0 || access(app.c_str(), F_OK) != 0) {
    std::fputs("The bundled Node runtime or application entry is missing.\n", stderr);
    return 1;
  }

  const char* home = std::getenv("HOME");
  const char* state_home = std::getenv("XDG_STATE_HOME");
  const std::filesystem::path logs = state_home != nullptr
      ? std::filesystem::path(state_home) / "nodeviewjs"
      : std::filesystem::path(home == nullptr ? "." : home) / ".local" / "state" / "nodeviewjs";
  std::error_code directory_error;
  std::filesystem::create_directories(logs, directory_error);
  if (directory_error) {
    std::fputs("NodeViewJS could not create its log directory.\n", stderr);
    return 1;
  }
  const std::filesystem::path log_path = logs / (executable.filename().string() + ".log");
  const int log_file = open(log_path.c_str(), O_CREAT | O_WRONLY | O_TRUNC, 0644);
  if (log_file < 0) return 1;

  const std::string launcher_path = executable.string();
  const std::string launcher_pid = std::to_string(getpid());
  setenv("NODEVIEW_LAUNCHER_PATH", launcher_path.c_str(), 1);
  setenv("NODEVIEW_LAUNCHER_PID", launcher_pid.c_str(), 1);

  const pid_t child = fork();
  if (child == 0) {
    dup2(log_file, STDOUT_FILENO);
    dup2(log_file, STDERR_FILENO);
    close(log_file);
    if (chdir(resources.c_str()) != 0) _exit(1);
    execl(node.c_str(), node.c_str(), app.c_str(), static_cast<char*>(nullptr));
    _exit(1);
  }
  close(log_file);
  if (child < 0) return 1;

  int status = 0;
  while (waitpid(child, &status, 0) < 0) {
    if (errno != EINTR) return 1;
  }
  return WIFEXITED(status) ? WEXITSTATUS(status) : 1;
}
