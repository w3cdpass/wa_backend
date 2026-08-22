import mongoose from 'mongoose';
import { config } from '../config/index.js';

let isConnected = false;

export const connectDB = async () => {
  if (isConnected && mongoose.connection.readyState === 1) {
    return mongoose.connection;
  }

  try {
    mongoose.set('strictQuery', true);
    
    const conn = await mongoose.connect(config.mongodb.uri, {
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
      family: 4,
    });

    isConnected = true;
    console.log(`✅ MongoDB connected: ${conn.connection.host}`);
    
    mongoose.connection.on('error', (err) => {
      console.error('MongoDB connection error:', err);
      isConnected = false;
    });

    mongoose.connection.on('disconnected', () => {
      console.warn('MongoDB disconnected');
      isConnected = false;
    });

    return conn;
  } catch (error) {
    console.error('MongoDB connection failed:', error);
    throw error;
  }
};

export const disconnectDB = async () => {
  if (!isConnected) return;
  await mongoose.disconnect();
  isConnected = false;
  console.log('MongoDB disconnected');
};

export const getDB = () => mongoose.connection.db;

export default { connectDB, disconnectDB, getDB };