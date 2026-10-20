import test from 'node:test';
import assert from 'node:assert/strict';
import { globToRegExp, createMatcher } from '../src/glob.js';

test('* and ? match within a single path segment', () => {
  assert.ok(globToRegExp('src/*.js').test('src/index.js'));
  assert.ok(!globToRegExp('src/*.js').test('src/lib/index.js'));
  assert.ok(globToRegExp('src/?.js').test('src/a.js'));
  assert.ok(!globToRegExp('src/?.js').test('src/ab.js'));
  assert.ok(!globToRegExp('src/*.js').test('src/index.jsx'));
});

test('** matches zero or more whole segments', () => {
  const re = globToRegExp('src/**/*.test.js');
  assert.ok(re.test('src/a.test.js'));
  assert.ok(re.test('src/deep/er/a.test.js'));
  assert.ok(!re.test('lib/a.test.js'));
  assert.ok(globToRegExp('vendor/**').test('vendor/x/y.c'));
  assert.ok(globToRegExp('vendor/**').test('vendor/x'));
  assert.ok(!globToRegExp('vendor/**').test('vendors/x'));
  assert.ok(globToRegExp('**/node_modules/**').test('a/b/node_modules/c/d.js'));
  assert.ok(globToRegExp('**/node_modules/**').test('node_modules/c/d.js'));
});

test('a pattern without a slash matches the basename at any depth', () => {
  assert.ok(globToRegExp('*.lock').test('yarn.lock'));
  assert.ok(globToRegExp('*.lock').test('packages/app/yarn.lock'));
  assert.ok(!globToRegExp('*.lock').test('packages/app/yarn.lock.bak'));
  assert.ok(globToRegExp('package-lock.json').test('x/package-lock.json'));
});

test('a trailing slash means everything below the directory; dots and other regex characters are literal', () => {
  assert.ok(globToRegExp('dist/').test('dist/bundle.js'));
  assert.ok(!globToRegExp('dist/').test('dist'));
  assert.ok(!globToRegExp('a.b').test('axb'));
  assert.ok(globToRegExp('weird(name)+[x].txt').test('weird(name)+[x].txt'));
  assert.throws(() => globToRegExp(''), TypeError);
});

test('createMatcher combines include and exclude lists', () => {
  const m = createMatcher({ include: ['src/**', 'bin/*.js'], exclude: ['**/*.test.js', 'src/vendor/**'] });
  assert.equal(m('src/a.js'), true);
  assert.equal(m('bin/cli.js'), true);
  assert.equal(m('src/a.test.js'), false);
  assert.equal(m('src/vendor/lib.js'), false);
  assert.equal(m('README.md'), false);
  const none = createMatcher();
  assert.equal(none('anything/at/all'), true);
  const excludeOnly = createMatcher({ exclude: ['*.lock'] });
  assert.equal(excludeOnly('yarn.lock'), false);
  assert.equal(excludeOnly('src/x.js'), true);
  assert.equal(excludeOnly('.\\src\\x.js'), true, 'backslashes and ./ prefixes are normalised');
});
