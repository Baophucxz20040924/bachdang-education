const mongoose = require('mongoose');

mongoose.set('strictQuery', true);

async function connectDB(uri) {
  if (!uri) throw new Error('MONGODB_URI is required to connect to MongoDB');
  await mongoose.connect(uri, {
    serverSelectionTimeoutMS: 10000,
  });
  return mongoose.connection;
}

async function disconnectDB() {
  await mongoose.disconnect();
}

module.exports = { connectDB, disconnectDB, mongoose };
