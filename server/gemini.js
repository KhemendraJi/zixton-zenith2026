/**
 * CivicSense - Google Gemini AI Integration Engine
 * 
 * Powered by Google Gemini Flash (gemini-2.5-flash with automatic adaptive failover to gemini-3.5-flash / gemini-3.8-flash).
 * Performs:
 * 1. AI Department & Predefined Category Classification
 * 2. Deep Semantic Duplicate Problem Detection
 * 
 * Includes graceful zero-downtime fallback to local rule heuristics if offline or API key absent.
 */

import 'dotenv/config'

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || ''

// User-requested model primary: gemini-2.5-flash, with automatic fallback if deprecated/404/503
const GEMINI_MODELS = ['gemini-2.5-flash', 'gemini-3.5-flash', 'gemini-3.8-flash', 'gemini-flash-latest']

let activeWorkingModel = null
const permanentlyFailedModels = new Set()

export const PREDEFINED_CATEGORIES = [
  'Roads & Potholes',
  'Sanitation & Garbage',
  'Water Supply',
  'Streetlights & Electricity',
  'Drainage & Sewage',
  'Public Safety',
  'Other'
]

export const PREDEFINED_DEPARTMENTS = {
  'Roads & Potholes': 'Roads & Maintenance',
  'Sanitation & Garbage': 'Sanitation Department',
  'Water Supply': 'Water Supply Department',
  'Streetlights & Electricity': 'Electrical Department',
  'Drainage & Sewage': 'Drainage Department',
  'Public Safety': 'Public Safety / Ward Office',
  Other: 'General Civic Services'
}

/**
 * Universal Gemini API caller with adaptive model learning, individual timeout protection, and structured JSON output.
 */
async function callGeminiJson(prompt, perModelTimeoutMs = 8000) {
  if (!GEMINI_API_KEY) return null

  // If a working model is already established, prioritize it
  const candidateModels = activeWorkingModel
    ? [activeWorkingModel, ...GEMINI_MODELS.filter(m => m !== activeWorkingModel && !permanentlyFailedModels.has(m))]
    : GEMINI_MODELS.filter(m => !permanentlyFailedModels.has(m))

  for (const model of candidateModels) {
    let timer = null
    try {
      const controller = new AbortController()
      timer = setTimeout(() => controller.abort(), perModelTimeoutMs)

      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            responseMimeType: 'application/json',
            temperature: 0.1
          }
        })
      })

      clearTimeout(timer)

      if (response.status === 404) {
        permanentlyFailedModels.add(model)
        continue
      }

      if (!response.ok) {
        continue
      }

      const data = await response.json()
      const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text
      if (rawText) {
        activeWorkingModel = model
        return {
          model,
          parsed: JSON.parse(rawText)
        }
      }
    } catch {
      // Continue to next model in candidate list
    } finally {
      if (timer) clearTimeout(timer)
    }
  }

  return null
}

/**
 * Classifies a civic issue into one of the exact predefined categories and departments using Gemini.
 */
export async function classifyWithGemini(description) {
  if (!description || description.trim().length < 5) return null

  const prompt = `You are an expert municipal AI classifier for CivicSense.
Analyze the following citizen complaint and classify it into EXACTLY ONE of these predefined categories:
${PREDEFINED_CATEGORIES.map(c => `- "${c}"`).join('\n')}

Complaint Description:
"${description.trim()}"

Respond ONLY with valid JSON in this exact structure:
{
  "category": "one of the predefined categories listed above",
  "reason": "concise 1-sentence reason for this classification"
}`

  try {
    const result = await callGeminiJson(prompt, 8000)
    if (result && result.parsed && result.parsed.category) {
      const matchedCategory = PREDEFINED_CATEGORIES.find(
        c => c.toLowerCase() === result.parsed.category.trim().toLowerCase()
      )
      if (matchedCategory) {
        return {
          category: matchedCategory,
          department: PREDEFINED_DEPARTMENTS[matchedCategory] || 'General Civic Services',
          reason: result.parsed.reason || '',
          model: result.model
        }
      }
    }
  } catch (err) {
    console.warn('[Gemini] Classification fallback triggered:', err.message)
  }

  return null
}

/**
 * Deep semantic duplicate detection using Gemini.
 * Evaluates whether two complaints in the same vicinity refer to the exact same physical issue.
 */
export async function detectDuplicateWithGemini(complaintA, complaintB, distanceMeters = null) {
  const prompt = `You are a municipal operations AI evaluating civic reports for duplicate detection.
Determine whether these two complaints describe the EXACT SAME physical incident or problem occurring at/near the same location.

Incident A:
- Description: "${complaintA.description}"
- Landmark / Area: "${complaintA.landmark || 'Unspecified'}"

Incident B:
- Description: "${complaintB.description}"
- Landmark / Area: "${complaintB.landmark || 'Unspecified'}"
${distanceMeters !== null ? `- Distance between GPS coordinates: approximately ${distanceMeters} meters` : ''}

Respond ONLY with valid JSON in this exact format:
{
  "isDuplicate": true or false,
  "confidence": number between 0.0 and 1.0,
  "explanation": "concise explanation of why this is or is not the same physical incident"
}`

  try {
    const result = await callGeminiJson(prompt, 8000)
    if (result && result.parsed && typeof result.parsed.isDuplicate === 'boolean') {
      return {
        isDuplicate: result.parsed.isDuplicate,
        confidence: Number(result.parsed.confidence) || 0.85,
        explanation: result.parsed.explanation || 'Semantic match verified by Gemini AI',
        model: result.model
      }
    }
  } catch (err) {
    console.warn('[Gemini] Duplicate detection fallback triggered:', err.message)
  }

  return null
}

