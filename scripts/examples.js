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

function sample(repoPath, name) {
  const abs = path.resolve(repoPath);
  const posixRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: abs, encoding: 'utf8' }).trim();
  const nativeRoot = posixRoot.split('/').join(path.sep);
  const scrub = (text) => text.split(nativeRoot).join(`…/${name}`).split(posixRoot).join(`…/${name}`);

  fs.writeFileSync(path.join(outDir, `${name}.txt`), scrub(cli(['--quiet'], abs)));
  fs.writeFileSync(path.join(outDir, `${name}-history.txt`), scrub(cli(['--quiet', '--by-author', '--history'], abs)));
  fs.writeFileSync(path.join(outDir, `${name}.md`), scrub(cli(['--quiet', '--markdown'], abs)));
  cli(['--quiet', '--badge', path.join(outDir, `${name}.svg`)], abs);

  const doc = JSON.parse(cli(['--quiet', '--json', '--by-author', '--history'], abs));
  doc.repo.path = `…/${name}`;
  fs.writeFileSync(path.join(outDir, `${name}.json`), `${JSON.stringify(doc, null, 2)}\n`);

  process.stdout.write(`${name}: ${doc.totals.lines} lines, ${(doc.totals.aiShare * 100).toFixed(1)}% AI-assisted, ${doc.totals.commits} commits\n`);
}

fs.mkdirSync(outDir, { recursive: true });
sample(root, 'agent-blame');
for (const p of process.argv.slice(2)) sample(p, path.basename(path.resolve(p)));
