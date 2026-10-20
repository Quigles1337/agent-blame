#!/usr/bin/env node
/**
 * Regenerate examples/ by running the CLI on this repository and on the
 * public sample repositories:
 *
 *   node scripts/examples.js                      # this repository + the samples below
 *   node scripts/examples.js path/to/other-repo   # this repository + the given repositories
 *
 * Samples are cloned (or fast-forwarded) under $AGENT_BLAME_SAMPLES_DIR,
 * which defaults to <tmpdir>/agent-blame-samples. Per sample: <name>.txt,
 * <name>-history.txt, <name>.md, <name>-report.json (the --json document),
 * <name>.svg (the badge) and <name>.json (the shields.io endpoint document).
 * Absolute repository paths are replaced with "…/<name>" so the files do
 * not depend on the machine they were produced on.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Public repositories with a mix of human and agent commits. */
const SAMPLES = [{ name: 'FR13DMAN', url: 'https://github.com/Quigles1337/FR13DMAN.git' }];

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const bin = path.join(root, 'bin', 'agent-blame.js');
const outDir = path.join(root, 'examples');
const samplesDir = process.env.AGENT_BLAME_SAMPLES_DIR || path.join(os.tmpdir(), 'agent-blame-samples');

function cli(args, cwd) {
  return execFileSync(process.execPath, [bin, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' },
    maxBuffer: 64 * 1024 * 1024,
  });
}

function git(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
}

/** Clone a sample into samplesDir, or fast-forward an existing clone. Returns its path. */
function ensureSample({ name, url }) {
  const dir = path.join(samplesDir, name);
  if (fs.existsSync(path.join(dir, '.git'))) {
    git(['pull', '-q', '--ff-only'], dir);
  } else {
    fs.mkdirSync(samplesDir, { recursive: true });
    git(['clone', '-q', url, dir], samplesDir);
  }
  return dir;
}

function sample(repoPath, name, extra = []) {
  const abs = path.resolve(repoPath);
  const posixRoot = git(['rev-parse', '--show-toplevel'], abs).trim();
  const nativeRoot = posixRoot.split('/').join(path.sep);
  const scrub = (text) => text.split(nativeRoot).join(`…/${name}`).split(posixRoot).join(`…/${name}`);
  const run = (args) => cli(['--quiet', ...extra, ...args], abs);

  fs.writeFileSync(path.join(outDir, `${name}.txt`), scrub(run([])));
  fs.writeFileSync(path.join(outDir, `${name}-history.txt`), scrub(run(['--by-author', '--history'])));
  fs.writeFileSync(path.join(outDir, `${name}.md`), scrub(run(['--markdown'])));
  run(['--badge', path.join(outDir, `${name}.svg`), '--shields', path.join(outDir, `${name}.json`)]);

  const doc = JSON.parse(run(['--json', '--by-author', '--history']));
  doc.repo.path = `…/${name}`;
  fs.writeFileSync(path.join(outDir, `${name}-report.json`), `${JSON.stringify(doc, null, 2)}\n`);

  process.stdout.write(`${name}: ${doc.totals.lines} lines, ${(doc.totals.aiShare * 100).toFixed(1)}% AI-assisted, ${doc.totals.commits} commits\n`);
}

fs.mkdirSync(outDir, { recursive: true });
// The self-sample leaves examples/ out: those files are this very output.
sample(root, 'agent-blame', ['--exclude', 'examples/**']);
const given = process.argv.slice(2);
if (given.length > 0) {
  for (const p of given) sample(p, path.basename(path.resolve(p)));
} else {
  for (const s of SAMPLES) sample(ensureSample(s), s.name);
}
