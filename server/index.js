import cors from 'cors'
import express from 'express'
import multer from 'multer'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import crypto from 'node:crypto'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const dataDir = path.join(__dirname, 'data')
const uploadDir = path.join(__dirname, 'uploads')
const dbPath = path.join(dataDir, 'complaints.json')
await Promise.all([mkdir(dataDir, { recursive: true }), mkdir(uploadDir, { recursive: true })])

const app = express()
app.use(cors())
app.use(express.json())
app.use('/uploads', express.static(uploadDir))

const storage = multer.diskStorage({
  destination: (_, __, done) => done(null, uploadDir),
  filename: (_, file, done) => done(null, `${Date.now()}-${crypto.randomUUID()}${path.extname(file.originalname)}`)
})
const upload = multer({ storage, limits: { fileSize: 4 * 1024 * 1024, files: 3 }, fileFilter: (_, f, done) => done(null, f.mimetype.startsWith('image/')) })

async function load() { try { return JSON.parse(await readFile(dbPath, 'utf8')) } catch { return [] } }
async function save(items) { await writeFile(dbPath, JSON.stringify(items, null, 2)) }
const categories = ['Roads & Potholes', 'Sanitation & Garbage', 'Water Supply', 'Streetlights & Electricity', 'Drainage & Sewage', 'Public Safety', 'Other']
const departments = { 'Roads & Potholes': 'Roads & Maintenance', 'Sanitation & Garbage': 'Sanitation Department', 'Water Supply': 'Water Supply Department', 'Streetlights & Electricity': 'Electrical Department', 'Drainage & Sewage': 'Drainage Department', 'Public Safety': 'Public Safety / Ward Office', Other: 'General Civic Services' }
function classify(text, chosen) { if (chosen) return chosen; const t = text.toLowerCase(); const rules = [['Roads & Potholes', ['pothole', 'road', 'crater', 'footpath']], ['Sanitation & Garbage', ['garbage', 'trash', 'waste', 'rubbish']], ['Water Supply', ['water leak', 'leakage', 'pipe burst', 'no water']], ['Streetlights & Electricity', ['streetlight', 'street light', 'electricity', 'wire']], ['Drainage & Sewage', ['drain', 'sewage', 'manhole', 'flooding']], ['Public Safety', ['unsafe', 'accident', 'danger', 'exposed wire']]]; return rules.map(([category, words]) => [category, words.filter(w => t.includes(w)).length]).sort((a, b) => b[1] - a[1])[0][1] ? rules.map(([category, words]) => [category, words.filter(w => t.includes(w)).length]).sort((a, b) => b[1] - a[1])[0][0] : 'Other' }
function priority(text) { const t = text.toLowerCase(); const safety = /injur|accident|danger|exposed wire|open manhole|fire|collapse|school|hospital/.test(t) ? 90 : /risk|unsafe|dark|overflow/.test(t) ? 65 : 35; const severity = /large|major|severe|burst|broken|blocked|overflow|collapse|exposed/.test(t) ? 85 : /small|minor/.test(t) ? 25 : 55; const impact = /school|hospital|market|main road|bus stop|college|many people/.test(t) ? 80 : 50; const score = Math.round(.3 * safety + .25 * severity + .2 * impact + .1 * 10); return { score, priority: score >= 85 ? 'Critical' : score >= 70 ? 'High' : score >= 45 ? 'Medium' : 'Low', factors: { safety, severity, impact, waiting: 10, related: 0 } } }

app.get('/api/health', (_, res) => res.json({ ok: true }))
app.get('/api/complaints', async (_, res) => res.json(await load()))
app.post('/api/complaints', upload.array('photos', 3), async (req, res) => {
  const { description, reporter = 'Citizen', category: chosen = '', landmark = '', lat = '', lon = '' } = req.body
  if (!description || description.trim().length < 8) return res.status(400).json({ message: 'Please provide a more detailed description.' })
  const latitude = lat === '' ? null : Number(lat), longitude = lon === '' ? null : Number(lon)
  if ((latitude === null) !== (longitude === null) || (latitude !== null && (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180))) return res.status(400).json({ message: 'Please enter valid latitude and longitude.' })
  const category = classify(description, chosen); const analysis = priority(description); const now = new Date().toISOString()
  const item = { id: `CS-${crypto.randomUUID().slice(0, 4).toUpperCase()}${Date.now().toString().slice(-4)}`, reporter, description: description.trim(), category, department: departments[category], landmark, lat: latitude, lon: longitude, photos: (req.files || []).map(file => `/uploads/${file.filename}`), createdAt: now, status: 'Filed', history: [{ at: now, action: 'Complaint submitted', by: 'Citizen' }], adminNote: '', duplicates: [], ...analysis }
  const items = await load(); items.unshift(item); await save(items); res.status(201).json(item)
})
app.patch('/api/complaints/:id', async (req, res) => { const items = await load(); const item = items.find(i => i.id === req.params.id); if (!item) return res.status(404).json({ message: 'Complaint not found.' }); const permitted = ['category', 'department', 'priority', 'status', 'adminNote']; const changes = Object.fromEntries(Object.entries(req.body).filter(([k]) => permitted.includes(k))); const now = new Date().toISOString(); for (const [key, value] of Object.entries(changes)) if (item[key] !== value) { item.history.push({ at: now, action: `${key} changed: ${item[key]} → ${value}`, by: 'Admin' }); item[key] = value }; item.history.push({ at: now, action: 'Administrator review saved', by: 'Admin' }); await save(items); res.json(item) })
app.listen(process.env.PORT || 5000, () => console.log('CivicSense API listening on http://localhost:5000'))
