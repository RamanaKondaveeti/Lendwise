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
  Mountain,
  MoreHorizontal,
  Plus,
  ReceiptText,
  Search,
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
  if (!response.ok) throw new Error(body.error || 'The request could not be completed.')
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

function App() {
  const [data, setData] = useState(null)
  const [tab, setTab] = useState('Overview')
  const [selectedGroupId, setSelectedGroupId] = useState(null)
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

  useEffect(() => {
    refresh().catch(error => setNotice(error.message))
  }, [])

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

  function notify(message) {
    setNotice(message)
    window.setTimeout(() => setNotice(''), 3200)
  }

  async function submit(event) {
    event.preventDefault()
    setBusy(true)
    const form = new FormData(event.currentTarget)
    let url
    let payload
    let successMessage

    if (modal === 'person') {
      url = '/api/people'
      payload = { name: form.get('name') }
      successMessage = 'Person added.'
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
      payload = { name: form.get('name'), icon: form.get('icon') }
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
      await request(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      setModal('')
      await refresh()
      setReloadKey(key => key + 1)
      notify(successMessage)
    } catch (error) {
      notify(error.message)
    } finally {
      setBusy(false)
    }
  }

  if (!data) {
    return (
      <main className="startup-state">
        {notice
          ? <><p>{notice}</p><button className="button button-dark" onClick={() => refresh().catch(error => setNotice(error.message))}>Try again</button></>
          : <><LoaderCircle className="loading-icon" size={24} /><p>Loading your expense data…</p></>}
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
        <div className="workspace">
          <div className="workspace-icon">{currentUser?.initials || 'LW'}</div>
          <div><b>{currentUser?.name || 'Personal space'}</b><small>Personal account</small></div>
          <ChevronDown size={15} className="muted" />
        </div>
        <div className="nav-label">WORKSPACE</div>
        <nav>
          {[[LayoutDashboard, 'Overview'], [Users, 'Groups'], [ReceiptText, 'Activity'], [ArrowLeftRight, 'Balances']].map(([Icon, name]) => (
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
            <div className="profile-copy"><b>{currentUser?.name || 'You'}</b><small>Personal account</small></div>
            <MoreHorizontal size={18} className="muted" />
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
            <button className="icon-button" aria-label="Record settlement" title="Record settlement" disabled={people.length < 2} onClick={() => setModal('settlement')}>
              <ArrowLeftRight size={18} />
            </button>
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
                {tab === 'Groups' && 'Your shared circles and their expenses.'}
                {tab === 'Activity' && 'Every expense recorded across your groups.'}
                {tab === 'Balances' && 'See where everyone stands and record payments.'}
                {tab === 'Group' && 'Expenses and totals for this group.'}
              </p>
            </div>
            <div className="welcome-actions">
              <button className="button button-light" onClick={() => setModal('group')}><Plus size={16} />Create group</button>
              <button className="button button-dark" disabled={!people.length || !groups.length} onClick={() => setModal('expense')}><Plus size={17} />Add an expense</button>
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
                            <span className="group-name"><b>{group.name}</b><span>{group.expenses} expenses</span></span>
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
                        <span className="group-card-meta">{group.expenses} {group.expenses === 1 ? 'expense' : 'expenses'}</span>
                        <strong>{money(group.total)}</strong>
                        <span className="group-card-link">Open group <ArrowRight size={14} /></span>
                      </button>
                    )
                  })}
                </div>
              ) : <div className="empty">No groups yet. Create one to start sharing expenses.</div>}
            </section>
          )}

          {(tab === 'Activity' || tab === 'Group') && (
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
          )}

          {tab === 'Balances' && (
            <section className="panel screen-panel">
              <div className="panel-heading screen-panel-heading">
                <div><div className="section-title">People & balances <span className="title-count">{data.balances.length}</span></div><div className="section-subtitle">Net balance calculated from expenses, splits, and settlements.</div></div>
                <button className="button button-light" onClick={() => setModal('person')}><Plus size={15} />Add person</button>
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
              <div><span className="eyebrow">LENDWISE</span><h2>{modal === 'person' ? 'Add a person' : modal === 'expense' ? 'Add an expense' : modal === 'group' ? 'Create a group' : 'Record a settlement'}</h2></div>
              <button type="button" className="close" aria-label="Close" onClick={() => setModal('')}><X size={18} /></button>
            </div>

            {modal === 'person' && (
              <label>Person's name<input required name="name" maxLength="255" autoFocus placeholder="Enter a name" /></label>
            )}

            {modal === 'expense' && (
              <>
                <label>What was it for?<input required name="title" maxLength="255" placeholder="Enter an expense name" /></label>
                <div className="form-row">
                  <label>Amount<input name="amount" type="number" min="0.01" step="0.01" placeholder="0.00" required /></label>
                  <label>Category<select name="category">{Object.keys(categoryIcons).map(category => <option key={category}>{category}</option>)}</select></label>
                </div>
                <label>Group<select name="groupId" required defaultValue={selectedGroupId || ''}><option value="" disabled>Select a group</option>{groups.map(group => <option value={group.id} key={group.id}>{group.name}</option>)}</select></label>
                <label>Paid by<select name="paidBy" defaultValue={data.currentUserId}>{people.map(person => <option value={person.id} key={person.id}>{person.name}</option>)}</select></label>
                <fieldset className="participant-field">
                  <legend>Split equally between</legend>
                  <div className="participant-list">
                    {people.map(person => <label key={person.id}><input type="checkbox" name="participants" value={person.id} defaultChecked /><span className="avatar tiny" style={{ background: person.color }}>{person.initials}</span>{person.name}</label>)}
                  </div>
                </fieldset>
                <p className="form-hint">Choose who shares this expense. Any extra cents are split fairly.</p>
              </>
            )}

            {modal === 'group' && (
              <>
                <label>Group name<input required name="name" maxLength="255" placeholder="Enter a group name" /></label>
                <label>Group icon<select name="icon"><option value="users">People</option><option value="house">Home</option><option value="mountain">Travel</option></select></label>
              </>
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

            <button className="button button-dark modal-submit" disabled={busy}>
              {busy ? 'Saving…' : modal === 'person' ? 'Add person' : modal === 'expense' ? 'Save expense' : modal === 'group' ? 'Create group' : 'Save settlement'}
              <ArrowRight size={15} />
            </button>
          </form>
        </div>
      )}
    </div>
  )
}

export default App
