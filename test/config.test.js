import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig, normalizeConfig, parseSize, CONFIG_FILENAME } from '../src/config.js';

function tmpdir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'agent-blame-config-'));
}

test('parseSize accepts bytes and unit suffixes', () => {
  assert.equal(parseSize(1024), 1024);
  assert.equal(parseSize('2mb'), 2 * 1024 * 1024);
  assert.equal(parseSize('500KB'), 500 * 1024);
  assert.equal(parseSize('1.5MiB'), Math.floor(1.5 * 1024 * 1024));
  assert.equal(parseSize('4096'), 4096);
  assert.throws(() => parseSize('lots'), TypeError);
});

test('normalizeConfig fills defaults and validates types', () => {
  const cfg = normalizeConfig({});
  assert.equal(cfg.ignoreBots, true);
  assert.deepEqual(cfg.include, []);
  assert.deepEqual(cfg.exclude, []);
  assert.equal(cfg.maxFileSize, 2 * 1024 * 1024);
  assert.equal(cfg.depth, 1);
  assert.equal(cfg.threshold, null);

  assert.throws(() => normalizeConfig({ ignoreBots: 'yes' }), /ignoreBots/);
  assert.throws(() => normalizeConfig({ include: 'src/**' }), /include/);
  assert.throws(() => normalizeConfig({ agents: { 'bad id!': {} } }), /invalid agent id/);
  assert.throws(() => normalizeConfig({ agents: { x: { emails: 'a@b' } } }), /emails must be an array/);
  assert.throws(() => normalizeConfig({ threshold: 150 }), /threshold/);
  assert.throws(() => normalizeConfig([]), /object/);
});

test('loadConfig returns defaults when the file is absent and parses it when present', () => {
  const dir = tmpdir();
  const absent = loadConfig(dir);
  assert.equal(absent.path, null);
  assert.equal(absent.ignoreBots, true);

  fs.writeFileSync(path.join(dir, CONFIG_FILENAME), JSON.stringify({
    agents: { 'my-internal-bot': { emails: ['bot@corp.example'], names: ['CorpBot'], markers: ['[auto]'] }, copilot: false },
    ignoreBots: false,
    include: ['src/**'],
    exclude: ['vendor/**', '*.lock'],
    maxFileSize: '1mb',
  }));
  const cfg = loadConfig(dir);
  assert.equal(cfg.path, path.join(dir, CONFIG_FILENAME));
  assert.equal(cfg.ignoreBots, false);
  assert.deepEqual(cfg.include, ['src/**']);
  assert.deepEqual(cfg.exclude, ['vendor/**', '*.lock']);
  assert.equal(cfg.maxFileSize, 1024 * 1024);
  assert.equal(cfg.agents.copilot, false);
  assert.deepEqual(cfg.agents['my-internal-bot'].emails, ['bot@corp.example']);
});

test('loadConfig reports invalid JSON and missing explicit files clearly', () => {
  const dir = tmpdir();
  fs.writeFileSync(path.join(dir, CONFIG_FILENAME), '{ not json');
  assert.throws(() => loadConfig(dir), /invalid JSON/);
  assert.throws(() => loadConfig(dir, 'nope.json'), /cannot read config/);
});
