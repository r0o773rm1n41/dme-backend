// config/database.js
import mongoose from 'mongoose';

export async function connectDB() {
  try {
    const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/dme';

    // Performance optimized connection options
    const options = {
      maxPoolSize: 10, // Maintain up to 10 socket connections
      serverSelectionTimeoutMS: 5000, // Keep trying to send operations for 5 seconds
      socketTimeoutMS: 45000, // Close sockets after 45 seconds of inactivity
      bufferCommands: false, // Disable mongoose buffering
      maxIdleTimeMS: 30000, // Close connections after 30 seconds of inactivity
      family: 4, // Use IPv4, skip trying IPv6
    };

    await mongoose.connect(mongoUri, options);
    console.log('MongoDB connected successfully with optimized settings');

    // Connection event handlers
    mongoose.connection.on('connected', () => {
      console.log('Mongoose connected to MongoDB');
    });

    mongoose.connection.on('error', (err) => {
      console.error('Mongoose connection error:', err);
    });

    mongoose.connection.on('disconnected', () => {
      console.log('Mongoose disconnected');
    });

    // Graceful shutdown
    process.on('SIGINT', async () => {
      await mongoose.connection.close();
      console.log('MongoDB connection closed through app termination');
      process.exit(0);
    });

  } catch (error) {
    console.error('MongoDB connection error:', error);
    
    // Provide helpful error message for IP whitelisting issues
    if (error.name === 'MongooseServerSelectionError' || error.message?.includes('whitelist')) {
      console.error('\n⚠️  MONGODB ATLAS IP WHITELIST ERROR ⚠️');
      console.error('===========================================');
      console.error('Your IP address is not whitelisted in MongoDB Atlas.');
      console.error('To fix this:');
      console.error('1. Go to: https://cloud.mongodb.com/');
      console.error('2. Navigate to: Network Access → IP Access List');
      console.error('3. Click "Add IP Address"');
      console.error('4. Click "Allow Access from Anywhere" (0.0.0.0/0) for development');
      console.error('   OR add your current IP address');
      console.error('5. Wait 1-2 minutes for changes to propagate');
      console.error('===========================================\n');
    }
    
    throw error;
  }
}

export default connectDB;