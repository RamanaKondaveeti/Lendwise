import { useEffect, useMemo, useState } from 'react'
import {
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowRight,
  ArrowUpRight,
  CalendarDays,
  CarFront,
  Check,
  ChevronDown,
  CircleHelp,
  Coffee,
  House,
  LayoutDashboard,
  LoaderCircle,
  LogOut,
  Mountain,
  Plus,
  ReceiptText,
  Search,
  Trash2,
  Users,
  Utensils,
  ShoppingBasket,
  Zap,
  X,
} from 'lucide-react'

const groupIcons = { mountain: Mountain, house: House, users: Users }
const categoryIcons = {
  'Food & drink': Utensils,
  Transport: CarFront,
  Shopping: ShoppingBasket,
  Utilities: Zap,
  Other: ReceiptText,
}
const money = amount => new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
}).format(Math.abs(Number(amount) || 0))
const date = value => new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
}).format(new Date(value))

async function request(url, options) {
  const response = await fetch(url, options)
  const body = await response.json()
  if (!response.ok) {
    const error = new Error(body.error || 'The request could not be completed.')
    error.status = response.status
    throw error
  }
  return body
}

function ExpenseRows({ expenses, currentUser, onGroupClick }) {
  if (!expenses.length) return <div className="empty">No expenses to show yet.</div>

  return (
    <div className="data-list">
      {expenses.map((expense, index) => {
        const Icon = categoryIcons[expense.category] || ReceiptText
        return (
          <div className="activity-row" key={expense.id}>
            <div className="activity-icon" style={{ background: ['#f3e9db', '#e6eee5', '#ece6f2'][index % 3] }}>
              <Icon size={17} />
            </div>
            <div className="activity-copy">
              <b>{expense.title}</b>
              <span>
                <button className="inline-link" onClick={() => onGroupClick(expense.group_id)}>
                  {expense.group_name}
                </button>
                <i>·</i>
                {date(expense.created_at)}
              </span>
            </div>
            <div className="activity-payer">
              <div className="avatar tiny" style={{ background: expense.color }}>{expense.initials}</div>
              <span>{expense.payer_id === currentUser?.id ? 'You' : expense.payer}</span>
            </div>
            <div className="activity-amount">
              <b>{money(expense.amount)}</b>
              <span>total</span>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function InvitationShareButtons({ url, workspaceName, onInstagram }) {
  const message = `Join my ${workspaceName} workspace on Lendwise: ${url}`
  const encodedMessage = encodeURIComponent(message)

  return (
    <div className="invitation-share">
      <span className="form-hint">Share this invite with</span>
      <div className="share-buttons" aria-label="Share invitation">
        <a className="share-button share-facebook" href={`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`} target="_blank" rel="noopener noreferrer">
          <span className="share-brand" aria-hidden="true">f</span>Facebook
        </a>
        <button className="share-button share-instagram" type="button" onClick={onInstagram} title="Copy the invitation link and open Instagram">
          <span className="share-brand" aria-hidden="true">IG</span>Instagram
        </button>
        <a className="share-button share-whatsapp" href={`https://wa.me/?text=${encodedMessage}`} target="_blank" rel="noopener noreferrer">
          <span className="share-brand" aria-hidden="true">WA</span>WhatsApp
        </a>
        <a className="share-button share-gmail" href={`https://mail.google.com/mail/?view=cm&fs=1&su=${encodeURIComponent('Join my Lendwise workspace')}&body=${encodedMessage}`} target="_blank" rel="noopener noreferrer">
          <span className="share-brand" aria-hidden="true">M</span>Gmail
        </a>
      </div>
      <span className="share-note">Instagram does not support prefilled web shares, so the link is copied for you to paste.</span>
    </div>
  )
}

function SiteShareButtons({ url, onInstagram, className = '' }) {
  const message = `Check out Lendwise, shared expenses made simple: ${url}`
  const encodedMessage = encodeURIComponent(message)

  return (
    <div className={`site-share-buttons ${className}`} aria-label="Share Lendwise">
      <a className="site-share-button share-facebook" href={`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`} target="_blank" rel="noopener noreferrer" aria-label="Share on Facebook" title="Facebook">
        <span aria-hidden="true">f</span>
      </a>
      <button className="site-share-button share-instagram" type="button" onClick={() => onInstagram(url)} aria-label="Share on Instagram" title="Instagram">
        <span aria-hidden="true">IG</span>
      </button>
      <a className="site-share-button share-whatsapp" href={`https://wa.me/?text=${encodedMessage}`} target="_blank" rel="noopener noreferrer" aria-label="Share on WhatsApp" title="WhatsApp">
        <span aria-hidden="true">WA</span>
      </a>
      <a className="site-share-button share-gmail" href={`https://mail.google.com/mail/?view=cm&fs=1&su=${encodeURIComponent('Check out Lendwise')}&body=${encodedMessage}`} target="_blank" rel="noopener noreferrer" aria-label="Share by Gmail" title="Gmail">
        <span aria-hidden="true">M</span>
      </a>
    </div>
  )
}

function App() {
  const [data, setData] = useState(null)
  const [authUser, setAuthUser] = useState(null)
  const [authChecked, setAuthChecked] = useState(false)
  const [authMode, setAuthMode] = useState('login')
  const [authError, setAuthError] = useState('')
  const [authNotice, setAuthNotice] = useState('')
  const [authEmail, setAuthEmail] = useState('')
  const [invitationToken, setInvitationToken] = useState('')
  const [resetToken, setResetToken] = useState('')
  const [workspaces, setWorkspaces] = useState([])
  const [workspaceMenuOpen, setWorkspaceMenuOpen] = useState(false)
  const [globalUserQuery, setGlobalUserQuery] = useState('')
  const [globalUserResults, setGlobalUserResults] = useState([])
  const [globalSearchLoading, setGlobalSearchLoading] = useState(false)
  const [manualInviteLink, setManualInviteLink] = useState('')
  const [tab, setTab] = useState('Overview')
  const [selectedGroupId, setSelectedGroupId] = useState(null)
  const [expenseGroupId, setExpenseGroupId] = useState('')
  const [modal, setModal] = useState('')
  const [search, setSearch] = useState('')
  const [dateRange, setDateRange] = useState('30')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [activity, setActivity] = useState([])
  const [activityLoading, setActivityLoading] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)

  const refresh = async () => {
    const summary = await request('/api/summary')
    setData(summary)
    setNotice('')
  }

  const refreshWorkspaces = async () => {
    setWorkspaces(await request('/api/workspaces'))
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const invite = params.get('invite')
    const reset = params.get('reset')
    if (invite || params.has('verify') || reset) window.history.replaceState({}, '', window.location.pathname)
    let active = true
    async function initializeAuth() {
      try {
        if (invite) {
          const invitation = await request(`/api/invitations/${encodeURIComponent(invite)}`)
          if (!active) return
          setInvitationToken(invite)
          setAuthEmail(invitation.email)
          setAuthMode(invitation.existing_account ? 'login' : 'signup')
          setAuthNotice(`You are invited to join ${invitation.workspace_name}.`)
          if (invitation.existing_account) {
            try {
              await request('/api/auth/me')
              await request('/api/invitations/accept', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token: invite }),
              })
              const account = await request('/api/auth/me')
              if (!active) return
              setAuthUser(account)
              await Promise.all([refresh(), refreshWorkspaces()])
              setInvitationToken('')
            } catch (error) {
              if (error.status !== 401) throw error
            }
          }
        } else if (reset) {
          setResetToken(reset)
          setAuthMode('reset')
        } else {
          const account = await request('/api/auth/me')
          if (!active) return
          setAuthUser(account)
          await Promise.all([refresh(), refreshWorkspaces()])
        }
      } catch (error) {
        if (active && error.status !== 401) setAuthError(error.message)
      } finally {
        if (active) setAuthChecked(true)
      }
    }
    initializeAuth()
    return () => { active = false }
  }, [])

  useEffect(() => {
    if (modal !== 'invite' || globalUserQuery.trim().length < 2) {
      setGlobalUserResults([])
      return undefined
    }
    let active = true
    const timer = window.setTimeout(async () => {
      setGlobalSearchLoading(true)
      try {
        const results = await request(`/api/users/search?q=${encodeURIComponent(globalUserQuery.trim())}`)
        if (active) setGlobalUserResults(results)
      } catch (error) {
        if (active) notify(error.message)
      } finally {
        if (active) setGlobalSearchLoading(false)
      }
    }, 250)
    return () => {
      active = false
      window.clearTimeout(timer)
    }
  }, [modal, globalUserQuery])

  useEffect(() => {
    if (tab !== 'Activity' && tab !== 'Group') return undefined

    let active = true
    const query = tab === 'Group' && selectedGroupId
      ? `?groupId=${encodeURIComponent(selectedGroupId)}`
      : ''
    setActivityLoading(true)
    request(`/api/expenses${query}`)
      .then(rows => {
        if (active) setActivity(rows)
      })
      .catch(error => {
        if (active) setNotice(error.message)
      })
      .finally(() => {
        if (active) setActivityLoading(false)
      })
    return () => { active = false }
  }, [tab, selectedGroupId, reloadKey])

  const currentUser = data?.balances?.find(person => person.id === data.currentUserId)
  const groups = data?.groups || []
  const people = data?.people || []
  const myBalance = Number(currentUser?.balance || 0)
  const owedToMe = myBalance < 0 ? Math.abs(myBalance) : 0
  const owedByMe = myBalance > 0 ? myBalance : 0
  const selectedGroup = groups.find(group => group.id === Number(selectedGroupId))
  const selectedExpenseGroup = groups.find(group => group.id === Number(expenseGroupId))
  const normalizedSearch = search.trim().toLowerCase()

  const visibleActivity = useMemo(() => {
    const source = tab === 'Overview' ? data?.activity || [] : activity
    const cutoff = dateRange === 'all' ? 0 : Date.now() - Number(dateRange) * 24 * 60 * 60 * 1000
    return source.filter(expense => {
      const matchesSearch = `${expense.title} ${expense.group_name} ${expense.payer}`
        .toLowerCase()
        .includes(normalizedSearch)
      return matchesSearch && new Date(expense.created_at).getTime() >= cutoff
    })
  }, [activity, data, dateRange, normalizedSearch, tab])

  function openGroup(groupId) {
    setSelectedGroupId(Number(groupId))
    setTab('Group')
  }

  function openExpense() {
    const defaultGroup = selectedGroup?.members?.length
      ? selectedGroup
      : groups.find(group => group.members?.length)
    setExpenseGroupId(defaultGroup?.id || '')
    setModal('expense')
  }

  function notify(message) {
    setNotice(message)
    window.setTimeout(() => setNotice(''), 3200)
  }

  async function submitAuth(event) {
    event.preventDefault()
    setBusy(true)
    setAuthError('')
    const form = new FormData(event.currentTarget)
    const signingUp = authMode === 'signup'
    try {
      if (authMode === 'forgot') {
        const result = await request('/api/auth/forgot-password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: authEmail }),
        })
        setAuthNotice(result.message)
        return
      }
      if (authMode === 'reset') {
        const result = await request('/api/auth/reset-password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: resetToken, password: form.get('password') }),
        })
        setAuthMode('login')
        setResetToken('')
        setAuthNotice(result.message)
        return
      }
      await request(`/api/auth/${authMode}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: signingUp ? form.get('name') : undefined,
          email: authEmail,
          password: form.get('password'),
          invitationToken: signingUp ? invitationToken || undefined : undefined,
        }),
      })
      if (authMode === 'login' && invitationToken) {
        await request('/api/invitations/accept', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: invitationToken }),
        })
        setInvitationToken('')
      }
      const currentAccount = await request('/api/auth/me')
      setAuthUser(currentAccount)
      await Promise.all([refresh(), refreshWorkspaces()])
    } catch (error) {
      setAuthError(error.message)
    } finally {
      setBusy(false)
    }
  }

  async function signOut() {
    try {
      await request('/api/auth/logout', { method: 'POST' })
      setAuthUser(null)
      setData(null)
      setWorkspaces([])
      setAuthMode('login')
      setAuthError('')
      setAuthNotice('')
    } catch (error) {
      notify(error.message)
    }
  }

  async function switchWorkspace(workspaceId) {
    setBusy(true)
    try {
      await request('/api/workspaces/active', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceId }),
      })
      const account = await request('/api/auth/me')
      setAuthUser(account)
      await Promise.all([refresh(), refreshWorkspaces()])
      setTab('Overview')
      setSelectedGroupId(null)
      setWorkspaceMenuOpen(false)
      notify(`Switched to ${account.workspaceName}.`)
    } catch (error) {
      notify(error.message)
    } finally {
      setBusy(false)
    }
  }

  async function inviteGlobalUser(accountId) {
    setBusy(true)
    try {
      const result = await request('/api/invitations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountId }),
      })
      setManualInviteLink(result.invitationUrl || '')
      notify(result.message)
      setGlobalUserResults(results => results.filter(user => user.account_id !== accountId))
    } catch (error) {
      notify(error.message)
    } finally {
      setBusy(false)
    }
  }

  async function copyInviteLink() {
    try {
      await navigator.clipboard.writeText(manualInviteLink)
      notify('Invitation link copied.')
    } catch (error) {
      notify('Copy was blocked. Select and copy the invitation link manually.')
    }
  }

  async function shareInviteOnInstagram() {
    window.open('https://www.instagram.com/', '_blank', 'noopener,noreferrer')
    try {
      await navigator.clipboard.writeText(manualInviteLink)
      notify('Invitation link copied. Paste it into Instagram to share.')
    } catch (error) {
      notify('Instagram opened. Copy the invitation link above to share it.')
    }
  }

  async function shareSiteOnInstagram(url) {
    window.open('https://www.instagram.com/', '_blank', 'noopener,noreferrer')
    try {
      await navigator.clipboard.writeText(`Check out Lendwise, shared expenses made simple: ${url}`)
      notify('Lendwise link copied. Paste it into Instagram to share.')
    } catch (error) {
      notify('Instagram opened. Copy the website address to share it.')
    }
  }

  async function deletePerson(person) {
    if (!window.confirm(`Delete ${person.name} from this workspace? Users with expense or settlement history cannot be deleted.`)) {
      return
    }

    setBusy(true)
    try {
      const result = await request(`/api/people/${person.id}`, { method: 'DELETE' })
      await refresh()
      setReloadKey(key => key + 1)
      notify(result.message || 'User deleted from this workspace.')
    } catch (error) {
      notify(error.message)
    } finally {
      setBusy(false)
    }
  }

  async function submit(event) {
    event.preventDefault()
    setBusy(true)
    const form = new FormData(event.currentTarget)
    let url
    let payload
    let successMessage

    if (modal === 'invite') {
      url = '/api/invitations'
      payload = { email: form.get('email') }
      successMessage = 'Invitation email sent.'
    } else if (modal === 'person') {
      url = '/api/people'
      payload = { name: form.get('name') }
      successMessage = 'Person added.'
    } else if (modal === 'members') {
      url = `/api/groups/${selectedGroupId}/members`
      payload = { personIds: form.getAll('memberIds').map(Number) }
      successMessage = 'Group members updated.'
    } else if (modal === 'expense') {
      url = '/api/expenses'
      payload = {
        groupId: Number(form.get('groupId')),
        title: form.get('title'),
        amount: Number(form.get('amount')),
        paidBy: Number(form.get('paidBy')),
        category: form.get('category'),
        participants: form.getAll('participants').map(Number),
      }
      successMessage = 'Expense added.'
    } else if (modal === 'group') {
      url = '/api/groups'
      payload = {
        name: form.get('name'),
        icon: form.get('icon'),
        memberIds: form.getAll('memberIds').map(Number),
      }
      successMessage = 'Group created.'
    } else {
      url = '/api/settlements'
      payload = {
        payerId: Number(form.get('payerId')),
        payeeId: Number(form.get('payeeId')),
        amount: Number(form.get('amount')),
        note: form.get('note'),
      }
      successMessage = 'Settlement recorded.'
    }

    try {
      const result = await request(url, {
        method: modal === 'members' ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (result.invitationUrl) setManualInviteLink(result.invitationUrl)
      else setModal('')
      await refresh()
      setReloadKey(key => key + 1)
      notify(result.message || successMessage)
    } catch (error) {
      notify(error.message)
    } finally {
      setBusy(false)
    }
  }

  if (!authChecked) {
    return (
      <main className="startup-state">
        <LoaderCircle className="loading-icon" size={24} />
        <p>Loading your workspace…</p>
      </main>
    )
  }

  if (!authUser) {
    return (
      <main className="auth-page">
        <SiteShareButtons
          url={`${window.location.origin}${window.location.pathname}`}
          onInstagram={shareSiteOnInstagram}
          className="auth-site-share"
        />
        <section className="auth-showcase">
          <a className="brand auth-brand" href="#" onClick={event => event.preventDefault()}>
            <span className="brand-mark"><ArrowLeftRight size={19} /></span>
            <span>lendwise<span className="brand-dot">.</span></span>
          </a>
          <div className="auth-message">
            <span className="auth-kicker"><span className="live-dot" /> SHARED EXPENSES, MADE SIMPLE</span>
            <h1>Good company.<br /><span>Clear balances.</span></h1>
            <p>Create your account to organize groups, track shared costs, and settle up with confidence.</p>
            <div className="auth-orbit"><Users size={34} /><span><Check size={17} /></span></div>
          </div>
          <span className="auth-footer">Your groups and expenses, all in one place.</span>
        </section>
        <section className="auth-form-side">
          <div className="auth-form-wrap">
            <div className="auth-mobile-brand">
              <span className="brand-mark"><ArrowLeftRight size={18} /></span>
              <b>lendwise<span className="brand-dot">.</span></b>
            </div>
            <div className="auth-heading">
              <span className="eyebrow">{authMode === 'signup' ? 'GET STARTED' : authMode === 'reset' ? 'ACCOUNT SECURITY' : authMode === 'forgot' ? 'ACCOUNT RECOVERY' : 'WELCOME BACK'}</span>
              <h2>{authMode === 'signup' ? 'Create your account' : authMode === 'reset' ? 'Choose a new password' : authMode === 'forgot' ? 'Reset your password' : 'Sign in to Lendwise'}</h2>
              <p>{authMode === 'signup' ? invitationToken ? 'Create your account to join the invited workspace.' : 'A private workspace will be created for your account.' : authMode === 'reset' ? 'Use at least 12 characters for your new password.' : authMode === 'forgot' ? 'We’ll email you a secure password reset link.' : 'Pick up right where your group left off.'}</p>
            </div>
            {(authMode === 'login' || authMode === 'signup') && (
              <div className="auth-tabs">
                <button type="button" className={authMode === 'login' ? 'active' : ''} onClick={() => { setAuthMode('login'); setAuthError(''); setAuthNotice('') }}>Log in</button>
                <button type="button" className={authMode === 'signup' ? 'active' : ''} onClick={() => { setAuthMode('signup'); setAuthError(''); setAuthNotice('') }}>Sign up</button>
              </div>
            )}
            <form className="auth-form" onSubmit={submitAuth}>
              {authMode === 'signup' && (
                <label>Full name<input name="name" autoComplete="name" maxLength="255" placeholder="Your name" required /></label>
              )}
              {authMode !== 'reset' && (
                <label>Email address<input name="email" type="email" autoComplete="email" maxLength="254" placeholder="you@example.com" value={authEmail} onChange={event => setAuthEmail(event.target.value)} readOnly={authMode === 'signup' && Boolean(invitationToken)} required /></label>
              )}
              {authMode !== 'forgot' && (
                <label>{authMode === 'reset' ? 'New password' : 'Password'}<input name="password" type="password" autoComplete={authMode === 'signup' || authMode === 'reset' ? 'new-password' : 'current-password'} minLength={authMode === 'reset' ? '12' : '8'} maxLength="128" placeholder={authMode === 'signup' ? 'At least 8 characters' : authMode === 'reset' ? 'At least 12 characters' : 'Your password'} required /></label>
              )}
              {authNotice && <p className="auth-success" role="status">{authNotice}</p>}
              {authError && <p className="auth-error" role="alert">{authError}</p>}
              <button className="button button-dark auth-submit" disabled={busy}>
                {busy ? 'Please wait…' : authMode === 'signup' ? 'Create account' : authMode === 'reset' ? 'Reset password' : authMode === 'forgot' ? 'Send reset link' : 'Log in'}
                <ArrowRight size={16} />
              </button>
            </form>
            {authMode === 'login' && <button className="auth-text-button" type="button" onClick={() => { setAuthMode('forgot'); setAuthError(''); setAuthNotice('') }}>Forgot password?</button>}
            {(authMode === 'forgot' || authMode === 'reset') && <button className="auth-text-button" type="button" onClick={() => { setAuthMode('login'); setAuthError(''); setAuthNotice('') }}>Back to sign in</button>}
            <p className="auth-privacy"><CircleHelp size={14} /> Your account details are stored securely.</p>
          </div>
        </section>
      </main>
    )
  }

  if (!data) {
    return (
      <main className="startup-state">
        {authError ? (
          <section className="workspace-error">
            <h1>Your account is ready</h1>
            <p>{authError}</p>
            <p>Rebuild and restart the backend so its latest database schema is applied, then try again.</p>
            <div className="workspace-error-actions">
              <button className="button button-dark" onClick={() => refresh().catch(error => setAuthError(error.message))}>Try again</button>
              <button className="button button-light" onClick={signOut}>Sign out</button>
            </div>
          </section>
        ) : (
          <><LoaderCircle className="loading-icon" size={24} /><p>Loading your expense data…</p></>
        )}
      </main>
    )
  }

  const today = new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date())
  const firstName = currentUser?.name?.split(' ')[0] || 'there'
  const pageTitle = tab === 'Group' ? selectedGroup?.name || 'Group' : tab

  return (
    <div className="app">
      <aside className="sidebar">
        <a className="brand" href="#" onClick={event => { event.preventDefault(); setTab('Overview') }}>
          <span className="brand-mark"><ArrowLeftRight size={19} /></span>
          <span>lendwise<span className="brand-dot">.</span></span>
        </a>
        <div className="workspace-switcher">
          <button type="button" className="workspace" aria-expanded={workspaceMenuOpen} onClick={() => setWorkspaceMenuOpen(open => !open)}>
            <div className="workspace-icon">{currentUser?.initials || 'LW'}</div>
            <div><b>{authUser.workspaceName || 'Workspace'}</b><small>{currentUser?.name || authUser.name}</small></div>
            <ChevronDown size={15} className="muted" />
          </button>
          {workspaceMenuOpen && (
            <div className="workspace-menu">
              {workspaces.map(workspace => (
                <button type="button" key={workspace.id} disabled={busy || Number(workspace.id) === Number(authUser.workspaceId)} onClick={() => switchWorkspace(Number(workspace.id))}>
                  <span>{workspace.name}</span>
                  {Number(workspace.id) === Number(authUser.workspaceId) && <Check size={15} />}
                </button>
              ))}
              {workspaces.length < 2 && <span className="workspace-menu-empty">Join a workspace from an invitation to see it here.</span>}
            </div>
          )}
        </div>
        <div className="nav-label">WORKSPACE</div>
        <nav>
          {[[LayoutDashboard, 'Overview'], [Users, 'Users'], [Users, 'Groups'], [ReceiptText, 'Activity'], [ArrowLeftRight, 'Balances']].map(([Icon, name]) => (
            <button key={name} className={`nav-item ${tab === name ? 'active' : ''}`} onClick={() => setTab(name)}>
              <Icon size={18} />{name}
              {name === 'Activity' && <span className="nav-count">{data.activityCount || 0}</span>}
            </button>
          ))}
        </nav>
        <div className="nav-label groups-label">
          YOUR GROUPS
          <button aria-label="Create group" onClick={() => setModal('group')}><Plus size={15} /></button>
        </div>
        <div className="group-links">
          {groups.map(group => {
            const Icon = groupIcons[group.icon] || Users
            return (
              <button key={group.id} className="group-link" onClick={() => openGroup(group.id)}>
                <span className="group-ico" style={{ background: group.color }}><Icon size={15} /></span>
                <span>{group.name}</span>
              </button>
            )
          })}
        </div>
        <div className="sidebar-bottom">
          <button className="nav-item" disabled={people.length < 2} onClick={() => setModal('settlement')}><ArrowLeftRight size={18} />Record settlement</button>
          <div className="profile">
            <div className="avatar me">{currentUser?.initials || 'ME'}</div>
            <div className="profile-copy"><b>{currentUser?.name || authUser.name}</b><small>{authUser.email}</small></div>
            <button type="button" className="sign-out-button" onClick={signOut} aria-label="Sign out" title="Sign out"><LogOut size={17} /></button>
          </div>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div className="crumb">Workspace <span>/</span> <b>{pageTitle}</b></div>
          <div className="top-actions">
            <label className="search">
              <Search size={16} />
              <input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search expenses..." />
              <kbd>/</kbd>
            </label>
            <SiteShareButtons
              url={`${window.location.origin}${window.location.pathname}`}
              onInstagram={shareSiteOnInstagram}
            />
            <button className="icon-button" aria-label="Record settlement" title="Record settlement" disabled={people.length < 2} onClick={() => setModal('settlement')}>
              <ArrowLeftRight size={18} />
            </button>
            <button type="button" className="sign-out-top-button" onClick={signOut} aria-label="Sign out" title="Sign out"><LogOut size={17} /></button>
            <div className="top-avatar">{currentUser?.initials || 'ME'}</div>
          </div>
        </header>

        <div className="content">
          <div className="welcome-row">
            <div>
              <div className="eyebrow"><span className="live-dot" />{today}</div>
              <h1>{tab === 'Overview' ? <>Good day<span className="wave">, {firstName}</span></> : pageTitle}</h1>
              <p className="subtitle">
                {tab === 'Overview' && 'Here’s the latest on your shared expenses.'}
                {tab === 'Users' && 'Everyone added to this workspace.'}
                {tab === 'Groups' && 'Your shared circles and their expenses.'}
                {tab === 'Activity' && 'Every expense recorded across your groups.'}
                {tab === 'Balances' && 'See where everyone stands and record payments.'}
                {tab === 'Group' && 'Expenses and totals for this group.'}
              </p>
            </div>
            <div className="welcome-actions">
              <button className="button button-light" onClick={() => setModal('person')}><Plus size={16} />Add user</button>
              <button className="button button-light" onClick={() => { setGlobalUserQuery(''); setGlobalUserResults([]); setManualInviteLink(''); setModal('invite') }}><Plus size={16} />Invite user</button>
              <button className="button button-light" onClick={() => setModal('group')}><Plus size={16} />Create group</button>
              <button className="button button-dark" disabled={!groups.some(group => group.members?.length)} onClick={openExpense}><Plus size={17} />Add an expense</button>
            </div>
          </div>

          {notice && <div className="toast"><Check size={16} />{notice}</div>}

          {tab === 'Overview' && (
            <>
              <section className="balance-grid">
                <article className="balance-card total-card">
                  <div className="card-top">
                    <span className="card-title">YOUR NET BALANCE</span>
                    <span className="card-symbol dark-symbol"><ArrowLeftRight size={17} /></span>
                  </div>
                  <div className="amount">{myBalance < 0 ? '+' : myBalance > 0 ? '−' : ''}{money(myBalance)}</div>
                  <div className="balance-foot">
                    <span className="balance-indicator">{myBalance < 0 ? <ArrowDownLeft size={14} /> : <ArrowUpRight size={14} />}</span>
                    {myBalance < 0 ? 'You are owed overall' : myBalance > 0 ? 'You owe overall' : 'You are all settled up'}
                    <button className="plain-link" onClick={() => setTab('Balances')}>View balances <ArrowRight size={13} /></button>
                  </div>
                </article>
                <article className="balance-card positive-card">
                  <div className="card-top"><span className="card-title">YOU ARE OWED</span><span className="card-symbol green-symbol"><ArrowDownLeft size={17} /></span></div>
                  <div className="amount">{money(owedToMe)}</div>
                  <div className="small-detail"><span>Net amount owed to you</span></div>
                  <div className="card-bottom-line"><span /><span /></div>
                </article>
                <article className="balance-card negative-card">
                  <div className="card-top"><span className="card-title">YOU OWE</span><span className="card-symbol orange-symbol"><ArrowUpRight size={17} /></span></div>
                  <div className="amount">{money(owedByMe)}</div>
                  <div className="small-detail"><span>Net amount you owe</span></div>
                  <div className="card-bottom-line orange-line"><span /><span /></div>
                </article>
              </section>

              <section className="lower-grid">
                <div className="panel activity-panel">
                  <div className="panel-heading">
                    <div><div className="section-title">Recent activity <span className="title-count">{visibleActivity.length}</span></div><div className="section-subtitle">Latest expenses from your groups</div></div>
                    <button className="select-button" onClick={() => setTab('Activity')}>View all <ArrowRight size={14} /></button>
                  </div>
                  <ExpenseRows expenses={visibleActivity.slice(0, 6)} currentUser={currentUser} onGroupClick={openGroup} />
                  <button className="view-all" onClick={() => setTab('Activity')}>View all activity <ArrowRight size={14} /></button>
                </div>
                <div className="right-column">
                  <div className="panel groups-panel">
                    <div className="panel-heading">
                      <div><div className="section-title">Your groups <span className="title-count">{groups.length}</span></div><div className="section-subtitle">Shared circles, one place</div></div>
                      <button className="more-button" aria-label="Create group" onClick={() => setModal('group')}><Plus size={17} /></button>
                    </div>
                    <div className="group-list">
                      {groups.slice(0, 5).map(group => {
                        const Icon = groupIcons[group.icon] || Users
                        return (
                          <button className="group-row group-row-button" key={group.id} onClick={() => openGroup(group.id)}>
                            <span className="group-icon" style={{ background: group.color }}><Icon size={17} /></span>
                            <span className="group-name"><b>{group.name}</b><span>{group.members?.length || 0} members · {group.expenses} expenses</span></span>
                            <span className="group-total"><b>{money(group.total)}</b><span>total</span></span>
                          </button>
                        )
                      })}
                      {!groups.length && <div className="empty">Create a group to get started.</div>}
                    </div>
                    <button className="view-all" onClick={() => setTab('Groups')}>See all groups <ArrowRight size={14} /></button>
                  </div>
                  <div className="tip-card">
                    <div className="tip-top"><div className="tip-icon"><Coffee size={17} /></div><span>YOUR WORKSPACE</span></div>
                    <p><b>{groups.length}</b> {groups.length === 1 ? 'group' : 'groups'} · <b>{data.activityCount || 0}</b> expenses recorded</p>
                  </div>
                </div>
              </section>
            </>
          )}

          {tab === 'Groups' && (
            <section className="screen-panel">
              <div className="panel-heading screen-panel-heading">
                <div><div className="section-title">All groups <span className="title-count">{groups.length}</span></div><div className="section-subtitle">Select a group to see its expenses.</div></div>
              </div>
              {groups.length ? (
                <div className="group-grid">
                  {groups.map(group => {
                    const Icon = groupIcons[group.icon] || Users
                    return (
                      <button className="group-card" key={group.id} onClick={() => openGroup(group.id)}>
                        <span className="group-card-icon" style={{ background: group.color }}><Icon size={20} /></span>
                        <span className="group-card-name">{group.name}</span>
                        <span className="group-card-meta">{group.members?.length || 0} members · {group.expenses} {group.expenses === 1 ? 'expense' : 'expenses'}</span>
                        <strong>{money(group.total)}</strong>
                        <span className="group-card-link">Open group <ArrowRight size={14} /></span>
                      </button>
                    )
                  })}
                </div>
              ) : <div className="empty">No groups yet. Create one to start sharing expenses.</div>}
            </section>
          )}

          {tab === 'Users' && (
            <section className="screen-panel">
              <div className="panel-heading screen-panel-heading">
                <div>
                  <div className="section-title">All users <span className="title-count">{people.length}</span></div>
                  <div className="section-subtitle">Users added to {authUser.workspaceName || 'this workspace'}.</div>
                </div>
                <div className="user-screen-actions">
                  <button className="button button-light" onClick={() => setModal('person')}><Plus size={15} />Add user</button>
                  <button className="button button-dark" onClick={() => { setGlobalUserQuery(''); setGlobalUserResults([]); setManualInviteLink(''); setModal('invite') }}><Plus size={15} />Invite user</button>
                </div>
              </div>
              {people.length ? (
                <div className="workspace-user-list">
                  {people
                    .filter(person => person.name.toLowerCase().includes(normalizedSearch))
                    .map(person => {
                      const personBalance = Number(data.balances.find(balance => balance.id === person.id)?.balance || 0)
                      const memberOf = groups.filter(group => group.members?.some(member => member.id === person.id))
                      return (
                        <article className="workspace-user-row" key={person.id}>
                          <div className="avatar" style={{ background: person.color }}>{person.initials}</div>
                          <div className="workspace-user-copy">
                            <b>{person.name}{person.id === data.currentUserId ? ' (you)' : ''}</b>
                            <span>{memberOf.length ? memberOf.map(group => group.name).join(', ') : 'Not assigned to a group'}</span>
                          </div>
                          <div className={`workspace-user-balance ${personBalance < 0 ? 'is-owed' : personBalance > 0 ? 'is-owing' : ''}`}>
                            <b>{personBalance < 0 ? '+' : personBalance > 0 ? '−' : ''}{money(personBalance)}</b>
                            <span>{personBalance < 0 ? 'owed' : personBalance > 0 ? 'owes' : 'settled'}</span>
                          </div>
                          <button
                            className="user-delete-button"
                            type="button"
                            aria-label={`Delete ${person.name}`}
                            title={person.id === data.currentUserId ? 'You cannot delete yourself' : `Delete ${person.name}`}
                            disabled={busy || person.id === data.currentUserId}
                            onClick={() => deletePerson(person)}
                          >
                            <Trash2 size={15} />
                          </button>
                        </article>
                      )
                    })}
                  {!people.some(person => person.name.toLowerCase().includes(normalizedSearch)) && (
                    <div className="empty">No users match “{search}”.</div>
                  )}
                </div>
              ) : (
                <div className="empty">No users in this workspace yet. Add a user or invite someone to get started.</div>
              )}
            </section>
          )}

          {(tab === 'Activity' || tab === 'Group') && (
            <>
            {tab === 'Group' && selectedGroup && (
              <section className="panel screen-panel group-members-panel">
                <div className="panel-heading screen-panel-heading">
                  <div>
                    <div className="section-title">Group members <span className="title-count">{selectedGroup.members?.length || 0}</span></div>
                    <div className="section-subtitle">Users in this group are available to share its expenses.</div>
                  </div>
                  <button className="button button-light" onClick={() => setModal('members')}><Users size={15} />Manage members</button>
                </div>
                {selectedGroup.members?.length ? (
                  <div className="group-member-list">
                    {selectedGroup.members.map(person => (
                      <div className="group-member" key={person.id}>
                        <div className="avatar" style={{ background: person.color }}>{person.initials}</div>
                        <b>{person.name}</b>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="empty">No users in this group yet. Manage members to add users before recording expenses.</div>
                )}
              </section>
            )}
            <section className="panel screen-panel activity-screen">
              <div className="panel-heading screen-panel-heading">
                <div>
                  <div className="section-title">{tab === 'Group' ? 'Group expenses' : 'All activity'} <span className="title-count">{visibleActivity.length}</span></div>
                  <div className="section-subtitle">{tab === 'Group' ? 'Transactions saved to this group.' : 'Your expense history, loaded from the database.'}</div>
                </div>
                {tab === 'Group'
                  ? <button className="select-button" onClick={() => setTab('Groups')}><ArrowRight className="back-arrow" size={14} />All groups</button>
                  : <label className="select-button range-select"><CalendarDays size={14} /><select value={dateRange} onChange={event => setDateRange(event.target.value)}><option value="30">Last 30 days</option><option value="7">Last 7 days</option><option value="all">All time</option></select><ChevronDown size={14} /></label>}
              </div>
              {activityLoading
                ? <div className="empty"><LoaderCircle className="loading-icon" size={20} />Loading expenses…</div>
                : <ExpenseRows expenses={visibleActivity} currentUser={currentUser} onGroupClick={openGroup} />}
            </section>
            </>
          )}

          {tab === 'Balances' && (
            <section className="panel screen-panel">
              <div className="panel-heading screen-panel-heading">
                <div><div className="section-title">People & balances <span className="title-count">{data.balances.length}</span></div><div className="section-subtitle">Net balance calculated from expenses, splits, and settlements.</div></div>
                <button className="button button-light" onClick={() => setModal('person')}><Plus size={15} />Add user</button>
              </div>
              {data.balances.length ? <div className="balance-table">
                <div className="balance-table-header"><span>PERSON</span><span>NET BALANCE</span><span>STATUS</span></div>
                {data.balances.map(person => {
                  const isCurrentUser = person.id === data.currentUserId
                  const balance = Number(person.balance)
                  return (
                    <div className="balance-person-row" key={person.id}>
                      <div className="balance-person">
                        <div className="avatar" style={{ background: person.color }}>{person.initials}</div>
                        <div><b>{person.name}{isCurrentUser ? ' (you)' : ''}</b><span>Shared expense account</span></div>
                      </div>
                      <b className={`balance-value ${balance < 0 ? 'is-owed' : balance > 0 ? 'is-owing' : ''}`}>
                        {balance < 0 ? '+' : balance > 0 ? '−' : ''}{money(balance)}
                      </b>
                      <span className={`balance-status ${balance < 0 ? 'is-owed' : balance > 0 ? 'is-owing' : ''}`}>
                        {balance < 0 ? 'Owed overall' : balance > 0 ? 'Owes overall' : 'Settled'}
                      </span>
                    </div>
                  )
                })}
              </div> : <div className="empty">No people yet. Add a person to start setting up your workspace.</div>}
              {data.balances.length > 0 && <p className="balance-note">A positive sign means the person is owed money overall; a minus sign means they owe money overall.</p>}
            </section>
          )}

          <footer><span>Shared expenses, kept in sync.</span><span><CircleHelp size={13} /> Data saved to your database</span></footer>
        </div>
      </main>

      {modal && (
        <div className="overlay" onMouseDown={event => event.target === event.currentTarget && setModal('')}>
          <form className="modal" onSubmit={submit}>
            <div className="modal-top">
              <div><span className="eyebrow">LENDWISE</span><h2>{modal === 'person' ? 'Add a user' : modal === 'invite' ? 'Invite to workspace' : modal === 'members' ? 'Manage group members' : modal === 'expense' ? 'Add an expense' : modal === 'group' ? 'Create a group' : 'Record a settlement'}</h2></div>
              <button type="button" className="close" aria-label="Close" onClick={() => setModal('')}><X size={18} /></button>
            </div>

            {modal === 'person' && (
              <label>User's name<input required name="name" maxLength="255" autoFocus placeholder="Enter a name" /></label>
            )}

            {modal === 'invite' && (
              <>
                {!manualInviteLink && (
                  <>
                    <label>Search Lendwise users<input value={globalUserQuery} onChange={event => setGlobalUserQuery(event.target.value)} maxLength="80" autoFocus placeholder="Type a name (2 characters minimum)" /></label>
                    <div className="global-user-results" aria-live="polite">
                      {globalSearchLoading && <span className="form-hint">Searching…</span>}
                      {!globalSearchLoading && globalUserQuery.trim().length >= 2 && !globalUserResults.length && <span className="form-hint">No matching users available to invite.</span>}
                      {globalUserResults.map(user => (
                        <div className="global-user-result" key={user.account_id}>
                          <span className="avatar tiny">{user.name.split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase()}</span>
                          <b>{user.name}</b>
                          <button type="button" className="button button-light" disabled={busy} onClick={() => inviteGlobalUser(user.account_id)}>Invite</button>
                        </div>
                      ))}
                    </div>
                    <label>Or invite by email<input name="email" type="email" maxLength="254" placeholder="person@example.com" required /></label>
                    <p className="form-hint">Send an invitation to generate a link you can also share on Facebook, Instagram, WhatsApp, or Gmail.</p>
                  </>
                )}
                {manualInviteLink && (
                  <>
                    <p className="form-hint">Your invitation is ready to share.</p>
                    <div className="manual-invite">
                      <label>Share this invitation link<input readOnly value={manualInviteLink} onFocus={event => event.target.select()} /></label>
                      <button type="button" className="button button-light" onClick={copyInviteLink}>Copy link</button>
                    </div>
                    <InvitationShareButtons url={manualInviteLink} workspaceName={authUser.workspaceName || 'Lendwise'} onInstagram={shareInviteOnInstagram} />
                  </>
                )}
              </>
            )}

            {modal === 'expense' && (
              <>
                <label>What was it for?<input required name="title" maxLength="255" placeholder="Enter an expense name" /></label>
                <div className="form-row">
                  <label>Amount<input name="amount" type="number" min="0.01" step="0.01" placeholder="0.00" required /></label>
                  <label>Category<select name="category">{Object.keys(categoryIcons).map(category => <option key={category}>{category}</option>)}</select></label>
                </div>
                <label>Group<select name="groupId" required value={expenseGroupId} onChange={event => setExpenseGroupId(Number(event.target.value))}><option value="" disabled>Select a group</option>{groups.filter(group => group.members?.length).map(group => <option value={group.id} key={group.id}>{group.name}</option>)}</select></label>
                <label key={selectedExpenseGroup?.id}>Paid by<select name="paidBy" required defaultValue={selectedExpenseGroup?.members?.some(person => person.id === data.currentUserId) ? data.currentUserId : selectedExpenseGroup?.members?.[0]?.id || ''}>{(selectedExpenseGroup?.members || []).map(person => <option value={person.id} key={person.id}>{person.name}</option>)}</select></label>
                <fieldset className="participant-field" key={selectedExpenseGroup?.id}>
                  <legend>Split equally between</legend>
                  <div className="participant-list">
                    {(selectedExpenseGroup?.members || []).map(person => <label key={person.id}><input type="checkbox" name="participants" value={person.id} defaultChecked /><span className="avatar tiny" style={{ background: person.color }}>{person.initials}</span>{person.name}</label>)}
                  </div>
                </fieldset>
                <p className="form-hint">Choose who shares this expense. Any extra cents are split fairly.</p>
              </>
            )}

            {modal === 'group' && (
              <>
                <label>Group name<input required name="name" maxLength="255" placeholder="Enter a group name" /></label>
                <label>Group icon<select name="icon"><option value="users">People</option><option value="house">Home</option><option value="mountain">Travel</option></select></label>
                <fieldset className="participant-field">
                  <legend>Add users to this group</legend>
                  {people.length ? (
                    <div className="participant-list">
                      {people.map(person => <label key={person.id}><input type="checkbox" name="memberIds" value={person.id} /><span className="avatar tiny" style={{ background: person.color }}>{person.initials}</span>{person.name}</label>)}
                    </div>
                  ) : <p className="form-hint">Add users first, then you can assign them to this group.</p>}
                </fieldset>
              </>
            )}

            {modal === 'members' && selectedGroup && (
              <fieldset className="participant-field">
                <legend>Select users for {selectedGroup.name}</legend>
                {people.length ? (
                  <div className="participant-list">
                    {people.map(person => <label key={person.id}><input type="checkbox" name="memberIds" value={person.id} defaultChecked={selectedGroup.members?.some(member => member.id === person.id)} /><span className="avatar tiny" style={{ background: person.color }}>{person.initials}</span>{person.name}</label>)}
                  </div>
                ) : <p className="form-hint">Add users before assigning them to a group.</p>}
              </fieldset>
            )}

            {modal === 'settlement' && (
              <>
                <div className="form-row">
                  <label>Paid by<select name="payerId" required defaultValue={data.currentUserId}>{people.map(person => <option value={person.id} key={person.id}>{person.name}</option>)}</select></label>
                  <label>Paid to<select name="payeeId" required defaultValue={people.find(person => person.id !== data.currentUserId)?.id || ''}>{people.filter(person => person.id !== data.currentUserId).map(person => <option value={person.id} key={person.id}>{person.name}</option>)}</select></label>
                </div>
                <div className="form-row">
                  <label>Amount<input name="amount" type="number" min="0.01" step="0.01" placeholder="0.00" required /></label>
                  <label>Note<input name="note" maxLength="255" defaultValue="Settlement" required /></label>
                </div>
              </>
            )}

            {!(modal === 'invite' && manualInviteLink) && (
              <button className="button button-dark modal-submit" disabled={busy}>
                {busy ? 'Saving…' : modal === 'person' ? 'Add user' : modal === 'invite' ? 'Create invitation & show share buttons' : modal === 'members' ? 'Save members' : modal === 'expense' ? 'Save expense' : modal === 'group' ? 'Create group' : 'Save settlement'}
                <ArrowRight size={15} />
              </button>
            )}
          </form>
        </div>
      )}
    </div>
  )
}

export default App
