const Log = require('../schemas/LogSchema');

async function writeLog(level, message, meta = {}) {
  try {
    const logEntry = new Log({ level, message, meta });
    await logEntry.save();
  } catch (e) {
    console.error('Logging failed:', e);
  }
}

module.exports = { writeLog };
