import mongoose from 'mongoose'

const userSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true,
    default: 'Citizen'
  },
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true
  },
  password: {
    type: String,
    required: true
  },
  role: {
    type: String,
    enum: ['user', 'admin'],
    default: 'user'
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
})

export const User = mongoose.models.User || mongoose.model('User', userSchema)

