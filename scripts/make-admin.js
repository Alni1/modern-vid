// Gives the administrator role to an account: npm run make-admin <login or display name>
// The first administrator is appointed this way; later ones in the moderation panel.
require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../schemas/userSchema');

(async () => {
  // All arguments together: logins of the first version may contain spaces
  // (npm run make-admin Олексій Анатолійович Конєвіченко).
  const query = process.argv.slice(2).filter((a) => a !== '--').join(' ').trim();
  if (!query) {
    console.log('Usage: npm run make-admin <login or display name>');
    process.exit(1);
  }
  await mongoose.connect(process.env.MONGODB_URL);
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  let users = await User.find({ login: query.toLowerCase() }).lean();
  if (!users.length) users = await User.find({ username: new RegExp(`^${escaped}$`, 'i') }).lean();
  if (!users.length) {
    console.log(`No account with the login or display name "${query}".`);
    process.exitCode = 1;
  } else if (users.length > 1) {
    console.log(`Several accounts have this display name, use the login instead: ${users.map((u) => u.login).join(', ')}`);
    process.exitCode = 1;
  } else {
    await User.updateOne({ _id: users[0]._id }, { $set: { role: 'admin' } });
    console.log(`${users[0].login} (${users[0].username}) is now an administrator. Reload the page.`);
  }
  await mongoose.disconnect();
})().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
