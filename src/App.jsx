import { useEffect, useMemo, useState } from 'react'

const API = '/api/complaints'
const AUTH_API = '/api/auth'
const categories = [
  'Roads & Potholes',
  'Sanitation & Garbage',
  'Water Supply',
  'Streetlights & Electricity',
  'Drainage & Sewage',
  'Public Safety',
  'Other'
]
const departments = [
  'Roads & Maintenance',
  'Sanitation Department',
  'Water Supply Department',
  'Electrical Department',
  'Drainage Department',
  'Public Safety / Ward Office',
  'General Civic Services'
]
const statusOptions = [
  'Filed',
  'Assigned',
  'In Progress',
  'Resolved - Awaiting Citizen',
  'Reopened',
  'Closed'
]

function getAuthToken() {
  return localStorage.getItem('civicsense_token') || ''
}

function getAuthHeaders(isJson = false) {
  const token = getAuthToken()
  const headers = {}
  if (token) headers['Authorization'] = `Bearer ${token}`
  if (isJson) headers['Content-Type'] = 'application/json'
  return headers
}

async function readApiResponse(response) {
  const text = await response.text()
  let body
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    throw new Error(`The API returned an invalid response (HTTP ${response.status}). Check that the backend is running.`)
  }
  if (!response.ok) throw new Error(body?.message || `The request failed (HTTP ${response.status}).`)
  if (body === null) throw new Error('The API returned an empty response. Check that the backend is running.')
  return body
}

const priorityTone = {
  Critical: 'bg-red-100 text-red-700 border-red-200',
  High: 'bg-orange-100 text-orange-700 border-orange-200',
  Medium: 'bg-amber-100 text-amber-700 border-amber-200',
  Low: 'bg-emerald-100 text-emerald-700 border-emerald-200'
}

const statusTone = {
  Filed: 'bg-blue-50 text-blue-700 border-blue-200',
  Assigned: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  'In Progress': 'bg-amber-50 text-amber-700 border-amber-200',
  'Resolved - Awaiting Citizen': 'bg-purple-100 text-purple-800 border-purple-300 font-extrabold animate-pulse',
  Reopened: 'bg-rose-100 text-rose-800 border-rose-300 font-bold',
  Closed: 'bg-emerald-50 text-emerald-700 border-emerald-200'
}

const formatDate = value =>
  new Date(value).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })

const location = item =>
  item.lat == null ? 'Location not provided' : `${Number(item.lat).toFixed(5)}, ${Number(item.lon).toFixed(5)}`

function App() {
  const [view, setView] = useState('citizen')
  const [complaints, setComplaints] = useState([])
  const [notice, setNotice] = useState('')
  const [loading, setLoading] = useState(true)
  const [selectedComplaint, setSelectedComplaint] = useState(null)
  const [user, setUser] = useState(() => {
    try {
      const stored = localStorage.getItem('civicsense_user')
      return stored ? JSON.parse(stored) : null
    } catch {
      return null
    }
  })
  const [showAuthModal, setShowAuthModal] = useState(false)
  const [dbStatus, setDbStatus] = useState(null)

  // Verify stored user session on mount
  useEffect(() => {
    const token = getAuthToken()
    if (token) {
      fetch(`${AUTH_API}/me`, { headers: { Authorization: `Bearer ${token}` } })
        .then(readApiResponse)
        .then(data => {
          if (data?.user) {
            setUser(data.user)
            localStorage.setItem('civicsense_user', JSON.stringify(data.user))
          }
        })
        .catch(() => {
          localStorage.removeItem('civicsense_token')
          localStorage.removeItem('civicsense_user')
          setUser(null)
        })
    }

    fetch('/api/health')
      .then(r => r.json())
      .then(status => setDbStatus(status))
      .catch(() => {})
  }, [])

  const refreshComplaints = async () => {
    setLoading(true)
    try {
      if (!user && view !== 'admin') {
        setComplaints([])
        setLoading(false)
        return
      }

      const url = view === 'admin' ? `${API}?all=true` : API
      const response = await fetch(url, { headers: getAuthHeaders() })
      const items = await readApiResponse(response)
      if (!Array.isArray(items)) throw new Error('The API returned an unexpected complaints response.')
      setComplaints(items)

      // Sync selected complaint if open
      if (selectedComplaint) {
        const found = items.find(i => i.id === selectedComplaint.id)
        if (found) setSelectedComplaint(found)
      }
    } catch (error) {
      setNotice(error.message || 'Could not reach the API. Start the backend with npm run dev.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    refreshComplaints()
  }, [view, user])

  useEffect(() => {
    if (!notice) return
    const timer = setTimeout(() => setNotice(''), 4500)
    return () => clearTimeout(timer)
  }, [notice])

  const handleLoginSuccess = (authUser, token) => {
    localStorage.setItem('civicsense_token', token)
    localStorage.setItem('civicsense_user', JSON.stringify(authUser))
    setUser(authUser)
    setShowAuthModal(false)
    setNotice(`Welcome back, ${authUser.name}!`)
    if (authUser.role === 'admin') {
      setView('admin')
    } else {
      setView('citizen')
    }
  }

  const handleLogout = () => {
    localStorage.removeItem('civicsense_token')
    localStorage.removeItem('civicsense_user')
    setUser(null)
    setSelectedComplaint(null)
    setView('citizen')
    setNotice('Logged out successfully.')
  }

  const switchView = targetView => {
    if (targetView === 'admin' && (!user || user.role !== 'admin')) {
      setNotice('Administrator login required to access the Admin dashboard.')
      setShowAuthModal(true)
      return
    }
    setView(targetView)
  }

  // Citizen Accept or Reject resolution action
  const handleFeedback = async (id, action, reason = '') => {
    try {
      const response = await fetch(`${API}/${id}`, {
        method: 'PATCH',
        headers: getAuthHeaders(true),
        body: JSON.stringify({ action, reason })
      })
      const updated = await readApiResponse(response)
      setComplaints(prev => prev.map(c => (c.id === id ? updated : c)))
      if (selectedComplaint && selectedComplaint.id === id) {
        setSelectedComplaint(updated)
      }
      setNotice(
        action === 'accept'
          ? `Resolution accepted! Complaint ${id} is now Closed.`
          : `Resolution rejected. Complaint ${id} has been Reopened.`
      )
    } catch (error) {
      setNotice(error.message || 'Action failed.')
    }
  }

  // Admin or Citizen Delete complaint
  const handleDelete = async id => {
    if (!window.confirm(`Are you sure you want to delete complaint ${id}? This cannot be undone.`)) {
      return
    }
    try {
      const response = await fetch(`${API}/${id}`, {
        method: 'DELETE',
        headers: getAuthHeaders()
      })
      await readApiResponse(response)
      setComplaints(prev => prev.filter(c => c.id !== id))
      if (selectedComplaint && selectedComplaint.id === id) {
        setSelectedComplaint(null)
      }
      setNotice(`Complaint ${id} was deleted successfully.`)
    } catch (error) {
      setNotice(error.message || 'Deletion failed.')
    }
  }

  // Admin patch update
  const handleSaveReview = async (id, changes) => {
    try {
      const response = await fetch(`${API}/${id}`, {
        method: 'PATCH',
        headers: getAuthHeaders(true),
        body: JSON.stringify(changes)
      })
      const updated = await readApiResponse(response)
      setComplaints(prev => prev.map(c => (c.id === id ? updated : c)))
      if (selectedComplaint && selectedComplaint.id === id) {
        setSelectedComplaint(updated)
      }
      setNotice(`Review saved for ${id}.`)
    } catch (error) {
      setNotice(error.message || 'Update failed.')
    }
  }

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 flex min-h-[70px] flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-5 py-3 md:px-[5vw]">
        <div className="flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-blue-600 to-teal-400 text-xl text-white shadow-sm">
            ✦
          </div>
          <div>
            <div className="text-xl font-black tracking-tight">
              CivicSense
              <span className="mt-0.5 block text-[10px] font-bold tracking-widest text-slate-500">
                AI CIVIC INTELLIGENCE
              </span>
            </div>
          </div>
          {dbStatus && (
            <span
              title={
                dbStatus.mongoConnected
                  ? 'Connected to MongoDB Atlas'
                  : 'Running via local persistent storage (MongoDB Atlas IP access whitelist pending)'
              }
              className={`hidden sm:inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-semibold border ${
                dbStatus.mongoConnected
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                  : 'border-amber-200 bg-amber-50 text-amber-700'
              }`}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  dbStatus.mongoConnected ? 'bg-emerald-500' : 'bg-amber-500'
                }`}
              />
              {dbStatus.mongoConnected ? 'MongoDB Atlas' : 'Local DB / Fallback'}
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <nav className="rounded-xl bg-slate-100 p-1 text-sm font-bold">
            <button
              onClick={() => switchView('citizen')}
              className={`rounded-lg px-3 py-2 transition ${
                view === 'citizen' ? 'bg-white text-civic shadow-sm' : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              Citizen portal
            </button>
            <button
              onClick={() => switchView('admin')}
              className={`rounded-lg px-3 py-2 transition ${
                view === 'admin' ? 'bg-white text-civic shadow-sm' : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              Admin dashboard
            </button>
          </nav>

          {user ? (
            <div className="flex items-center gap-2">
              <div className="hidden text-right md:block">
                <div className="text-xs font-bold text-slate-800">{user.name}</div>
                <div className="text-[11px] text-slate-500">{user.email}</div>
              </div>
              <span
                className={`pill ${
                  user.role === 'admin' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'
                }`}
              >
                {user.role === 'admin' ? '🛡 Admin' : '👤 Citizen'}
              </span>
              <button onClick={handleLogout} className="btn-secondary py-1.5 px-3 text-xs">
                Log out
              </button>
            </div>
          ) : (
            <button
              onClick={() => setShowAuthModal(true)}
              className="btn-primary flex items-center gap-1.5 py-2 px-4 text-xs shadow-sm"
            >
              <span>🔑</span> Sign In / Sign Up
            </button>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-7 md:px-6">
        {view === 'citizen' ? (
          <Citizen
            user={user}
            complaints={complaints}
            onOpenAuth={() => setShowAuthModal(true)}
            onSelect={item => setSelectedComplaint(item)}
            onFeedback={handleFeedback}
            onDelete={handleDelete}
            onCreated={item => {
              setComplaints(current => [item, ...current])
              setNotice(`Complaint ${item.id} submitted successfully!`)
            }}
          />
        ) : (
          <Admin
            user={user}
            complaints={complaints}
            onSelect={item => setSelectedComplaint(item)}
            onSave={handleSaveReview}
            onDelete={handleDelete}
            notify={setNotice}
          />
        )}
        {loading && <p className="mt-4 text-center text-sm text-slate-500">Loading complaints…</p>}
      </main>

      {notice && (
        <div className="fixed bottom-5 right-5 z-50 max-w-sm rounded-xl bg-slate-900 px-4 py-3 text-sm text-white shadow-xl animate-fade-in">
          {notice}
        </div>
      )}

      {showAuthModal && (
        <AuthModal
          onClose={() => setShowAuthModal(false)}
          onSuccess={handleLoginSuccess}
        />
      )}

      {selectedComplaint && (
        <ComplaintDetailModal
          item={selectedComplaint}
          user={user}
          onClose={() => setSelectedComplaint(null)}
          onFeedback={handleFeedback}
          onSaveReview={handleSaveReview}
          onDelete={handleDelete}
        />
      )}
    </div>
  )
}

function AuthModal({ onClose, onSuccess }) {
  const [mode, setMode] = useState('login')
  const [role, setRole] = useState('user')
  const [form, setForm] = useState({ name: '', email: '', password: '' })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleChange = e => {
    setForm(prev => ({ ...prev, [e.target.name]: e.target.value }))
    setError('')
  }

  const handleSubmit = async e => {
    e.preventDefault()
    setLoading(true)
    setError('')

    try {
      const endpoint = mode === 'login' ? `${AUTH_API}/login` : `${AUTH_API}/signup`
      const body =
        mode === 'login'
          ? { email: form.email, password: form.password }
          : { name: form.name, email: form.email, password: form.password, role }

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      })

      const data = await readApiResponse(response)
      onSuccess(data.user, data.token)
    } catch (err) {
      setError(err.message || 'Authentication failed. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const fillDemo = demoRole => {
    if (demoRole === 'admin') {
      setMode('login')
      setForm({ name: '', email: 'admin@civicsense.org', password: 'admin123' })
    } else {
      setMode('login')
      setForm({ name: '', email: 'citizen@civicsense.org', password: 'citizen123' })
    }
    setError('')
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl border border-slate-100">
        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
          <div>
            <h2 className="text-xl font-black text-slate-800">
              {mode === 'login' ? 'Sign In to CivicSense' : 'Create CivicSense Account'}
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Access citizen issue reporting or administrator operations
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition"
          >
            ✕
          </button>
        </div>

        <div className="mt-4 flex rounded-xl bg-slate-100 p-1 text-xs font-bold">
          <button
            type="button"
            onClick={() => {
              setMode('login')
              setError('')
            }}
            className={`flex-1 rounded-lg py-2 transition ${
              mode === 'login' ? 'bg-white text-civic shadow-sm' : 'text-slate-500'
            }`}
          >
            Sign In
          </button>
          <button
            type="button"
            onClick={() => {
              setMode('signup')
              setError('')
            }}
            className={`flex-1 rounded-lg py-2 transition ${
              mode === 'signup' ? 'bg-white text-civic shadow-sm' : 'text-slate-500'
            }`}
          >
            Sign Up (New Account)
          </button>
        </div>

        {error && (
          <div className="mt-3 rounded-lg bg-red-50 p-3 text-xs font-medium text-red-700 border border-red-200">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="mt-4 space-y-3.5">
          {mode === 'signup' && (
            <>
              <div>
                <label className="label">Account Role *</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setRole('user')}
                    className={`rounded-lg border p-2.5 text-xs font-bold transition flex items-center justify-center gap-1.5 ${
                      role === 'user'
                        ? 'border-civic bg-blue-50 text-civic'
                        : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    <span>👤</span> Citizen / User
                  </button>
                  <button
                    type="button"
                    onClick={() => setRole('admin')}
                    className={`rounded-lg border p-2.5 text-xs font-bold transition flex items-center justify-center gap-1.5 ${
                      role === 'admin'
                        ? 'border-purple-600 bg-purple-50 text-purple-700'
                        : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    <span>🛡</span> Administrator
                  </button>
                </div>
              </div>

              <div>
                <label className="label">Full Name *</label>
                <input
                  required
                  name="name"
                  value={form.name}
                  onChange={handleChange}
                  className="field"
                  placeholder={role === 'admin' ? 'e.g. Ward Officer' : 'e.g. Aditi Sharma'}
                />
              </div>
            </>
          )}

          <div>
            <label className="label">Email Address *</label>
            <input
              required
              type="email"
              name="email"
              value={form.email}
              onChange={handleChange}
              className="field"
              placeholder="name@example.com"
            />
          </div>

          <div>
            <label className="label">Password *</label>
            <input
              required
              type="password"
              name="password"
              value={form.password}
              onChange={handleChange}
              className="field"
              placeholder="At least 6 characters"
              minLength={6}
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="btn-primary w-full mt-2 py-2.5 text-sm disabled:opacity-60"
          >
            {loading
              ? 'Processing…'
              : mode === 'login'
              ? 'Sign In →'
              : `Create ${role === 'admin' ? 'Admin' : 'Citizen'} Account →`}
          </button>
        </form>

        <div className="mt-5 border-t border-slate-100 pt-4">
          <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2">
            Quick Demo Auto-Fill:
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => fillDemo('citizen')}
              className="btn-secondary flex-1 py-1.5 text-xs"
            >
              👤 Citizen Demo
            </button>
            <button
              type="button"
              onClick={() => fillDemo('admin')}
              className="btn-secondary flex-1 py-1.5 text-xs"
            >
              🛡 Admin Demo
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function Citizen({ user, complaints, onCreated, onOpenAuth, onSelect, onFeedback, onDelete }) {
  const [form, setForm] = useState({
    reporter: user?.name || '',
    description: '',
    category: '',
    landmark: '',
    lat: '',
    lon: ''
  })
  const [photos, setPhotos] = useState([])
  const [submitting, setSubmitting] = useState(false)
  const [locationStatus, setLocationStatus] = useState('Use GPS or enter coordinates manually.')

  useEffect(() => {
    if (user?.name) {
      setForm(prev => ({ ...prev, reporter: user.name }))
    }
  }, [user])

  const set = event => setForm(current => ({ ...current, [event.target.name]: event.target.value }))

  const detectLocation = () => {
    if (!navigator.geolocation) return setLocationStatus('Geolocation is not supported by this browser.')
    setLocationStatus('Requesting location permission…')
    navigator.geolocation.getCurrentPosition(
      pos => {
        setForm(current => ({
          ...current,
          lat: pos.coords.latitude.toFixed(6),
          lon: pos.coords.longitude.toFixed(6)
        }))
        setLocationStatus(`Location captured (±${Math.round(pos.coords.accuracy)} m).`)
      },
      () => setLocationStatus('Could not detect location. Try HTTPS/localhost or enter coordinates manually.'),
      { enableHighAccuracy: true, timeout: 10000 }
    )
  }

  const submit = async event => {
    event.preventDefault()
    if (!user) {
      onOpenAuth()
      return
    }

    setSubmitting(true)
    try {
      const data = new FormData()
      Object.entries(form).forEach(([key, value]) => data.append(key, value))
      photos.forEach(photo => data.append('photos', photo))

      const response = await fetch(API, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: data
      })
      const body = await readApiResponse(response)
      onCreated(body)
      setForm({
        reporter: user?.name || '',
        description: '',
        category: '',
        landmark: '',
        lat: '',
        lon: ''
      })
      setPhotos([])
      setLocationStatus('Use GPS or enter coordinates manually.')
    } catch (error) {
      alert(error.message || 'Unable to submit complaint.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      <Hero
        eyebrow="Your voice. Better neighbourhoods."
        title="Report an issue. Track the fix."
        text="Submit a civic problem and CivicSense will suggest its category, responsible department, and priority."
        badge={user ? `👤 ${user.name}` : undefined}
      />

      <div className="grid items-start gap-5 lg:grid-cols-[1.1fr_.9fr]">
        <section className="panel">
          <div className="flex items-center justify-between mb-1">
            <h2 className="text-lg font-extrabold text-slate-800">Report a civic issue</h2>
            {user ? (
              <span className="text-xs text-slate-500 font-medium">
                Signed in as <b className="text-slate-800">{user.name}</b> ({user.email})
              </span>
            ) : (
              <span className="pill bg-amber-50 text-amber-700 border border-amber-200">
                🔒 Sign In Required
              </span>
            )}
          </div>
          <p className="mb-5 text-sm text-slate-500">
            {user
              ? 'Your report is saved to your account and tracked by municipal authorities.'
              : 'You must log in to submit civic issues and track their resolution.'}
          </p>

          {!user ? (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50/70 p-8 text-center">
              <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-civic text-xl text-white shadow-sm">
                🔑
              </div>
              <h3 className="text-base font-extrabold text-slate-800">Please sign in to report a problem</h3>
              <p className="mx-auto mt-1 max-w-sm text-xs leading-5 text-slate-500">
                CivicSense ties reports to verified user accounts so officers can coordinate and you can track real-time resolution updates.
              </p>
              <button
                type="button"
                onClick={onOpenAuth}
                className="btn-primary mt-4 inline-flex items-center gap-2 py-2.5 px-6 text-sm shadow-sm"
              >
                <span>🔑</span> Sign In / Sign Up to Report →
              </button>
            </div>
          ) : (
            <form onSubmit={submit} className="space-y-4">
              <Input
                label="Your name"
                name="reporter"
                value={form.reporter}
                onChange={set}
                placeholder="e.g. Aditi Sharma"
                required
              />
              <label>
                <span className="label">Describe the problem *</span>
                <textarea
                  required
                  minLength={8}
                  name="description"
                  value={form.description}
                  onChange={set}
                  className="field min-h-28 resize-y"
                  placeholder="e.g. A large pothole near the main gate is causing bikes to swerve…"
                />
                <span className="mt-1 block text-xs text-slate-500">
                  Mention the issue and nearby landmark for a stronger classification.
                </span>
              </label>
              <div className="grid gap-4 sm:grid-cols-2">
                <label>
                  <span className="label">Category (optional)</span>
                  <select name="category" value={form.category} onChange={set} className="field">
                    <option value="">Let CivicSense detect it</option>
                    {categories.map(item => (
                      <option key={item}>{item}</option>
                    ))}
                  </select>
                </label>
                <Input
                  label="Area / landmark"
                  name="landmark"
                  value={form.landmark}
                  onChange={set}
                  placeholder="e.g. College main gate"
                />
              </div>
              <label>
                <span className="label">Photographs (optional)</span>
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={event => setPhotos(Array.from(event.target.files).slice(0, 3))}
                  className="block w-full rounded-xl border-2 border-dashed border-slate-200 bg-slate-50 p-4 text-sm"
                />
                <span className="mt-1 block text-xs text-slate-500">Up to 3 image files, 4 MB each.</span>
              </label>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Input
                    label="Latitude"
                    type="number"
                    name="lat"
                    value={form.lat}
                    onChange={set}
                    placeholder="23.2599"
                    step="any"
                  />
                  <Input
                    label="Longitude"
                    type="number"
                    name="lon"
                    value={form.lon}
                    onChange={set}
                    placeholder="77.4126"
                    step="any"
                  />
                </div>
                <button type="button" onClick={detectLocation} className="btn-secondary mt-1">
                  ◎ Detect my location
                </button>
                <p className="mt-2 text-xs text-slate-500">{locationStatus}</p>
              </div>
              <button disabled={submitting} className="btn-primary w-full disabled:opacity-60">
                {submitting ? 'Submitting…' : 'Analyse & submit complaint →'}
              </button>
            </form>
          )}
        </section>

        <section className="panel">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-lg font-extrabold text-slate-800">Your submitted issues</h2>
              <span className="text-xs text-slate-400">Click any issue to view full history & actions</span>
            </div>
            <span className="pill bg-slate-100 text-slate-600">
              {user ? `${complaints.length} reports` : 'Login required'}
            </span>
          </div>
          <p className="mb-5 text-sm text-slate-500">
            {user
              ? 'Issues you have submitted. Only visible to you and administrators.'
              : 'Sign in to access your submitted issues and monitor their progress.'}
          </p>

          {!user ? (
            <div className="rounded-xl bg-slate-50 p-8 text-center text-sm text-slate-500 border border-slate-100">
              <span className="text-2xl">🔒</span>
              <p className="mt-2 font-bold text-slate-700">No issues visible while signed out</p>
              <p className="mt-1 text-xs text-slate-500 max-w-xs mx-auto">
                Sign in to your account to view only the problems you have submitted.
              </p>
              <button onClick={onOpenAuth} className="btn-secondary mt-4 py-2 px-4 text-xs font-bold">
                Sign In to View Your Issues
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {complaints.length ? (
                complaints.map(item => (
                  <ComplaintCard
                    key={item.id}
                    item={item}
                    user={user}
                    onSelect={() => onSelect(item)}
                    onFeedback={onFeedback}
                    onDelete={onDelete}
                  />
                ))
              ) : (
                <Empty text="You haven't submitted any complaints yet. Report an issue using the form." />
              )}
            </div>
          )}
        </section>
      </div>
    </>
  )
}

function Admin({ user, complaints, onSelect, onSave, onDelete, notify }) {
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('')
  const [priority, setPriority] = useState('')
  const [clusterFilter, setClusterFilter] = useState('all') // 'all', 'unique', 'clusters_only'

  const uniqueComplaints = useMemo(() => complaints.filter(item => !item.isDuplicate), [complaints])
  const clusteredComplaints = useMemo(() => complaints.filter(item => item.clusterCount > 1), [complaints])
  const duplicateCount = complaints.length - uniqueComplaints.length

  const filtered = useMemo(
    () =>
      complaints.filter(item => {
        // Duplicate & Cluster Filter
        if (clusterFilter === 'unique' && item.isDuplicate) return false
        if (clusterFilter === 'clusters_only' && (!item.clusterCount || item.clusterCount <= 1)) return false

        const matchesQuery =
          !query ||
          [item.id, item.description, item.landmark, item.category, item.department, item.reporter, item.userEmail, item.clusterId]
            .filter(Boolean)
            .join(' ')
            .toLowerCase()
            .includes(query.toLowerCase())

        const matchesStatus = !status || item.status === status
        const matchesPriority = !priority || item.priority === priority

        return matchesQuery && matchesStatus && matchesPriority
      }),
    [complaints, query, status, priority, clusterFilter]
  )

  const open = complaints.filter(item => item.status !== 'Closed').length
  const critical = complaints.filter(item => item.priority === 'Critical' && item.status !== 'Closed').length
  const resolved = complaints.filter(item => ['Closed', 'Resolved - Awaiting Citizen'].includes(item.status)).length

  return (
    <>
      <Hero
        eyebrow="Operations centre"
        title="Admin dashboard"
        text="Review incoming citizen complaints, triage duplicates, route work to municipal departments, and track resolution."
        badge={user ? `🛡 Logged in as ${user.name}` : undefined}
      />
      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          ['Total reports', complaints.length, 'All citizen submissions received'],
          ['Unique issues', uniqueComplaints.length, `${duplicateCount} duplicate submissions clustered`],
          ['Hotspot clusters', clusteredComplaints.length, 'Multi-reported civic incidents'],
          ['Critical urgency', critical, 'Requires immediate department action']
        ].map(([label, value, note]) => (
          <div key={label} className="panel p-4">
            <p className="text-xs font-bold text-slate-500">{label}</p>
            <p className="my-1 text-3xl font-black">{value}</p>
            <p className="text-xs text-slate-500">{note}</p>
          </div>
        ))}
      </div>
      <div className="grid items-start gap-5 lg:grid-cols-[1.1fr_.9fr]">
        <section className="panel">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-extrabold text-slate-800">Complaint queue</h2>
              <span className="text-xs text-slate-400">Smart duplicate detection & triage engine active</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="pill bg-blue-50 text-civic">{complaints.length} reports</span>
              {duplicateCount > 0 && (
                <span className="pill bg-purple-50 text-purple-700 border border-purple-200">
                  👥 {duplicateCount} duplicates clustered
                </span>
              )}
            </div>
          </div>

          {/* Duplicate Detection & Cluster Filter Segment */}
          <div className="mb-3 flex flex-wrap gap-1.5 p-1 bg-slate-100 rounded-xl">
            <button
              type="button"
              onClick={() => setClusterFilter('all')}
              className={`py-1.5 px-3 rounded-lg text-xs font-bold transition ${
                clusterFilter === 'all'
                  ? 'bg-white text-slate-800 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              All Reports ({complaints.length})
            </button>
            <button
              type="button"
              onClick={() => setClusterFilter('unique')}
              className={`py-1.5 px-3 rounded-lg text-xs font-bold transition flex items-center gap-1.5 ${
                clusterFilter === 'unique'
                  ? 'bg-white text-civic shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <span>🛡️</span> Unique Issues Only ({uniqueComplaints.length})
            </button>
            <button
              type="button"
              onClick={() => setClusterFilter('clusters_only')}
              className={`py-1.5 px-3 rounded-lg text-xs font-bold transition flex items-center gap-1.5 ${
                clusterFilter === 'clusters_only'
                  ? 'bg-purple-600 text-white shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <span>🔥</span> Clustered Hotspots ({clusteredComplaints.length})
            </button>
          </div>

          <div className="mb-4 flex flex-wrap gap-2">
            <input
              className="field flex-1"
              value={query}
              onChange={event => setQuery(event.target.value)}
              placeholder="Search issue / ID / reporter / area / cluster"
            />
            <select className="field w-auto" value={status} onChange={event => setStatus(event.target.value)}>
              <option value="">All statuses</option>
              {statusOptions.map(item => (
                <option key={item}>{item}</option>
              ))}
            </select>
            <select className="field w-auto" value={priority} onChange={event => setPriority(event.target.value)}>
              <option value="">All priorities</option>
              {Object.keys(priorityTone).map(item => (
                <option key={item}>{item}</option>
              ))}
            </select>
          </div>
          <div className="space-y-3">
            {filtered.length ? (
              filtered.map(item => (
                <AdminCard
                  key={item.id}
                  item={item}
                  onSelect={() => onSelect(item)}
                  onSave={onSave}
                  onDelete={onDelete}
                />
              ))
            ) : (
              <Empty text="No complaints match these filters." />
            )}
          </div>
        </section>
        <Insights complaints={complaints} onSelect={onSelect} />
      </div>
    </>
  )
}

function Hero({ eyebrow, title, text, badge }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <p className="text-[11px] font-black uppercase tracking-[.16em] text-civic">{eyebrow}</p>
        <h1 className="mt-1 text-3xl font-black tracking-tight md:text-4xl">{title}</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">{text}</p>
      </div>
      {badge && <span className="pill bg-blue-50 text-civic">{badge}</span>}
    </div>
  )
}

function Input({ label, ...props }) {
  return (
    <label>
      <span className="label">{label}</span>
      <input className="field" {...props} />
    </label>
  )
}

function Empty({ text }) {
  return (
    <div className="rounded-xl bg-slate-50 p-8 text-center text-sm text-slate-500">
      ⌁
      <p className="mt-2">{text}</p>
    </div>
  )
}

function ComplaintCard({ item, user, onSelect, onFeedback, onDelete }) {
  const isAwaitingCitizen = item.status === 'Resolved - Awaiting Citizen'
  const isOwner = user && (item.userId === user.id || item.userEmail?.toLowerCase() === user.email?.toLowerCase())
  const [rejecting, setRejecting] = useState(false)
  const [rejectReason, setRejectReason] = useState('')

  return (
    <article
      onClick={onSelect}
      className="group cursor-pointer rounded-xl border border-slate-200 bg-white p-4 transition-all duration-150 hover:border-civic hover:shadow-md"
    >
      <div className="flex justify-between items-start gap-3">
        <div className="flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-bold text-slate-800 group-hover:text-civic transition">
              {item.id} · {item.category}
            </h3>
            {item.userEmail && (
              <span className="text-[11px] text-slate-400">
                by {item.reporter} ({item.userEmail})
              </span>
            )}
          </div>
          <p className="mt-1.5 text-sm text-slate-600 line-clamp-2">{item.description}</p>
        </div>
        {item.photos?.[0] && (
          <img className="h-14 w-14 rounded-lg object-cover border border-slate-200 shrink-0" src={item.photos[0]} alt="Reported issue" />
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className={`pill border ${priorityTone[item.priority] || 'bg-slate-100 text-slate-600 border-slate-200'}`}>
          {item.priority} priority
        </span>
        <span className={`pill border ${statusTone[item.status] || 'bg-blue-50 text-blue-700 border-blue-200'}`}>
          {item.status}
        </span>
        <span className="pill bg-slate-100 text-slate-600 border border-slate-200">{item.department}</span>
        {item.clusterCount > 1 && (
          <span className="pill bg-indigo-50 text-indigo-700 border border-indigo-200 font-bold flex items-center gap-1">
            <span>👥</span> {item.clusterCount} Community Reports
          </span>
        )}
      </div>

      {item.clusterCount > 1 && (
        <div className="mt-2.5 rounded-lg bg-indigo-50/80 px-3 py-1.5 text-xs text-indigo-900 border border-indigo-200/80 flex items-center gap-1.5">
          <span>👥</span>
          <span className="font-medium">
            <b>Community Impact:</b> {item.clusterCount - 1} other neighbour(s) also reported this issue nearby. Clustered for priority dispatch.
          </span>
        </div>
      )}

      {item.adminNote && (
        <div className="mt-2.5 rounded-lg bg-amber-50/90 p-2 text-xs text-amber-900 border border-amber-200/60">
          <span className="font-bold">Admin note:</span> {item.adminNote}
        </div>
      )}

      {/* Citizen Accept / Reject prompt if resolved */}
      {isAwaitingCitizen && isOwner && (
        <div
          onClick={e => e.stopPropagation()}
          className="mt-3.5 rounded-xl border-2 border-purple-300 bg-purple-50/80 p-3 shadow-sm"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-bold text-purple-950 flex items-center gap-1.5">
              <span>🔔</span> Officer marked this resolved. Do you accept this fix?
            </span>
          </div>

          {!rejecting ? (
            <div className="mt-2.5 flex items-center gap-2">
              <button
                type="button"
                onClick={() => onFeedback(item.id, 'accept')}
                className="btn py-1.5 px-3 text-xs bg-emerald-600 text-white hover:bg-emerald-700 shadow-sm"
              >
                ✓ Accept & Close
              </button>
              <button
                type="button"
                onClick={() => setRejecting(true)}
                className="btn py-1.5 px-3 text-xs bg-rose-50 text-rose-700 border border-rose-300 hover:bg-rose-100"
              >
                ✕ Reject & Reopen
              </button>
            </div>
          ) : (
            <div className="mt-2 space-y-2">
              <input
                className="field text-xs py-1.5"
                placeholder="Reason (e.g. pothole was only half filled)..."
                value={rejectReason}
                onChange={e => setRejectReason(e.target.value)}
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    onFeedback(item.id, 'reject', rejectReason)
                    setRejecting(false)
                  }}
                  className="btn py-1 px-3 text-xs bg-rose-600 text-white hover:bg-rose-700 font-bold"
                >
                  Confirm Reopen
                </button>
                <button
                  type="button"
                  onClick={() => setRejecting(false)}
                  className="btn-secondary py-1 px-2.5 text-xs"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-2.5 text-xs text-slate-500">
        <span>📍 {item.landmark || 'No landmark'} · {formatDate(item.createdAt)}</span>
        <span className="text-civic font-semibold flex items-center gap-1 group-hover:underline">
          View details & process →
        </span>
      </div>
    </article>
  )
}

function AdminCard({ item, onSelect, onSave, onDelete }) {
  const [values, setValues] = useState({
    category: item.category,
    department: item.department,
    priority: item.priority,
    status: item.status,
    adminNote: item.adminNote || ''
  })

  useEffect(() => {
    setValues({
      category: item.category,
      department: item.department,
      priority: item.priority,
      status: item.status,
      adminNote: item.adminNote || ''
    })
  }, [item])

  const change = event => setValues(current => ({ ...current, [event.target.name]: event.target.value }))

  return (
    <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div onClick={onSelect} className="cursor-pointer group">
        <div className="flex justify-between items-start gap-3">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-bold text-slate-800 group-hover:text-civic transition">
                {item.id} · {item.category}
              </h3>
              {item.userEmail && (
                <span className="text-[11px] text-slate-500">
                  reported by <b>{item.reporter}</b> ({item.userEmail})
                </span>
              )}
            </div>
            <p className="mt-1 text-sm text-slate-600">{item.description}</p>
          </div>
          {item.photos?.[0] && (
            <img className="h-14 w-14 rounded-lg object-cover border border-slate-200" src={item.photos[0]} alt="Reported issue" />
          )}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className={`pill border ${priorityTone[item.priority] || 'bg-slate-100 text-slate-600 border-slate-200'}`}>
            {item.priority} priority
          </span>
          <span className={`pill border ${statusTone[item.status] || 'bg-blue-50 text-blue-700 border-blue-200'}`}>
            {item.status}
          </span>
          <span className="pill bg-slate-100 text-slate-600 border border-slate-200">{item.department}</span>

          {item.isClusterMaster && (
            <span className="pill bg-purple-100 text-purple-900 border border-purple-300 font-extrabold flex items-center gap-1">
              <span>🔥</span> Clustered Hotspot · {item.clusterCount} reports
            </span>
          )}
          {item.isDuplicate && (
            <span className="pill bg-slate-100 text-slate-700 border border-slate-300 font-medium flex items-center gap-1">
              <span>↳</span> Duplicate Report
            </span>
          )}
        </div>

        {item.clusterCount > 1 && (
          <div className="mt-2.5 flex items-center justify-between rounded-lg bg-purple-50/70 px-3 py-1.5 text-xs text-purple-900 border border-purple-200/80">
            <span className="flex items-center gap-1.5 font-medium">
              <span>👥</span>
              {item.isClusterMaster
                ? `Master report for ${item.clusterCount} citizens who reported this identical issue.`
                : `Duplicate submission clustered with ${item.duplicates?.[0] || 'master issue'}.`}
            </span>
            <span className="font-bold text-purple-700 underline text-[11px]">Inspect cluster →</span>
          </div>
        )}
        <p className="mt-2 text-xs text-slate-400">
          📍 {item.landmark || 'No landmark'} · {location(item)} · {formatDate(item.createdAt)} · <span className="text-civic font-bold">Inspect Process & History →</span>
        </p>
      </div>

      {/* Quick Admin Action Controls */}
      <div className="mt-3 border-t border-slate-100 pt-3">
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="text-[11px] font-bold text-slate-500">
            Category
            <select className="field mt-0.5 text-xs py-1.5" name="category" value={values.category} onChange={change}>
              {categories.map(value => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </label>
          <label className="text-[11px] font-bold text-slate-500">
            Department
            <select className="field mt-0.5 text-xs py-1.5" name="department" value={values.department} onChange={change}>
              {departments.map(value => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </label>
          <label className="text-[11px] font-bold text-slate-500">
            Priority
            <select className="field mt-0.5 text-xs py-1.5" name="priority" value={values.priority} onChange={change}>
              {Object.keys(priorityTone).map(value => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </label>
          <label className="text-[11px] font-bold text-slate-500">
            Status
            <select className="field mt-0.5 text-xs py-1.5" name="status" value={values.status} onChange={change}>
              {statusOptions.map(value => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </label>
        </div>
        <div className="mt-2 flex gap-2">
          <input
            name="adminNote"
            value={values.adminNote}
            onChange={change}
            className="field text-xs py-1.5 flex-1"
            placeholder="Add administrator review note"
          />
          <button
            type="button"
            onClick={() => onSave(item.id, values)}
            className="btn-primary text-xs py-1.5 px-3 whitespace-nowrap"
          >
            Save review
          </button>
          <button
            type="button"
            onClick={() => onDelete(item.id)}
            title="Delete this complaint"
            className="btn bg-red-50 text-red-600 border border-red-200 hover:bg-red-100 text-xs py-1.5 px-3"
          >
            🗑
          </button>
        </div>
      </div>
    </article>
  )
}

function Insights({ complaints, onSelect }) {
  const workload = departments.map(department => [
    department,
    complaints.filter(item => item.department === department && item.status !== 'Closed').length
  ])
  const located = complaints.filter(item => item.lat != null)

  // Extract distinct multi-report hotspot clusters
  const clusters = useMemo(() => {
    const map = new Map()
    complaints.forEach(item => {
      if (item.clusterCount > 1 && item.clusterId) {
        if (!map.has(item.clusterId)) {
          map.set(item.clusterId, {
            clusterId: item.clusterId,
            master: item.isClusterMaster ? item : null,
            items: [],
            category: item.category,
            landmark: item.landmark,
            count: item.clusterCount
          })
        }
        const grp = map.get(item.clusterId)
        grp.items.push(item)
        if (item.isClusterMaster) grp.master = item
      }
    })
    return Array.from(map.values())
      .map(g => ({ ...g, master: g.master || g.items[0] }))
      .sort((a, b) => b.count - a.count)
  }, [complaints])

  return (
    <section className="panel">
      {clusters.length > 0 && (
        <div className="mb-6">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-extrabold text-slate-800 flex items-center gap-1.5">
              <span>🔥</span> Clustered Hotspots
            </h2>
            <span className="pill text-[10px] bg-purple-100 text-purple-800 border border-purple-300 font-extrabold">
              {clusters.length} Active Hotspot{clusters.length > 1 ? 's' : ''}
            </span>
          </div>
          <p className="mt-0.5 text-xs text-slate-500">
            Detected multi-reported civic emergencies in the same vicinity.
          </p>
          <div className="mt-3 space-y-2">
            {clusters.map(cl => (
              <div
                key={cl.clusterId}
                onClick={() => onSelect(cl.master)}
                className="cursor-pointer rounded-xl bg-purple-50/70 p-3 text-xs transition hover:bg-purple-100 hover:border-purple-300 border border-purple-200 shadow-2xs"
              >
                <div className="flex justify-between items-center">
                  <b className="text-purple-950 font-bold">
                    {cl.master.category} {cl.master.landmark ? `· ${cl.master.landmark}` : ''}
                  </b>
                  <span className="pill text-[10px] bg-purple-600 text-white font-extrabold">
                    👥 {cl.count} Reports
                  </span>
                </div>
                <p className="mt-1 text-slate-600 line-clamp-1">{cl.master.description}</p>
                <div className="mt-2 flex items-center justify-between text-[11px] text-purple-800">
                  <span>Dept: <b>{cl.master.department}</b></span>
                  <span className="font-bold underline text-[10px]">Inspect Master Ticket →</span>
                </div>
              </div>
            ))}
          </div>
          <hr className="my-5 border-slate-200" />
        </div>
      )}

      <h2 className="text-lg font-extrabold text-slate-800">Location intelligence</h2>
      <p className="mt-1 text-sm text-slate-500">
        Click any located report to inspect coordinates and history.
      </p>
      <div className="mt-4 space-y-2">
        {located.length ? (
          located.slice(0, 8).map(item => (
            <div
              key={item.id}
              onClick={() => onSelect(item)}
              className="cursor-pointer rounded-lg bg-slate-50 p-3 text-xs transition hover:bg-blue-50/80 hover:border-civic border border-transparent"
            >
              <div className="flex justify-between items-center">
                <b>{item.id} · {item.landmark || item.category}</b>
                <span className={`pill text-[10px] ${statusTone[item.status] || 'bg-slate-100'}`}>{item.status}</span>
              </div>
              <p className="mt-1 text-slate-500">
                {location(item)} · {item.priority} priority
              </p>
            </div>
          ))
        ) : (
          <Empty text="No coordinates yet." />
        )}
      </div>
      <hr className="my-5 border-slate-200" />
      <h2 className="text-lg font-extrabold text-slate-800">Department workload</h2>
      <div className="mt-3 space-y-3">
        {workload.map(([department, count]) => (
          <div key={department}>
            <div className="flex justify-between gap-4 text-xs">
              <span>{department}</span>
              <b>{count}</b>
            </div>
            <div className="mt-1 h-1.5 overflow-hidden rounded bg-slate-100">
              <div
                className="h-full bg-gradient-to-r from-blue-600 to-teal-400"
                style={{ width: `${complaints.length ? (count / complaints.length) * 100 : 0}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

function ComplaintDetailModal({ item, user, onClose, onFeedback, onSaveReview, onDelete }) {
  const isAdmin = user?.role === 'admin'
  const isOwner = user && (item.userId === user.id || item.userEmail?.toLowerCase() === user.email?.toLowerCase())
  const isAwaitingCitizen = item.status === 'Resolved - Awaiting Citizen'

  const [rejecting, setRejecting] = useState(false)
  const [rejectReason, setRejectReason] = useState('')

  const [adminValues, setAdminValues] = useState({
    category: item.category,
    department: item.department,
    priority: item.priority,
    status: item.status,
    adminNote: item.adminNote || ''
  })

  const handleAdminChange = e => {
    setAdminValues(prev => ({ ...prev, [e.target.name]: e.target.value }))
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm overflow-y-auto">
      <div className="relative my-8 w-full max-w-2xl rounded-2xl bg-white shadow-2xl border border-slate-100 max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-start justify-between border-b border-slate-200 p-5 shrink-0">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-mono font-black text-slate-500 uppercase">{item.id}</span>
              <span className={`pill border ${statusTone[item.status] || 'bg-slate-100 text-slate-700'}`}>
                {item.status}
              </span>
              <span className={`pill border ${priorityTone[item.priority] || 'bg-slate-100 text-slate-700'}`}>
                {item.priority} priority
              </span>
              {item.clusterCount > 1 && (
                <span className="pill bg-purple-100 text-purple-900 border border-purple-300 font-extrabold flex items-center gap-1">
                  <span>👥</span> Clustered Hotspot · {item.clusterCount} Reports
                </span>
              )}
            </div>
            <h2 className="mt-1 text-xl font-black text-slate-800">{item.category}</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Reported by <b className="text-slate-700">{item.reporter}</b> {item.userEmail && `(${item.userEmail})`} on {formatDate(item.createdAt)}
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition"
          >
            ✕
          </button>
        </div>

        {/* Scrollable Body */}
        <div className="p-5 space-y-5 overflow-y-auto flex-1">
          {/* Citizen Acceptance / Rejection Banner */}
          {isOwner && isAwaitingCitizen && (
            <div className="rounded-xl border-2 border-purple-300 bg-purple-50 p-4 shadow-sm">
              <div className="flex items-start gap-2.5">
                <span className="text-xl">🔔</span>
                <div className="flex-1">
                  <h4 className="text-sm font-extrabold text-purple-900">
                    Municipal authorities marked this problem as RESOLVED
                  </h4>
                  <p className="mt-1 text-xs text-purple-700 leading-relaxed">
                    Please verify if the issue has been resolved at the site. You can accept this fix to close the complaint or reject it to reopen the case.
                  </p>

                  {!rejecting ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => onFeedback(item.id, 'accept')}
                        className="btn py-2 px-4 text-xs font-bold bg-emerald-600 text-white hover:bg-emerald-700 shadow-sm"
                      >
                        ✓ Accept Resolution (Close Ticket)
                      </button>
                      <button
                        type="button"
                        onClick={() => setRejecting(true)}
                        className="btn py-2 px-4 text-xs font-bold bg-rose-50 text-rose-700 border border-rose-300 hover:bg-rose-100"
                      >
                        ✕ Reject Resolution (Reopen)
                      </button>
                    </div>
                  ) : (
                    <div className="mt-3 space-y-2 rounded-lg bg-white p-3 border border-purple-200">
                      <label className="text-xs font-bold text-slate-700 block">
                        Reason for rejection (What is still incomplete?):
                      </label>
                      <textarea
                        className="field text-xs min-h-20"
                        placeholder="e.g. The leak was patched but the pavement crater is still unfilled..."
                        value={rejectReason}
                        onChange={e => setRejectReason(e.target.value)}
                      />
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            onFeedback(item.id, 'reject', rejectReason)
                            setRejecting(false)
                          }}
                          className="btn py-1.5 px-4 text-xs bg-rose-600 text-white hover:bg-rose-700 font-bold"
                        >
                          Confirm & Reopen Ticket
                        </button>
                        <button
                          type="button"
                          onClick={() => setRejecting(false)}
                          className="btn-secondary py-1.5 px-3 text-xs"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Description */}
          <div>
            <h4 className="text-xs font-black text-slate-400 uppercase tracking-wider">Problem Description</h4>
            <div className="mt-1.5 rounded-xl bg-slate-50 p-4 text-sm text-slate-700 border border-slate-100 leading-relaxed">
              {item.description}
            </div>
          </div>

          {/* Location & Department */}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-slate-200 p-3.5 bg-slate-50/50">
              <span className="text-[11px] font-bold text-slate-500 uppercase">Assigned Department</span>
              <p className="mt-1 font-bold text-sm text-slate-800">{item.department}</p>
            </div>
            <div className="rounded-xl border border-slate-200 p-3.5 bg-slate-50/50">
              <span className="text-[11px] font-bold text-slate-500 uppercase">Landmark & GPS</span>
              <p className="mt-1 text-xs text-slate-700 font-semibold">{item.landmark || 'No landmark specified'}</p>
              <p className="text-[11px] text-slate-500 mt-0.5">{location(item)}</p>
              {item.lat != null && item.lon != null && (
                <a
                  href={`https://www.google.com/maps?q=${item.lat},${item.lon}`}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-1.5 inline-block text-[11px] font-bold text-civic hover:underline"
                >
                  📍 Open in Google Maps ↗
                </a>
              )}
            </div>
          </div>

          {/* Duplicate & Clustered Reports Section */}
          {item.clusterMembers && item.clusterMembers.length > 0 && (
            <div className="rounded-xl border border-purple-200 bg-purple-50/70 p-4">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className="text-base">👥</span>
                  <h4 className="text-xs font-black text-purple-950 uppercase tracking-wider">
                    Duplicate & Clustered Submissions ({item.clusterMembers.length})
                  </h4>
                </div>
                <span className="pill text-[10px] bg-purple-600 text-white font-extrabold shadow-2xs">
                  {item.clusterCount} Total Citizens Reported
                </span>
              </div>
              <p className="text-xs text-purple-800 mb-3">
                CivicSense spatial and semantic intelligence identified matching citizen reports for this issue:
              </p>
              <div className="space-y-2.5 max-h-56 overflow-y-auto pr-1">
                {item.clusterMembers.map(m => (
                  <div key={m.id} className="rounded-lg bg-white p-3 border border-purple-100 shadow-2xs text-xs">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-bold text-slate-800">{m.id}</span>
                        <span className="text-slate-500 font-medium">by {m.reporter}</span>
                        {m.distanceMeters !== null && (
                          <span className="pill text-[10px] bg-slate-100 text-slate-700">
                            📍 {m.distanceMeters}m away
                          </span>
                        )}
                      </div>
                      <span className={`pill text-[10px] ${statusTone[m.status] || 'bg-slate-100'}`}>{m.status}</span>
                    </div>
                    <p className="mt-1 text-slate-700 leading-relaxed">{m.description}</p>
                    {m.photos && m.photos.length > 0 && (
                      <div className="mt-2 flex gap-2">
                        {m.photos.map((p, idx) => (
                          <a key={idx} href={p} target="_blank" rel="noreferrer">
                            <img src={p} alt="Duplicate photo" className="h-12 w-12 rounded-md object-cover border border-slate-200 hover:scale-105 transition" />
                          </a>
                        ))}
                      </div>
                    )}
                    <p className="mt-1.5 text-[10px] text-purple-700 font-semibold">
                      ⚡ Match Signal: {m.matchReason}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Photos */}
          {item.photos && item.photos.length > 0 && (
            <div>
              <h4 className="text-xs font-black text-slate-400 uppercase tracking-wider">Attached Photographs</h4>
              <div className="mt-2 flex flex-wrap gap-3">
                {item.photos.map((photo, i) => (
                  <a key={i} href={photo} target="_blank" rel="noreferrer" className="group">
                    <img
                      src={photo}
                      alt={`Photo ${i + 1}`}
                      className="h-28 w-28 rounded-xl object-cover border border-slate-200 shadow-sm group-hover:scale-105 transition"
                    />
                  </a>
                ))}
              </div>
            </div>
          )}

          {/* Admin note */}
          {item.adminNote && (
            <div>
              <h4 className="text-xs font-black text-slate-400 uppercase tracking-wider">Administrator Note</h4>
              <div className="mt-1.5 rounded-xl bg-amber-50 p-3 text-xs text-amber-900 border border-amber-200">
                {item.adminNote}
              </div>
            </div>
          )}

          {/* Process Timeline / Audit Trail */}
          <div>
            <h4 className="text-xs font-black text-slate-400 uppercase tracking-wider mb-2.5">
              Resolution Process & Audit Trail
            </h4>
            <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4">
              <ol className="relative border-l border-slate-300 ml-2 space-y-4">
                {item.history && item.history.length > 0 ? (
                  item.history.map((step, idx) => (
                    <li key={idx} className="ml-4">
                      <div className="absolute -left-1.5 mt-1.5 h-3 w-3 rounded-full border-2 border-white bg-civic shadow-sm" />
                      <div className="text-xs font-semibold text-slate-800">{step.action}</div>
                      <div className="text-[11px] text-slate-500 mt-0.5">
                        by <span className="font-medium text-slate-600">{step.by}</span> · {formatDate(step.at)}
                      </div>
                    </li>
                  ))
                ) : (
                  <li className="ml-4 text-xs text-slate-500">No history events recorded yet.</li>
                )}
              </ol>
            </div>
          </div>

          {/* Admin Management Controls (Inside Modal for comprehensive oversight) */}
          {isAdmin && (
            <div className="rounded-xl border border-blue-200 bg-blue-50/50 p-4">
              <h4 className="text-xs font-black text-blue-900 uppercase tracking-wider mb-2">
                Administrator Actions
              </h4>
              <div className="grid gap-2 sm:grid-cols-2">
                <label className="text-[11px] font-bold text-slate-600">
                  Category
                  <select
                    className="field text-xs py-1.5 mt-0.5 bg-white"
                    name="category"
                    value={adminValues.category}
                    onChange={handleAdminChange}
                  >
                    {categories.map(value => (
                      <option key={value}>{value}</option>
                    ))}
                  </select>
                </label>
                <label className="text-[11px] font-bold text-slate-600">
                  Department
                  <select
                    className="field text-xs py-1.5 mt-0.5 bg-white"
                    name="department"
                    value={adminValues.department}
                    onChange={handleAdminChange}
                  >
                    {departments.map(value => (
                      <option key={value}>{value}</option>
                    ))}
                  </select>
                </label>
                <label className="text-[11px] font-bold text-slate-600">
                  Priority
                  <select
                    className="field text-xs py-1.5 mt-0.5 bg-white"
                    name="priority"
                    value={adminValues.priority}
                    onChange={handleAdminChange}
                  >
                    {Object.keys(priorityTone).map(value => (
                      <option key={value}>{value}</option>
                    ))}
                  </select>
                </label>
                <label className="text-[11px] font-bold text-slate-600">
                  Status
                  <select
                    className="field text-xs py-1.5 mt-0.5 bg-white"
                    name="status"
                    value={adminValues.status}
                    onChange={handleAdminChange}
                  >
                    {statusOptions.map(value => (
                      <option key={value}>{value}</option>
                    ))}
                  </select>
                </label>
              </div>
              <label className="text-[11px] font-bold text-slate-600 mt-2 block">
                Review Note
                <input
                  name="adminNote"
                  value={adminValues.adminNote}
                  onChange={handleAdminChange}
                  className="field text-xs py-1.5 mt-0.5 bg-white"
                  placeholder="Official status note for citizen..."
                />
              </label>
              <div className="mt-3 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => onSaveReview(item.id, adminValues)}
                  className="btn-primary py-1.5 px-4 text-xs font-bold"
                >
                  Save Review Updates
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer with Authority Delete / Close */}
        <div className="flex items-center justify-between border-t border-slate-200 p-4 bg-slate-50 rounded-b-2xl shrink-0">
          {(isAdmin || isOwner) ? (
            <button
              type="button"
              onClick={() => onDelete(item.id)}
              className="btn py-2 px-3.5 text-xs font-bold bg-red-50 text-red-700 border border-red-200 hover:bg-red-100 flex items-center gap-1.5"
            >
              <span>🗑</span> {isAdmin ? 'Delete Complaint (Admin)' : 'Delete My Report'}
            </button>
          ) : (
            <div />
          )}

          <button
            type="button"
            onClick={onClose}
            className="btn-secondary py-2 px-5 text-xs font-bold"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}

export default App
