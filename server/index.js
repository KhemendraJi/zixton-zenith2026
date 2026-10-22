import 'dotenv/config'
import cors from 'cors'
import express from 'express'
import multer from 'multer'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import crypto from 'node:crypto'
import {
  connectDB,
  getDbStatus,
  findUserByEmail,
  findUserById,
  createUser,
  getComplaints,
  getAllComplaintsRaw,
  getComplaintById,
  createComplaint,
  updateComplaint,
  deleteComplaint,
  linkComplaintDuplicates
} from './db.js'
import {
  clusterComplaints,
  compareComplaints,
  compareComplaintsWithAI,
  haversineDistance
} from './clustering.js'
import { classifyWithGemini } from './gemini.js'
import {
  hashPassword,
  comparePassword,
  generateToken,
  authenticate,
  requireAuth
} from './auth.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const uploadDir = path.join(__dirname, 'uploads')
await mkdir(uploadDir, { recursive: true })

// Connect to MongoDB Atlas (with graceful fallback if IP access is not yet permitted)
connectDB().catch(err => console.error('[DB] Initialization error:', err))

const app = express()
app.use(cors())
app.use(express.json())
app.use('/uploads', express.static(uploadDir))
app.use(authenticate)

const storage = multer.diskStorage({
  destination: (_, __, done) => done(null, uploadDir),
  filename: (_, file, done) => done(null, `${Date.now()}-${crypto.randomUUID()}${path.extname(file.originalname)}`)
})
const upload = multer({
  storage,
  limits: { fileSize: 4 * 1024 * 1024, files: 3 },
  fileFilter: (_, f, done) => done(null, f.mimetype.startsWith('image/'))
})

const categories = [
  'Roads & Potholes',
  'Sanitation & Garbage',
  'Water Supply',
  'Streetlights & Electricity',
  'Drainage & Sewage',
  'Public Safety',
  'Other'
]

const departments = {
  'Roads & Potholes': 'Roads & Maintenance',
  'Sanitation & Garbage': 'Sanitation Department',
  'Water Supply': 'Water Supply Department',
  'Streetlights & Electricity': 'Electrical Department',
  'Drainage & Sewage': 'Drainage Department',
  'Public Safety': 'Public Safety / Ward Office',
  Other: 'General Civic Services'
}

function classify(text, chosen) {
  if (chosen) return chosen
  const t = text.toLowerCase()
  const rules = [
    ['Roads & Potholes', ['pothole', 'road', 'crater', 'footpath']],
    ['Sanitation & Garbage', ['garbage', 'trash', 'waste', 'rubbish']],
    ['Water Supply', ['water leak', 'leakage', 'pipe burst', 'no water']],
    ['Streetlights & Electricity', ['streetlight', 'street light', 'electricity', 'wire']],
    ['Drainage & Sewage', ['drain', 'sewage', 'manhole', 'flooding']],
    ['Public Safety', ['unsafe', 'accident', 'danger', 'exposed wire']]
  ]
  const matched = rules
    .map(([category, words]) => [category, words.filter(w => t.includes(w)).length])
    .sort((a, b) => b[1] - a[1])

  return matched[0][1] ? matched[0][0] : 'Other'
}

function priority(text) {
  const t = text.toLowerCase()
  const safety = /injur|accident|danger|exposed wire|open manhole|fire|collapse|school|hospital/.test(t) ? 90 : /risk|unsafe|dark|overflow/.test(t) ? 65 : 35
  const severity = /large|major|severe|burst|broken|blocked|overflow|collapse|exposed/.test(t) ? 85 : /small|minor/.test(t) ? 25 : 55
  const impact = /school|hospital|market|main road|bus stop|college|many people/.test(t) ? 80 : 50
  const score = Math.round(0.3 * safety + 0.25 * severity + 0.2 * impact + 0.1 * 10)
  return {
    score,
    priority: score >= 85 ? 'Critical' : score >= 70 ? 'High' : score >= 45 ? 'Medium' : 'Low',
    factors: { safety, severity, impact, waiting: 10, related: 0 }
  }
}

// Health and DB status
app.get('/api/health', (_, res) => res.json({ ok: true, ...getDbStatus() }))

// ==================== AUTHENTICATION ROUTES ====================

// Sign up / Register (User or Admin)
app.post(['/api/auth/signup', '/api/auth/register'], async (req, res) => {
  try {
    const { name, email, password, role = 'user' } = req.body

    if (!email || !email.includes('@')) {
      return res.status(400).json({ message: 'Please provide a valid email address.' })
    }
    if (!password || password.length < 6) {
      return res.status(400).json({ message: 'Password must be at least 6 characters long.' })
    }

    const assignedRole = role === 'admin' ? 'admin' : 'user'
    const existing = await findUserByEmail(email)
    if (existing) {
      return res.status(409).json({ message: 'An account with this email address already exists. Please log in.' })
    }

    const hashedPassword = await hashPassword(password)
    const user = await createUser({
      name: name && name.trim() ? name.trim() : (assignedRole === 'admin' ? 'Admin' : 'Citizen'),
      email,
      password: hashedPassword,
      role: assignedRole
    })

    const token = generateToken(user)
    const userSafe = {
      id: user._id ? user._id.toString() : user.id,
      name: user.name,
      email: user.email,
      role: user.role
    }

    res.status(201).json({
      message: `${userSafe.role === 'admin' ? 'Admin' : 'Citizen'} account created successfully.`,
      token,
      user: userSafe
    })
  } catch (error) {
    console.error('Signup error:', error)
    res.status(500).json({ message: 'Unable to register account. Please try again.' })
  }
})

// Login
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body
    if (!email || !password) {
      return res.status(400).json({ message: 'Please provide email and password.' })
    }

    const user = await findUserByEmail(email)
    if (!user) {
      return res.status(401).json({ message: 'Invalid email or password.' })
    }

    const isMatch = await comparePassword(password, user.password)
    if (!isMatch) {
      return res.status(401).json({ message: 'Invalid email or password.' })
    }

    const token = generateToken(user)
    const userSafe = {
      id: user._id ? user._id.toString() : user.id,
      name: user.name,
      email: user.email,
      role: user.role
    }

    res.json({
      message: 'Logged in successfully.',
      token,
      user: userSafe
    })
  } catch (error) {
    console.error('Login error:', error)
    res.status(500).json({ message: 'Unable to log in. Please try again.' })
  }
})

// Get current user profile
app.get('/api/auth/me', async (req, res) => {
  if (!req.user) {
    return res.status(401).json({ message: 'Not authenticated' })
  }
  const user = await findUserById(req.user.id)
  if (!user) {
    return res.status(404).json({ message: 'User not found' })
  }
  res.json({
    user: {
      id: user._id ? user._id.toString() : user.id,
      name: user.name,
      email: user.email,
      role: user.role
    }
  })
})

// ==================== CLUSTERS & COMPLAINTS ROUTES ====================

// GET /api/clusters: Returns detected issue clusters & hotspot analytics
app.get('/api/clusters', async (req, res) => {
  try {
    if (!req.user) {
      return res.json({ clusters: [], totalClusters: 0, totalDuplicateReports: 0 })
    }

    const allComplaints = await getAllComplaintsRaw()
    const { clusters } = clusterComplaints(allComplaints)

    const totalDuplicateReports = clusters.reduce((sum, c) => sum + (c.count - 1), 0)
    res.json({
      clusters,
      totalClusters: clusters.length,
      totalDuplicateReports,
      hotspots: clusters.slice(0, 5)
    })
  } catch (error) {
    console.error('Fetch clusters error:', error)
    res.status(500).json({ message: 'Could not fetch complaint clusters.' })
  }
})

// GET complaints:
// If unauthenticated: returns empty array [].
// If authenticated citizen: returns citizen's own complaints annotated with cluster community data.
// If authenticated admin: returns all complaints annotated with duplicate/cluster status, supporting filters:
//   - ?hideDuplicates=true or ?filter=unique: returns only master/unique complaints (hiding duplicates)
//   - ?filter=clusters_only: returns only complaints that are part of a duplicate cluster
//   - ?clusterId=...: returns complaints belonging to a specific cluster
app.get('/api/complaints', async (req, res) => {
  try {
    if (!req.user) {
      return res.json([])
    }

    const allComplaints = await getAllComplaintsRaw()
    const { clusters, annotatedComplaints } = clusterComplaints(allComplaints)

    const isAdmin = req.user.role === 'admin'
    const isCitizen = req.user.role === 'user'

    if (isCitizen) {
      const userEmail = (req.user.email || '').toLowerCase()
      const userId = req.user.id || req.user._id
      const citizenComplaints = annotatedComplaints.filter(
        c =>
          (c.userId && (c.userId === userId || c.userId?.toString() === userId?.toString())) ||
          (c.userEmail && c.userEmail.toLowerCase() === userEmail)
      )
      return res.json(citizenComplaints)
    }

    if (isAdmin) {
      let filtered = annotatedComplaints

      const { hideDuplicates, filter, clusterId } = req.query

      if (clusterId) {
        filtered = filtered.filter(c => c.clusterId === clusterId)
      } else if (hideDuplicates === 'true' || filter === 'unique') {
        // Return only master tickets and solo tickets, filtering out redundant duplicates
        filtered = filtered.filter(c => !c.isDuplicate)
      } else if (filter === 'clusters_only') {
        // Return only issues that have 2 or more reports (hotspots)
        filtered = filtered.filter(c => c.clusterCount > 1)
      }

      return res.json(filtered)
    }

    res.json([])
  } catch (error) {
    console.error('Fetch complaints error:', error)
    res.status(500).json({ message: 'Could not fetch complaints.' })
  }
})

// POST complaint:
// Requires authentication. Detects duplicate complaints in the vicinity, links them,
// escalates priority factor for multi-reported incidents, and saves complaint.
app.post('/api/complaints', upload.array('photos', 3), async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ message: 'Authentication required. Please log in to report a problem.' })
    }

    const {
      description,
      reporter: passedReporter,
      category: chosen = '',
      landmark = '',
      lat = '',
      lon = ''
    } = req.body

    if (!description || description.trim().length < 8) {
      return res.status(400).json({ message: 'Please provide a more detailed description (at least 8 characters).' })
    }

    const latitude = lat === '' ? null : Number(lat)
    const longitude = lon === '' ? null : Number(lon)
    if (
      (latitude === null) !== (longitude === null) ||
      (latitude !== null && (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180))
    ) {
      return res.status(400).json({ message: 'Please enter valid latitude and longitude.' })
    }

    let category = chosen || ''
    let department = chosen ? (departments[chosen] || 'General Civic Services') : ''
    let categorizedBy = chosen ? 'Citizen Selection' : ''

    // If category was not explicitly selected by citizen, classify with Google Gemini AI
    if (!category) {
      const aiClassification = await classifyWithGemini(description)
      if (aiClassification && aiClassification.category) {
        category = aiClassification.category
        department = aiClassification.department
        categorizedBy = `Google Gemini (${aiClassification.model})`
      } else {
        category = classify(description)
        department = departments[category] || 'General Civic Services'
        categorizedBy = 'Heuristic Rules Engine'
      }
    }

    let analysis = priority(description)
    const now = new Date().toISOString()

    const reporterName = req.user.name || passedReporter?.trim() || 'Citizen'
    const userId = req.user.id
    const userEmail = req.user.email

    // Candidate complaint object
    const candidate = {
      description: description.trim(),
      category,
      landmark: landmark.trim(),
      lat: latitude,
      lon: longitude
    }

    // Run AI-enhanced duplicate detection against existing complaints in system
    const existingComplaints = await getAllComplaintsRaw()
    const duplicateMatches = []

    for (const c of existingComplaints) {
      const cmp = await compareComplaintsWithAI(candidate, c)
      if (cmp.isMatch) {
        duplicateMatches.push({ ...c, matchReason: cmp.reason })
      }
    }

    const duplicateIds = duplicateMatches.map(m => m.id)
    const history = [
      { at: now, action: 'Complaint submitted', by: req.user ? `${reporterName} (${userEmail})` : reporterName }
    ]

    if (categorizedBy && !chosen) {
      history.push({
        at: now,
        action: `Categorized into "${category}" (${department}) via ${categorizedBy}.`,
        by: categorizedBy.includes('Gemini') ? 'Google Gemini AI' : 'CivicSense Intelligence Engine'
      })
    }

    // If duplicate reports exist in same area, boost priority score (community escalation)
    if (duplicateMatches.length > 0) {
      const duplicateBoost = Math.min(30, duplicateMatches.length * 15)
      const newScore = Math.min(100, analysis.score + duplicateBoost)
      const escalatedPriority = newScore >= 85 ? 'Critical' : newScore >= 70 ? 'High' : newScore >= 45 ? 'Medium' : 'Low'

      analysis = {
        ...analysis,
        score: newScore,
        priority: escalatedPriority,
        factors: {
          ...analysis.factors,
          related: duplicateBoost
        }
      }

      const primaryMatchReason = duplicateMatches[0]?.matchReason ? ` Match: ${duplicateMatches[0].matchReason}` : ''
      history.push({
        at: now,
        action: `Duplicate detection engine identified ${duplicateMatches.length} matching report(s) in this vicinity (${duplicateIds.join(', ')}). Priority escalated by +${duplicateBoost} pts to ${escalatedPriority}.${primaryMatchReason}`,
        by: 'CivicSense Intelligence Engine'
      })
    }

    const item = {
      id: `CS-${crypto.randomUUID().slice(0, 4).toUpperCase()}${Date.now().toString().slice(-4)}`,
      userId,
      userEmail,
      reporter: reporterName,
      description: description.trim(),
      category,
      department: departments[category] || 'General Civic Services',
      landmark: landmark.trim(),
      lat: latitude,
      lon: longitude,
      photos: (req.files || []).map(file => `/uploads/${file.filename}`),
      createdAt: now,
      status: 'Filed',
      history,
      adminNote: '',
      duplicates: duplicateIds,
      ...analysis
    }

    const saved = await createComplaint(item)

    // Bidirectionally link this new complaint into the matched existing complaints
    if (duplicateIds.length > 0) {
      await linkComplaintDuplicates(saved.id, duplicateIds)
    }

    res.status(201).json(saved)
  } catch (error) {
    console.error('Create complaint error:', error)
    res.status(500).json({ message: 'Failed to submit complaint.' })
  }
})

// PATCH complaint:
// - Admin can update category, department, priority, status, and adminNote.
// - Citizen can accept or reject resolution for their own complaint.
app.patch('/api/complaints/:id', async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ message: 'Authentication required.' })
    }

    const existing = await getComplaintById(req.params.id)
    if (!existing) {
      return res.status(404).json({ message: 'Complaint not found.' })
    }

    const isAdmin = req.user.role === 'admin'
    const isOwner =
      existing.userId === req.user.id ||
      (existing.userEmail && existing.userEmail.toLowerCase() === req.user.email.toLowerCase())

    if (!isAdmin && !isOwner) {
      return res.status(403).json({ message: 'You are not authorized to modify this complaint.' })
    }

    // Citizen can only accept or reject resolution
    if (!isAdmin && isOwner) {
      if (req.body.action !== 'accept' && req.body.action !== 'reject') {
        return res.status(400).json({ message: 'Citizens can only accept or reject resolutions.' })
      }
    }

    const reviewerName = isAdmin ? (req.user.name ? `${req.user.name} (Admin)` : 'Admin') : (req.user.name || 'Citizen')
    const updated = await updateComplaint(req.params.id, req.body, reviewerName, req.user)
    if (!updated) {
      return res.status(404).json({ message: 'Complaint not found.' })
    }
    res.json(updated)
  } catch (error) {
    console.error('Update complaint error:', error)
    res.status(500).json({ message: 'Failed to update complaint.' })
  }
})

// DELETE complaint:
// - Admin can delete any complaint (e.g., spam, duplicates).
// - Citizen can delete their own submitted complaint.
app.delete('/api/complaints/:id', async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ message: 'Authentication required.' })
    }

    const existing = await getComplaintById(req.params.id)
    if (!existing) {
      return res.status(404).json({ message: 'Complaint not found.' })
    }

    const isAdmin = req.user.role === 'admin'
    const isOwner =
      existing.userId === req.user.id ||
      (existing.userEmail && existing.userEmail.toLowerCase() === req.user.email.toLowerCase())

    if (!isAdmin && !isOwner) {
      return res.status(403).json({ message: 'You are not authorized to delete this complaint.' })
    }

    const success = await deleteComplaint(req.params.id)
    if (!success) {
      return res.status(500).json({ message: 'Could not delete complaint.' })
    }

    res.json({ message: `Complaint ${req.params.id} has been deleted.`, id: req.params.id })
  } catch (error) {
    console.error('Delete complaint error:', error)
    res.status(500).json({ message: 'Failed to delete complaint.' })
  }
})

// Error handling middleware
app.use((error, _req, res, next) => {
  if (res.headersSent) return next(error)
  console.error('API request failed:', error)
  const isUploadError = error instanceof multer.MulterError
  const status = isUploadError ? error.code === 'LIMIT_FILE_SIZE' ? 413 : 400 : 500
  res.status(status).json({
    message: isUploadError
      ? error.code === 'LIMIT_FILE_SIZE' ? 'Each photo must be 4 MB or smaller.' : 'The uploaded photos could not be processed.'
      : 'The server could not process the request.'
  })
})

const PORT = process.env.PORT || 5000
app.listen(PORT, () => console.log(`CivicSense API listening on http://localhost:${PORT}`))
