#!/usr/bin/env node
/**
 * Regenerate examples/ by running the CLI on this repository and on any
 * sample repositories given as arguments:
 *
 *   node scripts/examples.js [path/to/sample-repo ...]
 *
 * Absolute repository paths are replaced with "…/<name>" so the files do
 * not depend on the machine they were produced on.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const bin = path.join(root, 'bin', 'agent-blame.js');
const outDir = path.join(root, 'examples');

function cli(args, cwd) {
  return execFileSync(process.execPath, [bin, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' },
    maxBuffer: 64 * 1024 * 1024,
  });
}

function sample(repoPath, name, extra = []) {
  const abs = path.resolve(repoPath);
  const posixRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: abs, encoding: 'utf8' }).trim();
  const nativeRoot = posixRoot.split('/').join(path.sep);
  const scrub = (text) => text.split(nativeRoot).join(`…/${name}`).split(posixRoot).join(`…/${name}`);
  const run = (args) => cli(['--quiet', ...extra, ...args], abs);

  fs.writeFileSync(path.join(outDir, `${name}.txt`), scrub(run([])));
  fs.writeFileSync(path.join(outDir, `${name}-history.txt`), scrub(run(['--by-author', '--history'])));
  fs.writeFileSync(path.join(outDir, `${name}.md`), scrub(run(['--markdown'])));
  run(['--badge', path.join(outDir, `${name}.svg`)]);

  const doc = JSON.parse(run(['--json', '--by-author', '--history']));
  doc.repo.path = `…/${name}`;
  fs.writeFileSync(path.join(outDir, `${name}.json`), `${JSON.stringify(doc, null, 2)}\n`);

  process.stdout.write(`${name}: ${doc.totals.lines} lines, ${(doc.totals.aiShare * 100).toFixed(1)}% AI-assisted, ${doc.totals.commits} commits\n`);
}

fs.mkdirSync(outDir, { recursive: true });
// The self-sample leaves examples/ out: those files are this very output.
sample(root, 'agent-blame', ['--exclude', 'examples/**']);
for (const p of process.argv.slice(2)) sample(p, path.basename(path.resolve(p)));
