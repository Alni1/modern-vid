const User = require('../schemas/userSchema');  
const Video = require('../schemas/VideoMeta'); 
const Log = require('../schemas/LogSchema'); 


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
