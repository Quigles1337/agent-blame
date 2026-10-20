// Shared helpers for tests that need a throwaway git repository.
// (This file defines no tests; node --test loads it and finds nothing to run.)
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function makeTempDir(prefix = 'agent-blame-') {
  return fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), prefix));
}

export function run(cwd, args, { env = {} } = {}) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      GIT_CONFIG_GLOBAL: path.join(os.tmpdir(), 'agent-blame-no-global-gitconfig'),
      GIT_CONFIG_NOSYSTEM: '1',
      ...env,
    },
  });
}

/** Create an initialised repo with LF line endings and a fixed default identity. */
export function initRepo() {
  const dir = makeTempDir();
  run(dir, ['init', '-q', '-b', 'main']);
  run(dir, ['config', 'core.autocrlf', 'false']);
  run(dir, ['config', 'user.name', 'Ada Lovelace']);
  run(dir, ['config', 'user.email', 'ada@example.com']);
  run(dir, ['config', 'commit.gpgsign', 'false']);
  return dir;
}

export function writeFile(dir, rel, content) {
  const abs = path.join(dir, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
}

/**
 * Stage everything and commit. `author` is `{name, email}`; `message` may
 * contain trailers; `date` is applied to both author and committer dates.
 */
export function commitAll(dir, message, { author, date = '2026-01-15T12:00:00Z' } = {}) {
  run(dir, ['add', '-A']);
  const env = { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date };
  const args = ['commit', '-q', '--allow-empty', '-F', '-'];
  if (author) args.push(`--author=${author.name} <${author.email}>`);
  execFileSync('git', args, {
    cwd: dir,
    input: message,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      ...process.env,
      GIT_CONFIG_GLOBAL: path.join(os.tmpdir(), 'agent-blame-no-global-gitconfig'),
      GIT_CONFIG_NOSYSTEM: '1',
      ...env,
    },
  });
  return run(dir, ['rev-parse', 'HEAD']).trim();
}

export function removeDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
}
