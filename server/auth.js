import jwt from 'jsonwebtoken'
import bcrypt from 'bcryptjs'

const JWT_SECRET = process.env.JWT_SECRET || 'civicsense-default-secret-key-zenith2026'

export async function hashPassword(plainPassword) {
  const salt = await bcrypt.genSalt(10)
  return bcrypt.hash(plainPassword, salt)
}

export async function comparePassword(plainPassword, hashedPassword) {
  return bcrypt.compare(plainPassword, hashedPassword)
}

export function generateToken(user) {
  return jwt.sign(
    {
      id: user._id ? user._id.toString() : user.id,
      email: user.email,
      name: user.name,
      role: user.role
    },
    JWT_SECRET,
    { expiresIn: '7d' }
  )
}

export function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET)
  } catch {
    return null
  }
}

export function authenticate(req, _res, next) {
  const authHeader = req.headers.authorization
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.split(' ')[1]
    const decoded = verifyToken(token)
    if (decoded) {
      req.user = decoded
    }
  }
  next()
}

export function requireAuth(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ message: 'Authentication required. Please log in.' })
  }
  next()
}

export function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ message: 'Access denied. Administrator privileges required.' })
  }
  next()
}

