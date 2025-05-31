// utils/deleteUser.js

const User = require('../schemas/userSchema');  // User model
const Video = require('../schemas/VideoMeta'); // Video model
const Log = require('../schemas/LogSchema'); // Log model (if applicable)

/**
 * Deletes a user and all associated content from the database.
 * This function performs cascade deletion:
 *  - deletes user's videos,
 *  - deletes user's logs (optional),
 *  - deletes the user document itself.
 * 
 * @param {String} userId - ID of the user to delete
 * @returns {Object} - Result of the deletion process
 */
async function deleteUserCascade(userId) {
  try {
    // Delete all videos owned by the user
    await Video.deleteMany({ ownerId: userId });

    // Delete all logs related to the user (optional)
    await Log.deleteMany({ userId: userId });

    // Delete the user document
    await User.deleteOne({ _id: userId });

    return { success: true };
  } catch (err) {
    console.error('Error during cascade delete:', err);
    return { success: false, error: err.message };
  }
}

module.exports = deleteUserCascade;
