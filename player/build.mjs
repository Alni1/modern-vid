// Builds the MVPlayer bundle into public/mvplayer/mvplayer.js (served by Express).
// Usage: node player/build.mjs [--watch] [--dev]
import * as esbuild from 'esbuild';
import { fileURLToPath } from 'node:url';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const watch = process.argv.includes('--watch');
const dev = process.argv.includes('--dev') || watch;

const options = {
  entryPoints: [here('src/index.ts')],
  outfile: here('../public/mvplayer/mvplayer.js'),
  bundle: true,
  format: 'esm',
  target: 'es2020',
  minify: !dev,
  sourcemap: true,
  legalComments: 'none',
  logLevel: 'info',
};

if (watch) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
  console.log('[mvplayer] watching for changes...');
} else {
  await esbuild.build(options);
}
