#import <Cocoa/Cocoa.h>

#include <fcntl.h>
#include <spawn.h>
#include <sys/wait.h>
#include <unistd.h>

#include <string>

extern char** environ;

namespace {

int ShowLaunchError(NSString* message) {
  [NSApplication sharedApplication];
  NSAlert* alert = [NSAlert new];
  alert.messageText = @"NodeViewJS could not start";
  alert.informativeText = message;
  [alert runModal];
  return 1;
}

}  // namespace

int main(int, char**) {
  @autoreleasepool {
    NSBundle* bundle = [NSBundle mainBundle];
    NSString* resources = bundle.resourcePath;
    NSString* node_path = [resources stringByAppendingPathComponent:@"runtime/node"];
    NSString* app_path = [resources stringByAppendingPathComponent:@"app/app.js"];
    if (![[NSFileManager defaultManager] isExecutableFileAtPath:node_path] ||
        ![[NSFileManager defaultManager] fileExistsAtPath:app_path]) {
      return ShowLaunchError(@"The bundled Node runtime or application entry is missing.");
    }

    NSString* app_name = [bundle objectForInfoDictionaryKey:@"CFBundleName"] ?: @"NodeViewJS";
    NSString* app_id = bundle.bundleIdentifier ?: app_name;
    NSString* logs = [NSHomeDirectory() stringByAppendingPathComponent:
        [NSString stringWithFormat:@"Library/Logs/%@", app_id]];
    NSError* directory_error = nil;
    if (![[NSFileManager defaultManager] createDirectoryAtPath:logs
                                   withIntermediateDirectories:YES
                                                    attributes:nil
                                                         error:&directory_error]) {
      return ShowLaunchError(directory_error.localizedDescription);
    }
    NSString* log_path = [logs stringByAppendingPathComponent:
        [app_name stringByAppendingPathExtension:@"log"]];
    const int log_file = open(log_path.fileSystemRepresentation, O_CREAT | O_WRONLY | O_APPEND, 0644);
    if (log_file < 0) return ShowLaunchError(@"The application log file could not be created.");

    const std::string launcher_path(bundle.executablePath.fileSystemRepresentation);
    const std::string launcher_pid = std::to_string(getpid());
    setenv("NODEVIEW_LAUNCHER_PATH", launcher_path.c_str(), 1);
    setenv("NODEVIEW_LAUNCHER_PID", launcher_pid.c_str(), 1);

    posix_spawn_file_actions_t actions;
    posix_spawn_file_actions_init(&actions);
    posix_spawn_file_actions_adddup2(&actions, log_file, STDOUT_FILENO);
    posix_spawn_file_actions_adddup2(&actions, log_file, STDERR_FILENO);
    posix_spawn_file_actions_addclose(&actions, log_file);
    posix_spawn_file_actions_addchdir_np(&actions, resources.fileSystemRepresentation);

    char* arguments[] = {
      const_cast<char*>(node_path.fileSystemRepresentation),
      const_cast<char*>(app_path.fileSystemRepresentation),
      nullptr
    };
    pid_t child = 0;
    const int spawn_result = posix_spawn(
        &child,
        node_path.fileSystemRepresentation,
        &actions,
        nullptr,
        arguments,
        environ);
    posix_spawn_file_actions_destroy(&actions);
    close(log_file);
    if (spawn_result != 0) return ShowLaunchError(@"The bundled Node runtime could not be launched.");

    int status = 0;
    if (waitpid(child, &status, 0) < 0) return 1;
    if (WIFEXITED(status)) return WEXITSTATUS(status);
    return 1;
  }
}
