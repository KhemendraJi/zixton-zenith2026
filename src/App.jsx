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
  Critical: 'bg-red-100 text-red-700',
  High: 'bg-orange-100 text-orange-700',
  Medium: 'bg-amber-100 text-amber-700',
  Low: 'bg-emerald-100 text-emerald-700'
}

const formatDate = value => new Date(value).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
const location = item => (item.lat == null ? 'Location not provided' : `${Number(item.lat).toFixed(5)}, ${Number(item.lon).toFixed(5)}`)

function App() {
  const [view, setView] = useState('citizen')
  const [complaints, setComplaints] = useState([])
  const [notice, setNotice] = useState('')
  const [loading, setLoading] = useState(true)
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
          // Token expired or invalid
          localStorage.removeItem('civicsense_token')
          localStorage.removeItem('civicsense_user')
          setUser(null)
        })
    }

    // Check DB status
    fetch('/api/health')
      .then(r => r.json())
      .then(status => setDbStatus(status))
      .catch(() => {})
  }, [])

  const refreshComplaints = async () => {
    setLoading(true)
    try {
      const url = view === 'admin' ? `${API}?all=true` : API
      const response = await fetch(url, { headers: getAuthHeaders() })
      const items = await readApiResponse(response)
      if (!Array.isArray(items)) throw new Error('The API returned an unexpected complaints response.')
      setComplaints(items)
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
            onCreated={item => {
              setComplaints(current => [item, ...current])
              setNotice(`Complaint ${item.id} submitted successfully!`)
            }}
          />
        ) : (
          <Admin
            user={user}
            complaints={complaints}
            setComplaints={setComplaints}
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
    </div>
  )
}

function AuthModal({ onClose, onSuccess }) {
  const [mode, setMode] = useState('login') // 'login' or 'signup'
  const [role, setRole] = useState('user') // 'user' or 'admin'
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
      const body = mode === 'login'
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

        {/* Tab switcher */}
        <div className="mt-4 flex rounded-xl bg-slate-100 p-1 text-xs font-bold">
          <button
            type="button"
            onClick={() => { setMode('login'); setError('') }}
            className={`flex-1 rounded-lg py-2 transition ${
              mode === 'login' ? 'bg-white text-civic shadow-sm' : 'text-slate-500'
            }`}
          >
            Sign In
          </button>
          <button
            type="button"
            onClick={() => { setMode('signup'); setError('') }}
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

        {/* Quick Demo Credentials */}
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

function Citizen({ user, complaints, onCreated, onOpenAuth }) {
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

  // Update default reporter name when user state updates
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
            <h2 className="text-lg font-extrabold">Your submitted issues</h2>
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
                complaints.map(item => <ComplaintCard key={item.id} item={item} />)
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

function Admin({ user, complaints, setComplaints, notify }) {
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('')
  const [priority, setPriority] = useState('')

  const filtered = useMemo(
    () =>
      complaints.filter(
        item =>
          (!query ||
            [item.id, item.description, item.landmark, item.category, item.department, item.reporter, item.userEmail]
              .filter(Boolean)
              .join(' ')
              .toLowerCase()
              .includes(query.toLowerCase())) &&
          (!status || item.status === status) &&
          (!priority || item.priority === priority)
      ),
    [complaints, query, status, priority]
  )

  const patch = async (id, changes) => {
    try {
      const response = await fetch(`${API}/${id}`, {
        method: 'PATCH',
        headers: getAuthHeaders(true),
        body: JSON.stringify(changes)
      })
      const item = await readApiResponse(response)
      setComplaints(current => current.map(old => (old.id === id ? item : old)))
      notify(`Review saved for ${id}.`)
    } catch (error) {
      notify(error.message || 'Update failed.')
    }
  }

  const open = complaints.filter(item => item.status !== 'Closed').length
  const critical = complaints.filter(item => item.priority === 'Critical' && item.status !== 'Closed').length
  const resolved = complaints.filter(item => ['Closed', 'Resolved - Awaiting Citizen'].includes(item.status)).length

  return (
    <>
      <Hero
        eyebrow="Operations centre"
        title="Admin dashboard"
        text="Review incoming citizen complaints, route work to municipal departments, and keep the resolution trail up to date."
        badge={user ? `🛡 Logged in as ${user.name}` : undefined}
      />
      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          ['Total reports', complaints.length, 'All submitted complaints in database'],
          ['Open issues', open, 'Pending resolution'],
          ['Critical', critical, 'Requires urgent review'],
          ['Awaiting / resolved', resolved, 'Pending citizen confirmation may remain']
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
            <h2 className="text-lg font-extrabold">Complaint queue</h2>
            <span className="pill bg-blue-50 text-civic">{complaints.length} total</span>
          </div>
          <div className="mb-4 flex flex-wrap gap-2">
            <input
              className="field flex-1"
              value={query}
              onChange={event => setQuery(event.target.value)}
              placeholder="Search issue / ID / reporter / area"
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
              filtered.map(item => <AdminCard key={item.id} item={item} onSave={patch} />)
            ) : (
              <Empty text="No complaints match these filters." />
            )}
          </div>
        </section>
        <Insights complaints={complaints} />
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

function ComplaintCard({ item }) {
  return (
    <article className="rounded-xl border border-slate-200 p-4 transition hover:border-slate-300">
      <div className="flex justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="font-bold text-slate-800">
              {item.id} · {item.category}
            </h3>
            {item.userEmail && (
              <span className="text-[10px] text-slate-400">
                by {item.reporter} ({item.userEmail})
              </span>
            )}
          </div>
          <p className="mt-1 text-sm text-slate-600">{item.description}</p>
        </div>
        {item.photos?.[0] && (
          <img className="h-14 w-14 rounded-lg object-cover" src={item.photos[0]} alt="Reported issue" />
        )}
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <span className={`pill ${priorityTone[item.priority]}`}>{item.priority} priority</span>
        <span className="pill bg-blue-50 text-blue-700">{item.status}</span>
        <span className="pill bg-slate-100 text-slate-600">{item.department}</span>
      </div>
      {item.adminNote && (
        <div className="mt-2.5 rounded-lg bg-amber-50/80 p-2 text-xs text-amber-900 border border-amber-200/50">
          <span className="font-bold">Admin note:</span> {item.adminNote}
        </div>
      )}
      <p className="mt-3 text-xs text-slate-500">
        📍 {item.landmark || 'No landmark'} · {location(item)} · {formatDate(item.createdAt)}
      </p>
    </article>
  )
}

function AdminCard({ item, onSave }) {
  const [values, setValues] = useState({
    category: item.category,
    department: item.department,
    priority: item.priority,
    status: item.status,
    adminNote: item.adminNote || ''
  })

  // Sync if item updates from backend
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
    <article className="rounded-xl border border-slate-200 p-4">
      <ComplaintCard item={item} />
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <select className="field" name="category" value={values.category} onChange={change}>
          {categories.map(value => (
            <option key={value}>{value}</option>
          ))}
        </select>
        <select className="field" name="department" value={values.department} onChange={change}>
          {departments.map(value => (
            <option key={value}>{value}</option>
          ))}
        </select>
        <select className="field" name="priority" value={values.priority} onChange={change}>
          {Object.keys(priorityTone).map(value => (
            <option key={value}>{value}</option>
          ))}
        </select>
        <select className="field" name="status" value={values.status} onChange={change}>
          {statusOptions.map(value => (
            <option key={value}>{value}</option>
          ))}
        </select>
      </div>
      <div className="mt-2 flex gap-2">
        <input
          name="adminNote"
          value={values.adminNote}
          onChange={change}
          className="field"
          placeholder="Add administrator review note"
        />
        <button onClick={() => onSave(item.id, values)} className="btn-primary whitespace-nowrap">
          Save review
        </button>
      </div>
    </article>
  )
}

function Insights({ complaints }) {
  const workload = departments.map(department => [
    department,
    complaints.filter(item => item.department === department && item.status !== 'Closed').length
  ])
  const located = complaints.filter(item => item.lat != null)

  return (
    <section className="panel">
      <h2 className="text-lg font-extrabold">Location intelligence</h2>
      <p className="mt-1 text-sm text-slate-500">Reports with valid coordinates appear below.</p>
      <div className="mt-4 space-y-2">
        {located.length ? (
          located.slice(0, 8).map(item => (
            <div key={item.id} className="rounded-lg bg-slate-50 p-3 text-xs">
              <b>
                {item.id} · {item.landmark || item.category}
              </b>
              <p className="mt-1 text-slate-500">
                {location(item)} · {item.priority}
              </p>
            </div>
          ))
        ) : (
          <Empty text="No coordinates yet." />
        )}
      </div>
      <hr className="my-5 border-slate-200" />
      <h2 className="text-lg font-extrabold">Department workload</h2>
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

export default App
