// Visibility of a video chosen by its author:
//  - public    shown everywhere (home page, search, recommendations, channel);
//  - unlisted  available to anyone with the link, but not listed anywhere;
//  - private   only the author (and moderators) can open it, including its media files.
const { canSeeHidden } = require('./moderation');

const VISIBILITY = ['public', 'unlisted', 'private'];

/** Query condition for videos that may appear in lists (videos without the field are public). */
const LISTED = Object.freeze({ visibility: { $nin: ['unlisted', 'private'] } });

const isListed = (video) => !video.visibility || video.visibility === 'public';

/** Whether the viewer may open the video page and its media files. */
function canWatch(viewer, video) {
  if (video.visibility !== 'private') return true;
  const ownerId = video.user && video.user._id ? video.user._id : video.user;
  return canSeeHidden(viewer, ownerId);
}

module.exports = { VISIBILITY, LISTED, isListed, canWatch };
