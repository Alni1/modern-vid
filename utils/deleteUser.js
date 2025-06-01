const User = require('../schemas/userSchema');  // User model
const Video = require('../schemas/VideoMeta'); // Video model
const Log = require('../schemas/LogSchema'); // Log model


async function deleteUserCascade(userId) {
  try {

    await Video.deleteMany({ ownerId: userId });

    await Log.deleteMany({ userId: userId });

    await User.deleteOne({ _id: userId });

    return { success: true };
  } catch (err) {
    console.error('Error during cascade delete:', err);
    return { success: false, error: err.message };
  }
}

module.exports = deleteUserCascade;
