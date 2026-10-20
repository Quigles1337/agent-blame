/**
 * A small glob matcher for repository paths (forward-slash separated).
 *
 *  - `*`  matches any run of characters except `/`
 *  - `?`  matches exactly one character except `/`
 *  - `**` matches zero or more whole path segments
 *  - a pattern without a `/` matches the file's basename at any depth
 *    (`*.lock` matches `a/b/yarn.lock`), as in .gitignore
 *  - a pattern ending in `/` matches everything below that directory
 *
 * Patterns are case-sensitive and anchored; there is no negation.
 */

const SPECIAL = /[.+^${}()|[\]\\]/g;

export function globToRegExp(glob) {
  if (typeof glob !== 'string' || glob.length === 0) throw new TypeError('glob must be a non-empty string');
  let pattern = glob.replace(/\\/g, '/').replace(/^\.\//, '');
  if (pattern.endsWith('/')) pattern += '**';
  const basenameOnly = !pattern.includes('/');

  let out = '';
  let i = 0;
  while (i < pattern.length) {
    const ch = pattern[i];
    if (ch === '*') {
      if (pattern[i + 1] === '*') {
        // `**/` -> any number of leading segments; `/**` at end -> anything below; bare `**` -> anything
        let j = i + 2;
        while (pattern[j] === '*') j += 1;
        if (pattern[j] === '/') {
          out += '(?:.*/)?';
          i = j + 1;
        } else {
          out += '.*';
          i = j;
        }
        continue;
      }
      out += '[^/]*';
      i += 1;
      continue;
    }
    if (ch === '?') {
      out += '[^/]';
      i += 1;
      continue;
    }
    out += ch.replace(SPECIAL, '\\$&');
    i += 1;
  }
  return new RegExp(basenameOnly ? `(?:^|/)${out}$` : `^${out}$`);
}

/**
 * Build a predicate from include/exclude glob lists. A path is kept when it
 * matches at least one include (or there are none) and matches no exclude.
 */
export function createMatcher({ include = [], exclude = [] } = {}) {
  const inc = include.map(globToRegExp);
  const exc = exclude.map(globToRegExp);
  return function matches(filePath) {
    const p = String(filePath).replace(/\\/g, '/').replace(/^\.\//, '');
    if (inc.length > 0 && !inc.some((re) => re.test(p))) return false;
    return !exc.some((re) => re.test(p));
  };
}
