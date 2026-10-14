// Video recommendations: scoring functions (pure, covered by the unit tests).
//
// "Up next" for a video a:
//   base(b | a)  = W_CONTENT · content(a, b) + W_QUALITY · quality(b) + W_FRESH · freshness(b)
//   score(b | a) = (1 − α_a) · base(b | a) + α_a · cowatch(a, b),   α_a = A_MAX · min(1, U_a / U_FULL)
// content  – TF-IDF cosine similarity of title, tags and description, plus same channel / category;
// quality  – smoothed average share of the video that is watched in a view (watch analytics);
// freshness – exponential decay with the age of the video;
// cowatch  – cosine similarity of the sets of signed-in viewers of a and b. Its weight α_a grows
//            with the number U_a of signed-in viewers of a, so without an audience it is simply 0.

const W_CONTENT = 0.65;
const W_QUALITY = 0.2;
const W_FRESH = 0.15;
const A_MAX = 0.5;
const U_FULL = 20;
/** Within the content score: text similarity, same channel, same category. */
const C_TEXT = 0.6;
const C_CHANNEL = 0.25;
const C_CATEGORY = 0.15;
/** Field weights of the text vector. */
const F_TITLE = 3;
const F_TAGS = 2;
const F_DESC = 1;
/** Freshness halves every FRESH_HALF_LIFE days. */
const FRESH_HALF_LIFE = 21;
/** Bayesian smoothing of the watched share: PRIOR_VIEWS virtual views at the catalogue average. */
const PRIOR_VIEWS = 5;
/** Diversity: at most this many videos of one channel among the first DIVERSITY_TOP results. */
const PER_CHANNEL = 2;
const DIVERSITY_TOP = 6;

const STOP = new Set((
  'the and for with that this from you your are was were has have had not but all can our out about into ' +
  'how what when who why will just more video videos part ' +
  'та що як для від все або але цей ця це ці про при над під без також щоб його її їх ми ви він вона вони ' +
  'відео частина ' +
  'что как для это или все так его она они мы вы без над под при про уже ещё еще видео часть'
).split(' '));

/**
 * Words of a text: lower case, letters and digits only, stop words removed.
 * Words are cut to 5 characters – a crude stemmer that merges the inflected forms
 * of Ukrainian and Russian words (лекція, лекції, лекцію → лекці).
 */
function tokenize(text) {
  if (!text) return [];
  return (String(text).toLowerCase().match(/[\p{L}\p{N}]+/gu) || [])
    .filter((w) => w.length >= 3 && !STOP.has(w) && !/^\d+$/.test(w))
    .map((w) => w.slice(0, 5));
}

/** L2-normalized TF-IDF vectors (Map term → weight) for a list of videos. */
function buildVectors(videos) {
  const tfs = videos.map((v) => {
    const tf = new Map();
    const add = (words, w) => words.forEach((t) => tf.set(t, (tf.get(t) || 0) + w));
    add(tokenize(v.title), F_TITLE);
    add(tokenize((v.tags || []).join(' ')), F_TAGS);
    add(tokenize(v.description), F_DESC);
    return tf;
  });
  const df = new Map();
  tfs.forEach((tf) => tf.forEach((_, t) => df.set(t, (df.get(t) || 0) + 1)));
  const n = videos.length;
  return tfs.map((tf) => {
    const vec = new Map();
    let norm = 0;
    tf.forEach((f, t) => {
      const w = (1 + Math.log(f)) * Math.log(1 + n / df.get(t));
      vec.set(t, w);
      norm += w * w;
    });
    norm = Math.sqrt(norm) || 1;
    vec.forEach((w, t) => vec.set(t, w / norm));
    return vec;
  });
}

function cosine(a, b) {
  if (a.size > b.size) [a, b] = [b, a];
  let s = 0;
  a.forEach((w, t) => { const u = b.get(t); if (u) s += w * u; });
  return s;
}

const sameId = (x, y) => x != null && y != null && String(x) === String(y);

function contentScore(a, b, vecA, vecB) {
  return C_TEXT * cosine(vecA, vecB)
    + C_CHANNEL * (sameId(a.user, b.user) ? 1 : 0)
    + C_CATEGORY * (a.category && a.category === b.category ? 1 : 0);
}

/**
 * Watched share smoothed towards the catalogue average, so that one view at 100 %
 * does not beat fifty views at 80 %. stats: { views, parts } where parts is the sum
 * of watched shares (0..1) of the views. Returns 0..1.
 */
function qualityScore(stats, prior) {
  const views = stats ? stats.views : 0;
  const parts = stats ? stats.parts : 0;
  return (parts + PRIOR_VIEWS * prior) / (views + PRIOR_VIEWS);
}

function freshnessScore(uploadedAt, now = Date.now()) {
  const ageDays = Math.max(0, (now - new Date(uploadedAt || now).getTime()) / 86400000);
  return 0.5 ** (ageDays / FRESH_HALF_LIFE);
}

/** Cosine similarity of two sets of viewer ids. */
function cowatchScore(viewersA, viewersB) {
  if (!viewersA || !viewersB || !viewersA.size || !viewersB.size) return 0;
  let common = 0;
  const [small, big] = viewersA.size < viewersB.size ? [viewersA, viewersB] : [viewersB, viewersA];
  small.forEach((u) => { if (big.has(u)) common++; });
  return common / Math.sqrt(viewersA.size * viewersB.size);
}

/** Weight of the co-watching signal for a video with `viewers` signed-in viewers. */
function cowatchWeight(viewers) {
  return A_MAX * Math.min(1, (viewers || 0) / U_FULL);
}

/**
 * Greedy re-ranking for variety: among the first DIVERSITY_TOP results at most PER_CHANNEL
 * videos of one channel; the rest keep their order and follow.
 */
function diversify(ranked, channelOf) {
  const out = [];
  const postponed = [];
  const perChannel = new Map();
  for (const item of ranked) {
    const ch = String(channelOf(item));
    const n = perChannel.get(ch) || 0;
    if (out.length < DIVERSITY_TOP && n >= PER_CHANNEL) { postponed.push(item); continue; }
    perChannel.set(ch, n + 1);
    out.push(item);
  }
  return out.concat(postponed);
}

/**
 * Top `limit` recommendations for every video.
 * videos: [{ _id, title, description, tags, category, user, uploadedAt }]
 * stats:  Map videoId → { views, parts } (watch analytics, views with the watched share)
 * viewers: Map videoId → Set of signed-in viewer ids
 * Returns Map videoId → [{ id, score }].
 */
function recommendAll(videos, { stats = new Map(), viewers = new Map(), limit = 20, now = Date.now() } = {}) {
  const vecs = buildVectors(videos);
  let sumParts = 0, sumViews = 0;
  stats.forEach((s) => { sumParts += s.parts; sumViews += s.views; });
  const prior = sumViews ? sumParts / sumViews : 0.5;
  const quality = videos.map((v) => qualityScore(stats.get(String(v._id)), prior));
  const fresh = videos.map((v) => freshnessScore(v.uploadedAt, now));
  const result = new Map();
  videos.forEach((a, i) => {
    const va = viewers.get(String(a._id));
    const alpha = cowatchWeight(va ? va.size : 0);
    const ranked = [];
    videos.forEach((b, j) => {
      if (i === j) return;
      const base = W_CONTENT * contentScore(a, b, vecs[i], vecs[j]) + W_QUALITY * quality[j] + W_FRESH * fresh[j];
      const co = alpha ? cowatchScore(va, viewers.get(String(b._id))) : 0;
      ranked.push({ id: String(b._id), channel: String(b.user), score: (1 - alpha) * base + alpha * co });
    });
    ranked.sort((x, y) => y.score - x.score);
    result.set(String(a._id), diversify(ranked, (r) => r.channel).slice(0, limit).map(({ id, score }) => ({ id, score })));
  });
  return result;
}

module.exports = {
  W_CONTENT, W_QUALITY, W_FRESH, A_MAX, U_FULL, PER_CHANNEL, DIVERSITY_TOP,
  tokenize, buildVectors, cosine, contentScore, qualityScore, freshnessScore, cowatchScore, cowatchWeight, diversify, recommendAll,
};
