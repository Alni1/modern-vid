// Runs the unit tests: player modules (TypeScript, bundled with esbuild) and server modules.
// Usage: npm test
import * as esbuild from 'esbuild';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const playerTests = readdirSync(join(root, 'player/test')).filter((f) => f.endsWith('.test.ts'));
const out = mkdtempSync(join(tmpdir(), 'mvplayer-tests-'));
await esbuild.build({
  entryPoints: playerTests.map((f) => join(root, 'player/test', f)),
  outdir: out,
  bundle: true,
  platform: 'node',
  format: 'esm',
  outExtension: { '.js': '.mjs' },
  logLevel: 'warning',
});
const files = [
  ...readdirSync(out).map((f) => join(out, f)),
  ...readdirSync(join(root, 'test')).filter((f) => f.endsWith('.test.js')).map((f) => join(root, 'test', f)),
];
const res = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' });
rmSync(out, { recursive: true, force: true });
process.exit(res.status ?? 1);
