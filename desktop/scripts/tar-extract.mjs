'use strict';

/**
 * Extract a tar archive (optionally gzip-compressed) or zip into destDir with
 * the platform tar binary. On Windows the PATH `tar` is Git-bash's GNU tar:
 * it parses a drive-letter path as a remote host ("Cannot connect to C:
 * resolve failed") and cannot read zip members at all. The bsdtar shipped at
 * System32 does both, so it is preferred there; macOS ships bsdtar as `tar`.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/** Tar binary that parses drive-letter paths and reads zip on win32. */
export function tarBinary() {
  if (process.platform === 'win32') {
    const bsdtar = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
    if (fs.existsSync(bsdtar)) return bsdtar;
  }
  return 'tar';
}

/** Extract archive into destDir, creating it when missing. */
export function extractArchive(archive, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  // -x with no -z/-j: bsdtar and GNU tar auto-detect gzip on extraction.
  execFileSync(tarBinary(), ['-xf', archive, '-C', destDir], { stdio: 'inherit' });
}
