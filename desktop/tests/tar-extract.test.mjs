import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { extractArchive, tarBinary } from '../scripts/tar-extract.mjs';

test('tarBinary prefers System32 bsdtar on win32 and falls back to tar elsewhere', () => {
  const bin = tarBinary();
  if (process.platform === 'win32') {
    assert.ok(bin.endsWith('tar.exe'), 'win32 must resolve the System32 bsdtar, got: ' + bin);
  } else {
    assert.equal(bin, 'tar');
  }
});

test('extractArchive unpacks a plain tar archive into destDir', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-tar-plain-'));
  const src = path.join(tmp, 'payload');
  fs.mkdirSync(src);
  fs.writeFileSync(path.join(src, 'hello.txt'), 'hello tar');
  const archive = path.join(tmp, 'payload.tar');
  execFileSync(tarBinary(), ['-cf', archive, '-C', src, 'hello.txt']);

  const dest = path.join(tmp, 'out');
  extractArchive(archive, dest);
  assert.equal(fs.readFileSync(path.join(dest, 'hello.txt'), 'utf8'), 'hello tar');
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('extractArchive auto-detects gzip on extraction', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-tar-gz-'));
  const src = path.join(tmp, 'payload');
  fs.mkdirSync(src);
  fs.writeFileSync(path.join(src, 'package.json'), '{}');
  const archive = path.join(tmp, 'payload.tar.gz');
  execFileSync(tarBinary(), ['-czf', archive, '-C', src, 'package.json']);

  const dest = path.join(tmp, 'out');
  extractArchive(archive, dest);
  assert.equal(fs.readFileSync(path.join(dest, 'package.json'), 'utf8'), '{}');
  fs.rmSync(tmp, { recursive: true, force: true });
});
