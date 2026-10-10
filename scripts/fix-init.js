/**
 * Repairs HLS renditions that are missing their init.mp4 (initialization segment),
 * without re-transcoding the whole video: the first 2 seconds of each rendition are
 * encoded again with exactly the same settings and only init.mp4 is kept.
 *   npm run fix-init -- <videoId folder name, e.g. b68c39b6-8289-...>
 */
require('dotenv').config();
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const storage = require('../utils/storage');
const { probe } = require('../utils/ffmpeg');
const { buildLadder, describeSource } = require('../utils/transcoder/ladder');
const { buildRenditionArgs, runFfmpeg } = require('../utils/transcoder/hls');

(async () => {
  const id = process.argv[2];
  if (!id) throw new Error('Usage: npm run fix-init -- <video folder id>');
  const videoDir = storage.resolve(`videos/${id}`);
  const sourceName = (await fs.readdir(videoDir)).find((f) => f.startsWith('source.'));
  if (!sourceName) throw new Error(`No source file in ${videoDir}`);
  const input = path.join(videoDir, sourceName);
  const source = describeSource(await probe(input));
  const ladder = buildLadder(source);
  const codec = process.env.TRANSCODE_VIDEO_CODEC || 'libx264';

  for (let i = 0; i < ladder.length; i++) {
    const target = path.join(videoDir, 'hls', `v${i}`, 'init.mp4');
    try {
      await fs.access(target);
      console.log(`v${i} (${ladder[i].name}): init.mp4 present`);
      continue;
    } catch {
      /* missing — regenerate */
    }
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'fix-init-'));
    const args = buildRenditionArgs({ input, dir: tmp, r: ladder[i], source, codec });
    args.splice(args.indexOf('-f'), 0, '-t', '2'); // only the first 2 seconds
    await runFfmpeg(args, { cwd: tmp });
    await fs.copyFile(path.join(tmp, 'init.mp4'), target);
    await fs.rm(tmp, { recursive: true, force: true });
    console.log(`v${i} (${ladder[i].name}): init.mp4 restored`);
  }
  console.log('done');
})().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
