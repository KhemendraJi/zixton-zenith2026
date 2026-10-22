import mongoose from 'mongoose'

const complaintSchema = new mongoose.Schema({
  id: {
    type: String,
    required: true,
    unique: true
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  userEmail: {
    type: String,
    default: ''
  },
  reporter: {
    type: String,
    default: 'Citizen'
  },
  description: {
    type: String,
    required: true
  },
  category: {
    type: String,
    default: 'Other'
  },
  department: {
    type: String,
    default: 'General Civic Services'
  },
  landmark: {
    type: String,
    default: ''
  },
  lat: {
    type: Number,
    default: null
  },
  lon: {
    type: Number,
    default: null
  },
  photos: {
    type: [String],
    default: []
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  status: {
    type: String,
    default: 'Filed'
  },
  history: [
    {
      at: { type: Date, default: Date.now },
      action: { type: String },
      by: { type: String }
    }
  ],
  adminNote: {
    type: String,
    default: ''
  },
  duplicates: {
    type: [String],
    default: []
  },
  score: {
    type: Number,
    default: 35
  },
  priority: {
    type: String,
    default: 'Low'
  },
  factors: {
    safety: { type: Number, default: 35 },
    severity: { type: Number, default: 55 },
    impact: { type: Number, default: 50 },
    waiting: { type: Number, default: 10 },
    related: { type: Number, default: 0 }
  }
})

export const Complaint = mongoose.models.Complaint || mongoose.model('Complaint', complaintSchema)

