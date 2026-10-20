/**
 * `.agent-blame.json` loading and validation.
 *
 * Shape:
 * {
 *   "agents": {
 *     "my-internal-bot": { "label": "Internal bot", "emails": [...], "names": [...], "markers": [...] },
 *     "copilot": false                      // disable a built-in agent
 *   },
 *   "bots": { "names": [...], "emails": [...] },
 *   "ignoreBots": true,
 *   "include": ["src/**"],
 *   "exclude": ["vendor/**", "*.lock"],
 *   "maxFileSize": 2097152,
 *   "depth": 1,
 *   "threshold": 60
 * }
 */
import fs from 'node:fs';
import path from 'node:path';

export const CONFIG_FILENAME = '.agent-blame.json';

export const DEFAULT_CONFIG = Object.freeze({
  agents: {},
  bots: { names: [], emails: [] },
  ignoreBots: true,
  include: [],
  exclude: [],
  maxFileSize: 2 * 1024 * 1024,
  depth: 1,
  threshold: null,
});

function stringArray(value, label) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.some((v) => typeof v !== 'string')) {
    throw new TypeError(`${label} must be an array of strings`);
  }
  return value;
}

/** Validate and normalise a parsed config object. Throws on invalid input. */
export function normalizeConfig(raw = {}) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new TypeError('config must be a JSON object');
  }
  const cfg = { ...DEFAULT_CONFIG, bots: { ...DEFAULT_CONFIG.bots } };

  if (raw.agents !== undefined) {
    if (raw.agents === null || typeof raw.agents !== 'object' || Array.isArray(raw.agents)) {
      throw new TypeError('config.agents must be an object');
    }
    cfg.agents = {};
    for (const [id, def] of Object.entries(raw.agents)) {
      if (!/^[a-z0-9][a-z0-9._-]*$/i.test(id)) throw new TypeError(`config.agents: invalid agent id ${JSON.stringify(id)}`);
      if (def === false || def === null) {
        cfg.agents[id] = false;
        continue;
      }
      if (typeof def !== 'object' || Array.isArray(def)) throw new TypeError(`config.agents.${id} must be an object or false`);
      cfg.agents[id] = {
        label: def.label === undefined ? undefined : String(def.label),
        emails: stringArray(def.emails, `config.agents.${id}.emails`),
        names: stringArray(def.names, `config.agents.${id}.names`),
        markers: stringArray(def.markers, `config.agents.${id}.markers`),
        pairs: (def.pairs ?? []).map((p, i) => {
          if (!p || typeof p.name !== 'string' || typeof p.email !== 'string') {
            throw new TypeError(`config.agents.${id}.pairs[${i}] must have string "name" and "email"`);
          }
          return { name: p.name, email: p.email };
        }),
      };
    }
  }

  if (raw.bots !== undefined) {
    if (raw.bots === null || typeof raw.bots !== 'object' || Array.isArray(raw.bots)) {
      throw new TypeError('config.bots must be an object');
    }
    cfg.bots = {
      names: stringArray(raw.bots.names, 'config.bots.names'),
      emails: stringArray(raw.bots.emails, 'config.bots.emails'),
    };
  }

  if (raw.ignoreBots !== undefined) {
    if (typeof raw.ignoreBots !== 'boolean') throw new TypeError('config.ignoreBots must be a boolean');
    cfg.ignoreBots = raw.ignoreBots;
  }
  cfg.include = stringArray(raw.include, 'config.include');
  cfg.exclude = stringArray(raw.exclude, 'config.exclude');

  if (raw.maxFileSize !== undefined) {
    cfg.maxFileSize = parseSize(raw.maxFileSize, 'config.maxFileSize');
  }
  if (raw.depth !== undefined) {
    if (!Number.isInteger(raw.depth) || raw.depth < 0) throw new TypeError('config.depth must be a non-negative integer');
    cfg.depth = raw.depth;
  }
  if (raw.threshold !== undefined && raw.threshold !== null) {
    if (typeof raw.threshold !== 'number' || raw.threshold < 0 || raw.threshold > 100) {
      throw new TypeError('config.threshold must be a number between 0 and 100');
    }
    cfg.threshold = raw.threshold;
  }
  return cfg;
}

/** Parse a size like `2mb`, `500kb`, `1024` (bytes). */
export function parseSize(value, label = 'size') {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return Math.floor(value);
  const m = /^\s*(\d+(?:\.\d+)?)\s*([kmg]?i?b?)\s*$/i.exec(String(value));
  if (!m) throw new TypeError(`${label} must be a byte count or a size like "2mb", got ${JSON.stringify(value)}`);
  const n = Number(m[1]);
  const unit = m[2].toLowerCase().replace(/i?b$/, '');
  const mult = { '': 1, k: 1024, m: 1024 ** 2, g: 1024 ** 3 }[unit];
  return Math.floor(n * mult);
}

/**
 * Load `.agent-blame.json` from `dir` (or the explicit `file`). A missing
 * default file yields the defaults; a missing explicit file is an error.
 */
export function loadConfig(dir, file) {
  const explicit = Boolean(file);
  const target = file ? path.resolve(dir, file) : path.join(dir, CONFIG_FILENAME);
  let text;
  try {
    text = fs.readFileSync(target, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT' && !explicit) return { ...normalizeConfig({}), path: null };
    throw new Error(`cannot read config ${target}: ${err.message}`);
  }
  let raw;
  try {
    raw = JSON.parse(text.replace(/^﻿/, ''));
  } catch (err) {
    throw new Error(`invalid JSON in ${target}: ${err.message}`);
  }
  try {
    return { ...normalizeConfig(raw), path: target };
  } catch (err) {
    throw new Error(`invalid config ${target}: ${err.message}`);
  }
}
