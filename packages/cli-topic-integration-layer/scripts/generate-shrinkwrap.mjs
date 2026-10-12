// Writes npm-shrinkwrap.json next to package.json so the published tarball pins its whole
// dependency tree.
//
// `commercetools plugins install` runs a plain `npm install` on the published package. The
// workspace pnpm-lock.yaml is not shipped, so without a shrinkwrap npm resolves every
// transitive range from the registry at install time. A partly published upstream release
// (dependents live before their dependencies) then fails the install with ETARGET, even for
// an already-published plugin version. npm honours npm-shrinkwrap.json of an installed
// package, so the tree below is what every consumer gets.
//
// Runs at publish time (see `changeset:publish`). It resolves with `--before` set to 24h ago,
// mirroring `minimumReleaseAge` in pnpm-workspace.yaml, so a release still being rolled out
// is never locked in.
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const { name, version, dependencies } = JSON.parse(
  readFileSync(join(packageDir, 'package.json'), 'utf8'),
);

const before = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
const workDir = mkdtempSync(join(tmpdir(), 'il-shrinkwrap-'));

try {
  // Production dependencies only: that is all a consumer installs.
  writeFileSync(
    join(workDir, 'package.json'),
    JSON.stringify({ name, version, dependencies }, null, 2),
  );
  const npm = (...args) => execFileSync('npm', args, { cwd: workDir, stdio: 'inherit' });
  npm('install', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund', `--before=${before}`);
  npm('shrinkwrap');
  copyFileSync(join(workDir, 'npm-shrinkwrap.json'), join(packageDir, 'npm-shrinkwrap.json'));
  console.log(`Wrote npm-shrinkwrap.json (resolved as of ${before})`);
} finally {
  rmSync(workDir, { recursive: true, force: true });
}
