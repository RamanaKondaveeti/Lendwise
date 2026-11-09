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

function ExpenseRows({ expenses, currentUser, onGroupClick, onSettleExpense, showSettlement = false }) {
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
              <span>{showSettlement
                ? expense.outstanding_amount > 0 ? `${money(expense.outstanding_amount)} unpaid` : 'settled'
                : 'total'}</span>
            </div>
            {showSettlement && (
              expense.outstanding_amount > 0
                ? <button className="settle-expense-button" type="button" onClick={() => onSettleExpense(expense)}>Settle</button>
                : <span className="expense-settled" title="All shares are settled"><Check size={15} /></span>
            )}
          </div>
        )
      })}
    </div>
  )
}

function ShareServiceIcon({ service }) {
  if (service === 'facebook') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path fill="currentColor" d="M24 12.073C24 5.405 18.627 0 12 0S0 5.405 0 12.073C0 18.1 4.388 23.093 10.125 24v-8.437H7.078v-3.49h3.047V9.41c0-3.023 1.792-4.697 4.533-4.697 1.312 0 2.686.235 2.686.235v2.973h-1.513c-1.491 0-1.956.93-1.956 1.886v2.266h3.328l-.532 3.49h-2.796V24C19.612 23.093 24 18.1 24 12.073Z" />
      </svg>
    )
  }

  if (service === 'instagram') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <defs>
          <linearGradient id="instagram-gradient" x1="0" x2="1" y1="1" y2="0">
            <stop offset="0%" stopColor="#feda75" />
            <stop offset="50%" stopColor="#d62976" />
            <stop offset="100%" stopColor="#4f5bd5" />
          </linearGradient>
        </defs>
        <rect x="3" y="3" width="18" height="18" rx="5" fill="none" stroke="url(#instagram-gradient)" strokeWidth="2" />
        <circle cx="12" cy="12" r="4" fill="none" stroke="url(#instagram-gradient)" strokeWidth="2" />
        <circle cx="17.5" cy="6.8" r="1.2" fill="#d62976" />
      </svg>
    )
  }

  if (service === 'whatsapp') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path fill="currentColor" d="M20.52 3.48A11.86 11.86 0 0 0 12.08 0C5.48 0 .11 5.36.1 11.96c0 2.11.55 4.17 1.6 5.99L0 24l6.2-1.63a11.98 11.98 0 0 0 5.87 1.5h.01c6.6 0 11.97-5.37 11.98-11.97a11.9 11.9 0 0 0-3.54-8.42ZM12.08 21.83h-.01a9.9 9.9 0 0 1-5.04-1.38l-.36-.21-3.68.97.98-3.59-.23-.37a9.86 9.86 0 0 1-1.52-5.29c0-5.43 4.43-9.85 9.87-9.85a9.8 9.8 0 0 1 6.98 2.9 9.8 9.8 0 0 1 2.89 6.99c0 5.44-4.43 9.86-9.88 9.86Zm5.42-7.39c-.3-.15-1.77-.87-2.05-.97-.28-.1-.48-.15-.68.15-.2.3-.78.97-.95 1.17-.17.2-.35.22-.65.07-.3-.15-1.27-.47-2.42-1.5-.9-.8-1.5-1.78-1.68-2.08-.18-.3-.02-.46.13-.61.13-.13.3-.35.45-.53.15-.18.2-.3.3-.5.1-.2.05-.38-.02-.53-.08-.15-.68-1.63-.93-2.23-.24-.58-.49-.5-.68-.51l-.58-.01c-.2 0-.53.08-.81.38-.28.3-1.06 1.03-1.06 2.5s1.09 2.9 1.24 3.1c.15.2 2.14 3.27 5.19 4.58.72.31 1.28.5 1.72.64.72.23 1.38.2 1.9.12.58-.09 1.77-.73 2.02-1.43.25-.7.25-1.3.18-1.43-.08-.13-.28-.2-.58-.35Z" />
      </svg>
    )
  }

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#4285f4" d="M3 5.2v13.6h3.6V8.2L12 12.3l5.4-4.1v10.6H21V5.2l-3.6 2.7L12 12 6.6 7.9 3 5.2Z" />
      <path fill="#34a853" d="M3 18.8h3.6V8.2L3 5.2v13.6Z" />
      <path fill="#fbbc04" d="M17.4 8.2v10.6H21V5.2l-3.6 3Z" />
      <path fill="#ea4335" d="M3 5.2 6.6 8 12 12l5.4-4.1L21 5.2V4.5c0-1-.8-1.8-1.8-1.8h-.4L12 8.1 5.2 2.7h-.4C3.8 2.7 3 3.5 3 4.5v.7Z" />
    </svg>
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
          <span className="share-brand"><ShareServiceIcon service="facebook" /></span>Facebook
        </a>
        <button className="share-button share-instagram" type="button" onClick={onInstagram} title="Copy the invitation link and open Instagram">
          <span className="share-brand"><ShareServiceIcon service="instagram" /></span>Instagram
        </button>
        <a className="share-button share-whatsapp" href={`https://wa.me/?text=${encodedMessage}`} target="_blank" rel="noopener noreferrer">
          <span className="share-brand"><ShareServiceIcon service="whatsapp" /></span>WhatsApp
        </a>
        <a className="share-button share-gmail" href={`https://mail.google.com/mail/?view=cm&fs=1&su=${encodeURIComponent('Join my Lendwise workspace')}&body=${encodedMessage}`} target="_blank" rel="noopener noreferrer">
          <span className="share-brand"><ShareServiceIcon service="gmail" /></span>Gmail
        </a>
      </div>
      <span className="share-note">Instagram uses your device’s share sheet when available; otherwise, copy and paste the link.</span>
    </div>
  )
}

function SiteShareButtons({ url, onInstagram, className = '' }) {
  const message = `Check out Lendwise, shared expenses made simple: ${url}`
  const encodedMessage = encodeURIComponent(message)

  return (
    <div className={`site-share-buttons ${className}`} aria-label="Share Lendwise">
      <a className="site-share-button share-facebook" href={`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`} target="_blank" rel="noopener noreferrer" aria-label="Share on Facebook" title="Facebook">
        <ShareServiceIcon service="facebook" />
      </a>
      <button className="site-share-button share-instagram" type="button" onClick={() => onInstagram(url)} aria-label="Share on Instagram" title="Instagram">
        <ShareServiceIcon service="instagram" />
      </button>
      <a className="site-share-button share-whatsapp" href={`https://wa.me/?text=${encodedMessage}`} target="_blank" rel="noopener noreferrer" aria-label="Share on WhatsApp" title="WhatsApp">
        <ShareServiceIcon service="whatsapp" />
      </a>
      <a className="site-share-button share-gmail" href={`https://mail.google.com/mail/?view=cm&fs=1&su=${encodeURIComponent('Check out Lendwise')}&body=${encodedMessage}`} target="_blank" rel="noopener noreferrer" aria-label="Share by Gmail" title="Gmail">
        <ShareServiceIcon service="gmail" />
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
  const [expenseToSettle, setExpenseToSettle] = useState(null)
  const [settlementPlan, setSettlementPlan] = useState([])
  const [settlementDefaults, setSettlementDefaults] = useState(null)
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

  function openManualSettlement() {
    setSettlementDefaults(null)
    setModal('settlement')
  }

  function openExpenseSettlement(expense) {
    setExpenseToSettle(expense)
    setModal('expense-settlement')
  }

  function createSettlementPlan() {
    const userBalance = Math.round(Number(currentUser?.balance || 0) * 100)
    if (!userBalance) return []

    return data.balances
      .filter(person => person.id !== data.currentUserId &&
        (userBalance > 0 ? Number(person.balance) < 0 : Number(person.balance) > 0))
      .map(person => {
        const otherBalance = Math.round(Number(person.balance) * 100)
        const cents = Math.min(Math.abs(userBalance), Math.abs(otherBalance))
        const payer = userBalance > 0 ? currentUser : person
        const payee = userBalance > 0 ? person : currentUser
        return {
          payerId: payer.id,
          payer: payer.name,
          payeeId: payee.id,
          payee: payee.name,
          amount: cents / 100,
        }
      })
      .filter(payment => payment.amount > 0)
      .sort((left, right) => right.amount - left.amount)
  }

  function openSettleAll() {
    const plan = createSettlementPlan()
    if (!plan.length) {
      notify('Your balance is already clear.')
      return
    }
    setSettlementPlan(plan)
    setModal('settle-all')
  }

  function openPersonSettlement(person) {
    const personBalance = Number(person.balance)
    const userBalance = Number(currentUser?.balance || 0)
    if (!userBalance || !personBalance || Math.sign(personBalance) === Math.sign(userBalance)) return
    const payer = userBalance > 0 ? currentUser : person
    const payee = userBalance < 0 ? currentUser : person
    const amount = Math.min(Math.abs(userBalance), Math.abs(personBalance))
    setSettlementDefaults({ payerId: payer.id, payeeId: payee.id, amount: (Math.round(amount * 100) / 100).toFixed(2) })
    setModal('settlement')
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

  async function shareOnInstagram(url, message) {
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ title: 'Lendwise', text: message, url })
        return
      } catch (error) {
        if (error.name === 'AbortError') return
      }
    }

    window.open('https://www.instagram.com/', '_blank', 'noopener,noreferrer')
    try {
      await navigator.clipboard.writeText(`${message} ${url}`)
      notify('Lendwise link copied. Paste it into Instagram to share.')
    } catch (error) {
      notify('Instagram opened. Copy the invitation link to share it.')
    }
  }

  async function shareInviteOnInstagram() {
    return shareOnInstagram(manualInviteLink, `Join my ${authUser.workspaceName || 'Lendwise'} workspace on Lendwise:`)
  }

  async function shareSiteOnInstagram(url) {
    return shareOnInstagram(url, 'Check out Lendwise, shared expenses made simple:')
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
    const form = new FormData(event.currentTarget)
    let url
    let payload
    let successMessage

    if (modal === 'expense-settlement') {
      const personIds = form.getAll('personIds').map(Number)
      if (!personIds.length) {
        notify('Select at least one expense share to settle.')
        return
      }
      url = `/api/expenses/${expenseToSettle.id}/settle`
      payload = { personIds }
      successMessage = 'Selected expense shares settled.'
    } else if (modal === 'settle-all') {
      url = '/api/settlements/bulk'
      payload = { payments: settlementPlan.map(({ payerId, payeeId, amount }) => ({ payerId, payeeId, amount })) }
      successMessage = 'All suggested settlements recorded.'
    } else if (modal === 'invite') {
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

    setBusy(true)
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
          <button className="nav-item" disabled={people.length < 2} onClick={openManualSettlement}><ArrowLeftRight size={18} />Record settlement</button>
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
            <button className="icon-button" aria-label="Record settlement" title="Record settlement" disabled={people.length < 2} onClick={openManualSettlement}>
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
                : <ExpenseRows
                  expenses={visibleActivity}
                  currentUser={currentUser}
                  onGroupClick={openGroup}
                  onSettleExpense={openExpenseSettlement}
                  showSettlement
                />}
            </section>
            </>
          )}

          {tab === 'Balances' && (
            <section className="panel screen-panel">
              <div className="panel-heading screen-panel-heading">
                <div><div className="section-title">People & balances <span className="title-count">{data.balances.length}</span></div><div className="section-subtitle">Net balance calculated from expenses, splits, and settlements.</div></div>
                <div className="user-screen-actions">
                  <button className="button button-light" disabled={!Number(currentUser?.balance)} onClick={openSettleAll}><Check size={15} />Settle my balance</button>
                  <button className="button button-light" onClick={() => setModal('person')}><Plus size={15} />Add user</button>
                </div>
              </div>
              {data.balances.length ? <div className="balance-table">
                <div className="balance-table-header"><span>PERSON</span><span>NET BALANCE</span><span>STATUS</span><span /></div>
                {data.balances.map(person => {
                  const isCurrentUser = person.id === data.currentUserId
                  const balance = Number(person.balance)
                  const userBalance = Number(currentUser?.balance || 0)
                  const canSettle = !isCurrentUser && userBalance !== 0 && balance !== 0 &&
                    Math.sign(userBalance) !== Math.sign(balance)
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
                      {canSettle
                        ? <button className="button button-light balance-settle-button" onClick={() => openPersonSettlement(person)}>Settle</button>
                        : <span />}
                    </div>
                  )
                })}
              </div> : <div className="empty">No people yet. Add a person to start setting up your workspace.</div>}
              {data.balances.length > 0 && <p className="balance-note">A positive balance means the person owes money overall; a negative balance means they are owed money overall.</p>}
            </section>
          )}

          <footer><span>Shared expenses, kept in sync.</span><span><CircleHelp size={13} /> Data saved to your database</span></footer>
        </div>
      </main>

      {modal && (
        <div className="overlay" onMouseDown={event => event.target === event.currentTarget && setModal('')}>
          <form className="modal" onSubmit={submit}>
            <div className="modal-top">
              <div><span className="eyebrow">LENDWISE</span><h2>{modal === 'person' ? 'Add a user' : modal === 'invite' ? 'Invite to workspace' : modal === 'members' ? 'Manage group members' : modal === 'expense' ? 'Add an expense' : modal === 'group' ? 'Create a group' : modal === 'expense-settlement' ? 'Settle expense shares' : modal === 'settle-all' ? 'Settle your balance' : 'Record a settlement'}</h2></div>
              <button type="button" className="close" aria-label="Close" onClick={() => setModal('')}><X size={18} /></button>
            </div>

            {modal === 'person' && (
              <label>User's name<input required name="name" maxLength="255" autoFocus placeholder="Enter a name" /></label>
            )}

            {modal === 'expense-settlement' && expenseToSettle && (
              <>
                <p className="form-hint">Select who has paid their share of “{expenseToSettle.title}”. Payments are recorded to {expenseToSettle.payer}.</p>
                <div className="expense-settlement-list">
                  {expenseToSettle.shares
                    .filter(share => share.person_id !== expenseToSettle.payer_id && share.outstanding_amount > 0)
                    .map(share => (
                      <label className="expense-settlement-person" key={share.person_id}>
                        <input type="checkbox" name="personIds" value={share.person_id} />
                        <span>{share.name}</span>
                        <b>{money(share.outstanding_amount)}</b>
                      </label>
                    ))}
                </div>
              </>
            )}

            {modal === 'settle-all' && (
              <>
                <p className="form-hint">Review the suggested payments. Confirming records payments to clear your net balance. Other people’s balances may remain.</p>
                <div className="settlement-plan">
                  {settlementPlan.map((payment, index) => (
                    <div className="settlement-plan-row" key={`${payment.payerId}-${payment.payeeId}-${index}`}>
                      <span><b>{payment.payer}</b> pays <b>{payment.payee}</b></span>
                      <strong>{money(payment.amount)}</strong>
                    </div>
                  ))}
                </div>
                <div className="settlement-plan-total">
                  <span>Your balance to clear · {settlementPlan.length} {settlementPlan.length === 1 ? 'payment' : 'payments'}</span>
                  <b>{money(settlementPlan.reduce((total, payment) => total + payment.amount, 0))}</b>
                </div>
              </>
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
                  <label>Paid by<select name="payerId" required defaultValue={settlementDefaults?.payerId || data.currentUserId}>{people.map(person => <option value={person.id} key={person.id}>{person.name}</option>)}</select></label>
                  <label>Paid to<select name="payeeId" required defaultValue={settlementDefaults?.payeeId || people.find(person => person.id !== data.currentUserId)?.id || ''}>{people.filter(person => person.id !== (settlementDefaults?.payerId || data.currentUserId)).map(person => <option value={person.id} key={person.id}>{person.name}</option>)}</select></label>
                </div>
                <div className="form-row">
                  <label>Amount<input name="amount" type="number" min="0.01" step="0.01" defaultValue={settlementDefaults?.amount || ''} placeholder="0.00" required /></label>
                  <label>Note<input name="note" maxLength="255" defaultValue="Settlement" required /></label>
                </div>
              </>
            )}

            {!(modal === 'invite' && manualInviteLink) && (
              <button className="button button-dark modal-submit" disabled={busy}>
                {busy ? 'Saving…' : modal === 'person' ? 'Add user' : modal === 'invite' ? 'Create invitation & show share buttons' : modal === 'members' ? 'Save members' : modal === 'expense' ? 'Save expense' : modal === 'group' ? 'Create group' : modal === 'expense-settlement' ? 'Record selected shares paid' : modal === 'settle-all' ? 'Confirm & clear my balance' : 'Save settlement'}
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
