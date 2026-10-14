// Watch analytics: validation of the watch page reports and helpers for the statistics.
// Pure functions (no database access), covered by the unit tests.

/** The video is divided into this many equal parts for audience retention. */
const BUCKETS = 100;
/** Periods the analytics can be shown for, in days. */
const PERIODS = [7, 28, 90];
/** Time zone of the daily statistics (server time zone unless ANALYTICS_TZ is set). */
const TIME_ZONE = process.env.ANALYTICS_TZ || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
/** Highest playback speed of the player: watch time cannot grow faster than this. */
const MAX_RATE = 2;

/**
 * Seconds that must be played for a session to count as a view:
 * 5 s, or half of a video shorter than 10 s. Opening the page alone is not a view.
 */
function viewThreshold(duration) {
  return duration > 0 ? Math.min(5, duration / 2) : 5;
}

/** Validates a report sent by the watch page. Returns null when it is malformed. */
function parseReport(body) {
  if (!body || typeof body !== 'object') return null;
  const { video, session, watched, buckets } = body;
  if (typeof video !== 'string' || !/^[a-f0-9]{24}$/i.test(video)) return null;
  if (typeof session !== 'string' || !/^[A-Za-z0-9-]{8,64}$/.test(session)) return null;
  if (typeof watched !== 'number' || !Number.isFinite(watched) || watched < 0) return null;
  if (!Array.isArray(buckets) || buckets.length > BUCKETS) return null;
  const set = new Set();
  for (const b of buckets) {
    if (!Number.isInteger(b) || b < 0 || b >= BUCKETS) return null;
    set.add(b);
  }
  return { video, session, watched, buckets: [...set].sort((a, b) => a - b) };
}

/**
 * Watch time accepted from a report: it can only grow, and not faster than real time
 * multiplied by the highest playback speed (plus a margin for the first report).
 */
function acceptedWatched(reported, previous, elapsedSec, duration) {
  const prev = previous || 0;
  let max = prev + Math.max(0, elapsedSec) * MAX_RATE + 30;
  if (duration > 0) max = Math.min(max, duration * 20); // even a looped video has a limit
  return Math.max(prev, Math.min(reported, max));
}

/** 'YYYY-MM-DD' of a date in the given time zone. */
function dayKey(date, timeZone = TIME_ZONE) {
  // en-CA formats dates as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

/** Keys of the last `days` days ending today, oldest first. */
function lastDays(days, now = new Date(), timeZone = TIME_ZONE) {
  const keys = [];
  for (let i = days - 1; i >= 0; i--) keys.push(dayKey(new Date(now.getTime() - i * 86400000), timeZone));
  // Around a DST change two timestamps 24 h apart can fall on the same day.
  return [...new Set(keys)];
}

/**
 * Daily series and totals from rows grouped by day ({ _id: 'YYYY-MM-DD', views, watched, viewWatched }),
 * where watched is the watch time of all sessions and viewWatched that of the counted views,
 * with zero days filled in, plus the totals of the previous period of the same length.
 */
function buildDaily(rows, days, now = new Date(), timeZone = TIME_ZONE) {
  const byDay = new Map(rows.map((r) => [r._id, r]));
  const keys = lastDays(days, now, timeZone);
  const prevKeys = lastDays(days, new Date(now.getTime() - days * 86400000), timeZone);
  const sum = (ks) => ks.reduce((acc, k) => {
    const r = byDay.get(k);
    if (r) { acc.views += r.views || 0; acc.watched += r.watched || 0; acc.viewWatched += r.viewWatched || 0; }
    return acc;
  }, { views: 0, watched: 0, viewWatched: 0 });
  return {
    daily: keys.map((k) => ({ day: k, views: byDay.get(k)?.views || 0, watched: byDay.get(k)?.watched || 0 })),
    totals: sum(keys),
    previous: sum(prevKeys),
  };
}

/**
 * Audience retention: for each 1 % part of the video, the share of views that played it.
 * counts – rows { _id: bucket, n }, total – number of views.
 */
function retentionCurve(counts, total) {
  const curve = new Array(BUCKETS).fill(0);
  if (!total) return curve;
  for (const { _id, n } of counts) if (_id >= 0 && _id < BUCKETS) curve[_id] = Math.min(1, n / total);
  return curve;
}

/** Period in days from a query value (default 28). */
function parsePeriod(value) {
  const d = parseInt(value, 10);
  return PERIODS.includes(d) ? d : 28;
}

// ---- aggregation pipelines (MongoDB) ----------------------------------------

const dayExpr = (timeZone = TIME_ZONE) => ({ $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: timeZone } });

/** Views and watch time per day for the period and the previous one (input of buildDaily). */
function dailyPipeline(match, days, now = new Date(), timeZone = TIME_ZONE) {
  return [
    { $match: { ...match, createdAt: { $gte: new Date(now.getTime() - (2 * days + 2) * 86400000) } } },
    {
      $group: {
        _id: dayExpr(timeZone),
        views: { $sum: { $cond: ['$counted', 1, 0] } },
        watched: { $sum: '$watched' },
        // Watch time of the counted views only: average view duration = viewWatched / views (2.21).
        viewWatched: { $sum: { $cond: ['$counted', '$watched', 0] } },
      },
    },
  ];
}

/** Sessions of the current period: whole days in the analytics time zone. */
function periodStages(match, days, now = new Date(), timeZone = TIME_ZONE) {
  return [
    { $match: { ...match, createdAt: { $gte: new Date(now.getTime() - (days + 1) * 86400000) } } },
    { $addFields: { day: dayExpr(timeZone) } },
    { $match: { day: { $in: lastDays(days, now, timeZone) } } },
  ];
}

/** Views, watch time and average watched share (in buckets) of every video of a channel. */
function perVideoPipeline(channel, days, now = new Date(), timeZone = TIME_ZONE) {
  return [
    ...periodStages({ channel }, days, now, timeZone),
    {
      $group: {
        _id: '$video',
        views: { $sum: { $cond: ['$counted', 1, 0] } },
        watched: { $sum: '$watched' },
        parts: { $avg: { $cond: ['$counted', { $size: '$buckets' }, null] } },
      },
    },
  ];
}

/** Number of views, averages and per-bucket counts of one video (input of retentionCurve). */
function retentionPipeline(video, days, now = new Date(), timeZone = TIME_ZONE) {
  return [
    ...periodStages({ video, counted: true }, days, now, timeZone),
    {
      $facet: {
        total: [{ $count: 'n' }],
        avg: [{ $group: { _id: null, watched: { $avg: '$watched' }, parts: { $avg: { $size: '$buckets' } } } }],
        buckets: [{ $unwind: '$buckets' }, { $group: { _id: '$buckets', n: { $sum: 1 } } }],
      },
    },
  ];
}

module.exports = {
  BUCKETS, PERIODS, TIME_ZONE, MAX_RATE,
  viewThreshold, parseReport, acceptedWatched, dayKey, lastDays, buildDaily, retentionCurve, parsePeriod,
  dailyPipeline, periodStages, perVideoPipeline, retentionPipeline,
};
