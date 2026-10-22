import mongoose from 'mongoose'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { User } from './models/User.js'
import { Complaint } from './models/Complaint.js'
import { hashPassword } from './auth.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const dataDir = path.join(__dirname, 'data')
const complaintsJsonPath = path.join(dataDir, 'complaints.json')
const usersJsonPath = path.join(dataDir, 'users.json')

let isMongoConnected = false

export function getDbStatus() {
  return {
    mongoConnected: isMongoConnected,
    mode: isMongoConnected ? 'mongodb' : 'fallback-local'
  }
}

// Local JSON store helpers for graceful fallback
async function readJson(file, defaultValue = []) {
  try {
    const raw = await readFile(file, 'utf8')
    return JSON.parse(raw)
  } catch (error) {
    if (error.code === 'ENOENT') return defaultValue
    console.error(`Error reading ${file}:`, error.message)
    return defaultValue
  }
}

async function writeJson(file, data) {
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, JSON.stringify(data, null, 2), 'utf8')
}

// Seed default users if they don't exist
export async function seedDefaults() {
  const defaultAdmin = {
    name: 'System Administrator',
    email: 'admin@civicsense.org',
    password: 'admin123',
    role: 'admin'
  }

  const defaultUser = {
    name: 'Demo Citizen',
    email: 'citizen@civicsense.org',
    password: 'citizen123',
    role: 'user'
  }

  if (isMongoConnected) {
    try {
      const adminExists = await User.findOne({ email: defaultAdmin.email })
      if (!adminExists) {
        const hashedPassword = await hashPassword(defaultAdmin.password)
        await User.create({ ...defaultAdmin, password: hashedPassword })
        console.log(`[MongoDB] Created default admin: ${defaultAdmin.email}`)
      }

      const userExists = await User.findOne({ email: defaultUser.email })
      if (!userExists) {
        const hashedPassword = await hashPassword(defaultUser.password)
        await User.create({ ...defaultUser, password: hashedPassword })
        console.log(`[MongoDB] Created default user: ${defaultUser.email}`)
      }
    } catch (err) {
      console.error('[MongoDB] Error seeding default accounts:', err.message)
    }
  }

  // Also ensure local fallback has default accounts
  const localUsers = await readJson(usersJsonPath, [])
  let updatedLocal = false

  for (const acc of [defaultAdmin, defaultUser]) {
    const existing = localUsers.find(u => u.email.toLowerCase() === acc.email.toLowerCase())
    if (!existing) {
      const hashedPassword = await hashPassword(acc.password)
      localUsers.push({
        id: `local-usr-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        name: acc.name,
        email: acc.email.toLowerCase(),
        password: hashedPassword,
        role: acc.role,
        createdAt: new Date().toISOString()
      })
      updatedLocal = true
    }
  }

  if (updatedLocal) {
    await writeJson(usersJsonPath, localUsers)
  }
}

// Migrate local complaints to MongoDB once connected
async function migrateComplaintsToMongo() {
  if (!isMongoConnected) return
  try {
    const localComplaints = await readJson(complaintsJsonPath, [])
    if (!localComplaints.length) return

    for (const item of localComplaints) {
      const exists = await Complaint.findOne({ id: item.id })
      if (!exists) {
        await Complaint.create({
          id: item.id,
          reporter: item.reporter || 'Citizen',
          description: item.description,
          category: item.category || 'Other',
          department: item.department || 'General Civic Services',
          landmark: item.landmark || '',
          lat: item.lat ?? null,
          lon: item.lon ?? null,
          photos: item.photos || [],
          createdAt: item.createdAt ? new Date(item.createdAt) : new Date(),
          status: item.status || 'Filed',
          history: item.history || [],
          adminNote: item.adminNote || '',
          duplicates: item.duplicates || [],
          score: item.score ?? 35,
          priority: item.priority || 'Low',
          factors: item.factors || {}
        })
      }
    }
    console.log(`[MongoDB] Verified/migrated ${localComplaints.length} complaints into MongoDB Atlas`)
  } catch (err) {
    console.error('[MongoDB] Migration note:', err.message)
  }
}

// Connect to MongoDB with auto-retry
export async function connectDB() {
  const uri = process.env.MONGODB_URI
  if (!uri) {
    console.warn('[MongoDB] No MONGODB_URI found in environment. Using local storage fallback.')
    await seedDefaults()
    return
  }

  try {
    console.log('[MongoDB] Attempting connection to MongoDB Atlas...')
    await mongoose.connect(uri, {
      dbName: 'civicsense',
      serverSelectionTimeoutMS: 5000
    })
    isMongoConnected = true
    console.log('[MongoDB] Connected successfully to MongoDB database: civicsense')
    await seedDefaults()
    await migrateComplaintsToMongo()
  } catch (error) {
    isMongoConnected = false
    console.warn('[MongoDB] Notice: Could not connect to MongoDB Atlas cluster directly.')
    console.warn('[MongoDB] Details:', error.message)
    console.warn('[MongoDB] Note: To allow direct Atlas access, ensure your IP address is whitelisted in MongoDB Atlas Network Access.')
    console.warn('[MongoDB] Active fallback: civic data and accounts are safely running via persistent local storage so all features remain functional!')
    await seedDefaults()

    // Retry connection in background every 60 seconds
    setInterval(async () => {
      if (!isMongoConnected) {
        try {
          await mongoose.connect(uri, { dbName: 'civicsense', serverSelectionTimeoutMS: 5000 })
          isMongoConnected = true
          console.log('[MongoDB] Background reconnect: successfully connected to MongoDB Atlas!')
          await seedDefaults()
          await migrateComplaintsToMongo()
        } catch {}
      }
    }, 60000).unref()
  }
}

// User operations
export async function findUserByEmail(email) {
  const normalized = email.toLowerCase().trim()
  if (isMongoConnected) {
    try {
      const user = await User.findOne({ email: normalized })
      if (user) return user
    } catch (err) {
      console.error('[DB] findUserByEmail error:', err.message)
    }
  }

  const localUsers = await readJson(usersJsonPath, [])
  return localUsers.find(u => u.email.toLowerCase() === normalized) || null
}

export async function findUserById(id) {
  if (isMongoConnected) {
    try {
      if (mongoose.Types.ObjectId.isValid(id)) {
        const user = await User.findById(id)
        if (user) return user
      }
    } catch (err) {
      console.error('[DB] findUserById error:', err.message)
    }
  }

  const localUsers = await readJson(usersJsonPath, [])
  return localUsers.find(u => u.id === id || u._id === id) || null
}

export async function createUser({ name, email, password, role }) {
  const normalizedEmail = email.toLowerCase().trim()
  const trimmedName = name.trim()
  const userRole = role === 'admin' ? 'admin' : 'user'

  if (isMongoConnected) {
    try {
      const user = await User.create({
        name: trimmedName,
        email: normalizedEmail,
        password,
        role: userRole
      })
      return user
    } catch (err) {
      console.error('[DB] createUser in Mongo failed, saving locally:', err.message)
    }
  }

  const localUsers = await readJson(usersJsonPath, [])
  const newUser = {
    id: `usr-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    name: trimmedName,
    email: normalizedEmail,
    password,
    role: userRole,
    createdAt: new Date().toISOString()
  }
  localUsers.push(newUser)
  await writeJson(usersJsonPath, localUsers)
  return newUser
}

// Complaints operations
export async function getComplaints({ user = null } = {}) {
  // If not logged in, return empty array so unauthenticated visitors cannot see any user's personal complaints
  if (!user) {
    return []
  }

  const isAdmin = user.role === 'admin'
  const isCitizen = user.role === 'user'

  if (isMongoConnected) {
    try {
      let query = {}
      if (isCitizen) {
        const orConditions = [{ userEmail: user.email.toLowerCase() }]
        if (user.id) {
          orConditions.push({ userId: user.id })
          if (mongoose.Types.ObjectId.isValid(user.id)) {
            orConditions.push({ userId: new mongoose.Types.ObjectId(user.id) })
          }
        }
        query = { $or: orConditions }
      }
      const items = await Complaint.find(query).sort({ createdAt: -1 }).lean()
      return items.map(formatComplaint)
    } catch (err) {
      console.error('[DB] getComplaints from Mongo failed, reading local:', err.message)
    }
  }

  const local = await readJson(complaintsJsonPath, [])
  if (isCitizen) {
    return local.filter(c =>
      (c.userId && (c.userId === user.id || c.userId === user._id)) ||
      (c.userEmail && c.userEmail.toLowerCase() === user.email.toLowerCase())
    )
  }
  if (isAdmin) {
    return local
  }
  return []
}

export async function createComplaint(complaintData) {
  if (isMongoConnected) {
    try {
      const doc = await Complaint.create(complaintData)
      // Also mirror to local JSON for backup
      const local = await readJson(complaintsJsonPath, [])
      local.unshift(formatComplaint(doc.toObject()))
      await writeJson(complaintsJsonPath, local)
      return formatComplaint(doc.toObject())
    } catch (err) {
      console.error('[DB] createComplaint in Mongo failed, saving locally:', err.message)
    }
  }

  const local = await readJson(complaintsJsonPath, [])
  local.unshift(complaintData)
  await writeJson(complaintsJsonPath, local)
  return complaintData
}

export async function updateComplaint(id, changes, by = 'Admin') {
  const permitted = ['category', 'department', 'priority', 'status', 'adminNote']
  const filtered = Object.fromEntries(Object.entries(changes).filter(([k]) => permitted.includes(k)))
  const now = new Date().toISOString()

  if (isMongoConnected) {
    try {
      const item = await Complaint.findOne({ id })
      if (item) {
        for (const [key, value] of Object.entries(filtered)) {
          if (item[key] !== value) {
            item.history.push({
              at: new Date(),
              action: `${key} changed: ${item[key]} → ${value}`,
              by
            })
            item[key] = value
          }
        }
        item.history.push({
          at: new Date(),
          action: 'Administrator review saved',
          by
        })
        await item.save()
        const formatted = formatComplaint(item.toObject())

        // Sync local
        const local = await readJson(complaintsJsonPath, [])
        const idx = local.findIndex(i => i.id === id)
        if (idx !== -1) {
          local[idx] = formatted
          await writeJson(complaintsJsonPath, local)
        }
        return formatted
      }
    } catch (err) {
      console.error('[DB] updateComplaint in Mongo failed, falling back:', err.message)
    }
  }

  const local = await readJson(complaintsJsonPath, [])
  const item = local.find(i => i.id === id)
  if (!item) return null

  for (const [key, value] of Object.entries(filtered)) {
    if (item[key] !== value) {
      item.history.push({
        at: now,
        action: `${key} changed: ${item[key]} → ${value}`,
        by
      })
      item[key] = value
    }
  }
  item.history.push({
    at: now,
    action: 'Administrator review saved',
    by
  })
  await writeJson(complaintsJsonPath, local)
  return item
}

function formatComplaint(item) {
  return {
    ...item,
    id: item.id,
    userId: item.userId ? item.userId.toString() : null,
    createdAt: item.createdAt instanceof Date ? item.createdAt.toISOString() : item.createdAt
  }
}

