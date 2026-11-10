import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowRight,
  ArrowUpRight,
  Bell,
  CalendarDays,
  CalendarClock,
  CarFront,
  Check,
  CheckCheck,
  Clapperboard,
  ChevronDown,
  CircleHelp,
  Coffee,
  GraduationCap,
  HeartPulse,
  House,
  Lightbulb,
  LayoutDashboard,
  LoaderCircle,
  LogOut,
  Mountain,
  Plus,
  Pause,
  Play,
  Pencil,
  Plane,
  ReceiptText,
  Repeat,
  Search,
  Settings2,
  Trash2,
  Users,
  Utensils,
  ShoppingBasket,
  ShoppingBag,
  Zap,
  X,
} from 'lucide-react'
import { calculateMonthlyAnalytics, monthValue } from './analytics.mjs'

const groupIcons = { mountain: Mountain, house: House, users: Users }
const expenseCategories = [
  'Food & Dining',
  'Shopping',
  'Travel',
  'Rent',
  'Utilities & Bills',
  'Entertainment',
  'Groceries',
  'Healthcare',
  'Education',
  'Other',
]
const categoryIcons = {
  'Food & Dining': Utensils,
  'Food & drink': Utensils,
  Shopping: ShoppingBag,
  Travel: Plane,
  Rent: House,
  'Utilities & Bills': Lightbulb,
  Entertainment: Clapperboard,
  Groceries: ShoppingBasket,
  Healthcare: HeartPulse,
  Education: GraduationCap,
  Other: ReceiptText,
  Transport: CarFront,
  Utilities: Zap,
}
const categoryStyles = {
  'Food & Dining': 'food',
  'Food & drink': 'food',
  Shopping: 'shopping',
  Travel: 'transport',
  Rent: 'rent',
  'Utilities & Bills': 'utilities',
  Entertainment: 'entertainment',
  Groceries: 'food',
  Healthcare: 'healthcare',
  Education: 'education',
  Other: 'other',
  Transport: 'transport',
  Utilities: 'utilities',
}
const chartColors = ['#4f8b5b', '#83ad7d', '#a8c797', '#c4d8ac', '#e3b46b', '#d98c72', '#9d83b8', '#6f9fa4', '#d08fba', '#8e9b91']
const notificationLabels = {
  expense_created: 'Expense created',
  expense_updated: 'Expense updated',
  settlement_recorded: 'Settlement recorded',
  settlement_reminder: 'Settlement reminder',
  group_invitation: 'Group invitations',
  member_joined: 'Member joined',
  recurring_generated: 'Recurring expense generated',
  recurring_confirmation: 'Recurring amount confirmation',
}
const notificationIcon = type => {
  if (type.startsWith('expense_')) return ReceiptText
  if (type.startsWith('settlement_')) return ArrowLeftRight
  if (type.startsWith('recurring_')) return Repeat
  return Users
}
const equalSharePercentages = ids => {
  const base = Math.floor(10000 / Math.max(ids.length, 1))
  const remainder = 10000 % Math.max(ids.length, 1)
  return Object.fromEntries(ids.map((id, index) => [id, (base + (index < remainder ? 1 : 0)) / 100]))
}
const monthName = value => new Intl.DateTimeFormat('en-US', {
  month: 'long',
  year: 'numeric',
}).format(new Date(`${value}-01T12:00:00`))
const groupBalanceLabel = (balance, formatMoney) => {
  const amount = Number(balance || 0)
  if (!amount) return 'Settled'
  return amount > 0 ? `You owe ${formatMoney(amount)}` : `Owed to you ${formatMoney(amount)}`
}
const date = value => new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
}).format(new Date(value))
const notificationTimestamp = value => new Intl.DateTimeFormat('en-US', {
  dateStyle: 'medium',
  timeStyle: 'short',
}).format(new Date(value))

function MonthlyExpenseChart({ series, selectedMonth, onSelectMonth, formatMoney }) {
  const maximum = Math.max(1, ...series.map(item => item.total))
  const baseY = 126
  const chartHeight = 100

  return (
    <svg className="analytics-bar-chart" viewBox="0 0 620 158" role="img" aria-label="Monthly expenses for the selected year">
      {series.map((item, index) => {
        const height = Math.max(item.total > 0 ? 3 : 0, (item.total / maximum) * chartHeight)
        const x = 14 + index * 50
        const label = new Intl.DateTimeFormat('en-US', { month: 'short' }).format(new Date(`${item.month}-01T12:00:00`))
        return (
          <g
            key={item.month}
            className="analytics-bar"
            role="button"
            tabIndex="0"
            aria-label={`${monthName(item.month)}: ${formatMoney(item.total)}. Select this month.`}
            onClick={() => onSelectMonth(item.month)}
            onKeyDown={event => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                onSelectMonth(item.month)
              }
            }}
          >
            <title>{monthName(item.month)}: {formatMoney(item.total)}</title>
            <rect
              x={x}
              y={baseY - height}
              width="28"
              height={height}
              rx="5"
              className={item.month === selectedMonth ? 'analytics-bar-selected' : ''}
            />
            <text x={x + 14} y="148" textAnchor="middle">{label}</text>
          </g>
        )
      })}
    </svg>
  )
}

function CategoryDonutChart({ categories, total, formatMoney }) {
  const radius = 53
  const circumference = 2 * Math.PI * radius
  let offset = 0

  return (
    <div className="analytics-donut-layout">
      <svg className="analytics-donut" viewBox="0 0 160 160" role="img" aria-label="Monthly expenses by category">
        <circle cx="80" cy="80" r={radius} className="analytics-donut-track" />
        {categories.map((category, index) => {
          const length = total > 0 ? (category.amount / total) * circumference : 0
          const currentOffset = offset
          offset += length
          return (
            <circle
              key={category.name}
              cx="80"
              cy="80"
              r={radius}
              stroke={chartColors[index % chartColors.length]}
              strokeDasharray={`${length} ${circumference - length}`}
              strokeDashoffset={-currentOffset}
              className="analytics-donut-slice"
            >
              <title>{category.name}: {formatMoney(category.amount)}</title>
            </circle>
          )
        })}
        <text x="80" y="77" className="analytics-donut-total">{categories.length}</text>
        <text x="80" y="94" className="analytics-donut-caption">categories</text>
      </svg>
      <div className="analytics-legend">
        {categories.length ? categories.map((category, index) => (
          <div className="analytics-legend-row" key={category.name}>
            <span className="analytics-legend-name"><i style={{ background: chartColors[index % chartColors.length] }} />{category.name}</span>
            <b>{formatMoney(category.amount)}</b>
          </div>
        )) : <div className="analytics-empty">No category expenses for this month.</div>}
      </div>
    </div>
  )
}

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

function ExpenseRows({ expenses, currentUser, onGroupClick, onSettleExpense, onEditCategory, showSettlement = false, showShare = false, formatMoney }) {
  if (!expenses.length) return <div className="empty">No expenses to show yet.</div>

  return (
    <div className="data-list">
      {expenses.map(expense => {
        const Icon = categoryIcons[expense.category] || ReceiptText
        const categoryStyle = categoryStyles[expense.category] || 'other'
        const userShare = expense.shares?.find(share => share.person_id === currentUser?.id)
        const settlementStatus = !Array.isArray(expense.shares)
          ? 'Loading status'
          : expense.payer_id === currentUser?.id
            ? 'Paid by you'
            : !userShare || userShare.outstanding_amount <= 0
              ? 'Settled'
              : userShare.settled_amount > 0
                ? 'Partially paid'
                : 'Unpaid'
        return (
          <div className="activity-row" id={`expense-${expense.id}`} key={expense.id}>
            <div className={`activity-icon category-icon-${categoryStyle}`} title={expense.category || 'Other'}>
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
                <i>·</i>
                <span className="activity-category-label">{expense.category || 'Other'}</span>
              </span>
            </div>
            <div className="activity-payer">
              <div className="avatar tiny" style={{ background: expense.color }}>{expense.initials}</div>
              <span>{expense.payer_id === currentUser?.id ? 'You' : expense.payer}</span>
            </div>
            <div className="activity-amount">
              <b>{formatMoney(expense.amount)}</b>
              <span>{showSettlement
                ? expense.outstanding_amount > 0 ? `${formatMoney(expense.outstanding_amount)} unpaid` : 'settled'
                : showShare
                  ? `Your share ${formatMoney(userShare?.amount || 0)}`
                  : 'total'}</span>
              {showShare && <span className={`settlement-status status-${settlementStatus.toLowerCase().replace(/\s+/g, '-')}`}>{settlementStatus}</span>}
            </div>
            {(onEditCategory || showSettlement) && (
              <div className="activity-row-actions">
                {onEditCategory && (
                  <button className="edit-category-button" type="button" title="Edit category" aria-label={`Edit category for ${expense.title}`} onClick={() => onEditCategory(expense)}>
                    <Pencil size={14} />
                  </button>
                )}
                {showSettlement && (expense.outstanding_amount > 0
                  ? <button className="settle-expense-button" type="button" onClick={() => onSettleExpense(expense)}>Settle</button>
                  : <span className="expense-settled" title="All shares are settled"><Check size={15} /></span>)}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function RecurringExpenseFields({ groups, currency, exchangeRate, initial, currentUserId }) {
  const [groupId, setGroupId] = useState(Number(initial?.group_id || groups.find(group => group.members?.length)?.id || ''))
  const [splitMethod, setSplitMethod] = useState(initial?.split_method || 'equal')
  const [configuredCurrency, setConfiguredCurrency] = useState(initial?.currency || currency)
  const initialGroup = groups.find(group => Number(group.id) === groupId)
  const [participantIds, setParticipantIds] = useState(
    initial?.participants?.map(participant => Number(participant.person_id)) ||
      initialGroup?.members?.map(person => person.id) || []
  )
  const [payerId, setPayerId] = useState(Number(initial?.paid_by || currentUserId || initialGroup?.members?.[0]?.id || ''))
  const [sharePercentages, setSharePercentages] = useState(() => Object.fromEntries(
    (initialGroup?.members || []).map(person => {
      const saved = initial?.participants?.find(participant => Number(participant.person_id) === person.id)?.share_percent
      return [person.id, saved === null || saved === undefined ? equalSharePercentages(initialGroup.members.map(member => member.id))[person.id] : Number(saved)]
    })
  ))
  const selectedGroup = groups.find(group => Number(group.id) === groupId)
  const groupMembers = selectedGroup?.members || []
  const savedRate = initial && configuredCurrency === initial.currency
    ? Number(initial.exchange_rate_to_inr)
    : null
  const exchangeRateToInr = configuredCurrency === 'INR'
    ? 1
    : savedRate || (Number.isFinite(exchangeRate) && exchangeRate > 0 ? 1 / exchangeRate : null)
  const selectedPercentageTotal = participantIds.reduce(
    (total, personId) => total + Number(sharePercentages[personId] || 0),
    0
  )

  return (
    <>
      <label>Expense title<input required name="title" maxLength="255" defaultValue={initial?.title || ''} placeholder="e.g. Monthly rent" /></label>
      <label>Description<textarea name="description" maxLength="2000" defaultValue={initial?.description || ''} placeholder="Add details about this recurring expense" /></label>
      <label>Group
        <select name="groupId" required value={groupId} onChange={event => {
          const nextGroupId = Number(event.target.value)
          const members = groups.find(group => Number(group.id) === nextGroupId)?.members || []
          setGroupId(nextGroupId)
          setParticipantIds(members.map(person => person.id))
          setPayerId(members.some(person => person.id === Number(currentUserId))
            ? Number(currentUserId)
            : Number(members[0]?.id || ''))
          setSharePercentages(equalSharePercentages(members.map(person => person.id)))
        }}>
          {groups.filter(group => group.members?.length || Number(group.id) === groupId).map(group => <option value={group.id} key={group.id}>{group.name}</option>)}
        </select>
      </label>
      <label>Paid by
        <select name="paidBy" required value={payerId} onChange={event => setPayerId(Number(event.target.value))}>
          {groupMembers.map(person => <option value={person.id} key={person.id}>{person.name}</option>)}
        </select>
      </label>
      <div className="form-row">
        <label>Expected amount
          <input name="amount" type="number" min="0.01" step="0.01" defaultValue={initial?.amount || ''} placeholder="0.00" required disabled={configuredCurrency === 'USD' && !Number.isFinite(exchangeRateToInr)} />
        </label>
        <label>Currency
          <select name="currency" value={configuredCurrency} onChange={event => setConfiguredCurrency(event.target.value)}>
            <option value="INR">INR</option>
            <option value="USD">USD</option>
          </select>
        </label>
      </div>
      <input type="hidden" name="exchangeRateToInr" value={exchangeRateToInr || ''} />
      {configuredCurrency === 'USD' && !Number.isFinite(exchangeRateToInr) &&
        <p className="form-hint">A current USD exchange rate is required to save this recurring expense.</p>}
      <label>Category
        <select name="category" defaultValue={initial?.category || 'Other'}>
          {expenseCategories.map(category => <option key={category}>{category}</option>)}
        </select>
      </label>
      <label>Frequency
        <select name="frequency" defaultValue={initial?.frequency || 'monthly'}>
          <option value="weekly">Weekly</option>
          <option value="monthly">Monthly</option>
          <option value="quarterly">Quarterly</option>
          <option value="yearly">Yearly</option>
        </select>
      </label>
      <div className="form-row">
        <label>Start date<input name="startDate" type="date" defaultValue={initial?.start_date?.slice(0, 10) || new Date().toISOString().slice(0, 10)} required /></label>
        <label>End date (optional)<input name="endDate" type="date" defaultValue={initial?.end_date?.slice(0, 10) || ''} /></label>
      </div>
      <label className="recurring-toggle">
        <input type="checkbox" name="variableAmount" defaultChecked={Boolean(initial?.variable_amount)} />
        <span>Variable amount</span>
        <small>Ask for the actual bill amount on each due date.</small>
      </label>
      <label>Split method
        <select name="splitMethod" value={splitMethod} onChange={event => setSplitMethod(event.target.value)}>
          <option value="equal">Split equally</option>
          <option value="custom">Custom percentages</option>
        </select>
      </label>
      <fieldset className="participant-field">
        <legend>Participants</legend>
        {groupMembers.length ? (
          <div className="participant-list recurring-participant-list">
            {groupMembers.map(person => (
              <div className="recurring-participant-row" key={person.id}>
                <label>
                  <input
                    type="checkbox"
                    name="participantIds"
                    value={person.id}
                    checked={participantIds.includes(person.id)}
                    onChange={event => {
                      setParticipantIds(selected => event.target.checked
                        ? [...selected, person.id]
                        : selected.filter(id => id !== person.id))
                      if (event.target.checked) {
                        setSharePercentages(current => ({
                          ...current,
                          [person.id]: current[person.id] || 0.01,
                        }))
                      }
                    }}
                  />
                  <span className="avatar tiny" style={{ background: person.color }}>{person.initials}</span>
                  <span>{person.name}</span>
                </label>
                {splitMethod === 'custom' && participantIds.includes(person.id) && (
                  <span className="recurring-percent-input">
                    <input
                      type="number"
                      min="0.01"
                      max="100"
                      step="0.01"
                      name={`sharePercent-${person.id}`}
                      value={sharePercentages[person.id] ?? ''}
                      aria-label={`${person.name} split percentage`}
                      onChange={event => setSharePercentages(current => ({ ...current, [person.id]: event.target.value }))}
                      required
                    />
                    <small>%</small>
                  </span>
                )}
              </div>
            ))}
          </div>
        ) : <p className="form-hint">This group needs members before a recurring expense can be created.</p>}
      </fieldset>
      {splitMethod === 'custom' && (
        <p className={`form-hint ${Math.abs(selectedPercentageTotal - 100) > 0.01 ? 'recurring-share-invalid' : ''}`}>
          Selected shares total {selectedPercentageTotal.toFixed(2)}%; they must total 100%.
        </p>
      )}
    </>
  )
}

function SettlementSuggestions({ suggestions, formatMoney, onRecordSettlement, disabled }) {
  return (
    <section className="panel settlement-suggestions">
      <div className="panel-heading">
        <div>
          <div className="section-title">Suggested Settlements <span className="title-count">{suggestions.length}</span></div>
          <div className="section-subtitle">Minimum payments per group, based on current net balances.</div>
        </div>
      </div>
      {suggestions.length ? (
        <div className="suggested-settlement-list">
          {suggestions.map((payment, index) => (
            <article className="suggested-settlement-row" key={`${payment.groupId}-${payment.payerId}-${payment.payeeId}-${index}`}>
              <div className="suggested-settlement-flow">
                <span className="suggested-settlement-group">{payment.groupName}</span>
                <b>{payment.payer}</b><span>pays</span><b>{payment.payee}</b>
                <strong>{formatMoney(payment.amount)}</strong>
                <small>
                  After: {payment.payerRemaining > 0
                    ? `${payment.payer} owes ${formatMoney(payment.payerRemaining)}`
                    : `${payment.payer} is settled`}
                  {' · '}
                  {payment.payeeRemaining > 0
                    ? `${payment.payee} is still owed ${formatMoney(payment.payeeRemaining)}`
                    : `${payment.payee} is settled`}
                </small>
              </div>
              <button
                type="button"
                className="button button-light suggested-settlement-action"
                disabled={disabled}
                onClick={() => onRecordSettlement(payment)}
              >
                Record settlement
              </button>
            </article>
          ))}
        </div>
      ) : (
        <div className="empty settlement-suggestions-empty">All group balances are settled.</div>
      )}
    </section>
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
  const message = `Join my ${workspaceName} workspace on GroupBuk: ${url}`
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
        <a className="share-button share-gmail" href={`https://mail.google.com/mail/?view=cm&fs=1&su=${encodeURIComponent('Join my GroupBuk workspace')}&body=${encodedMessage}`} target="_blank" rel="noopener noreferrer">
          <span className="share-brand"><ShareServiceIcon service="gmail" /></span>Gmail
        </a>
      </div>
      <span className="share-note">Instagram uses your device’s share sheet when available; otherwise, copy and paste the link.</span>
    </div>
  )
}

function SiteShareButtons({ url, onInstagram, className = '' }) {
  const message = `Check out GroupBuk, shared expenses made simple: ${url}`
  const encodedMessage = encodeURIComponent(message)

  return (
    <div className={`site-share-buttons ${className}`} aria-label="Share GroupBuk">
      <a className="site-share-button share-facebook" href={`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`} target="_blank" rel="noopener noreferrer" aria-label="Share on Facebook" title="Facebook">
        <ShareServiceIcon service="facebook" />
      </a>
      <button className="site-share-button share-instagram" type="button" onClick={() => onInstagram(url)} aria-label="Share on Instagram" title="Instagram">
        <ShareServiceIcon service="instagram" />
      </button>
      <a className="site-share-button share-whatsapp" href={`https://wa.me/?text=${encodedMessage}`} target="_blank" rel="noopener noreferrer" aria-label="Share on WhatsApp" title="WhatsApp">
        <ShareServiceIcon service="whatsapp" />
      </a>
      <a className="site-share-button share-gmail" href={`https://mail.google.com/mail/?view=cm&fs=1&su=${encodeURIComponent('Check out GroupBuk')}&body=${encodedMessage}`} target="_blank" rel="noopener noreferrer" aria-label="Share by Gmail" title="Gmail">
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
  const [focusExpenseId, setFocusExpenseId] = useState(null)
  const [expenseGroupId, setExpenseGroupId] = useState('')
  const [expenseToSettle, setExpenseToSettle] = useState(null)
  const [expenseToEdit, setExpenseToEdit] = useState(null)
  const [settlementPlan, setSettlementPlan] = useState([])
  const [settlementDefaults, setSettlementDefaults] = useState(null)
  const [modal, setModal] = useState('')
  const [search, setSearch] = useState('')
  const [dateRange, setDateRange] = useState('30')
  const [activityCategory, setActivityCategory] = useState('all')
  const [analyticsGroup, setAnalyticsGroup] = useState('all')
  const [analyticsCategory, setAnalyticsCategory] = useState('all')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [activity, setActivity] = useState([])
  const [activityLoading, setActivityLoading] = useState(false)
  const [activityLoaded, setActivityLoaded] = useState(false)
  const [recurringTemplates, setRecurringTemplates] = useState([])
  const [recurringOccurrences, setRecurringOccurrences] = useState([])
  const [recurringLoading, setRecurringLoading] = useState(false)
  const [recurringEditing, setRecurringEditing] = useState(null)
  const [occurrenceToConfirm, setOccurrenceToConfirm] = useState(null)
  const recurringNoticeKeys = useRef(new Set())
  const notificationCenterRef = useRef(null)
  const [notifications, setNotifications] = useState([])
  const [unreadNotificationCount, setUnreadNotificationCount] = useState(0)
  const [notificationsHaveMore, setNotificationsHaveMore] = useState(false)
  const [notificationLimit, setNotificationLimit] = useState(25)
  const [notificationCenterOpen, setNotificationCenterOpen] = useState(false)
  const [notificationPreferencesOpen, setNotificationPreferencesOpen] = useState(false)
  const [notificationPreferences, setNotificationPreferences] = useState({
    expense_created: true,
    expense_updated: true,
    settlement_recorded: true,
    settlement_reminder: true,
    group_invitation: true,
    member_joined: true,
    recurring_generated: true,
    recurring_confirmation: true,
    settlement_reminder_frequency: 'weekly',
  })
  const [reloadKey, setReloadKey] = useState(0)
  const [selectedMonth, setSelectedMonth] = useState(() => monthValue(new Date()))
  const [currency, setCurrency] = useState(() => window.localStorage.getItem('groupbuk_currency') === 'USD' ? 'USD' : 'INR')
  const [exchangeRate, setExchangeRate] = useState(() => currency === 'INR' ? 1 : null)
  const [currencyLoading, setCurrencyLoading] = useState(false)

  const refresh = async () => {
    const summary = await request('/api/summary')
    setData(summary)
    setNotice('')
  }

  const refreshWorkspaces = async () => {
    setWorkspaces(await request('/api/workspaces'))
  }

  const refreshNotifications = async (limit = notificationLimit, offset = 0, merge = false) => {
    const result = await request(`/api/notifications?limit=${limit}&offset=${offset}`)
    if (merge) {
      setNotifications(current => {
        const merged = new Map([...current, ...result.notifications].map(notification => [notification.id, notification]))
        return [...merged.values()]
          .sort((left, right) => new Date(right.created_at) - new Date(left.created_at))
          .slice(0, offset > 0 ? current.length + result.notifications.length : Math.max(current.length, limit))
      })
    } else {
      setNotifications(result.notifications)
    }
    setUnreadNotificationCount(result.unreadCount)
    setNotificationsHaveMore(result.hasMore)
    return result
  }

  const refreshNotificationPreferences = async () => {
    setNotificationPreferences(await request('/api/notification-preferences'))
  }

  const refreshRecurring = async () => {
    const result = await request('/api/recurring-expenses')
    setRecurringTemplates(result.templates)
    setRecurringOccurrences(result.occurrences)
    return result
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
    if (!authUser) return undefined
    let active = true
    const loadNotifications = async () => {
      try {
        await refreshNotifications(notificationLimit, 0, true)
      } catch (error) {
        if (active) setNotice(error.message)
      }
    }
    loadNotifications()
    const timer = window.setInterval(loadNotifications, 30 * 1000)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [authUser?.id, notificationLimit])

  useEffect(() => {
    if (!authUser) return undefined
    let active = true
    refreshNotificationPreferences().catch(error => {
      if (active) setNotice(error.message)
    })
    return () => { active = false }
  }, [authUser?.id])

  useEffect(() => {
    if (!notificationCenterOpen) return undefined
    const closeOnOutsideClick = event => {
      if (!notificationCenterRef.current?.contains(event.target)) {
        setNotificationCenterOpen(false)
        setNotificationPreferencesOpen(false)
      }
    }
    document.addEventListener('pointerdown', closeOnOutsideClick)
    return () => document.removeEventListener('pointerdown', closeOnOutsideClick)
  }, [notificationCenterOpen])

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
    if (tab !== 'Overview' && tab !== 'Activity' && tab !== 'Group') return undefined

    let active = true
    const query = tab === 'Group' && selectedGroupId
      ? `?groupId=${encodeURIComponent(selectedGroupId)}`
      : ''
    setActivityLoading(true)
    request(`/api/expenses${query}`)
      .then(rows => {
        if (active) {
          setActivity(rows)
          setActivityLoaded(true)
        }
      })
      .catch(error => {
        if (active) setNotice(error.message)
      })
      .finally(() => {
        if (active) setActivityLoading(false)
      })
    return () => { active = false }
  }, [tab, selectedGroupId, reloadKey])

  useEffect(() => {
    if (!authUser || (tab !== 'Overview' && tab !== 'Recurring')) return undefined
    let active = true
    const loadRecurring = async () => {
      setRecurringLoading(true)
      try {
        const result = await request('/api/recurring-expenses')
        if (!active) return
        setRecurringTemplates(result.templates)
        setRecurringOccurrences(result.occurrences)
        const recentlyGenerated = result.occurrences.filter(occurrence =>
          occurrence.status === 'needs_confirmation' ||
          (occurrence.status === 'generated' &&
            Date.now() - new Date(occurrence.generated_at).getTime() < 24 * 60 * 60 * 1000)
        )
        const newOccurrences = recentlyGenerated.filter(occurrence => {
          const key = `${authUser.workspaceId}:${occurrence.id}`
          if (recurringNoticeKeys.current.has(key)) return false
          recurringNoticeKeys.current.add(key)
          return true
        })
        if (newOccurrences.some(occurrence => occurrence.status === 'generated')) {
          await refresh()
          if (!active) return
          setReloadKey(key => key + 1)
        }
        if (!active) return
        if (newOccurrences.some(occurrence => occurrence.status === 'needs_confirmation')) {
          notify('A variable recurring expense needs its actual amount confirmed.')
        } else if (newOccurrences.some(occurrence => occurrence.status === 'generated')) {
          notify('A recurring expense was generated and added to your balances.')
        }
      } catch (error) {
        if (active) setNotice(error.message)
      } finally {
        if (active) setRecurringLoading(false)
      }
    }
    loadRecurring()
    const timer = window.setInterval(loadRecurring, 60 * 1000)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [tab, authUser?.workspaceId])

  useEffect(() => {
    if (tab !== 'Activity' || !activityLoaded || !focusExpenseId) return undefined
    const row = document.getElementById(`expense-${focusExpenseId}`)
    if (!row) return undefined
    row.scrollIntoView({ behavior: 'smooth', block: 'center' })
    row.classList.add('notification-expense-focus')
    const timer = window.setTimeout(() => {
      row.classList.remove('notification-expense-focus')
      setFocusExpenseId(null)
    }, 2400)
    return () => window.clearTimeout(timer)
  }, [tab, activity, activityLoaded, focusExpenseId])

  useEffect(() => {
    window.localStorage.setItem('groupbuk_currency', currency)
    if (currency === 'INR') {
      setExchangeRate(1)
      setCurrencyLoading(false)
      return undefined
    }

    const controller = new AbortController()
    let active = true
    setCurrencyLoading(true)
    setExchangeRate(null)
    fetch('https://api.frankfurter.dev/v1/latest?base=INR&symbols=USD', { signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error('Could not load the latest exchange rate.')
        const result = await response.json()
        const rate = Number(result.rates?.USD)
        if (!Number.isFinite(rate) || rate <= 0) throw new Error('The exchange-rate response was invalid.')
        return rate
      })
      .then(rate => {
        if (active) setExchangeRate(rate)
      })
      .catch(error => {
        if (active && error.name !== 'AbortError') notify(`${error.message} Select INR or try again later.`)
      })
      .finally(() => {
        if (active) setCurrencyLoading(false)
      })

    return () => {
      active = false
      controller.abort()
    }
  }, [currency])

  const currentUser = data?.balances?.find(person => person.id === data.currentUserId)
  const groups = data?.groups || []
  const people = data?.people || []
  const myBalance = Number(currentUser?.balance || 0)
  const owedToMe = myBalance < 0 ? Math.abs(myBalance) : 0
  const owedByMe = myBalance > 0 ? myBalance : 0
  const selectedGroup = groups.find(group => group.id === Number(selectedGroupId))
  const selectedExpenseGroup = groups.find(group => group.id === Number(expenseGroupId))
  const settlementGroup = groups.find(group => group.id === Number(settlementDefaults?.groupId))
  const settlementPeople = settlementGroup ? settlementGroup.balance_people || [] : people
  const suggestedSettlements = groups.flatMap(group => group.settlement_suggestions || [])
  const normalizedSearch = search.trim().toLowerCase()
  const currentMonth = monthValue(new Date())
  const formatMoney = amount => {
    if (!Number.isFinite(exchangeRate)) return '—'
    return new Intl.NumberFormat(currency === 'INR' ? 'en-IN' : 'en-US', {
      style: 'currency',
      currency,
    }).format(Math.abs(Number(amount) * exchangeRate || 0))
  }
  const toStoredAmount = amount => Math.round((Number(amount) / exchangeRate) * 100) / 100
  const availableYears = [...new Set([
    currentMonth,
    selectedMonth,
    ...activity.map(expense => monthValue(expense.created_at)),
  ].map(month => month.slice(0, 4)))]
  const monthOptions = availableYears
    .flatMap(year => Array.from({ length: 12 }, (_, index) => `${year}-${String(index + 1).padStart(2, '0')}`))
    .sort((left, right) => right.localeCompare(left))
  const categoryOptions = [...new Set([
    ...expenseCategories,
    ...(data?.activity || []).map(expense => expense.category || 'Other'),
    ...activity.map(expense => expense.category || 'Other'),
  ])].sort((left, right) => left.localeCompare(right))
  const unassignedBalance = Math.round((myBalance - groups.reduce(
    (total, group) => total + Number(group.user_balance || 0),
    0
  )) * 100) / 100
  const monthlyExpenses = activity.filter(expense => {
    return monthValue(expense.created_at) === selectedMonth
  })
  const monthlyTotal = monthlyExpenses.reduce((total, expense) => total + Number(expense.amount || 0), 0)
  const analyticsSource = activityLoaded ? activity : data?.activity || []
  const monthlyAnalytics = useMemo(() => calculateMonthlyAnalytics(
    analyticsSource,
    data?.currentUserId,
    selectedMonth,
    analyticsGroup,
    analyticsCategory,
  ), [analyticsCategory, analyticsGroup, analyticsSource, data?.currentUserId, selectedMonth])

  const visibleActivity = useMemo(() => {
    const source = tab === 'Overview' && !activityLoaded ? data?.activity || [] : activity
    const cutoff = dateRange === 'all' ? 0 : Date.now() - Number(dateRange) * 24 * 60 * 60 * 1000
    return source.filter(expense => {
      const matchesSearch = `${expense.title} ${expense.group_name} ${expense.payer}`
        .toLowerCase()
        .includes(normalizedSearch)
      const matchesCategory = !['Activity', 'Group'].includes(tab) ||
        activityCategory === 'all' || (expense.category || 'Other') === activityCategory
      return matchesSearch && matchesCategory && new Date(expense.created_at).getTime() >= cutoff
    })
  }, [activity, activityCategory, activityLoaded, data, dateRange, normalizedSearch, tab])

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

  function openGroupSettlement(group, suggestion = group.settlement_suggestion) {
    if (!suggestion || !Number.isFinite(exchangeRate)) return
    setSettlementDefaults({
      payerId: suggestion.payerId,
      payeeId: suggestion.payeeId,
      amount: (suggestion.amount * exchangeRate).toFixed(2),
      groupId: group.id,
    })
    setModal('settlement')
  }

  function openExpenseSettlement(expense) {
    setExpenseToSettle(expense)
    setModal('expense-settlement')
  }

  function openExpenseCategoryEdit(expense) {
    setExpenseToEdit(expense)
    setModal('expense-category')
  }

  function openRecurringEditor(template = null) {
    setRecurringEditing(template)
    setModal(template ? 'recurring-edit' : 'recurring')
  }

  function openOccurrenceConfirmation(occurrence) {
    setOccurrenceToConfirm(occurrence)
    setModal('recurring-confirm')
  }

  async function setRecurringStatus(template, status) {
    setBusy(true)
    try {
      const result = await request(`/api/recurring-expenses/${template.id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      await refreshRecurring()
      notify(result.message)
    } catch (error) {
      notify(error.message)
    } finally {
      setBusy(false)
    }
  }

  async function deactivateRecurring(template) {
    if (!window.confirm(`Deactivate “${template.title}”? Its generated expense history will remain.`)) return
    setBusy(true)
    try {
      const result = await request(`/api/recurring-expenses/${template.id}`, { method: 'DELETE' })
      await refreshRecurring()
      notify(result.message)
    } catch (error) {
      notify(error.message)
    } finally {
      setBusy(false)
    }
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
    if (!Number.isFinite(exchangeRate)) {
      notify('Wait for the currency rate to load before recording a settlement.')
      return
    }
    const personBalance = Number(person.balance)
    const userBalance = Number(currentUser?.balance || 0)
    if (!userBalance || !personBalance || Math.sign(personBalance) === Math.sign(userBalance)) return
    const payer = userBalance > 0 ? currentUser : person
    const payee = userBalance < 0 ? currentUser : person
    const amount = Math.min(Math.abs(userBalance), Math.abs(personBalance))
    setSettlementDefaults({ payerId: payer.id, payeeId: payee.id, amount: (Math.round(amount * 100) / 100 * exchangeRate).toFixed(2) })
    setModal('settlement')
  }

  function notify(message) {
    setNotice(message)
    window.setTimeout(() => setNotice(''), 3200)
  }

  async function saveNotificationPreferences(patch) {
    try {
      setNotificationPreferences(await request('/api/notification-preferences', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      }))
    } catch (error) {
      notify(error.message)
    }
  }

  async function markNotificationRead(notificationId) {
    try {
      await request(`/api/notifications/${notificationId}/read`, { method: 'PATCH' })
      await refreshNotifications()
    } catch (error) {
      notify(error.message)
    }
  }

  async function markAllNotificationsRead() {
    try {
      await request('/api/notifications/read-all', { method: 'POST' })
      await refreshNotifications()
    } catch (error) {
      notify(error.message)
    }
  }

  async function dismissNotification(notificationId) {
    try {
      await request(`/api/notifications/${notificationId}`, { method: 'DELETE' })
      await refreshNotifications()
    } catch (error) {
      notify(error.message)
    }
  }

  async function openNotification(notification) {
    if (notification.target_type === 'invitation') {
      notify('Accept the invitation here to join the workspace.')
      return
    }
    if (Number(notification.workspace_id) !== Number(authUser.workspaceId)) {
      const workspace = workspaces.find(item => Number(item.id) === Number(notification.workspace_id))
      if (!workspace) {
        notify(`Switch to ${notification.workspace_name} to open this notification.`)
        return
      }
      if (!await switchWorkspace(Number(workspace.id))) return
    }
    if (!notification.read_at) await markNotificationRead(notification.id)
    setNotificationCenterOpen(false)
    if (notification.target_type === 'expense') {
      setSearch('')
      setDateRange('all')
      setActivityCategory('all')
      setSelectedGroupId(null)
      setFocusExpenseId(Number(notification.target_id))
      setTab('Activity')
    } else if (notification.target_type === 'group') {
      openGroup(notification.target_id)
    } else if (notification.target_type === 'settlement') {
      setTab('Balances')
    } else if (notification.target_type === 'recurring') {
      const result = await refreshRecurring()
      const occurrence = result.occurrences.find(item =>
        Number(item.template_id) === Number(notification.target_id) &&
        (!notification.target_date || item.occurrence_date.slice(0, 10) === notification.target_date.slice(0, 10))
      )
      if (notification.notification_type === 'recurring_confirmation' && occurrence) {
        openOccurrenceConfirmation(occurrence)
      } else {
        setTab('Recurring')
      }
    } else {
      setTab('Groups')
    }
  }

  async function acceptNotificationInvitation(notification) {
    setBusy(true)
    try {
      await request('/api/invitations/accept', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invitationId: Number(notification.target_id) }),
      })
      const account = await request('/api/auth/me')
      setAuthUser(account)
      await Promise.all([refresh(), refreshWorkspaces(), refreshNotifications()])
      setTab('Overview')
      setSelectedGroupId(null)
      setActivity([])
      setActivityLoaded(false)
      setRecurringTemplates([])
      setRecurringOccurrences([])
      recurringNoticeKeys.current.clear()
      setReloadKey(key => key + 1)
      setNotificationCenterOpen(false)
      notify(`Joined ${account.workspaceName}.`)
    } catch (error) {
      notify(error.message)
    } finally {
      setBusy(false)
    }
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
      setRecurringTemplates([])
      setRecurringOccurrences([])
      recurringNoticeKeys.current.clear()
      setNotifications([])
      setUnreadNotificationCount(0)
      setNotificationsHaveMore(false)
      setNotificationCenterOpen(false)
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
      setActivity([])
      setActivityLoaded(false)
      setRecurringTemplates([])
      setRecurringOccurrences([])
      recurringNoticeKeys.current.clear()
      setReloadKey(key => key + 1)
      notify(`Switched to ${account.workspaceName}.`)
      return true
    } catch (error) {
      notify(error.message)
      return false
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
        await navigator.share({ title: 'GroupBuk', text: message, url })
        return
      } catch (error) {
        if (error.name === 'AbortError') return
      }
    }

    window.open('https://www.instagram.com/', '_blank', 'noopener,noreferrer')
    try {
      await navigator.clipboard.writeText(`${message} ${url}`)
      notify('GroupBuk link copied. Paste it into Instagram to share.')
    } catch (error) {
      notify('Instagram opened. Copy the invitation link to share it.')
    }
  }

  async function shareInviteOnInstagram() {
    return shareOnInstagram(manualInviteLink, `Join my ${authUser.workspaceName || 'GroupBuk'} workspace on GroupBuk:`)
  }

  async function shareSiteOnInstagram(url) {
    return shareOnInstagram(url, 'Check out GroupBuk, shared expenses made simple:')
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
    if (['expense', 'expense-settlement', 'settlement'].includes(modal) && !Number.isFinite(exchangeRate)) {
      notify('A current currency rate is required before saving this amount.')
      return
    }
    const form = new FormData(event.currentTarget)
    if (['recurring', 'recurring-edit'].includes(modal) &&
        (!Number.isFinite(Number(form.get('exchangeRateToInr'))) || Number(form.get('exchangeRateToInr')) <= 0)) {
      notify('A current exchange rate is required before saving this recurring expense.')
      return
    }
    let url
    let payload
    let successMessage

    if (modal === 'expense-settlement') {
      const personIds = form.getAll('personIds').map(Number)
      if (!personIds.length) {
        notify('Select at least one expense share to settle.')
        return
      }
      const payments = personIds.map(personId => ({
        personId,
        amount: toStoredAmount(form.get(`amount-${personId}`)),
      }))
      if (payments.some(payment => !Number.isFinite(payment.amount) || payment.amount <= 0)) {
        notify('Enter a valid payment amount for each selected share.')
        return
      }
      url = `/api/expenses/${expenseToSettle.id}/settle`
      payload = { payments }
      successMessage = 'Selected expense payments recorded.'
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
        amount: toStoredAmount(form.get('amount')),
        paidBy: Number(form.get('paidBy')),
        category: form.get('category'),
        participants: form.getAll('participants').map(Number),
      }
      successMessage = 'Expense added.'
    } else if (modal === 'expense-category') {
      url = `/api/expenses/${expenseToEdit.id}/category`
      payload = { category: form.get('category') }
      successMessage = 'Expense category updated.'
    } else if (modal === 'recurring' || modal === 'recurring-edit') {
      const splitMethod = form.get('splitMethod')
      const participantIds = form.getAll('participantIds').map(Number)
      url = modal === 'recurring-edit'
        ? `/api/recurring-expenses/${recurringEditing.id}`
        : '/api/recurring-expenses'
      payload = {
        title: form.get('title'),
        description: form.get('description'),
        groupId: Number(form.get('groupId')),
        paidBy: Number(form.get('paidBy')),
        amount: Number(form.get('amount')),
        currency: form.get('currency'),
        exchangeRateToInr: Number(form.get('exchangeRateToInr')),
        category: form.get('category'),
        splitMethod,
        participants: participantIds.map(personId => ({
          personId,
          sharePercent: splitMethod === 'custom' ? Number(form.get(`sharePercent-${personId}`)) : null,
        })),
        variableAmount: form.get('variableAmount') === 'on',
        frequency: form.get('frequency'),
        startDate: form.get('startDate'),
        endDate: form.get('endDate') || null,
      }
      successMessage = modal === 'recurring-edit' ? 'Recurring expense updated.' : 'Recurring expense created.'
    } else if (modal === 'recurring-confirm') {
      url = `/api/recurring-expenses/${occurrenceToConfirm.template_id}/occurrences/${encodeURIComponent(occurrenceToConfirm.occurrence_date.slice(0, 10))}/confirm`
      payload = { amount: Number(form.get('amount')) }
      successMessage = 'Recurring expense recorded.'
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
        amount: toStoredAmount(form.get('amount')),
        note: form.get('note'),
        ...(settlementDefaults?.groupId ? { groupId: settlementDefaults.groupId } : {}),
      }
      successMessage = 'Settlement recorded.'
    }

    setBusy(true)
    try {
      const submittedModal = modal
      const result = await request(url, {
        method: submittedModal === 'members' || submittedModal === 'recurring-edit'
          ? 'PUT'
          : submittedModal === 'expense-category'
            ? 'PATCH'
            : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (result.invitationUrl) setManualInviteLink(result.invitationUrl)
      else setModal('')
      await refresh()
      setReloadKey(key => key + 1)
      refreshNotifications().catch(error => notify(error.message))
      if (['recurring', 'recurring-edit', 'recurring-confirm'].includes(submittedModal)) {
        await refreshRecurring()
      }
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
            <span>GroupBuk</span>
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
              <b>GroupBuk</b>
            </div>
            <div className="auth-heading">
              <span className="eyebrow">{authMode === 'signup' ? 'GET STARTED' : authMode === 'reset' ? 'ACCOUNT SECURITY' : authMode === 'forgot' ? 'ACCOUNT RECOVERY' : 'WELCOME BACK'}</span>
              <h2>{authMode === 'signup' ? 'Create your account' : authMode === 'reset' ? 'Choose a new password' : authMode === 'forgot' ? 'Reset your password' : 'Sign in to GroupBuk'}</h2>
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
          <span>GroupBuk</span>
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
          {[[LayoutDashboard, 'Overview'], [Users, 'Users'], [Users, 'Groups'], [ReceiptText, 'Activity'], [CalendarClock, 'Recurring'], [ArrowLeftRight, 'Balances']].map(([Icon, name]) => (
            <button key={name} className={`nav-item ${tab === name ? 'active' : ''}`} onClick={() => setTab(name)}>
              <Icon size={18} />{name}
              {name === 'Activity' && <span className="nav-count">{data.activityCount || 0}</span>}
              {name === 'Recurring' && recurringOccurrences.some(occurrence => occurrence.status === 'needs_confirmation') &&
                <span className="nav-count">{recurringOccurrences.filter(occurrence => occurrence.status === 'needs_confirmation').length}</span>}
            </button>
          ))}
          <button className="nav-item settle-up-nav" type="button" aria-label="Settle up" title="Settle up" disabled={!Number(currentUser?.balance)} onClick={openSettleAll}>
            <Check size={18} />Settle up
          </button>
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
            <label className="currency-switcher" title="Choose the currency for displayed amounts">
              <span>Currency</span>
              <select value={currency} onChange={event => setCurrency(event.target.value)} aria-label="Currency">
                <option value="INR">INR</option>
                <option value="USD">USD</option>
              </select>
              <small aria-live="polite">{currencyLoading ? 'Updating rate…' : currency === 'INR' ? 'Base currency' : Number.isFinite(exchangeRate) ? 'Converted' : 'Rate unavailable'}</small>
            </label>
            <SiteShareButtons
              url={`${window.location.origin}${window.location.pathname}`}
              onInstagram={shareSiteOnInstagram}
            />
            <div className="notification-center" ref={notificationCenterRef}>
              <button
                type="button"
                className={`notification-bell ${notificationCenterOpen ? 'is-open' : ''}`}
                aria-label={`Notifications${unreadNotificationCount ? `, ${unreadNotificationCount} unread` : ''}`}
                aria-expanded={notificationCenterOpen}
                onClick={() => setNotificationCenterOpen(open => !open)}
              >
                <Bell size={18} />
                {unreadNotificationCount > 0 && (
                  <span className="notification-badge">{unreadNotificationCount > 99 ? '99+' : unreadNotificationCount}</span>
                )}
              </button>
              {notificationCenterOpen && (
                <section className="notification-popover" aria-label="Notification center">
                  <div className="notification-popover-heading">
                    <div>
                      <b>{notificationPreferencesOpen ? 'Notification preferences' : 'Notifications'}</b>
                      {!notificationPreferencesOpen && <small>{unreadNotificationCount} unread</small>}
                    </div>
                    <div className="notification-heading-actions">
                      {!notificationPreferencesOpen && (
                        <button type="button" aria-label="Notification preferences" title="Notification preferences" onClick={() => setNotificationPreferencesOpen(true)}>
                          <Settings2 size={16} />
                        </button>
                      )}
                      {notificationPreferencesOpen && (
                        <button type="button" aria-label="Back to notifications" onClick={() => setNotificationPreferencesOpen(false)}>
                          <ArrowLeftRight size={16} />
                        </button>
                      )}
                      <button type="button" aria-label="Close notifications" onClick={() => setNotificationCenterOpen(false)}>
                        <X size={16} />
                      </button>
                    </div>
                  </div>
                  {notificationPreferencesOpen ? (
                    <div className="notification-preferences">
                      <label className="notification-frequency-setting">
                        <span>Settlement reminder frequency</span>
                        <select
                          value={notificationPreferences.settlement_reminder_frequency}
                          onChange={event => saveNotificationPreferences({ settlement_reminder_frequency: event.target.value })}
                        >
                          <option value="off">Off</option>
                          <option value="daily">Daily</option>
                          <option value="weekly">Weekly</option>
                        </select>
                      </label>
                      {Object.entries(notificationLabels).map(([type, label]) => (
                        <label className="notification-preference-toggle" key={type}>
                          <span>{label}</span>
                          <input
                            type="checkbox"
                            checked={notificationPreferences[type]}
                            onChange={event => saveNotificationPreferences({ [type]: event.target.checked })}
                          />
                        </label>
                      ))}
                      <small>Preferences apply to notifications across your account’s workspaces.</small>
                    </div>
                  ) : (
                    <>
                      <div className="notification-toolbar">
                        <button type="button" onClick={markAllNotificationsRead} disabled={!unreadNotificationCount}>
                          <CheckCheck size={14} />Mark all as read
                        </button>
                        <button
                          type="button"
                          onClick={async () => {
                            if (notificationLimit === 25) {
                              setNotificationLimit(100)
                              await refreshNotifications(100).catch(error => notify(error.message))
                            } else if (notificationsHaveMore) {
                              await refreshNotifications(100, notifications.length, true).catch(error => notify(error.message))
                            } else {
                              setNotificationLimit(25)
                              await refreshNotifications(25).catch(error => notify(error.message))
                            }
                          }}
                        >
                          {notificationLimit === 25
                            ? 'View all notifications'
                            : notificationsHaveMore
                              ? 'Load more notifications'
                              : 'Show recent'}
                        </button>
                      </div>
                      <div className="notification-list">
                        {notifications.length ? notifications.map(notification => {
                          const Icon = notificationIcon(notification.notification_type)
                          return (
                            <article className={`notification-row ${notification.read_at ? '' : 'notification-unread'}`} key={notification.id}>
                              <button type="button" className="notification-open" onClick={() => openNotification(notification)}>
                                <span className={`notification-type-icon notification-type-${notification.notification_type}`}><Icon size={15} /></span>
                                <span className="notification-copy">
                                  <b>{notification.title}</b>
                                  <span>{notification.message}</span>
                                  <small>{notification.workspace_name} · {notificationTimestamp(notification.created_at)}</small>
                                </span>
                                {!notification.read_at && <i className="notification-unread-dot" aria-label="Unread" />}
                              </button>
                              {notification.target_type === 'invitation' && (
                                <button
                                  type="button"
                                  className="notification-accept"
                                  disabled={busy}
                                  onClick={() => acceptNotificationInvitation(notification)}
                                >
                                  Accept
                                </button>
                              )}
                              <button
                                type="button"
                                className="notification-dismiss"
                                aria-label="Dismiss notification"
                                onClick={() => dismissNotification(notification.id)}
                              >
                                <X size={14} />
                              </button>
                            </article>
                          )
                        }) : <div className="notification-empty">You’re all caught up.</div>}
                      </div>
                    </>
                  )}
                </section>
              )}
            </div>
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
                {tab === 'Recurring' && 'Schedule shared expenses and review generated bills.'}
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
          <section className="monthly-summary" aria-label="Monthly expense summary">
            <div className="monthly-summary-icon"><CalendarDays size={19} /></div>
            <div className="monthly-summary-copy">
              <span className="monthly-summary-label">MONTHLY SPENDING</span>
              <label className="monthly-summary-select">
                <span className="sr-only">Choose month for spending summary</span>
                <select value={selectedMonth} onChange={event => setSelectedMonth(event.target.value)}>
                  {monthOptions.map(month => <option value={month} key={month}>{monthName(month)}</option>)}
                </select>
                <ChevronDown size={14} aria-hidden="true" />
              </label>
            </div>
            <div className="monthly-summary-stat">
              <span>Total expenses</span>
              <b>{activityLoading && !activityLoaded ? 'Loading…' : formatMoney(monthlyTotal)}</b>
            </div>
            <div className="monthly-summary-stat">
              <span>Recorded expenses</span>
              <b>{activityLoading && !activityLoaded ? '—' : monthlyExpenses.length}</b>
            </div>
          </section>
          <section className="panel analytics-panel" aria-label="Monthly analytics">
            <div className="panel-heading analytics-heading">
              <div>
                <div className="section-title">Monthly analytics</div>
                <div className="section-subtitle">Expense records and your actual split amounts</div>
              </div>
              <div className="analytics-filters">
                <label>
                  <span className="sr-only">Filter analytics by group</span>
                  <select value={analyticsGroup} onChange={event => setAnalyticsGroup(event.target.value)}>
                    <option value="all">All groups</option>
                    {groups.map(group => <option value={group.id} key={group.id}>{group.name}</option>)}
                  </select>
                </label>
                <label>
                  <span className="sr-only">Filter analytics by category</span>
                  <select value={analyticsCategory} onChange={event => setAnalyticsCategory(event.target.value)}>
                    <option value="all">All categories</option>
                    {categoryOptions.map(category => <option key={category}>{category}</option>)}
                  </select>
                </label>
              </div>
            </div>
            <div className="analytics-stats">
              <div>
                <span>Group expenses · {monthName(selectedMonth)}</span>
                <b>{activityLoading && !activityLoaded ? 'Loading…' : formatMoney(monthlyAnalytics.total)}</b>
              </div>
              <div>
                <span>Your personal share</span>
                <b>{activityLoading && !activityLoaded ? 'Loading…' : formatMoney(monthlyAnalytics.personalShare)}</b>
              </div>
              <div>
                <span>Compared with previous month</span>
                <b className={monthlyAnalytics.changePercent === null ? '' : monthlyAnalytics.changePercent > 0 ? 'analytics-change-up' : 'analytics-change-down'}>
                  {monthlyAnalytics.changePercent === null
                    ? `${monthlyAnalytics.total > 0 ? 'New activity · ' : ''}${formatMoney(monthlyAnalytics.previousTotal)} previous`
                    : `${monthlyAnalytics.changePercent > 0 ? '+' : ''}${monthlyAnalytics.changePercent.toFixed(1)}% · ${formatMoney(monthlyAnalytics.previousTotal)} previous`}
                </b>
              </div>
            </div>
            <div className="analytics-charts">
              <div className="analytics-chart-card">
                <div className="analytics-chart-heading">
                  <b>Monthly expenses</b>
                  <span>{selectedMonth.slice(0, 4)} · Select a bar to view that month</span>
                </div>
                <MonthlyExpenseChart
                  series={monthlyAnalytics.monthlySeries}
                  selectedMonth={selectedMonth}
                  onSelectMonth={setSelectedMonth}
                  formatMoney={formatMoney}
                />
              </div>
              <div className="analytics-chart-card">
                <div className="analytics-chart-heading">
                  <b>By category</b>
                  <span>{monthName(selectedMonth)}</span>
                </div>
                <CategoryDonutChart
                  categories={monthlyAnalytics.categoryTotals}
                  total={monthlyAnalytics.total}
                  formatMoney={formatMoney}
                />
              </div>
            </div>
          </section>
          <section className="balance-grid">
                <article className={`balance-card total-card ${myBalance > 0 ? 'owes-card' : ''}`}>
                  <div className="card-top">
                    <span className="card-title">YOUR NET BALANCE</span>
                    <span className="card-symbol dark-symbol"><ArrowLeftRight size={17} /></span>
                  </div>
                  <div className="amount">{myBalance < 0 ? '+' : myBalance > 0 ? '−' : ''}{formatMoney(myBalance)}</div>
                  <div className="balance-foot">
                    <span className="balance-indicator">{myBalance < 0 ? <ArrowDownLeft size={14} /> : <ArrowUpRight size={14} />}</span>
                    {myBalance < 0 ? 'You are owed overall' : myBalance > 0 ? 'You owe overall' : 'You are all settled up'}
                    <button className="plain-link" onClick={() => setTab('Balances')}>View balances <ArrowRight size={13} /></button>
                  </div>
                </article>
                <article className="balance-card positive-card">
                  <div className="card-top"><span className="card-title">YOU ARE OWED</span><span className="card-symbol green-symbol"><ArrowDownLeft size={17} /></span></div>
                  <div className="amount">{formatMoney(owedToMe)}</div>
                  <div className="small-detail"><span>Net amount owed to you</span></div>
                  <div className="card-bottom-line"><span /><span /></div>
                </article>
                <article className="balance-card negative-card">
                  <div className="card-top"><span className="card-title">YOU OWE</span><span className="card-symbol orange-symbol"><ArrowUpRight size={17} /></span></div>
                  <div className="amount">{formatMoney(owedByMe)}</div>
                  <div className="small-detail"><span>Net amount you owe</span></div>
                  <div className="card-bottom-line orange-line"><span /><span /></div>
                </article>
              </section>

              <SettlementSuggestions
                suggestions={suggestedSettlements}
                formatMoney={formatMoney}
                disabled={!Number.isFinite(exchangeRate)}
                onRecordSettlement={payment => {
                  const group = groups.find(item => item.id === payment.groupId)
                  if (group) openGroupSettlement(group, payment)
                }}
              />

              <section className="lower-grid">
                <div className="panel activity-panel">
                  <div className="panel-heading">
                    <div><div className="section-title">Recent activity <span className="title-count">{visibleActivity.length}</span></div><div className="section-subtitle">Latest expenses from your groups</div></div>
                    <button className="select-button" onClick={() => setTab('Activity')}>View all <ArrowRight size={14} /></button>
                  </div>
                  <ExpenseRows expenses={visibleActivity.slice(0, 6)} currentUser={currentUser} onGroupClick={openGroup} showShare formatMoney={formatMoney} />
                  <button className="view-all" onClick={() => setTab('Activity')}>View all activity <ArrowRight size={14} /></button>
                </div>
                <div className="right-column">
                  <div className="panel recurring-upcoming-panel">
                    <div className="panel-heading">
                      <div>
                        <div className="section-title">Upcoming recurring</div>
                        <div className="section-subtitle">Next scheduled group expenses</div>
                      </div>
                      <button className="more-button" aria-label="View recurring expenses" onClick={() => setTab('Recurring')}><ArrowRight size={15} /></button>
                    </div>
                    {recurringTemplates.filter(template => template.status === 'active' && template.next_occurrence_date).length ? (
                      <div className="recurring-upcoming-list">
                        {recurringTemplates
                          .filter(template => template.status === 'active' && template.next_occurrence_date)
                          .slice(0, 3)
                          .map(template => (
                            <article className="recurring-upcoming-row" key={template.id}>
                              <span className="recurring-upcoming-icon"><Repeat size={15} /></span>
                              <span className="recurring-upcoming-copy">
                                <b>{template.title}</b>
                                <small>{template.group_name} · Due {date(template.next_occurrence_date)}</small>
                              </span>
                              <strong>{new Intl.NumberFormat(template.currency === 'INR' ? 'en-IN' : 'en-US', {
                                style: 'currency',
                                currency: template.currency,
                              }).format(Number(template.amount))}</strong>
                            </article>
                          ))}
                      </div>
                    ) : (
                      <div className="recurring-upcoming-empty">
                        {recurringLoading ? 'Loading schedule…' : 'No upcoming recurring expenses.'}
                        <button type="button" onClick={() => setTab('Recurring')}>Set up a schedule</button>
                      </div>
                    )}
                  </div>
                  <div className="panel groups-panel">
                    <div className="panel-heading">
                      <div>
                        <div className="section-title">Your groups <span className="title-count">{groups.length}</span></div>
                        <div className="section-subtitle">Shared circles, one place</div>
                      </div>
                      <button className="more-button" aria-label="Create group" onClick={() => setModal('group')}><Plus size={17} /></button>
                    </div>
                    <div className="group-list">
                      {groups.map(group => {
                        const Icon = groupIcons[group.icon] || Users
                        const balance = Number(group.user_balance || 0)
                        return (
                          <article className="group-row group-summary-row" key={group.id}>
                            <span className="group-icon" style={{ background: group.color }}><Icon size={17} /></span>
                            <span className="group-name">
                              <b>{group.name}</b>
                              <span>{group.members?.length || 0} members · {group.expenses} expenses · {formatMoney(group.total)} total</span>
                              <span className={`group-user-balance ${balance < 0 ? 'is-owed' : balance > 0 ? 'is-owing' : 'is-settled'}`}>
                                {groupBalanceLabel(balance, formatMoney)}
                              </span>
                            </span>
                            <span className="group-row-actions">
                              <button type="button" className="group-action-button" onClick={() => openGroup(group.id)}>View Group</button>
                              {group.settlement_suggestion && (
                                <button type="button" className="group-action-button group-settle-button" disabled={!Number.isFinite(exchangeRate)} onClick={() => openGroupSettlement(group)}>
                                  Settle Up
                                </button>
                              )}
                            </span>
                          </article>
                        )
                      })}
                      {!groups.length && <div className="empty">Create a group to get started.</div>}
                    </div>
                    {Math.abs(unassignedBalance) >= 0.01 && (
                      <p className="group-balance-note">
                        Overall balance also includes {formatMoney(unassignedBalance)} from settlements not assigned to a group.
                      </p>
                    )}
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

          {tab === 'Recurring' && (
            <div className="recurring-page">
              <section className="panel screen-panel recurring-templates-panel">
                <div className="panel-heading screen-panel-heading">
                  <div>
                    <div className="section-title">Recurring expense templates <span className="title-count">{recurringTemplates.length}</span></div>
                    <div className="section-subtitle">Scheduled expenses are added to balances and analytics only after they are generated.</div>
                  </div>
                  <button className="button button-dark" disabled={!groups.some(group => group.members?.length)} onClick={() => openRecurringEditor()}>
                    <Plus size={15} />Create recurring
                  </button>
                </div>
                {recurringLoading && !recurringTemplates.length
                  ? <div className="empty"><LoaderCircle className="loading-icon" size={20} />Loading recurring expenses…</div>
                  : recurringTemplates.length
                    ? <div className="recurring-template-list">
                      {recurringTemplates.map(template => (
                        <article className="recurring-template-card" key={template.id}>
                          <div className="recurring-template-main">
                            <span className="recurring-template-icon"><Repeat size={17} /></span>
                            <div>
                              <b>{template.title}</b>
                              <p>{template.description || template.category} · {template.group_name}</p>
                              <span>{template.participants.map(participant => participant.name).join(', ')}</span>
                            </div>
                          </div>
                          <div className="recurring-template-meta">
                            <b>{new Intl.NumberFormat(template.currency === 'INR' ? 'en-IN' : 'en-US', {
                              style: 'currency',
                              currency: template.currency,
                            }).format(Number(template.amount))}{template.variable_amount ? ' expected' : ''}</b>
                            <span>{template.frequency[0].toUpperCase() + template.frequency.slice(1)} · {template.split_method === 'equal' ? 'Equal split' : 'Custom split'}</span>
                            <span>{template.next_occurrence_date ? `Next · ${date(template.next_occurrence_date)}` : 'No future occurrence'}</span>
                          </div>
                          <span className={`recurring-status recurring-status-${template.status}`}>{template.status}</span>
                          <div className="recurring-template-actions">
                            {template.status !== 'cancelled' &&
                              <button type="button" className="button button-light" onClick={() => openRecurringEditor(template)}><Pencil size={14} />Edit</button>}
                            {template.status === 'active' &&
                              <button type="button" className="button button-light" disabled={busy} onClick={() => setRecurringStatus(template, 'paused')}><Pause size={14} />Pause</button>}
                            {template.status === 'paused' &&
                              <button type="button" className="button button-light" disabled={busy} onClick={() => setRecurringStatus(template, 'active')}><Play size={14} />Resume</button>}
                            {template.status !== 'cancelled' &&
                              <button type="button" className="recurring-delete-button" disabled={busy} aria-label={`Deactivate ${template.title}`} onClick={() => deactivateRecurring(template)}><Trash2 size={15} /></button>}
                          </div>
                        </article>
                      ))}
                    </div>
                    : <div className="empty">No recurring expenses yet. Create a template to schedule shared bills.</div>}
              </section>

              <section className="panel screen-panel recurring-history-panel">
                <div className="panel-heading screen-panel-heading">
                  <div>
                    <div className="section-title">Occurrence history <span className="title-count">{recurringOccurrences.length}</span></div>
                    <div className="section-subtitle">Generated expenses and bills waiting for actual amounts.</div>
                  </div>
                </div>
                {recurringOccurrences.length ? (
                  <div className="recurring-occurrence-list">
                    {recurringOccurrences.map(occurrence => (
                      <article className="recurring-occurrence-row" key={occurrence.id}>
                        <div>
                          <b>{occurrence.title}</b>
                          <span>{occurrence.group_name} · Due {date(occurrence.occurrence_date)}</span>
                        </div>
                        <strong>{new Intl.NumberFormat(occurrence.currency === 'INR' ? 'en-IN' : 'en-US', {
                          style: 'currency',
                          currency: occurrence.currency,
                        }).format(Number(occurrence.status === 'generated' ? occurrence.entered_amount : occurrence.expected_amount))}</strong>
                        {occurrence.status === 'needs_confirmation'
                          ? <button type="button" className="button button-dark" onClick={() => openOccurrenceConfirmation(occurrence)}>Enter actual amount</button>
                          : <span className="recurring-status recurring-status-generated">Generated</span>}
                      </article>
                    ))}
                  </div>
                ) : <div className="empty">No occurrences generated yet.</div>}
              </section>
            </div>
          )}

          {tab === 'Groups' && (
            <section className="screen-panel">
              <div className="panel-heading screen-panel-heading">
                <div>
                  <div className="section-title">All groups <span className="title-count">{groups.length}</span></div>
                  <div className="section-subtitle">Group balances use expense shares and settlements.</div>
                </div>
              </div>
              {groups.length ? (
                <div className="group-grid">
                  {groups.map(group => {
                    const Icon = groupIcons[group.icon] || Users
                    const balance = Number(group.user_balance || 0)
                    return (
                      <article className="group-card-shell" key={group.id}>
                        <button className="group-card" onClick={() => openGroup(group.id)}>
                          <span className="group-card-icon" style={{ background: group.color }}><Icon size={20} /></span>
                          <span className="group-card-name">{group.name}</span>
                          <span className="group-card-meta">{group.members?.length || 0} members · {group.expenses} {group.expenses === 1 ? 'expense' : 'expenses'}</span>
                          <strong>{formatMoney(group.total)} total expenses</strong>
                          <span className={`group-card-balance ${balance < 0 ? 'is-owed' : balance > 0 ? 'is-owing' : 'is-settled'}`}>
                            {groupBalanceLabel(balance, formatMoney)}
                          </span>
                          <span className="group-card-link">View Group <ArrowRight size={14} /></span>
                        </button>
                        {group.settlement_suggestion && (
                          <button type="button" className="button button-light group-card-settle" disabled={!Number.isFinite(exchangeRate)} onClick={() => openGroupSettlement(group)}>
                            Settle Up
                          </button>
                        )}
                      </article>
                    )
                  })}
                </div>
              ) : <div className="empty">No groups yet. Create one to start sharing expenses.</div>}
              {Math.abs(unassignedBalance) >= 0.01 && (
                <p className="group-balance-note">
                  Overall balance also includes {formatMoney(unassignedBalance)} from settlements not assigned to a group.
                </p>
              )}
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
                            <b>{personBalance < 0 ? '+' : personBalance > 0 ? '−' : ''}{formatMoney(personBalance)}</b>
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
              <>
              <SettlementSuggestions
                suggestions={selectedGroup.settlement_suggestions || []}
                formatMoney={formatMoney}
                disabled={!Number.isFinite(exchangeRate)}
                onRecordSettlement={payment => openGroupSettlement(selectedGroup, payment)}
              />
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
              </>
            )}
            <section className="panel screen-panel activity-screen">
              <div className="panel-heading screen-panel-heading">
                <div>
                  <div className="section-title">{tab === 'Group' ? 'Group expenses' : 'All activity'} <span className="title-count">{visibleActivity.length}</span></div>
                  <div className="section-subtitle">{tab === 'Group' ? 'Transactions saved to this group.' : 'Your expense history, loaded from the database.'}</div>
                </div>
                <div className="activity-controls">
                  <label className="select-button range-select">
                    <span>Category</span>
                    <select value={activityCategory} onChange={event => setActivityCategory(event.target.value)}>
                      <option value="all">All</option>
                      {categoryOptions.map(category => <option key={category}>{category}</option>)}
                    </select>
                    <ChevronDown size={14} />
                  </label>
                  {tab === 'Group'
                    ? <button className="select-button" onClick={() => setTab('Groups')}><ArrowRight className="back-arrow" size={14} />All groups</button>
                    : <label className="select-button range-select"><CalendarDays size={14} /><select value={dateRange} onChange={event => setDateRange(event.target.value)}><option value="30">Last 30 days</option><option value="7">Last 7 days</option><option value="all">All time</option></select><ChevronDown size={14} /></label>}
                </div>
              </div>
              {activityLoading
                ? <div className="empty"><LoaderCircle className="loading-icon" size={20} />Loading expenses…</div>
                : <ExpenseRows
                  expenses={visibleActivity}
                  currentUser={currentUser}
                  onGroupClick={openGroup}
                  onSettleExpense={openExpenseSettlement}
                  onEditCategory={openExpenseCategoryEdit}
                  formatMoney={formatMoney}
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
                        {balance < 0 ? '+' : balance > 0 ? '−' : ''}{formatMoney(balance)}
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
              <div><span className="eyebrow">GROUPBUK</span><h2>{modal === 'person' ? 'Add a user' : modal === 'invite' ? 'Invite to workspace' : modal === 'members' ? 'Manage group members' : modal === 'expense' ? 'Add an expense' : modal === 'expense-category' ? 'Edit expense category' : modal === 'recurring' ? 'Create recurring expense' : modal === 'recurring-edit' ? 'Edit recurring expense' : modal === 'recurring-confirm' ? 'Confirm recurring amount' : modal === 'group' ? 'Create a group' : modal === 'expense-settlement' ? 'Settle expense shares' : modal === 'settle-all' ? 'Settle your balance' : settlementDefaults?.groupId ? 'Settle group balance' : 'Record a settlement'}</h2></div>
              <button type="button" className="close" aria-label="Close" onClick={() => setModal('')}><X size={18} /></button>
            </div>

            {modal === 'person' && (
              <label>User's name<input required name="name" maxLength="255" autoFocus placeholder="Enter a name" /></label>
            )}

            {modal === 'expense-settlement' && expenseToSettle && (
              <>
                <p className="form-hint">Select who is paying toward “{expenseToSettle.title}”. Adjust each amount to record a partial payment. Payments are recorded to {expenseToSettle.payer}.</p>
                <div className="expense-settlement-list">
                  {expenseToSettle.shares
                    .filter(share => share.person_id !== expenseToSettle.payer_id && share.outstanding_amount > 0)
                    .map(share => (
                      <div className="expense-settlement-person" key={share.person_id}>
                        <input type="checkbox" name="personIds" value={share.person_id} aria-label={`Select ${share.name}`} />
                        <span>{share.name}</span>
                        <label className="expense-settlement-amount">
                          <span className="sr-only">Payment amount for {share.name}, up to {formatMoney(share.outstanding_amount)}</span>
                          <input name={`amount-${share.person_id}`} type="number" min="0.01" max={Number.isFinite(exchangeRate) ? (share.outstanding_amount * exchangeRate).toFixed(2) : undefined} step="0.01" defaultValue={Number.isFinite(exchangeRate) ? (share.outstanding_amount * exchangeRate).toFixed(2) : ''} disabled={!Number.isFinite(exchangeRate)} required />
                        </label>
                      </div>
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
                      <strong>{formatMoney(payment.amount)}</strong>
                    </div>
                  ))}
                </div>
                <div className="settlement-plan-total">
                  <span>Your balance to clear · {settlementPlan.length} {settlementPlan.length === 1 ? 'payment' : 'payments'}</span>
                  <b>{formatMoney(settlementPlan.reduce((total, payment) => total + payment.amount, 0))}</b>
                </div>
              </>
            )}

            {modal === 'invite' && (
              <>
                {!manualInviteLink && (
                  <>
                    <label>Search GroupBuk users<input value={globalUserQuery} onChange={event => setGlobalUserQuery(event.target.value)} maxLength="80" autoFocus placeholder="Type a name (2 characters minimum)" /></label>
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
                    <InvitationShareButtons url={manualInviteLink} workspaceName={authUser.workspaceName || 'GroupBuk'} onInstagram={shareInviteOnInstagram} />
                  </>
                )}
              </>
            )}

            {modal === 'expense' && (
              <>
                <label>What was it for?<input required name="title" maxLength="255" placeholder="Enter an expense name" /></label>
                <div className="form-row">
                <label>Amount ({currency})<input name="amount" type="number" min="0.01" step="0.01" placeholder="0.00" disabled={!Number.isFinite(exchangeRate)} required /></label>
                  <label>Category<select name="category">{expenseCategories.map(category => <option key={category}>{category}</option>)}</select></label>
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

            {modal === 'expense-category' && expenseToEdit && (
              <>
                <p className="form-hint">Change the category for “{expenseToEdit.title}”. The expense amount and split are not changed.</p>
                <label>Category
                  <select name="category" defaultValue={expenseToEdit.category || 'Other'} required>
                    {categoryOptions.map(category => <option key={category}>{category}</option>)}
                  </select>
                </label>
              </>
            )}

            {(modal === 'recurring' || modal === 'recurring-edit') && (
              <>
                <p className="form-hint">Fixed expenses are generated automatically. Variable bills will wait for confirmation before affecting analytics and balances.</p>
                <RecurringExpenseFields
                  key={recurringEditing?.id || 'new-recurring'}
                  groups={groups}
                  currency={currency}
                  exchangeRate={exchangeRate}
                  initial={recurringEditing}
                  currentUserId={data.currentUserId}
                />
              </>
            )}

            {modal === 'recurring-confirm' && occurrenceToConfirm && (
              <>
                <p className="form-hint">
                  Enter the actual {occurrenceToConfirm.currency} bill for “{occurrenceToConfirm.title}” due {date(occurrenceToConfirm.occurrence_date)}.
                  This creates the expense and splits only after confirmation.
                </p>
                <label>Actual amount ({occurrenceToConfirm.currency})
                  <input name="amount" type="number" min="0.01" step="0.01" defaultValue={occurrenceToConfirm.expected_amount} required />
                </label>
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
                {settlementDefaults?.groupId && (
                  <p className="form-hint">
                    This payment is assigned to {groups.find(group => group.id === Number(settlementDefaults.groupId))?.name || 'this group'} and will update both group and overall balances.
                  </p>
                )}
                <div className="form-row">
                  <label>Paid by<select name="payerId" required defaultValue={settlementDefaults?.payerId || data.currentUserId}>{settlementPeople.map(person => <option value={person.id} key={person.id}>{person.name}</option>)}</select></label>
                  <label>Paid to<select name="payeeId" required defaultValue={settlementDefaults?.payeeId || settlementPeople.find(person => person.id !== data.currentUserId)?.id || ''}>{settlementPeople.filter(person => person.id !== (settlementDefaults?.payerId || data.currentUserId)).map(person => <option value={person.id} key={person.id}>{person.name}</option>)}</select></label>
                </div>
                <div className="form-row">
                  <label>Amount ({currency})<input name="amount" type="number" min="0.01" step="0.01" defaultValue={settlementDefaults?.amount || ''} placeholder="0.00" disabled={!Number.isFinite(exchangeRate)} required /></label>
                  <label>Note<input name="note" maxLength="255" defaultValue="Settlement" required /></label>
                </div>
              </>
            )}

            {!(modal === 'invite' && manualInviteLink) && (
              <button className="button button-dark modal-submit" disabled={busy}>
                {busy ? 'Saving…' : modal === 'person' ? 'Add user' : modal === 'invite' ? 'Create invitation & show share buttons' : modal === 'members' ? 'Save members' : modal === 'expense' ? 'Save expense' : modal === 'expense-category' ? 'Save category' : modal === 'recurring' ? 'Create schedule' : modal === 'recurring-edit' ? 'Save schedule' : modal === 'recurring-confirm' ? 'Confirm & record expense' : modal === 'group' ? 'Create group' : modal === 'expense-settlement' ? 'Record selected payments' : modal === 'settle-all' ? 'Confirm & clear my balance' : 'Save settlement'}
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
