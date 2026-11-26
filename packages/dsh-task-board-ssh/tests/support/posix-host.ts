/**
 * Whether this machine can stand in for the remote host.
 *
 * The integration specs run the launcher, the workspace strategies and the
 * fake ssh transport against a local `sh`, using local temporary directories
 * as remote paths. That needs a POSIX host: absolute paths that start with
 * `/`, process groups that `kill -- -pid` can signal, and a shell that runs
 * the launcher as the remote one would. Windows has none of these (its temp
 * directories are `C:\...` paths the strategies rightly refuse as remote
 * paths), so those suites are skipped there; CI runs them on Linux.
 */
export const noPosixHost = process.platform === 'win32'
