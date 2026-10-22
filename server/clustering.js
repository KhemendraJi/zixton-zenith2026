/**
 * CivicSense - Duplicate Complaint Detection & Spatial-Semantic Clustering Engine
 */

import { detectDuplicateWithGemini } from './gemini.js'

const EARTH_RADIUS_METERS = 6371000

const STOP_WORDS = new Set([
  'the', 'is', 'at', 'which', 'on', 'a', 'an', 'and', 'or', 'in', 'near', 'there',
  'from', 'to', 'my', 'our', 'your', 'his', 'her', 'this', 'that', 'these', 'those',
  'house', 'home', 'please', 'due', 'very', 'too', 'much', 'with', 'by', 'for',
  'of', 'about', 'around', 'area', 'colony', 'locality', 'ward', 'facing', 'having',
  'been', 'has', 'have', 'had', 'was', 'were', 'also', 'here', 'some', 'any', 'not',
  'me', 'someone', 'inside', 'coming', 'going', 'cut', 'off', 'too', 'many', 'very'
])

export const CIVIC_TOPIC_KEYWORDS = {
  fire: ['fire', 'flame', 'smoke', 'burning', 'caught fire', 'blaze'],
  pothole: ['pothole', 'potholes', 'crater', 'broken road', 'bad road', 'footpath', 'asphalt', 'road patch'],
  garbage: ['garbage', 'trash', 'waste', 'rubbish', 'dump', 'dustbin', 'litter', 'filth'],
  water: ['water leak', 'leakage', 'pipe burst', 'no water', 'water supply', 'drinking water', 'pipeline', 'pipe'],
  electricity: ['electricity', 'streetlight', 'street light', 'pole', 'wire', 'power cut', 'dark', 'transformer', 'power'],
  drainage: ['drain', 'drainage', 'sewage', 'sewer', 'manhole', 'gutter', 'overflow', 'flooding', 'blockage'],
  safety: ['harass', 'harassment', 'harrashing', 'eve teasing', 'theft', 'threat', 'stalking', 'danger', 'unsafe', 'robbery']
}

export function haversineDistance(lat1, lon1, lat2, lon2) {
  if (lat1 == null || lon1 == null || lat2 == null || lon2 == null) return null
  const l1 = Number(lat1)
  const n1 = Number(lon1)
  const l2 = Number(lat2)
  const n2 = Number(lon2)
  if (!Number.isFinite(l1) || !Number.isFinite(n1) || !Number.isFinite(l2) || !Number.isFinite(n2)) {
    return null
  }

  const toRad = deg => (deg * Math.PI) / 180
  const dLat = toRad(l2 - l1)
  const dLon = toRad(n2 - n1)
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(l1)) * Math.cos(toRad(l2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return Math.round(EARTH_RADIUS_METERS * c)
}

export function tokenize(text = '') {
  if (!text) return []
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .map(w => w.trim())
    .filter(w => w.length > 2 && !STOP_WORDS.has(w))
}

export function textJaccardSimilarity(text1, text2) {
  const tokens1 = new Set(tokenize(text1))
  const tokens2 = new Set(tokenize(text2))
  if (tokens1.size === 0 || tokens2.size === 0) return 0

  let intersection = 0
  tokens1.forEach(t => {
    if (tokens2.has(t)) intersection++
  })

  const union = tokens1.size + tokens2.size - intersection
  return union === 0 ? 0 : intersection / union
}

export function extractCivicTopics(text = '') {
  const lower = text.toLowerCase()
  const matched = []
  for (const [topic, words] of Object.entries(CIVIC_TOPIC_KEYWORDS)) {
    if (words.some(w => lower.includes(w))) {
      matched.push(topic)
    }
  }
  return matched
}

export function landmarkSimilarity(lm1 = '', lm2 = '') {
  const l1 = (lm1 || '').toLowerCase().trim()
  const l2 = (lm2 || '').toLowerCase().trim()
  if (!l1 || !l2) return 0
  if (l1 === l2) return 1.0
  if (l1.includes(l2) || l2.includes(l1)) return 0.85

  const t1 = new Set(tokenize(l1))
  const t2 = new Set(tokenize(l2))
  let intersection = 0
  t1.forEach(token => {
    if (t2.has(token)) intersection++
  })
  const union = t1.size + t2.size - intersection
  return union === 0 ? 0 : intersection / union
}

/**
 * Accurately determines if two complaints are duplicates of the same physical incident.
 */
export function compareComplaints(c1, c2) {
  if (c1.id === c2.id) {
    return { isMatch: false, reason: 'same_complaint', score: 1.0 }
  }

  const distance = haversineDistance(c1.lat, c1.lon, c2.lat, c2.lon)

  // 1. HARD SPATIAL CONSTRAINT: If both have GPS coordinates and distance > 400m, they are in DIFFERENT locations
  if (distance !== null && distance > 400) {
    return { isMatch: false, reason: 'too_far_apart', distanceMeters: distance, score: 0 }
  }

  const topics1 = extractCivicTopics(c1.description)
  const topics2 = extractCivicTopics(c2.description)
  const commonTopics = topics1.filter(t => topics2.includes(t))
  const hasCommonTopic = commonTopics.length > 0

  // If both have extracted topics but they conflict (e.g. fire vs electricity), reject
  if (topics1.length > 0 && topics2.length > 0 && !hasCommonTopic) {
    return { isMatch: false, reason: 'conflicting_civic_topics', score: 0 }
  }

  const cat1 = c1.category || ''
  const cat2 = c2.category || ''
  const sameSpecificCategory = cat1 !== 'Other' && cat2 !== 'Other' && cat1 === cat2

  // Different specific categories (e.g. Roads vs Sanitation) without common topic cannot be duplicates
  if (cat1 !== 'Other' && cat2 !== 'Other' && cat1 !== cat2 && !hasCommonTopic) {
    return { isMatch: false, reason: 'different_categories', score: 0 }
  }

  const textSim = textJaccardSimilarity(c1.description, c2.description)
  const lm1 = (c1.landmark || '').trim()
  const lm2 = (c2.landmark || '').trim()
  const hasBothLandmarks = lm1.length > 0 && lm2.length > 0
  const lmSim = landmarkSimilarity(lm1, lm2)

  // Semantic topic alignment requirement:
  // Must have: a common topic, or same specific category with text similarity >= 0.15, or high text similarity >= 0.35
  const isSemanticMatch = hasCommonTopic || (sameSpecificCategory && (textSim >= 0.15 || lmSim >= 0.5)) || textSim >= 0.35

  if (!isSemanticMatch) {
    return { isMatch: false, reason: 'semantic_mismatch', score: 0 }
  }

  // If both specified distinct landmarks (e.g. "hostel 7" vs "dal bazar"), reject unless distance is < 30m
  if (hasBothLandmarks && lmSim === 0 && (distance === null || distance > 30)) {
    return { isMatch: false, reason: 'distinct_landmarks', score: 0 }
  }

  // CASE A: Both have GPS coordinates and are within 150 meters
  if (distance !== null && distance <= 150) {
    return {
      isMatch: true,
      score: Math.min(0.99, 0.75 + (1 - distance / 150) * 0.25),
      distanceMeters: distance,
      reason: `GPS proximity (${distance}m) with matching issue: ${commonTopics.join(', ') || cat1}`
    }
  }

  // CASE B: GPS coordinates within 151m - 350m
  if (distance !== null && distance <= 350) {
    if (hasCommonTopic || (sameSpecificCategory && textSim >= 0.25)) {
      return {
        isMatch: true,
        score: 0.72,
        distanceMeters: distance,
        reason: `Spatial proximity (${distance}m) with matching issue description`
      }
    }
  }

  // CASE C: One or both lack GPS, but landmarks match
  if (distance === null && hasBothLandmarks && lmSim >= 0.5) {
    return {
      isMatch: true,
      score: 0.8,
      distanceMeters: null,
      reason: `Matching landmark ("${lm1}") with aligned category/description`
    }
  }

  // CASE D: Pure text similarity >= 65% when distance is null or within 300m
  if (textSim >= 0.65 && (distance === null || distance <= 300)) {
    return {
      isMatch: true,
      score: 0.85,
      distanceMeters: distance,
      reason: `High textual similarity (${Math.round(textSim * 100)}% match)`
    }
  }

  return { isMatch: false, distanceMeters: distance, score: 0 }
}

/**
 * AI-Enhanced Complaint Duplicate Comparator.
 * Evaluates candidate pairs within proximity using Google Gemini Flash, with
 * zero-downtime automatic fallback to deterministic rule comparison.
 */
export async function compareComplaintsWithAI(c1, c2) {
  if (c1.id === c2.id) {
    return { isMatch: false, reason: 'same_complaint', score: 1.0 }
  }

  const distance = haversineDistance(c1.lat, c1.lon, c2.lat, c2.lon)
  if (distance !== null && distance > 400) {
    return { isMatch: false, reason: 'too_far_apart', distanceMeters: distance, score: 0 }
  }

  const lmSim = landmarkSimilarity(c1.landmark, c2.landmark)
  const isCandidateVicinity = (distance !== null && distance <= 350) || (distance === null && lmSim >= 0.4)

  if (isCandidateVicinity) {
    try {
      const aiResult = await detectDuplicateWithGemini(c1, c2, distance)
      if (aiResult && typeof aiResult.isDuplicate === 'boolean') {
        if (aiResult.isDuplicate) {
          return {
            isMatch: true,
            score: aiResult.confidence,
            distanceMeters: distance,
            reason: `${aiResult.explanation} (Verified by ${aiResult.model})`
          }
        } else if (aiResult.confidence >= 0.85) {
          return {
            isMatch: false,
            score: 0,
            distanceMeters: distance,
            reason: aiResult.explanation
          }
        }
      }
    } catch {
      // Fall through to deterministic comparison
    }
  }

  return compareComplaints(c1, c2)
}

/**
 * Clusters an array of complaints using graph-based connected components.
 */
export function clusterComplaints(complaints = []) {
  if (!complaints || complaints.length === 0) {
    return { clusters: [], annotatedComplaints: [] }
  }

  const n = complaints.length
  const parent = Array.from({ length: n }, (_, i) => i)

  function find(i) {
    if (parent[i] === i) return i
    parent[i] = find(parent[i])
    return parent[i]
  }

  function union(i, j) {
    const rootI = find(i)
    const rootJ = find(j)
    if (rootI !== rootJ) {
      parent[rootI] = rootJ
    }
  }

  const pairInfo = new Map()

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const cmp = compareComplaints(complaints[i], complaints[j])
      if (cmp.isMatch) {
        union(i, j)
        pairInfo.set(`${complaints[i].id}:${complaints[j].id}`, cmp)
        pairInfo.set(`${complaints[j].id}:${complaints[i].id}`, cmp)
      }
    }
  }

  const groups = new Map()
  for (let i = 0; i < n; i++) {
    const root = find(i)
    if (!groups.has(root)) groups.set(root, [])
    groups.get(root).push(complaints[i])
  }

  const clusters = []
  const complaintLookup = new Map()

  for (const [, members] of groups.entries()) {
    // Sort members chronologically: earliest filed is master
    members.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
    const master = members[0]
    const hasDuplicates = members.length > 1
    const clusterId = hasDuplicates ? `CLUSTER-${master.id}` : `SOLO-${master.id}`

    const located = members.filter(m => m.lat != null && m.lon != null)
    const centerLat = located.length ? located.reduce((s, m) => s + Number(m.lat), 0) / located.length : null
    const centerLon = located.length ? located.reduce((s, m) => s + Number(m.lon), 0) / located.length : null

    const allClosed = members.every(m => m.status === 'Closed')
    const hasInProgress = members.some(m => ['In Progress', 'Assigned', 'Resolved - Awaiting Citizen'].includes(m.status))
    const clusterStatus = allClosed ? 'Closed' : hasInProgress ? 'In Progress' : master.status

    if (hasDuplicates) {
      clusters.push({
        clusterId,
        title: `${master.category !== 'Other' ? master.category : (extractCivicTopics(master.description)[0] ? extractCivicTopics(master.description)[0].toUpperCase() : 'Civic Issue')} near ${master.landmark || 'Identified Ward'}`,
        category: master.category,
        department: master.department,
        status: clusterStatus,
        masterId: master.id,
        masterComplaint: master,
        count: members.length,
        center: centerLat ? { lat: centerLat, lon: centerLon } : null,
        members: members.map(m => ({
          id: m.id,
          reporter: m.reporter,
          userEmail: m.userEmail,
          createdAt: m.createdAt,
          description: m.description,
          landmark: m.landmark,
          status: m.status,
          priority: m.priority,
          photos: m.photos || [],
          distanceFromMaster: haversineDistance(master.lat, master.lon, m.lat, m.lon)
        }))
      })
    }

    members.forEach((m, idx) => {
      const isMaster = idx === 0
      const isDuplicate = !isMaster && hasDuplicates
      const otherMembers = members.filter(other => other.id !== m.id)

      complaintLookup.set(m.id, {
        ...m,
        clusterId,
        isDuplicate,
        isClusterMaster: isMaster && hasDuplicates,
        clusterCount: members.length,
        duplicates: otherMembers.map(o => o.id),
        clusterMembers: otherMembers.map(o => ({
          id: o.id,
          reporter: o.reporter,
          userEmail: o.userEmail,
          createdAt: o.createdAt,
          description: o.description,
          landmark: o.landmark,
          status: o.status,
          priority: o.priority,
          photos: o.photos || [],
          distanceMeters: haversineDistance(m.lat, m.lon, o.lat, o.lon),
          matchReason: pairInfo.get(`${m.id}:${o.id}`)?.reason || 'Identified as duplicate civic issue'
        }))
      })
    })
  }

  clusters.sort((a, b) => b.count - a.count)
  const annotatedComplaints = complaints.map(c => complaintLookup.get(c.id) || c)

  return { clusters, annotatedComplaints }
}

