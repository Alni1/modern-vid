const os = require('os');
const path = require('path');
const fs = require('fs/promises');

const TranscodeJob = require('../../schemas/TranscodeJob');
const VideoMeta = require('../../schemas/VideoMeta');
const storage = require('../storage');
const { probe } = require('../ffmpeg');
const { buildLadder, describeSource } = require('./ladder');
const { transcodeToHls } = require('./hls');

const POLL_MS = Number(process.env.TRANSCODE_POLL_MS) || 3000;
const MAX_ATTEMPTS = 2;
const CODEC = process.env.TRANSCODE_VIDEO_CODEC || 'libx264';

let timer = null;
let busy = false;

/** Adds a transcoding job for the video to the queue. */
async function enqueue(videoObjectId) {
  return TranscodeJob.create({ video: videoObjectId });
}

/** Atomically takes the oldest queued job, so several workers never process the same job. */
function claimNext() {
  return TranscodeJob.findOneAndUpdate(
    { status: 'queued' },
    { $set: { status: 'processing', lockedAt: new Date() }, $inc: { attempts: 1 } },
    { sort: { createdAt: 1 }, new: true },
  );
}

async function processJob(job) {
  const video = await VideoMeta.findById(job.video);
  if (!video || !video.storageKey) {
    await TranscodeJob.updateOne({ _id: job._id }, { status: 'failed', error: 'Video not found', finishedAt: new Date() });
    return;
  }

  const workDir = path.join(os.tmpdir(), `modernvid-hls-${video.videoId}`);
  const source = await storage.getLocalPath(video.storageKey);
  const started = Date.now();
  try {
    const info = describeSource(await probe(source.path));
    const ladder = buildLadder(info);
    console.log(`[transcoder] ${video._id}: ${info.width}x${info.height}, ${info.duration.toFixed(1)}s -> ${ladder.map((r) => r.name).join(', ')}`);

    let lastSaved = 0;
    await fs.rm(workDir, { recursive: true, force: true });
    await transcodeToHls({
      input: source.path,
      outDir: workDir,
      ladder,
      source: info,
      codec: CODEC,
      onProgress: (p) => {
        // Persist progress at most every 5% to keep database writes low.
        if (p - lastSaved < 0.05 && p < 1) return;
        lastSaved = p;
        const progress = Math.round(p * 100) / 100;
        const elapsed = (Date.now() - started) / 1000;
        const eta = p > 0.02 ? Math.round((elapsed / p - elapsed) / 60) : null;
        console.log(`[transcoder] ${video._id}: ${Math.round(p * 100)}%${eta !== null ? `, ~${eta} min left` : ''}`);
        VideoMeta.updateOne({ _id: video._id }, { processingProgress: progress }).catch(() => {});
        TranscodeJob.updateOne({ _id: job._id }, { progress }).catch(() => {});
      },
    });

    const prefix = `videos/${video.videoId}/hls`;
    await storage.deletePrefix(prefix);
    const files = await storage.putDir(prefix, workDir, { move: true });

    video.hls = { masterKey: `${prefix}/master.m3u8`, renditions: ladder };
    video.duration = info.duration;
    video.status = 'ready';
    video.processingProgress = 1;
    video.processingError = undefined;
    await video.save();
    await TranscodeJob.updateOne({ _id: job._id }, { status: 'done', progress: 1, finishedAt: new Date() });
    console.log(`[transcoder] ${video._id}: done, ${files} files in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  } catch (err) {
    const final = job.attempts >= MAX_ATTEMPTS;
    console.error(`[transcoder] ${video._id}: attempt ${job.attempts} failed${final ? ' (giving up)' : ''}:`, err.message);
    await TranscodeJob.updateOne(
      { _id: job._id },
      { status: final ? 'failed' : 'queued', error: err.message.slice(0, 2000), finishedAt: final ? new Date() : undefined },
    );
    if (final) {
      // The source file is still playable progressively, so the video stays watchable.
      await VideoMeta.updateOne({ _id: video._id }, { status: 'failed', processingError: err.message.slice(0, 500) });
    }
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
    await source.release();
  }
}

async function tick() {
  if (busy) return;
  busy = true;
  try {
    let job;
    while ((job = await claimNext())) await processJob(job);
  } catch (err) {
    console.error('[transcoder] worker error:', err.message);
  } finally {
    busy = false;
  }
}

/**
 * Queues videos that were uploaded before HLS transcoding existed
 * (they have a source file but no HLS renditions yet).
 */
async function backfill() {
  const videos = await VideoMeta.find({
    storageKey: { $exists: true, $ne: null },
    'hls.masterKey': { $exists: false },
    status: { $ne: 'failed' },
  }).select('_id').lean();
  for (const v of videos) {
    const pending = await TranscodeJob.exists({ video: v._id, status: { $in: ['queued', 'processing'] } });
    if (pending) continue;
    await VideoMeta.updateOne({ _id: v._id }, { status: 'processing', processingProgress: 0 });
    await enqueue(v._id);
  }
  if (videos.length) console.log(`[transcoder] queued ${videos.length} existing video(s) for HLS transcoding`);
}

/** Starts the in-process worker. Disable with TRANSCODE_WORKER=off (e.g. when a separate worker runs). */
async function startWorker() {
  if (timer || process.env.TRANSCODE_WORKER === 'off') return;
  // Jobs left "processing" by a stopped server go back to the queue
  // (with a single in-process worker nothing else can be processing them now).
  const interrupted = await TranscodeJob.updateMany({ status: 'processing' }, { status: 'queued' });
  if (interrupted.modifiedCount) console.log(`[transcoder] re-queued ${interrupted.modifiedCount} interrupted job(s)`);
  await backfill();
  timer = setInterval(tick, POLL_MS);
  tick();
  console.log(`[transcoder] worker started (codec ${CODEC})`);
}

module.exports = { enqueue, startWorker, processJob };
