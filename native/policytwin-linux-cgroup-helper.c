#define _GNU_SOURCE

#include <errno.h>
#include <fcntl.h>
#include <inttypes.h>
#include <limits.h>
#include <linux/magic.h>
#include <linux/openat2.h>
#include <poll.h>
#include <signal.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/prctl.h>
#include <sys/stat.h>
#include <sys/statfs.h>
#include <sys/syscall.h>
#include <sys/types.h>
#include <time.h>
#include <unistd.h>

/*
 * PolicyTwin Linux cgroup-v2 helper protocol v1.
 *
 * This process owns pidfds and cgroup dirfds outside the Node.js signing process. It communicates
 * only through fixed-size binary stdin/stdout frames. It has no shell, dynamic loading, network,
 * pathname supplied by a caller, or arbitrary-file operation. The helper source is present for
 * review but is not a live claim until a pinned binary is built and exercised on Linux.
 */

#ifndef SYS_pidfd_open
#error "pidfd_open syscall support is required"
#endif
#ifndef SYS_openat2
#error "openat2 syscall support is required"
#endif
#ifndef SYS_pidfd_send_signal
#error "pidfd_send_signal syscall support is required"
#endif
#ifndef CLOCK_MONOTONIC_RAW
#error "CLOCK_MONOTONIC_RAW is required"
#endif

#define FRAME_HEADER_BYTES 24U
#define MAX_PAYLOAD_BYTES 256U
#define MAX_TEXT_BYTES (64U * 1024U)
#define MAX_HANDLES 3U
#define PROTOCOL_VERSION 1U
#define RESPONSE_BIT 0x8000U
#define ERROR_OPCODE 0xffffU
#define CAPABILITY_BITS 0x7fULL
#define WAIT_TIMEOUT_NS 5000000000ULL

enum opcode {
  OP_HELLO = 0x0001,
  OP_RAW_CLOCK = 0x0002,
  OP_BIND = 0x0003,
  OP_SAMPLE = 0x0004,
  OP_FREEZE = 0x0005,
  OP_KILL = 0x0006,
  OP_QUIESCENT = 0x0007,
  OP_RELEASE = 0x0008,
  OP_CLOSE = 0x0009,
  OP_STOP = 0x000a
};

enum helper_error {
  ERR_PROTOCOL = 1,
  ERR_IDENTITY = 2,
  ERR_CGROUP = 3,
  ERR_COUNTER = 4,
  ERR_CLOCK = 5,
  ERR_STATE = 6,
  ERR_TIMEOUT = 7,
  ERR_INTERNAL = 8
};

struct frame {
  uint16_t opcode;
  uint64_t sequence;
  uint32_t payload_length;
  uint8_t payload[MAX_PAYLOAD_BYTES];
};

struct role_handle {
  bool used;
  uint32_t id;
  uint8_t role;
  pid_t pid;
  int pidfd;
  int cgroupfd;
  uint64_t pid_start_ticks;
  uint64_t device;
  uint64_t inode;
  uint64_t mount_id;
  uint64_t last_usage_usec;
  bool quiescent_verified;
  uint8_t container_id[32];
  char relative_path[PATH_MAX];
};

static const uint8_t frame_magic[4] = {'P', 'T', 'L', 'C'};
static struct role_handle handles[MAX_HANDLES];
static bool role_seen[4];
static int cgroup_root_fd = -1;
static uint64_t cgroup_root_mount_id = 0;

static int cgroup_mount_id(int directory_fd, uint64_t *output);

static uint16_t read_u16(const uint8_t *input) {
  return (uint16_t)(((uint16_t)input[0] << 8U) | (uint16_t)input[1]);
}

static uint32_t read_u32(const uint8_t *input) {
  return ((uint32_t)input[0] << 24U) | ((uint32_t)input[1] << 16U) |
         ((uint32_t)input[2] << 8U) | (uint32_t)input[3];
}

static uint64_t read_u64(const uint8_t *input) {
  uint64_t result = 0;
  for (size_t index = 0; index < 8U; index += 1U) {
    result = (result << 8U) | (uint64_t)input[index];
  }
  return result;
}

static void write_u16(uint8_t *output, uint16_t value) {
  output[0] = (uint8_t)(value >> 8U);
  output[1] = (uint8_t)value;
}

static void write_u32(uint8_t *output, uint32_t value) {
  output[0] = (uint8_t)(value >> 24U);
  output[1] = (uint8_t)(value >> 16U);
  output[2] = (uint8_t)(value >> 8U);
  output[3] = (uint8_t)value;
}

static void write_u64(uint8_t *output, uint64_t value) {
  for (size_t index = 0; index < 8U; index += 1U) {
    output[7U - index] = (uint8_t)(value & 0xffU);
    value >>= 8U;
  }
}

static int read_exact(int file_descriptor, uint8_t *buffer, size_t length, bool allow_eof) {
  size_t offset = 0;
  while (offset < length) {
    ssize_t count = read(file_descriptor, buffer + offset, length - offset);
    if (count == 0) return allow_eof && offset == 0U ? 0 : -1;
    if (count < 0) {
      if (errno == EINTR) continue;
      return -1;
    }
    offset += (size_t)count;
  }
  return 1;
}

static int write_exact(int file_descriptor, const uint8_t *buffer, size_t length) {
  size_t offset = 0;
  while (offset < length) {
    ssize_t count = write(file_descriptor, buffer + offset, length - offset);
    if (count < 0) {
      if (errno == EINTR) continue;
      return -1;
    }
    if (count == 0) return -1;
    offset += (size_t)count;
  }
  return 0;
}

static int read_frame(struct frame *output) {
  uint8_t header[FRAME_HEADER_BYTES];
  int header_result = read_exact(STDIN_FILENO, header, sizeof(header), true);
  if (header_result <= 0) return header_result;
  if (memcmp(header, frame_magic, sizeof(frame_magic)) != 0 ||
      read_u16(header + 4U) != PROTOCOL_VERSION || read_u32(header + 12U) != 0U) {
    return -1;
  }
  output->opcode = read_u16(header + 6U);
  output->payload_length = read_u32(header + 8U);
  output->sequence = read_u64(header + 16U);
  if (output->opcode == 0U || output->opcode >= RESPONSE_BIT || output->sequence == 0U ||
      output->payload_length > MAX_PAYLOAD_BYTES) {
    return -1;
  }
  if (output->payload_length > 0U &&
      read_exact(STDIN_FILENO, output->payload, output->payload_length, false) != 1) {
    return -1;
  }
  return 1;
}

static int send_frame(uint16_t opcode, uint64_t sequence, const uint8_t *payload,
                      uint32_t payload_length) {
  uint8_t header[FRAME_HEADER_BYTES];
  if (payload_length > MAX_PAYLOAD_BYTES || sequence == 0U) return -1;
  memset(header, 0, sizeof(header));
  memcpy(header, frame_magic, sizeof(frame_magic));
  write_u16(header + 4U, PROTOCOL_VERSION);
  write_u16(header + 6U, opcode);
  write_u32(header + 8U, payload_length);
  write_u64(header + 16U, sequence);
  if (write_exact(STDOUT_FILENO, header, sizeof(header)) != 0) return -1;
  if (payload_length > 0U && write_exact(STDOUT_FILENO, payload, payload_length) != 0) return -1;
  return 0;
}

static int send_error(uint64_t sequence, uint16_t failed_opcode, enum helper_error code) {
  uint8_t payload[4];
  write_u16(payload, failed_opcode);
  write_u16(payload + 2U, (uint16_t)code);
  return send_frame(ERROR_OPCODE, sequence, payload, sizeof(payload));
}

static int raw_clock_ns(uint64_t *output) {
  struct timespec value;
  if (clock_gettime(CLOCK_MONOTONIC_RAW, &value) != 0 || value.tv_sec < 0 || value.tv_nsec < 0 ||
      value.tv_nsec >= 1000000000L) {
    return -1;
  }
  uint64_t seconds = (uint64_t)value.tv_sec;
  if (seconds > UINT64_MAX / 1000000000ULL) return -1;
  *output = seconds * 1000000000ULL + (uint64_t)value.tv_nsec;
  return 0;
}

static int openat2_directory(int root_fd, const char *relative_path) {
  struct open_how how;
  memset(&how, 0, sizeof(how));
  how.flags = O_RDONLY | O_DIRECTORY | O_CLOEXEC | O_NOFOLLOW;
  how.resolve =
      RESOLVE_BENEATH | RESOLVE_NO_SYMLINKS | RESOLVE_NO_MAGICLINKS | RESOLVE_NO_XDEV;
  return (int)syscall(SYS_openat2, root_fd, relative_path, &how, sizeof(how));
}

static int read_bounded_fd(int file_descriptor, char *output, size_t capacity, size_t *length) {
  size_t offset = 0;
  if (capacity < 2U) return -1;
  for (;;) {
    if (offset + 1U >= capacity) return -1;
    ssize_t count = read(file_descriptor, output + offset, capacity - offset - 1U);
    if (count == 0) break;
    if (count < 0) {
      if (errno == EINTR) continue;
      return -1;
    }
    offset += (size_t)count;
  }
  output[offset] = '\0';
  *length = offset;
  return 0;
}

static int read_bounded_absolute(const char *path, char *output, size_t capacity, size_t *length) {
  int fd = open(path, O_RDONLY | O_CLOEXEC | O_NOFOLLOW);
  if (fd < 0) return -1;
  int result = read_bounded_fd(fd, output, capacity, length);
  int saved_errno = errno;
  (void)close(fd);
  errno = saved_errno;
  return result;
}

static int read_cgroup_file(int directory_fd, const char *name, char *output, size_t capacity,
                            size_t *length) {
  if (strcmp(name, "cpu.stat") != 0 && strcmp(name, "cgroup.events") != 0 &&
      strcmp(name, "cgroup.procs") != 0) {
    errno = EPERM;
    return -1;
  }
  int fd = openat(directory_fd, name, O_RDONLY | O_CLOEXEC | O_NOFOLLOW);
  if (fd < 0) return -1;
  int result = read_bounded_fd(fd, output, capacity, length);
  int saved_errno = errno;
  (void)close(fd);
  errno = saved_errno;
  return result;
}

static int write_cgroup_control(int directory_fd, const char *name) {
  if (strcmp(name, "cgroup.freeze") != 0 && strcmp(name, "cgroup.kill") != 0) {
    errno = EPERM;
    return -1;
  }
  int fd = openat(directory_fd, name, O_WRONLY | O_CLOEXEC | O_NOFOLLOW);
  if (fd < 0) return -1;
  const uint8_t one = '1';
  int result = write_exact(fd, &one, 1U);
  int saved_errno = errno;
  (void)close(fd);
  errno = saved_errno;
  return result;
}

static int parse_decimal_u64(const char *start, size_t length, uint64_t *output) {
  if (length == 0U || (length > 1U && start[0] == '0')) return -1;
  uint64_t value = 0;
  for (size_t index = 0; index < length; index += 1U) {
    if (start[index] < '0' || start[index] > '9') return -1;
    uint64_t digit = (uint64_t)(start[index] - '0');
    if (value > (UINT64_MAX - digit) / 10U) return -1;
    value = value * 10U + digit;
  }
  *output = value;
  return 0;
}

static int parse_named_u64(const char *text, const char *name, uint64_t *output) {
  size_t name_length = strlen(name);
  const char *cursor = text;
  bool found = false;
  uint64_t value = 0;
  while (*cursor != '\0') {
    const char *line_end = strchr(cursor, '\n');
    if (line_end == NULL) line_end = cursor + strlen(cursor);
    if ((size_t)(line_end - cursor) > name_length + 1U &&
        memcmp(cursor, name, name_length) == 0 &&
        (cursor[name_length] == ' ' || cursor[name_length] == '\t')) {
      if (found || parse_decimal_u64(cursor + name_length + 1U,
                                     (size_t)(line_end - cursor) - name_length - 1U,
                                     &value) != 0) {
        return -1;
      }
      found = true;
    }
    cursor = *line_end == '\0' ? line_end : line_end + 1;
  }
  if (!found) return -1;
  *output = value;
  return 0;
}

static int read_usage_usec(int directory_fd, uint64_t *usage) {
  char text[MAX_TEXT_BYTES + 1U];
  size_t length = 0;
  if (read_cgroup_file(directory_fd, "cpu.stat", text, sizeof(text), &length) != 0 ||
      length == 0U || parse_named_u64(text, "usage_usec", usage) != 0) {
    return -1;
  }
  return 0;
}

static int read_events(int directory_fd, bool *populated, bool *frozen) {
  char text[MAX_TEXT_BYTES + 1U];
  size_t length = 0;
  uint64_t populated_value = 0;
  uint64_t frozen_value = 0;
  if (read_cgroup_file(directory_fd, "cgroup.events", text, sizeof(text), &length) != 0 ||
      length == 0U || parse_named_u64(text, "populated", &populated_value) != 0 ||
      parse_named_u64(text, "frozen", &frozen_value) != 0 || populated_value > 1U ||
      frozen_value > 1U) {
    return -1;
  }
  *populated = populated_value == 1U;
  *frozen = frozen_value == 1U;
  return 0;
}

static int count_direct_processes(int directory_fd, uint32_t *count) {
  char text[MAX_TEXT_BYTES + 1U];
  size_t length = 0;
  if (read_cgroup_file(directory_fd, "cgroup.procs", text, sizeof(text), &length) != 0) return -1;
  uint32_t result = 0;
  const char *cursor = text;
  while (*cursor != '\0') {
    const char *line_end = strchr(cursor, '\n');
    if (line_end == NULL) line_end = cursor + strlen(cursor);
    if (line_end != cursor) {
      uint64_t pid_value = 0;
      if (parse_decimal_u64(cursor, (size_t)(line_end - cursor), &pid_value) != 0 ||
          pid_value == 0U || pid_value > INT_MAX || result == UINT32_MAX) {
        return -1;
      }
      result += 1U;
    }
    cursor = *line_end == '\0' ? line_end : line_end + 1;
  }
  *count = result;
  return 0;
}

static int direct_process_contains(int directory_fd, pid_t expected_pid) {
  char text[MAX_TEXT_BYTES + 1U];
  size_t length = 0;
  if (read_cgroup_file(directory_fd, "cgroup.procs", text, sizeof(text), &length) != 0) return -1;
  const char *cursor = text;
  while (*cursor != '\0') {
    const char *line_end = strchr(cursor, '\n');
    if (line_end == NULL) line_end = cursor + strlen(cursor);
    uint64_t value = 0;
    if (line_end != cursor &&
        parse_decimal_u64(cursor, (size_t)(line_end - cursor), &value) == 0 &&
        value == (uint64_t)expected_pid) {
      return 1;
    }
    cursor = *line_end == '\0' ? line_end : line_end + 1;
  }
  return 0;
}

static int process_start_ticks(pid_t pid, uint64_t *output) {
  char path[64];
  char text[4097];
  size_t length = 0;
  int path_length = snprintf(path, sizeof(path), "/proc/%ld/stat", (long)pid);
  if (path_length < 1 || (size_t)path_length >= sizeof(path) ||
      read_bounded_absolute(path, text, sizeof(text), &length) != 0 || length == 0U) {
    return -1;
  }
  char *close_parenthesis = strrchr(text, ')');
  if (close_parenthesis == NULL || close_parenthesis[1] != ' ') return -1;
  char *cursor = close_parenthesis + 2;
  unsigned int field = 3U;
  while (*cursor != '\0') {
    while (*cursor == ' ') cursor += 1;
    if (*cursor == '\0') break;
    char *token_end = cursor;
    while (*token_end != '\0' && *token_end != ' ') token_end += 1;
    if (field == 22U) {
      return parse_decimal_u64(cursor, (size_t)(token_end - cursor), output);
    }
    field += 1U;
    cursor = token_end;
  }
  return -1;
}

static int pidfd_is_exited(int pidfd, bool *exited) {
  struct pollfd descriptor;
  memset(&descriptor, 0, sizeof(descriptor));
  descriptor.fd = pidfd;
  descriptor.events = POLLIN;
  int result;
  do {
    result = poll(&descriptor, 1U, 0);
  } while (result < 0 && errno == EINTR);
  if (result < 0 || (descriptor.revents & (POLLERR | POLLNVAL)) != 0) return -1;
  if (result == 0) {
    *exited = false;
    return 0;
  }
  if ((descriptor.revents & (POLLIN | POLLHUP)) == 0) return -1;
  *exited = true;
  return 0;
}

static int pidfd_kill_if_alive(struct role_handle *handle) {
  bool exited = false;
  if (pidfd_is_exited(handle->pidfd, &exited) != 0) return -1;
  if (exited) return 0;
  if (syscall(SYS_pidfd_send_signal, handle->pidfd, SIGKILL, NULL, 0U) == 0) return 0;
  if (errno != ESRCH || pidfd_is_exited(handle->pidfd, &exited) != 0 || !exited) return -1;
  return 0;
}

static int cgroup_mount_id(int directory_fd, uint64_t *output) {
  char path[64];
  char text[4097];
  size_t length = 0;
  int path_length = snprintf(path, sizeof(path), "/proc/self/fdinfo/%d", directory_fd);
  if (path_length < 1 || (size_t)path_length >= sizeof(path) ||
      read_bounded_absolute(path, text, sizeof(text), &length) != 0) {
    return -1;
  }
  return parse_named_u64(text, "mnt_id:", output);
}

static bool safe_path_character(char value) {
  return (value >= 'A' && value <= 'Z') || (value >= 'a' && value <= 'z') ||
         (value >= '0' && value <= '9') || value == '_' || value == '-' || value == '.' ||
         value == ':' || value == '@' || value == '/';
}

static int count_substring(const char *text, const char *needle) {
  int count = 0;
  size_t needle_length = strlen(needle);
  const char *cursor = text;
  while ((cursor = strstr(cursor, needle)) != NULL) {
    count += 1;
    cursor += needle_length;
  }
  return count;
}

static int canonical_cgroup_membership(pid_t pid, const uint8_t container_id[32], char *output,
                                       size_t capacity) {
  char proc_path[64];
  char text[PATH_MAX + 64U];
  char container_hex[65];
  size_t length = 0;
  int path_length = snprintf(proc_path, sizeof(proc_path), "/proc/%ld/cgroup", (long)pid);
  if (path_length < 1 || (size_t)path_length >= sizeof(proc_path) ||
      read_bounded_absolute(proc_path, text, sizeof(text), &length) != 0 || length < 5U ||
      strncmp(text, "0::/", 4U) != 0) {
    return -1;
  }
  char *line_end = strchr(text, '\n');
  if (line_end != NULL) {
    *line_end = '\0';
    for (char *extra = line_end + 1; *extra != '\0'; extra += 1) {
      if (*extra != '\n' && *extra != '\r') return -1;
    }
  }
  const char *relative = text + 4U;
  size_t relative_length = strlen(relative);
  if (relative_length == 0U || relative_length >= capacity || relative[relative_length - 1U] == '/' ||
      strstr(relative, "//") != NULL || strstr(relative, "/../") != NULL ||
      strstr(relative, "/./") != NULL) {
    return -1;
  }
  for (size_t index = 0; index < 32U; index += 1U) {
    static const char hex[] = "0123456789abcdef";
    container_hex[index * 2U] = hex[container_id[index] >> 4U];
    container_hex[index * 2U + 1U] = hex[container_id[index] & 0x0fU];
  }
  container_hex[64] = '\0';
  for (size_t index = 0; index < relative_length; index += 1U) {
    if (!safe_path_character(relative[index])) return -1;
  }
  char scope_suffix[79];
  if (snprintf(scope_suffix, sizeof(scope_suffix), "docker-%s.scope", container_hex) < 1) {
    return -1;
  }
  const char *last_slash = strrchr(relative, '/');
  const char *last_component = last_slash == NULL ? relative : last_slash + 1;
  bool scope = strcmp(last_component, scope_suffix) == 0;
  bool direct = false;
  if (last_slash != NULL && strcmp(last_component, container_hex) == 0) {
    const char *parent_end = last_slash;
    const char *parent_start = parent_end;
    while (parent_start > relative && parent_start[-1] != '/') parent_start -= 1;
    direct = (size_t)(parent_end - parent_start) == strlen("docker") &&
             memcmp(parent_start, "docker", strlen("docker")) == 0;
  }
  if (direct == scope || count_substring(relative, container_hex) != 1) return -1;
  memcpy(output, relative, relative_length + 1U);
  return 0;
}

static int verify_cgroup_fd(struct role_handle *handle, bool allow_exited_pid) {
  struct stat descriptor_stat;
  struct statfs file_system;
  uint64_t mount_id = 0;
  if (fstat(handle->cgroupfd, &descriptor_stat) != 0 || !S_ISDIR(descriptor_stat.st_mode) ||
      (uint64_t)descriptor_stat.st_dev != handle->device ||
      (uint64_t)descriptor_stat.st_ino != handle->inode ||
      fstatfs(handle->cgroupfd, &file_system) != 0 ||
      (unsigned long)file_system.f_type != (unsigned long)CGROUP2_SUPER_MAGIC ||
      cgroup_mount_id(handle->cgroupfd, &mount_id) != 0 || mount_id != handle->mount_id ||
      mount_id != cgroup_root_mount_id) {
    return -1;
  }
  int reopened = openat2_directory(cgroup_root_fd, handle->relative_path);
  if (reopened < 0) return -1;
  struct stat reopened_stat;
  int stat_result = fstat(reopened, &reopened_stat);
  (void)close(reopened);
  if (stat_result != 0 || (uint64_t)reopened_stat.st_dev != handle->device ||
      (uint64_t)reopened_stat.st_ino != handle->inode) {
    return -1;
  }
  bool exited = false;
  if (pidfd_is_exited(handle->pidfd, &exited) != 0) return -1;
  if (!exited) {
    uint64_t current_start_ticks = 0;
    char current_membership[PATH_MAX];
    if (process_start_ticks(handle->pid, &current_start_ticks) != 0 ||
        current_start_ticks != handle->pid_start_ticks ||
        canonical_cgroup_membership(handle->pid, handle->container_id, current_membership,
                                    sizeof(current_membership)) != 0 ||
        strcmp(current_membership, handle->relative_path) != 0 ||
        direct_process_contains(handle->cgroupfd, handle->pid) != 1) {
      return -1;
    }
    if (pidfd_is_exited(handle->pidfd, &exited) != 0) return -1;
  } else if (!allow_exited_pid) {
    return -1;
  }
  return 0;
}

static struct role_handle *lookup_handle(uint32_t id) {
  if (id == 0U) return NULL;
  for (size_t index = 0; index < MAX_HANDLES; index += 1U) {
    if (handles[index].used && handles[index].id == id) return &handles[index];
  }
  return NULL;
}

static void close_handle(struct role_handle *handle) {
  if (!handle->used) return;
  if (handle->pidfd >= 0) (void)close(handle->pidfd);
  if (handle->cgroupfd >= 0) (void)close(handle->cgroupfd);
  memset(handle, 0, sizeof(*handle));
  handle->pidfd = -1;
  handle->cgroupfd = -1;
}

static int bind_handle(const struct frame *request, uint8_t response[56]) {
  if (request->payload_length != 40U || request->payload[0] < 1U || request->payload[0] > 3U ||
      request->payload[1] != 0U || request->payload[2] != 0U || request->payload[3] != 0U) {
    return -1;
  }
  uint32_t pid_value = read_u32(request->payload + 4U);
  if (pid_value == 0U || pid_value > (uint32_t)INT_MAX) return -1;
  struct role_handle *target = NULL;
  for (size_t index = 0; index < MAX_HANDLES; index += 1U) {
    if (!handles[index].used) {
      target = &handles[index];
      break;
    }
  }
  if (target == NULL) return -1;
  pid_t pid = (pid_t)pid_value;
  for (size_t index = 0; index < MAX_HANDLES; index += 1U) {
    if (handles[index].used &&
        (handles[index].role == request->payload[0] || handles[index].pid == pid)) {
      return -1;
    }
  }
  uint64_t start_a = 0;
  uint64_t start_b = 0;
  if (role_seen[request->payload[0]]) return -1;
  int pidfd = (int)syscall(SYS_pidfd_open, pid, 0U);
  if (pidfd < 0 || fcntl(pidfd, F_SETFD, FD_CLOEXEC) != 0) {
    if (pidfd >= 0) (void)close(pidfd);
    return -1;
  }
  bool pid_exited = false;
  if (pidfd_is_exited(pidfd, &pid_exited) != 0 || pid_exited) {
    (void)close(pidfd);
    return -1;
  }
  if (process_start_ticks(pid, &start_a) != 0 ||
      pidfd_is_exited(pidfd, &pid_exited) != 0 || pid_exited) {
    (void)close(pidfd);
    return -1;
  }
  char relative_path[PATH_MAX];
  if (canonical_cgroup_membership(pid, request->payload + 8U, relative_path,
                                  sizeof(relative_path)) != 0 ||
      process_start_ticks(pid, &start_b) != 0 || start_a != start_b ||
      pidfd_is_exited(pidfd, &pid_exited) != 0 || pid_exited) {
    (void)close(pidfd);
    return -1;
  }
  int cgroupfd = openat2_directory(cgroup_root_fd, relative_path);
  if (cgroupfd < 0) {
    (void)close(pidfd);
    return -1;
  }
  struct stat stat_value;
  struct statfs statfs_value;
  uint64_t mount_id = 0;
  uint64_t usage = 0;
  uint64_t raw_ns = 0;
  bool populated = false;
  bool frozen = false;
  int membership = direct_process_contains(cgroupfd, pid);
  if (fstat(cgroupfd, &stat_value) != 0 || !S_ISDIR(stat_value.st_mode) ||
      fstatfs(cgroupfd, &statfs_value) != 0 ||
      (unsigned long)statfs_value.f_type != (unsigned long)CGROUP2_SUPER_MAGIC ||
      cgroup_mount_id(cgroupfd, &mount_id) != 0 || membership != 1 ||
      read_events(cgroupfd, &populated, &frozen) != 0 || !populated || frozen ||
      read_usage_usec(cgroupfd, &usage) != 0 || raw_clock_ns(&raw_ns) != 0 ||
      process_start_ticks(pid, &start_b) != 0 || start_a != start_b ||
      pidfd_is_exited(pidfd, &pid_exited) != 0 || pid_exited ||
      mount_id != cgroup_root_mount_id) {
    (void)close(cgroupfd);
    (void)close(pidfd);
    return -1;
  }
  for (size_t index = 0; index < MAX_HANDLES; index += 1U) {
    if (handles[index].used && handles[index].device == (uint64_t)stat_value.st_dev &&
        handles[index].inode == (uint64_t)stat_value.st_ino &&
        handles[index].mount_id == mount_id) {
      (void)close(cgroupfd);
      (void)close(pidfd);
      return -1;
    }
  }
  memset(target, 0, sizeof(*target));
  target->used = true;
  target->id = (uint32_t)((target - handles) + 1U);
  target->role = request->payload[0];
  target->pid = pid;
  target->pidfd = pidfd;
  target->cgroupfd = cgroupfd;
  target->pid_start_ticks = start_a;
  target->device = (uint64_t)stat_value.st_dev;
  target->inode = (uint64_t)stat_value.st_ino;
  target->mount_id = mount_id;
  target->last_usage_usec = usage;
  target->quiescent_verified = false;
  memcpy(target->container_id, request->payload + 8U, sizeof(target->container_id));
  (void)snprintf(target->relative_path, sizeof(target->relative_path), "%s", relative_path);
  role_seen[target->role] = true;
  memset(response, 0, 56U);
  write_u32(response, target->id);
  response[4] = target->role;
  write_u64(response + 8U, start_a);
  write_u64(response + 16U, target->device);
  write_u64(response + 24U, target->inode);
  write_u64(response + 32U, mount_id);
  write_u64(response + 40U, usage);
  write_u64(response + 48U, raw_ns);
  return 0;
}

static int sample_handle(struct role_handle *handle, uint8_t response[28]) {
  uint64_t raw_ns = 0;
  uint64_t usage = 0;
  bool populated = false;
  bool frozen = false;
  uint32_t process_count = 0;
  if (verify_cgroup_fd(handle, true) != 0 || raw_clock_ns(&raw_ns) != 0 ||
      read_usage_usec(handle->cgroupfd, &usage) != 0 || usage < handle->last_usage_usec ||
      read_events(handle->cgroupfd, &populated, &frozen) != 0 ||
      count_direct_processes(handle->cgroupfd, &process_count) != 0 ||
      verify_cgroup_fd(handle, true) != 0) {
    return -1;
  }
  handle->last_usage_usec = usage;
  if (populated) handle->quiescent_verified = false;
  memset(response, 0, 28U);
  write_u32(response, handle->id);
  write_u64(response + 4U, raw_ns);
  write_u64(response + 12U, usage);
  response[20] = populated ? 1U : 0U;
  response[21] = frozen ? 1U : 0U;
  write_u32(response + 24U, process_count);
  return 0;
}

static int wait_for_state(struct role_handle *handle, bool require_frozen,
                          bool require_quiescent) {
  uint64_t started = 0;
  if (raw_clock_ns(&started) != 0) return -1;
  for (;;) {
    bool populated = false;
    bool frozen = false;
    bool exited = false;
    if (verify_cgroup_fd(handle, true) != 0 ||
        read_events(handle->cgroupfd, &populated, &frozen) != 0 ||
        pidfd_is_exited(handle->pidfd, &exited) != 0) {
      return -1;
    }
    if ((!require_frozen || frozen) && (!require_quiescent || (!populated && exited))) return 0;
    uint64_t now = 0;
    if (raw_clock_ns(&now) != 0 || now < started || now - started > WAIT_TIMEOUT_NS) {
      return -2;
    }
    struct timespec pause_value = {.tv_sec = 0, .tv_nsec = 1000000L};
    while (nanosleep(&pause_value, &pause_value) != 0 && errno == EINTR) {
    }
  }
}

static int path_is_released(const struct role_handle *handle) {
  struct stat value;
  if (fstatat(cgroup_root_fd, handle->relative_path, &value, AT_SYMLINK_NOFOLLOW) == 0) return 0;
  return errno == ENOENT ? 1 : -1;
}

static void best_effort_containment(void) {
  for (size_t index = 0; index < MAX_HANDLES; index += 1U) {
    struct role_handle *handle = &handles[index];
    if (!handle->used) continue;
    (void)write_cgroup_control(handle->cgroupfd, "cgroup.freeze");
    (void)write_cgroup_control(handle->cgroupfd, "cgroup.kill");
    (void)pidfd_kill_if_alive(handle);
    close_handle(handle);
  }
}

static int process_request(const struct frame *request) {
  uint8_t response[MAX_PAYLOAD_BYTES];
  memset(response, 0, sizeof(response));
  if (request->opcode == OP_RAW_CLOCK) {
    uint64_t raw_ns = 0;
    if (request->payload_length != 0U || raw_clock_ns(&raw_ns) != 0) {
      return send_error(request->sequence, request->opcode, ERR_CLOCK);
    }
    write_u64(response, raw_ns);
    return send_frame((uint16_t)(request->opcode | RESPONSE_BIT), request->sequence, response, 8U);
  }
  if (request->opcode == OP_BIND) {
    if (bind_handle(request, response) != 0) {
      return send_error(request->sequence, request->opcode, ERR_IDENTITY);
    }
    return send_frame((uint16_t)(request->opcode | RESPONSE_BIT), request->sequence, response, 56U);
  }
  if (request->opcode == OP_STOP) {
    if (request->payload_length != 0U) {
      return send_error(request->sequence, request->opcode, ERR_PROTOCOL);
    }
    for (size_t index = 0; index < MAX_HANDLES; index += 1U) {
      if (handles[index].used) return send_error(request->sequence, request->opcode, ERR_STATE);
    }
    return send_frame((uint16_t)(request->opcode | RESPONSE_BIT), request->sequence, response, 0U);
  }
  if (request->payload_length != 4U) {
    return send_error(request->sequence, request->opcode, ERR_PROTOCOL);
  }
  uint32_t handle_id = read_u32(request->payload);
  struct role_handle *handle = lookup_handle(handle_id);
  if (handle == NULL) return send_error(request->sequence, request->opcode, ERR_STATE);
  if (request->opcode == OP_SAMPLE) {
    if (sample_handle(handle, response) != 0) {
      return send_error(request->sequence, request->opcode, ERR_IDENTITY);
    }
    return send_frame((uint16_t)(request->opcode | RESPONSE_BIT), request->sequence, response, 28U);
  }
  if (request->opcode == OP_FREEZE) {
    int identity_result = verify_cgroup_fd(handle, true);
    int freeze_result = write_cgroup_control(handle->cgroupfd, "cgroup.freeze");
    int wait_result = freeze_result == 0 ? wait_for_state(handle, true, false) : -1;
    int sample_result = wait_result == 0 ? sample_handle(handle, response) : -1;
    if (identity_result != 0 || freeze_result != 0 || wait_result != 0 || sample_result != 0) {
      return send_error(request->sequence, request->opcode,
                        wait_result == -2 ? ERR_TIMEOUT : ERR_CGROUP);
    }
    return send_frame((uint16_t)(request->opcode | RESPONSE_BIT), request->sequence, response, 28U);
  }
  if (request->opcode == OP_KILL) {
    int identity_result = verify_cgroup_fd(handle, true);
    int cgroup_kill_result = write_cgroup_control(handle->cgroupfd, "cgroup.kill");
    int pidfd_kill_result = pidfd_kill_if_alive(handle);
    int sample_result = sample_handle(handle, response);
    if (identity_result != 0 || cgroup_kill_result != 0 || pidfd_kill_result != 0 ||
        sample_result != 0) {
      return send_error(request->sequence, request->opcode, ERR_CGROUP);
    }
    return send_frame((uint16_t)(request->opcode | RESPONSE_BIT), request->sequence, response, 28U);
  }
  if (request->opcode == OP_QUIESCENT) {
    int wait_result = wait_for_state(handle, false, true);
    if (wait_result != 0 || sample_handle(handle, response) != 0 ||
        response[20] != 0U || read_u32(response + 24U) != 0U) {
      return send_error(request->sequence, request->opcode,
                        wait_result == -2 ? ERR_TIMEOUT : ERR_CGROUP);
    }
    handle->quiescent_verified = true;
    return send_frame((uint16_t)(request->opcode | RESPONSE_BIT), request->sequence, response, 28U);
  }
  if (request->opcode == OP_RELEASE) {
    bool populated = true;
    bool frozen = false;
    bool exited = false;
    if (!handle->quiescent_verified || pidfd_is_exited(handle->pidfd, &exited) != 0 || !exited ||
        read_events(handle->cgroupfd, &populated, &frozen) != 0 || populated ||
        path_is_released(handle) != 1) {
      return send_error(request->sequence, request->opcode, ERR_STATE);
    }
    write_u32(response, handle->id);
    close_handle(handle);
    return send_frame((uint16_t)(request->opcode | RESPONSE_BIT), request->sequence, response, 4U);
  }
  if (request->opcode == OP_CLOSE) {
    return send_error(request->sequence, request->opcode, ERR_STATE);
  }
  return send_error(request->sequence, request->opcode, ERR_PROTOCOL);
}

int main(int argc, char **argv) {
  for (size_t index = 0; index < MAX_HANDLES; index += 1U) {
    handles[index].pidfd = -1;
    handles[index].cgroupfd = -1;
  }
  if (argc != 2 || strcmp(argv[1], "--stdio-v1") != 0 || isatty(STDIN_FILENO) ||
      isatty(STDOUT_FILENO) || getuid() != geteuid() || getgid() != getegid()) {
    return 64;
  }
  (void)umask(0077);
  if (signal(SIGPIPE, SIG_IGN) == SIG_ERR || prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0) != 0) {
    return 70;
  }
  cgroup_root_fd = open("/sys/fs/cgroup", O_RDONLY | O_DIRECTORY | O_CLOEXEC | O_NOFOLLOW);
  if (cgroup_root_fd < 0) return 70;
  struct statfs root_fs;
  if (fstatfs(cgroup_root_fd, &root_fs) != 0 ||
      (unsigned long)root_fs.f_type != (unsigned long)CGROUP2_SUPER_MAGIC ||
      cgroup_mount_id(cgroup_root_fd, &cgroup_root_mount_id) != 0) {
    (void)close(cgroup_root_fd);
    return 70;
  }

  struct frame request;
  memset(&request, 0, sizeof(request));
  int first = read_frame(&request);
  if (first != 1 || request.opcode != OP_HELLO || request.sequence != 1U ||
      request.payload_length != 32U) {
    best_effort_containment();
    (void)close(cgroup_root_fd);
    return 65;
  }
  uint8_t hello_response[40];
  memcpy(hello_response, request.payload, 32U);
  write_u64(hello_response + 32U, CAPABILITY_BITS);
  if (send_frame((uint16_t)(OP_HELLO | RESPONSE_BIT), request.sequence, hello_response,
                 sizeof(hello_response)) != 0) {
    best_effort_containment();
    (void)close(cgroup_root_fd);
    return 74;
  }

  uint64_t expected_sequence = 2U;
  int exit_status = 0;
  for (;;) {
    memset(&request, 0, sizeof(request));
    int result = read_frame(&request);
    if (result == 0) {
      best_effort_containment();
      exit_status = 75;
      break;
    }
    if (result != 1 || request.sequence != expected_sequence) {
      best_effort_containment();
      exit_status = 65;
      break;
    }
    expected_sequence += 1U;
    if (expected_sequence == 0U) {
      best_effort_containment();
      exit_status = 65;
      break;
    }
    if (process_request(&request) != 0) {
      best_effort_containment();
      exit_status = 74;
      break;
    }
    if (request.opcode == OP_STOP) break;
  }
  for (size_t index = 0; index < MAX_HANDLES; index += 1U) close_handle(&handles[index]);
  (void)close(cgroup_root_fd);
  return exit_status;
}
