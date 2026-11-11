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
  Download,
  FileBarChart,
  FileDown,
  FileSpreadsheet,
  GraduationCap,
  HeartPulse,
  House,
  Lightbulb,
  LayoutDashboard,
  LoaderCircle,
  LogOut,
  Menu,
  Moon,
  Monitor,
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
  Sun,
  Tag,
  Trash2,
  Users,
  Utensils,
  Wallet,
  ShoppingBasket,
  ShoppingBag,
  Zap,
  X,
} from 'lucide-react'
import { calculateMonthlyAnalytics, monthValue } from './analytics.mjs'
import {
  convertReportRow,
  presentReportRow,
  reportCsv,
  reportHeaders,
  reportPdf,
  reportTypes,
  reportXlsx,
} from './reports.mjs'

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
  budget_alert: 'Budget alerts',
}
const notificationIcon = type => {
  if (type === 'budget_alert') return Wallet
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
const parsePercentageUnits = value => {
  if (typeof value !== 'string' && typeof value !== 'number') return null
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(String(value).trim())
  if (!match) return null
  const units = Number(match[1]) * 100 + Number((match[2] || '').padEnd(2, '0'))
  return Number.isSafeInteger(units) ? units : null
}
const percentageShareCents = (totalCents, allocations) => {
  const shares = allocations.map((allocation, index) => {
    const product = BigInt(totalCents) * BigInt(allocation.units || 0)
    return { index, cents: Number(product / 10000n), remainder: product % 10000n }
  })
  if (allocations.reduce((sum, allocation) => sum + (allocation.units || 0), 0) === 10000) {
    let remaining = totalCents - shares.reduce((sum, share) => sum + share.cents, 0)
    const order = [...shares].sort((left, right) => left.remainder === right.remainder
      ? left.index - right.index
      : left.remainder > right.remainder ? -1 : 1)
    for (let index = 0; remaining > 0; index++, remaining--) shares[order[index % order.length].index].cents++
  }
  return shares
}
const shareCountCents = (totalCents, allocations) => {
  const weights = allocations.map(allocation => BigInt(allocation.valid ? allocation.raw : 0))
  const totalShares = weights.reduce((sum, shares) => sum + shares, 0n)
  if (!totalShares) return allocations.map((_, index) => ({ index, cents: 0, remainder: 0n }))
  const shares = weights.map((weight, index) => {
    const product = BigInt(totalCents) * weight
    return { index, cents: Number(product / totalShares), remainder: product % totalShares }
  })
  let remaining = totalCents - shares.reduce((sum, share) => sum + share.cents, 0)
  const order = [...shares].sort((left, right) => left.remainder === right.remainder
    ? left.index - right.index
    : left.remainder > right.remainder ? -1 : 1)
  for (let index = 0; remaining > 0; index++, remaining--) shares[order[index % order.length].index].cents++
  return shares
}
const percentageInputsFromAmounts = amounts => {
  const cents = amounts.map(value => Math.max(0, Math.round(Number(value || 0) * 100)))
  const total = cents.reduce((sum, value) => sum + value, 0)
  if (!total) return cents.map(() => '0.00')
  const units = cents.map((value, index) => {
    const product = value * 10000
    return { index, value: Math.floor(product / total), remainder: product % total }
  })
  let remaining = 10000 - units.reduce((sum, value) => sum + value.value, 0)
  const order = [...units].sort((left, right) => right.remainder - left.remainder || left.index - right.index)
  for (let index = 0; index < remaining; index++) units[order[index].index].value++
  return units.sort((left, right) => left.index - right.index).map(value => (value.value / 100).toFixed(2))
}
const shareInputsFromAmounts = amounts => {
  const cents = amounts.map(value => Math.max(0, Math.round(Number(value || 0) * 100)))
  const gcd = (left, right) => right ? gcd(right, left % right) : left
  const divisor = cents.reduce((value, amount) => amount ? (value ? gcd(value, amount) : amount) : value, 0)
  return cents.map(value => String(divisor ? Math.max(1, Math.round(value / divisor)) : 1))
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
const todayIso = () => {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}
const themeOptions = new Set(['light', 'dark', 'system'])
const storedThemePreference = () => {
  try {
    const preference = window.localStorage.getItem('groupbuk_theme')
    return themeOptions.has(preference) ? preference : 'system'
  } catch {
    return 'system'
  }
}

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

function LoadingSkeleton({ rows = 3, label = 'Loading content' }) {
  return (
    <div className="loading-skeleton-list" role="status" aria-label={label}>
      {Array.from({ length: rows }, (_, index) => (
        <div className="loading-skeleton-row" key={index} aria-hidden="true">
          <i />
          <i />
          <i />
        </div>
      ))}
    </div>
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

function GroupAnalyticsDashboard({ analytics, loading, error, period, setPeriod, startDate, setStartDate, endDate, setEndDate, formatMoney, onRetry }) {
  const trend = analytics?.monthlyTrend || []
  const categories = analytics?.categoryStats || []
  const members = analytics?.memberStats || []
  const maxTrend = Math.max(1, ...trend.map(row => Number(row.totalAmount)))
  const maxMember = Math.max(1, ...members.map(row => Number(row.totalPaid)))
  const points = trend.map((row, index) => {
    const x = trend.length < 2 ? 310 : 28 + index * (564 / (trend.length - 1))
    const y = 124 - (Number(row.totalAmount) / maxTrend) * 100
    return `${x},${y}`
  }).join(' ')
  const radius = 48
  const circumference = 2 * Math.PI * radius
  let offset = 0
  return (
    <section className="group-analytics" aria-label="Group analytics">
      <div className="panel-heading screen-panel-heading">
        <div><div className="section-title">Group analytics</div><div className="section-subtitle">Spending and contributions in INR base currency.</div></div>
        <div className="group-analytics-filters">
          <label><span className="sr-only">Analytics period</span><select value={period} onChange={event => setPeriod(event.target.value)}>
            <option value="7d">Last 7 Days</option><option value="30d">Last 30 Days</option><option value="90d">Last 90 Days</option><option value="all">All Time</option><option value="custom">Custom Dates</option>
          </select></label>
          {period === 'custom' && <><label><span className="sr-only">Start date</span><input type="date" value={startDate} max={endDate || undefined} onChange={event => setStartDate(event.target.value)} /></label><label><span className="sr-only">End date</span><input type="date" value={endDate} min={startDate || undefined} onChange={event => setEndDate(event.target.value)} /></label></>}
        </div>
      </div>
      {loading ? <div className="group-analytics-loading" role="status"><LoaderCircle className="loading-icon" size={20} />Loading group analytics…</div>
        : error ? <div className="empty group-analytics-state" role="alert">{error}<button type="button" className="button button-light" onClick={onRetry}>Retry</button></div>
          : <>
            <div className="group-analytics-summary">
              {[
                ['Total Group Spending', formatMoney(analytics?.summary.totalExpenses || 0)],
                ['Expense Count', analytics?.summary.expenseCount ?? 0],
                ['Average Expense', formatMoney(analytics?.summary.averageExpense || 0)],
                ['Active Members', `${analytics?.summary.activeMembers || 0} / ${analytics?.summary.totalMembers || 0}`],
              ].map(([label, value]) => <article className="analytics-stat" key={label}><span>{label}</span><b>{value}</b></article>)}
            </div>
            {!analytics?.summary.expenseCount ? <div className="empty group-analytics-state">No expenses for this group and date range.</div> : <>
              <div className="group-analytics-charts">
                <article className="analytics-chart-card"><div className="analytics-chart-heading"><b>Monthly Spending Trend</b><span>INR</span></div>
                  {trend.length ? <svg className="group-trend-chart" viewBox="0 0 620 165" role="img" aria-label="Monthly spending trend">
                    {[0, 1, 2, 3].map(line => <line key={line} x1="24" x2="596" y1={24 + line * 32} y2={24 + line * 32} className="group-chart-gridline" />)}
                    {trend.length > 1 && <polyline points={points} className="group-trend-line" />}
                    {trend.map((row, index) => { const x = trend.length < 2 ? 310 : 28 + index * (564 / (trend.length - 1)); const y = 124 - (Number(row.totalAmount) / maxTrend) * 100; return <g key={row.month}><circle cx={x} cy={y} r="4" className="group-trend-point"><title>{row.month}: {formatMoney(row.totalAmount)}</title></circle><text x={x} y="151" textAnchor="middle">{row.month}</text></g> })}
                  </svg> : <div className="analytics-empty">No monthly data.</div>}
                </article>
                <article className="analytics-chart-card"><div className="analytics-chart-heading"><b>Category Spending Breakdown</b><span>{categories.length} categories</span></div>
                  <div className="analytics-donut-layout"><svg className="analytics-donut" viewBox="0 0 160 160" role="img" aria-label="Category spending breakdown"><circle cx="80" cy="80" r={radius} className="analytics-donut-track" />{categories.map((row, index) => { const length = Number(row.percentage) / 100 * circumference; const currentOffset = offset; offset += length; return <circle key={row.category} cx="80" cy="80" r={radius} stroke={chartColors[index % chartColors.length]} strokeDasharray={`${length} ${circumference - length}`} strokeDashoffset={-currentOffset} className="analytics-donut-slice"><title>{row.category}: {formatMoney(row.totalAmount)} ({Number(row.percentage).toFixed(1)}%)</title></circle> })}<text x="80" y="77" className="analytics-donut-total">{categories.length}</text><text x="80" y="94" className="analytics-donut-caption">categories</text></svg>
                    <div className="analytics-legend">{categories.map((row, index) => <div className="analytics-legend-row" key={row.category}><span className="analytics-legend-name"><i style={{ background: chartColors[index % chartColors.length] }} />{row.category}</span><b>{formatMoney(row.totalAmount)}</b></div>)}</div>
                  </div>
                </article>
                <article className="analytics-chart-card group-member-chart-card"><div className="analytics-chart-heading"><b>Member-wise Spending Comparison</b><span>Paid amounts</span></div>
                  {members.length ? <div className="group-member-bars">{members.map(row => <div className="group-member-bar-row" key={row.memberId}><span title={row.memberName}>{row.memberName}</span><i><b style={{ width: `${Math.min(100, Number(row.totalPaid) / maxMember * 100)}%` }} /></i><strong>{formatMoney(row.totalPaid)}</strong></div>)}</div> : <div className="analytics-empty">No group members.</div>}
                </article>
              </div>
              <article className="analytics-chart-card group-analytics-table-card"><div className="analytics-chart-heading"><b>Member Contribution</b><span>{members.length} members</span></div><div className="group-analytics-table-scroll"><table className="report-table"><thead><tr><th>Member</th><th>Paid</th><th>Share</th><th>Net Contribution</th><th>Expense Count</th></tr></thead><tbody>{members.map(row => <tr key={row.memberId}><td>{row.memberName}</td><td>{formatMoney(row.totalPaid)}</td><td>{formatMoney(row.totalShare)}</td><td>{formatMoney(row.netContribution)}</td><td>{row.expenseCount}</td></tr>)}</tbody></table></div></article>
              <article className="analytics-chart-card group-analytics-table-card"><div className="analytics-chart-heading"><b>Top 10 Expenses</b><span>Highest amounts</span></div><div className="group-analytics-table-scroll"><table className="report-table"><thead><tr><th>Expense</th><th>Category</th><th>Paid by</th><th>Amount</th><th>Date</th></tr></thead><tbody>{(analytics?.topExpenses || []).map(row => <tr key={row.expenseId}><td>{row.title}</td><td>{row.category}</td><td>{row.paidBy}</td><td>{formatMoney(row.amount)}</td><td>{date(row.createdAt)}</td></tr>)}</tbody></table></div></article>
            </>}
          </>}
    </section>
  )
}

function BudgetForm({ budget, groups, categories, currency, exchangeRate, onSubmit, onCancel, busy }) {
  const [type, setType] = useState(budget?.budget_type || 'personal')
  const thresholds = budget?.alert_thresholds
    ? (Array.isArray(budget.alert_thresholds) ? budget.alert_thresholds : JSON.parse(budget.alert_thresholds)).join(', ')
    : '80, 90, 100'
  return (
    <form className="budget-form" onSubmit={onSubmit}>
      <div className="budget-form-grid">
        <label>Budget name<input name="name" required maxLength="120" defaultValue={budget?.name || ''} placeholder="e.g. Monthly groceries" /></label>
        <label>Budget type<select name="budgetType" value={type} onChange={event => setType(event.target.value)}><option value="personal">Personal</option><option value="group">Group</option></select></label>
        {type === 'group' && <label>Group<select name="groupId" required defaultValue={budget?.group_id || ''}><option value="" disabled>Select a group</option>{groups.map(group => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label>}
        <label>Amount<input name="amount" type="number" min="0.01" step="0.01" required defaultValue={budget ? Number(budget.amount) / Number(budget.exchange_rate_to_inr || 1) : ''} placeholder="0.00" /></label>
        <label>Currency<select name="currency" defaultValue={budget?.currency || currency}><option value="INR">INR (₹)</option><option value="USD">USD ($)</option></select></label>
        <label>Period<select name="period" defaultValue={budget?.period || 'monthly'}><option value="weekly">Weekly</option><option value="monthly">Monthly</option><option value="yearly">Yearly</option></select></label>
        <label>Start date<input name="startDate" type="date" required defaultValue={budget?.start_date?.slice(0, 10) || todayIso()} /></label>
        <label>End date (optional)<input name="endDate" type="date" defaultValue={budget?.end_date?.slice(0, 10) || ''} /></label>
        <label>Category (optional)<select name="category" defaultValue={budget?.category || ''}><option value="">All categories</option>{categories.map(category => <option key={category}>{category}</option>)}</select></label>
        <label className="budget-threshold-field">Alert thresholds (%)<input name="alertThresholds" required defaultValue={thresholds} pattern="\s*\d+(\s*,\s*\d+)*\s*" title="Enter percentages separated by commas, such as 80, 100" /><small>Separate percentages with commas. Default: 80, 100.</small></label>
      </div>
      <div className="budget-form-actions"><button type="button" className="button button-light" onClick={onCancel}>Cancel</button><button className="button button-dark" disabled={busy}>{busy ? 'Saving…' : budget ? 'Save changes' : 'Create budget'}</button></div>
    </form>
  )
}

function BudgetHistoryChart({ rows, formatMoney }) {
  const max = Math.max(1, ...rows.map(row => Math.max(Number(row.spent), Number(row.budgetAmount))))
  return (
    <div className="budget-history-chart" role="img" aria-label="Budget history: actual spending compared with budget">
      {rows.map((row, index) => <div className="budget-history-column" key={`${row.startDate}-${index}`}>
        <div className="budget-history-bars"><i className="budget-history-limit" style={{ height: `${Math.max(4, Number(row.budgetAmount) / max * 100)}%` }} title={`Budget ${formatMoney(row.budgetAmount)}`} /><i className="budget-history-spend" style={{ height: `${Math.max(row.spent ? 4 : 0, Number(row.spent) / max * 100)}%` }} title={`Spent ${formatMoney(row.spent)}`} /></div>
        <span>{new Intl.DateTimeFormat('en-US', { month: 'short', year: '2-digit', timeZone: 'UTC' }).format(new Date(`${row.startDate}T12:00:00Z`))}</span>
      </div>)}
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

function ExpenseRows({ expenses, currentUser, onGroupClick, onSettleExpense, onEditCategory, onEditExpense, onVoidExpense, canVoidExpense, voidingExpenseId, showSettlement = false, showShare = false, formatMoney }) {
  if (!expenses.length) return <div className="empty">No expenses to show yet.</div>

  return (
    <div className="data-list">
      {expenses.map(expense => {
        const isVoided = Boolean(expense.voided_at)
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
          <div className={`activity-row${isVoided ? ' activity-row-voided' : ''}`} id={`expense-${expense.id}`} key={expense.id}>
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
                {isVoided && <span className="voided-expense-badge" title={expense.voided_by_name ? `Deleted by ${expense.voided_by_name}` : 'Deleted'}>DELETED</span>}
              </span>
            </div>
            <div className="activity-payer">
              <div className="avatar tiny" style={{ background: expense.color }}>{expense.initials}</div>
              <span>{expense.payer_id === currentUser?.id ? 'You' : expense.payer}</span>
            </div>
            <div className="activity-amount">
              <b>{formatMoney(expense.amount)}</b>
              <span>{isVoided ? 'Deleted · excluded from balances' : showSettlement
                ? expense.outstanding_amount > 0 ? `${formatMoney(expense.outstanding_amount)} unpaid` : 'settled'
                : showShare
                  ? `Your share ${formatMoney(userShare?.amount || 0)}`
                  : 'total'}</span>
              {showShare && <span className={`settlement-status status-${settlementStatus.toLowerCase().replace(/\s+/g, '-')}`}>{settlementStatus}</span>}
            </div>
            {((onEditCategory && !isVoided) || (onEditExpense && !isVoided) || (onVoidExpense && !isVoided && canVoidExpense?.(expense)) || showSettlement) && (
              <div className="activity-row-actions">
                {onEditExpense && !isVoided && (
                  <button className="edit-category-button" type="button" title="Edit expense" aria-label={`Edit expense ${expense.title}`} onClick={() => onEditExpense(expense)}>
                    <Pencil size={14} />
                  </button>
                )}
                {onEditCategory && !isVoided && (
                  <button className="edit-category-button" type="button" title="Edit category" aria-label={`Edit category for ${expense.title}`} onClick={() => onEditCategory(expense)}>
                    <Tag size={14} />
                  </button>
                )}
                {onVoidExpense && !isVoided && canVoidExpense?.(expense) && (
                  <button className="void-expense-button" type="button" disabled={voidingExpenseId === expense.id} title="Delete expense" aria-label={`Delete expense ${expense.title}`} onClick={() => onVoidExpense(expense)}>
                    {voidingExpenseId === expense.id ? 'Deleting…' : 'Delete'}
                  </button>
                )}
                {showSettlement && !isVoided && (expense.outstanding_amount > 0
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
  const [themePreference, setThemePreference] = useState(storedThemePreference)
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const [selectedGroupId, setSelectedGroupId] = useState(null)
  const [focusExpenseId, setFocusExpenseId] = useState(null)
  const [expenseGroupId, setExpenseGroupId] = useState('')
  const [expensePaidBy, setExpensePaidBy] = useState('')
  const [expenseSplitMethod, setExpenseSplitMethod] = useState('equal')
  const [expenseParticipantIds, setExpenseParticipantIds] = useState([])
  const [expenseExactAmounts, setExpenseExactAmounts] = useState({})
  const [expensePercentages, setExpensePercentages] = useState({})
  const [expenseShares, setExpenseShares] = useState({})
  const [expenseItems, setExpenseItems] = useState([])
  const [expenseTotalInput, setExpenseTotalInput] = useState('')
  const [expenseToSettle, setExpenseToSettle] = useState(null)
  const [expenseToEdit, setExpenseToEdit] = useState(null)
  const [voidingExpenseId, setVoidingExpenseId] = useState(null)
  const [settlementPlan, setSettlementPlan] = useState([])
  const [settlementDefaults, setSettlementDefaults] = useState(null)
  const [modal, setModal] = useState('')
  const [search, setSearch] = useState('')
  const [dateRange, setDateRange] = useState('30')
  const [activityCategory, setActivityCategory] = useState('all')
  const [showVoidedExpenses, setShowVoidedExpenses] = useState(false)
  const [analyticsGroup, setAnalyticsGroup] = useState('all')
  const [analyticsCategory, setAnalyticsCategory] = useState('all')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [activity, setActivity] = useState([])
  const [activityLoading, setActivityLoading] = useState(false)
  const [activityLoaded, setActivityLoaded] = useState(false)
  const [groupAnalytics, setGroupAnalytics] = useState(null)
  const [groupAnalyticsLoading, setGroupAnalyticsLoading] = useState(false)
  const [groupAnalyticsError, setGroupAnalyticsError] = useState('')
  const [groupAnalyticsPeriod, setGroupAnalyticsPeriod] = useState('30d')
  const [groupAnalyticsStartDate, setGroupAnalyticsStartDate] = useState('')
  const [groupAnalyticsEndDate, setGroupAnalyticsEndDate] = useState('')
  const [groupAnalyticsRetry, setGroupAnalyticsRetry] = useState(0)
  const [selectedReportType, setSelectedReportType] = useState('expense')
  const [reportFilters, setReportFilters] = useState({
    startDate: `${new Date().getFullYear()}-01-01`,
    endDate: todayIso(),
    groupId: 'all',
    memberId: 'all',
    category: 'all',
  })
  const [reportResult, setReportResult] = useState(null)
  const [reportLoading, setReportLoading] = useState(false)
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
    budget_alert: true,
    settlement_reminder_frequency: 'weekly',
  })
  const [reloadKey, setReloadKey] = useState(0)
  const [selectedMonth, setSelectedMonth] = useState(() => monthValue(new Date()))
  const [currency, setCurrency] = useState(() => window.localStorage.getItem('groupbuk_currency') === 'USD' ? 'USD' : 'INR')
  const [exchangeRate, setExchangeRate] = useState(() => currency === 'INR' ? 1 : null)
  const [currencyLoading, setCurrencyLoading] = useState(false)
  const [budgets, setBudgets] = useState([])
  const [budgetsLoading, setBudgetsLoading] = useState(false)
  const [budgetEditing, setBudgetEditing] = useState(null)
  const [budgetFormOpen, setBudgetFormOpen] = useState(false)
  const [budgetHistory, setBudgetHistory] = useState([])
  const [budgetHistoryId, setBudgetHistoryId] = useState(null)
  const [budgetBusy, setBudgetBusy] = useState(false)

  const setTheme = preference => {
    if (!themeOptions.has(preference)) return
    setThemePreference(preference)
    try {
      window.localStorage.setItem('groupbuk_theme', preference)
      if (authUser?.id) window.localStorage.setItem(`groupbuk_theme_${authUser.id}`, preference)
    } catch (error) {
      notify('Could not save your appearance preference in this browser.')
    }
  }

  useEffect(() => {
    if (!authUser?.id) return
    try {
      const accountPreference = window.localStorage.getItem(`groupbuk_theme_${authUser.id}`)
      if (themeOptions.has(accountPreference)) setThemePreference(accountPreference)
    } catch (error) {
      notify('Could not restore your saved appearance preference.')
    }
  }, [authUser?.id])

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const applyTheme = () => {
      const resolvedTheme = themePreference === 'system'
        ? media.matches ? 'dark' : 'light'
        : themePreference
      document.documentElement.dataset.theme = resolvedTheme
      document.documentElement.style.colorScheme = resolvedTheme
    }
    applyTheme()
    media.addEventListener?.('change', applyTheme)
    return () => media.removeEventListener?.('change', applyTheme)
  }, [themePreference])

  useEffect(() => {
    if (!mobileNavOpen) return undefined
    const closeOnEscape = event => {
      if (event.key === 'Escape') setMobileNavOpen(false)
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [mobileNavOpen])

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

  const reportQuery = (type, offset = 0, limit = 100) => {
    const params = new URLSearchParams({
      type,
      limit: String(limit),
      offset: String(offset),
      currency,
    })
    Object.entries(reportFilters).forEach(([key, value]) => {
      if (value && value !== 'all') params.set(key, value)
    })
    return `/api/reports?${params}`
  }

  async function runReport(offset = 0, append = false) {
    setReportLoading(true)
    try {
      const result = await request(reportQuery(selectedReportType, offset))
      setReportResult(previous => append && previous
        ? { ...result, records: [...previous.records, ...result.records] }
        : result)
    } catch (error) {
      notify(error.message)
    } finally {
      setReportLoading(false)
    }
  }

  async function exportReport(format) {
    if (!reportResult) return
    if (!Number.isFinite(exchangeRate)) {
      notify('Wait for the selected currency rate to load before exporting.')
      return
    }
    setReportLoading(true)
    try {
      const records = [...reportResult.records]
      const exportLimit = 5000
      let offset = records.length
      while (reportResult.hasMore && offset < exportLimit) {
        const page = await request(reportQuery(selectedReportType, offset, Math.min(1000, exportLimit - offset)))
        records.push(...page.records)
        if (!page.hasMore || !page.records.length) break
        offset += page.records.length
      }
      const type = reportTypes.find(item => item.id === selectedReportType)
      const headers = reportHeaders(selectedReportType)
      const rows = records.map(record => {
        const converted = convertReportRow(presentReportRow(record), exchangeRate, currency)
        return {
          ...converted,
          date: converted.date ? String(converted.date).slice(0, 10) : '',
          month: converted.month || '',
          total_amount: Number(converted.total_amount || 0),
          personal_share: Number(converted.personal_share || 0),
          paid_amount: Number(converted.paid_amount || 0),
          balance: Number(converted.balance || 0),
        }
      })
      const filename = `groupbuk-${selectedReportType}-${todayIso()}`
      let blob
      if (format === 'csv') {
        blob = new Blob([`\uFEFF${reportCsv(headers, rows)}`], { type: 'text/csv;charset=utf-8' })
      } else if (format === 'xlsx') {
        blob = new Blob([reportXlsx(headers, rows, type?.label)], {
          type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        })
      } else {
        blob = new Blob([reportPdf(headers, rows, type?.label)], { type: 'application/pdf' })
      }
      const link = document.createElement('a')
      const url = URL.createObjectURL(blob)
      link.href = url
      link.download = `${filename}.${format}`
      link.click()
      URL.revokeObjectURL(url)
      if (reportResult.totalRecords > exportLimit) {
        notify(`Downloaded the first ${exportLimit.toLocaleString()} rows. Narrow filters to export the complete report.`)
      }
    } catch (error) {
      notify(`Could not create the ${format.toUpperCase()} report: ${error.message}`)
    } finally {
      setReportLoading(false)
    }
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
    const params = new URLSearchParams()
    if (tab === 'Group' && selectedGroupId) params.set('groupId', selectedGroupId)
    if (showVoidedExpenses && ['Activity', 'Group'].includes(tab)) params.set('includeVoided', 'true')
    const query = params.size ? `?${params.toString()}` : ''
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
  }, [tab, selectedGroupId, reloadKey, showVoidedExpenses])

  useEffect(() => {
    if (!authUser || tab !== 'Group' || !selectedGroupId) return undefined
    let active = true
    const params = new URLSearchParams()
    if (groupAnalyticsPeriod === 'custom') {
      if (groupAnalyticsStartDate) params.set('startDate', groupAnalyticsStartDate)
      if (groupAnalyticsEndDate) params.set('endDate', groupAnalyticsEndDate)
    } else {
      params.set('period', groupAnalyticsPeriod)
    }
    setGroupAnalyticsLoading(true)
    setGroupAnalyticsError('')
    setGroupAnalytics(null)
    request(`/api/groups/${selectedGroupId}/analytics?${params.toString()}`)
      .then(result => { if (active) setGroupAnalytics(result) })
      .catch(error => { if (active) setGroupAnalyticsError(error.message) })
      .finally(() => { if (active) setGroupAnalyticsLoading(false) })
    return () => { active = false }
  }, [authUser?.id, tab, selectedGroupId, groupAnalyticsPeriod, groupAnalyticsStartDate, groupAnalyticsEndDate, groupAnalyticsRetry, reloadKey])

  useEffect(() => {
    if (!authUser || (tab !== 'Budgets' && tab !== 'Overview')) return undefined
    let active = true
    setBudgetsLoading(true)
    request('/api/budgets')
      .then(rows => { if (active) setBudgets(rows) })
      .catch(error => { if (active) notify(error.message) })
      .finally(() => { if (active) setBudgetsLoading(false) })
    return () => { active = false }
  }, [authUser?.id, authUser?.workspaceId, tab, reloadKey])

  useEffect(() => {
    if (!budgetHistoryId || tab !== 'Budgets') return undefined
    let active = true
    request(`/api/budgets/${budgetHistoryId}/history?limit=12`)
      .then(rows => { if (active) setBudgetHistory(rows) })
      .catch(error => { if (active) notify(error.message) })
    return () => { active = false }
  }, [budgetHistoryId, tab, reloadKey])

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
  const expenseTotalCents = /^\d+(?:\.\d{1,2})?$/.test(expenseTotalInput)
    ? Math.round(Number(expenseTotalInput) * 100)
    : null
  const expenseExactAllocations = expenseParticipantIds.map(personId => {
    const raw = expenseExactAmounts[personId] ?? ''
    const valid = /^\d+(?:\.\d{1,2})?$/.test(raw)
    return { personId, raw, cents: valid ? Math.round(Number(raw) * 100) : null, valid }
  })
  const expenseAllocatedCents = expenseExactAllocations.reduce((sum, allocation) => sum + (allocation.cents ?? 0), 0)
  const expensePercentageAllocations = expenseParticipantIds.map(personId => {
    const raw = expensePercentages[personId] ?? ''
    const units = parsePercentageUnits(raw)
    return { personId, raw, units, valid: units !== null }
  })
  const expensePercentageUnits = expensePercentageAllocations.reduce((sum, allocation) => sum + (allocation.units ?? 0), 0)
  const expensePercentageCents = expenseTotalCents === null
    ? []
    : percentageShareCents(expenseTotalCents, expensePercentageAllocations)
  const expensePercentageAllocatedCents = expensePercentageCents.reduce((sum, share) => sum + share.cents, 0)
  const expenseShareAllocations = expenseParticipantIds.map(personId => {
    const raw = expenseShares[personId] ?? '1'
    const valid = /^\d+$/.test(String(raw)) && Number.isSafeInteger(Number(raw)) && Number(raw) > 0
    return { personId, raw, valid }
  })
  const expenseTotalShares = expenseShareAllocations.reduce((sum, allocation) => sum + (allocation.valid ? BigInt(allocation.raw) : 0n), 0n)
  const expenseShareCents = expenseTotalCents === null ? [] : shareCountCents(expenseTotalCents, expenseShareAllocations)
  const expenseShareAllocatedCents = expenseShareCents.reduce((sum, share) => sum + share.cents, 0)
  const expenseItemwiseDetails = expenseItems.map(item => {
    const quantityMatch = /^(\d+)(?:\.(\d{1,3}))?$/.exec(String(item.quantity).trim())
    const unitPriceValid = /^\d+(?:\.\d{1,2})?$/.test(String(item.unitPrice).trim()) && Number.isFinite(exchangeRate) && exchangeRate > 0
    const quantityMillis = quantityMatch
      ? Number(quantityMatch[1]) * 1000 + Number((quantityMatch[2] || '').padEnd(3, '0'))
      : 0
    const candidateUnitPriceBaseCents = unitPriceValid ? Math.round(Number(item.unitPrice) / exchangeRate * 100) : null
    const unitPriceBaseCents = Number.isSafeInteger(candidateUnitPriceBaseCents) ? candidateUnitPriceBaseCents : null
    const totalCents = unitPriceBaseCents === null || !Number.isSafeInteger(quantityMillis)
      ? null
      : Number((BigInt(unitPriceBaseCents) * BigInt(quantityMillis) + 500n) / 1000n)
    const ids = item.participantIds || []
    const rawAllocations = ids.map(personId => ({ personId, raw: item.allocations?.[personId] ?? '' }))
    let allocations = []
    let allocationValid = ids.length > 0
    if (totalCents !== null) {
      if (item.allocationMethod === 'equal') {
        const base = Math.floor(totalCents / Math.max(ids.length, 1))
        const remainder = totalCents % Math.max(ids.length, 1)
        allocations = ids.map((personId, index) => ({ personId, cents: base + (index < remainder ? 1 : 0) }))
      } else if (item.allocationMethod === 'exact') {
        allocations = rawAllocations.map(({ personId, raw }) => {
          const valid = /^\d+(?:\.\d{1,2})?$/.test(String(raw).trim())
          const cents = valid ? Math.round(Number(raw) / exchangeRate * 100) : 0
          return { personId, raw, cents, valid }
        })
        allocationValid = allocationValid && allocations.every(allocation => allocation.valid) &&
          allocations.reduce((sum, allocation) => sum + allocation.cents, 0) === totalCents
      } else if (item.allocationMethod === 'percentage') {
        allocations = rawAllocations.map(({ personId, raw }) => ({ personId, raw, units: parsePercentageUnits(raw) }))
        allocationValid = allocationValid && allocations.every(allocation => allocation.units !== null) &&
          allocations.reduce((sum, allocation) => sum + (allocation.units || 0), 0) === 10000
        allocations = percentageShareCents(totalCents, allocations).map((share, index) => ({ ...share, personId: ids[index] }))
      } else {
        allocations = rawAllocations.map(({ personId, raw }) => ({
          personId,
          raw,
          valid: /^\d+$/.test(String(raw)) && Number.isSafeInteger(Number(raw)) && Number(raw) > 0,
        }))
        allocationValid = allocationValid && allocations.every(allocation => allocation.valid)
        allocations = shareCountCents(totalCents, allocations).map((share, index) => ({ ...share, personId: ids[index] }))
      }
    }
    const memberIds = new Set((selectedExpenseGroup?.members || []).map(person => person.id))
    const membersValid = ids.every(personId => memberIds.has(personId))
    return {
      ...item,
      quantityMillis,
      unitPriceBaseCents,
      totalCents,
      allocations,
      valid: Boolean(item.itemName?.trim()) && item.itemName.trim().length <= 255 &&
        quantityMillis > 0 && Number.isSafeInteger(quantityMillis) && unitPriceValid &&
        totalCents !== null && Number.isSafeInteger(totalCents) && allocationValid && membersValid,
    }
  })
  const expenseItemwiseTotalCents = expenseItemwiseDetails.reduce((sum, item) => sum + (item.totalCents || 0), 0)
  const expenseItemwiseAllocatedCents = expenseItemwiseDetails.reduce((sum, item) =>
    sum + item.allocations.reduce((itemSum, allocation) => itemSum + allocation.cents, 0), 0)
  const expenseItemwiseDisplayTotal = Number.isFinite(exchangeRate) && exchangeRate > 0
    ? (expenseItemwiseTotalCents / 100 * exchangeRate).toFixed(2)
    : ''
  const expenseSplitValid = expenseSplitMethod === 'exact'
    ? expenseTotalCents !== null && expenseParticipantIds.length > 0 &&
      expenseExactAllocations.every(allocation => allocation.valid) &&
      expenseAllocatedCents === expenseTotalCents && Number.isFinite(exchangeRate) && exchangeRate > 0
    : expenseSplitMethod === 'percentage'
      ? expenseTotalCents !== null && expenseParticipantIds.length > 0 &&
        expensePercentageAllocations.every(allocation => allocation.valid) &&
        expensePercentageUnits === 10000 && Number.isFinite(exchangeRate) && exchangeRate > 0
      : expenseSplitMethod === 'shares'
        ? expenseTotalCents !== null && expenseParticipantIds.length > 0 && expenseShareAllocations.every(allocation => allocation.valid) &&
          expenseTotalShares > 0n && Number.isFinite(exchangeRate) && exchangeRate > 0
        : expenseSplitMethod === 'itemwise'
          ? expenseItemwiseDetails.length > 0 && expenseItemwiseDetails.every(item => item.valid) &&
            expenseItemwiseTotalCents > 0 && expenseItemwiseAllocatedCents === expenseItemwiseTotalCents
          : true
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
  const formatCurrentCurrency = amount => new Intl.NumberFormat(currency === 'INR' ? 'en-IN' : 'en-US', {
    style: 'currency',
    currency,
  }).format(Math.abs(Number(amount) || 0))
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
    return !expense.voided_at && monthValue(expense.created_at) === selectedMonth
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
  const reportColumns = reportHeaders(selectedReportType)
  const visibleReportRows = (reportResult?.records || []).map(record =>
    convertReportRow(presentReportRow(record), exchangeRate, currency)
  )

  function reportCell(record, key) {
    if (['total_amount', 'personal_share', 'paid_amount', 'balance'].includes(key)) {
      const amount = Number(record[key] || 0)
      return key === 'balance' && amount !== 0
        ? `${amount > 0 ? '−' : '+'}${formatMoney(amount)}`
        : formatMoney(amount)
    }
    if (key === 'date') return record.date ? String(record.date).slice(0, 10) : ''
    if (key === 'month') return record.month || ''
    if (key === 'currency') return currency
    if (key === 'group') return record.group_name || ''
    if (key === 'member') return record.participant || record.description || ''
    return record[key] ?? ''
  }

  const visibleActivity = useMemo(() => {
    const source = tab === 'Overview' && !activityLoaded ? data?.activity || [] : activity
    const cutoff = dateRange === 'all' ? 0 : Date.now() - Number(dateRange) * 24 * 60 * 60 * 1000
    return source.filter(expense => {
      if (!(showVoidedExpenses && ['Activity', 'Group'].includes(tab)) && expense.voided_at) return false
      const matchesSearch = `${expense.title} ${expense.group_name} ${expense.payer}`
        .toLowerCase()
        .includes(normalizedSearch)
      const matchesCategory = !['Activity', 'Group'].includes(tab) ||
        activityCategory === 'all' || (expense.category || 'Other') === activityCategory
      return matchesSearch && matchesCategory && new Date(expense.created_at).getTime() >= cutoff
    })
  }, [activity, activityCategory, activityLoaded, data, dateRange, normalizedSearch, showVoidedExpenses, tab])

  function openGroup(groupId) {
    setSelectedGroupId(Number(groupId))
    setTab('Group')
  }

  function openExpense() {
    const defaultGroup = selectedGroup?.members?.length
      ? selectedGroup
      : groups.find(group => group.members?.length)
    setExpenseGroupId(defaultGroup?.id || '')
    setExpensePaidBy(defaultGroup?.members?.some(person => person.id === data.currentUserId)
      ? data.currentUserId
      : defaultGroup?.members?.[0]?.id || '')
    setExpenseSplitMethod('equal')
    setExpenseParticipantIds((defaultGroup?.members || []).map(person => person.id))
    setExpenseExactAmounts({})
    setExpensePercentages({})
    setExpenseShares({})
    setExpenseItems([])
    setExpenseTotalInput('')
    setExpenseToEdit(null)
    setModal('expense')
  }

  function openExpenseEdit(expense) {
    const participants = (expense.shares || []).map(share => Number(share.person_id))
    const rate = Number.isFinite(exchangeRate) && exchangeRate > 0 ? exchangeRate : 1
    setExpenseToEdit(expense)
    setExpenseGroupId(Number(expense.group_id))
    setExpensePaidBy(Number(expense.payer_id))
    setExpenseSplitMethod(expense.split_method || 'equal')
    setExpenseParticipantIds(participants)
    setExpenseTotalInput((Number(expense.amount) * rate).toFixed(2))
    setExpenseExactAmounts(Object.fromEntries((expense.shares || []).map(share => [
      Number(share.person_id), (Number(share.amount) * rate).toFixed(2),
    ])))
    const participantAmounts = (expense.shares || []).map(share => Number(share.amount))
    const percentages = percentageInputsFromAmounts(participantAmounts)
    const shareCounts = shareInputsFromAmounts(participantAmounts)
    setExpensePercentages(Object.fromEntries(participants.map((personId, index) => [personId, percentages[index]])))
    setExpenseShares(Object.fromEntries(participants.map((personId, index) => [personId, shareCounts[index]])))
    setExpenseItems((expense.items || []).map(item => {
      const allocations = item.allocations || []
      const itemAmounts = allocations.map(allocation => Number(allocation.amount))
      const itemPercentages = percentageInputsFromAmounts(itemAmounts)
      const itemShares = shareInputsFromAmounts(itemAmounts)
      const itemParticipantIds = allocations.map(allocation => Number(allocation.person_id))
      return {
        itemName: item.item_name,
        quantity: String(Number(item.quantity)),
        unitPrice: (Number(item.unit_price) * rate).toFixed(2),
        allocationMethod: item.allocation_method,
        participantIds: itemParticipantIds,
        allocations: Object.fromEntries(itemParticipantIds.map((personId, index) => [
          personId,
          item.allocation_method === 'exact'
            ? (itemAmounts[index] * rate).toFixed(2)
            : item.allocation_method === 'percentage'
              ? itemPercentages[index]
              : item.allocation_method === 'shares'
                ? itemShares[index]
                : '',
        ])),
      }
    }))
    setModal('expense-edit')
  }

  function updateExpenseItem(index, update) {
    setExpenseItems(current => current.map((item, itemIndex) =>
      itemIndex === index ? update(item) : item))
  }

  function addExpenseItem() {
    setExpenseItems(current => [...current, {
      itemName: '',
      quantity: '1',
      unitPrice: '',
      allocationMethod: 'equal',
      participantIds: [...expenseParticipantIds],
      allocations: {},
    }])
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

  async function voidExpense(expense) {
    const confirmed = window.confirm(
      `Delete “${expense.title}” (${formatMoney(expense.amount)})? This removes it from group balances and totals. The expense and its history will be retained.`
    )
    if (!confirmed) return
    setVoidingExpenseId(expense.id)
    try {
      await request(`/api/expenses/${expense.id}`, { method: 'DELETE' })
      await refresh()
      setReloadKey(key => key + 1)
      if (reportResult) await runReport()
      notify('Expense deleted from active group totals. Its history is retained.')
    } catch (error) {
      notify(error.status === 409
        ? `This expense could not be deleted: ${error.message}`
        : error.message)
    } finally {
      setVoidingExpenseId(null)
    }
  }

  function openRecurringEditor(template = null) {
    setRecurringEditing(template)
    setModal(template ? 'recurring-edit' : 'recurring')
  }
  const formatBudgetMoney = (budget, amount) => new Intl.NumberFormat(
    budget.currency === 'INR' ? 'en-IN' : 'en-US',
    { style: 'currency', currency: budget.currency },
  ).format(Math.abs(Number(amount) / Number(budget.exchange_rate_to_inr || 1)) || 0)

  async function saveBudget(event) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const amount = Number(form.get('amount'))
    if (!Number.isFinite(amount) || amount <= 0 || !Number.isFinite(Math.round(amount * 100))) {
      notify('Enter a valid budget amount greater than zero.')
      return
    }
    const type = String(form.get('budgetType'))
    const payload = {
      name: String(form.get('name') || '').trim(),
      budgetType: type,
      amount,
      exchangeRateToInr: form.get('currency') === 'USD' ? 1 / exchangeRate : 1,
      currency: form.get('currency'),
      period: form.get('period'),
      startDate: form.get('startDate'),
      endDate: form.get('endDate') || null,
      category: form.get('category') || null,
      alertThresholds: String(form.get('alertThresholds') || '80,90,100').split(',').map(value => Number(value.trim())),
      ...(type === 'group' ? { groupId: Number(form.get('groupId')) } : {}),
    }
    if (!payload.name || (payload.endDate && payload.endDate < payload.startDate) ||
        payload.alertThresholds.some(value => !Number.isInteger(value) || value < 1 || value > 1000)) {
      notify('Check the budget name, date range, amount, and alert thresholds.')
      return
    }
    if (form.get('currency') === 'USD' && (!Number.isFinite(exchangeRate) || exchangeRate <= 0)) {
      notify('Select USD in the workspace currency switcher and wait for its rate before saving a USD budget.')
      return
    }
    setBudgetBusy(true)
    try {
      const isEditing = Boolean(budgetEditing?.id)
      const result = await request(isEditing ? `/api/budgets/${budgetEditing.id}` : '/api/budgets', {
        method: isEditing ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      setBudgetEditing(null)
      setBudgetFormOpen(false)
      setReloadKey(key => key + 1)
      notify(result.message || (isEditing ? 'Budget updated.' : 'Budget created.'))
    } catch (error) { notify(error.message) }
    finally { setBudgetBusy(false) }
  }

  async function setBudgetPaused(budget, paused) {
    setBudgetBusy(true)
    try {
      await request(`/api/budgets/${budget.id}/pause`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paused }),
      })
      setReloadKey(key => key + 1)
    } catch (error) { notify(error.message) }
    finally { setBudgetBusy(false) }
  }

  async function removeBudget(budget) {
    if (!window.confirm(`Delete “${budget.name}”? This will deactivate the budget.`)) return
    setBudgetBusy(true)
    try {
      const result = await request(`/api/budgets/${budget.id}`, { method: 'DELETE' })
      setReloadKey(key => key + 1)
      if (budgetHistoryId === budget.id) { setBudgetHistoryId(null); setBudgetHistory([]) }
      notify(result.message || 'Budget deleted.')
    } catch (error) { notify(error.message) }
    finally { setBudgetBusy(false) }
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
    } else if (notification.target_type === 'budget') {
      setTab('Budgets')
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
          rememberMe: authMode === 'login' ? form.get('rememberMe') === 'on' : undefined,
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
    if (['expense', 'expense-edit', 'expense-settlement', 'settlement'].includes(modal) && !Number.isFinite(exchangeRate)) {
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
    } else if (modal === 'expense' || modal === 'expense-edit') {
      if (!expenseSplitValid) {
        notify('Split allocations must be valid and match the selected split method.')
        return
      }
      const selectedParticipants = expenseParticipantIds
      const normalizedTotalCents = expenseSplitMethod === 'itemwise'
        ? expenseItemwiseTotalCents
        : Math.round(toStoredAmount(form.get('amount')) * 100)
      const exactCents = expenseSplitMethod === 'exact'
        ? expenseExactAllocations.map(allocation => Math.floor(allocation.cents / exchangeRate))
        : null
      if (exactCents) {
        let residual = normalizedTotalCents - exactCents.reduce((sum, cents) => sum + cents, 0)
        const order = expenseExactAllocations
          .map((allocation, index) => ({ index, fraction: allocation.cents / exchangeRate - exactCents[index] }))
          .sort((left, right) => right.fraction - left.fraction)
        for (let index = 0; residual > 0; index++, residual--) exactCents[order[index % order.length].index]++
        const reverseOrder = [...order].reverse()
        for (let index = 0; residual < 0; index++, residual++) {
          const target = reverseOrder[index % reverseOrder.length].index
          if (exactCents[target] > 0) exactCents[target]--
        }
      }
      url = modal === 'expense-edit' ? `/api/expenses/${expenseToEdit.id}` : '/api/expenses'
      payload = {
        groupId: modal === 'expense-edit' ? Number(expenseToEdit.group_id) : Number(form.get('groupId')),
        title: form.get('title'),
        amount: expenseSplitMethod === 'itemwise' ? expenseItemwiseTotalCents / 100 : toStoredAmount(form.get('amount')),
        paidBy: Number(form.get('paidBy')),
        category: form.get('category'),
        splitMethod: expenseSplitMethod,
        participants: expenseSplitMethod === 'itemwise' ? undefined : expenseSplitMethod === 'exact'
          ? selectedParticipants.map((personId, index) => ({ personId, amount: exactCents[index] / 100 }))
          : expenseSplitMethod === 'percentage'
            ? expensePercentageAllocations.map(allocation => ({
              personId: allocation.personId,
              percentage: allocation.raw,
            }))
            : expenseSplitMethod === 'shares'
              ? expenseShareAllocations.map(allocation => ({
                personId: allocation.personId,
                shares: allocation.raw,
              }))
            : selectedParticipants,
        items: expenseSplitMethod === 'itemwise' ? expenseItemwiseDetails.map(item => ({
          itemName: item.itemName.trim(),
          quantity: item.quantityMillis / 1000,
          unitPrice: item.unitPriceBaseCents / 100,
          allocationMethod: item.allocationMethod,
          participants: item.allocationMethod === 'equal'
            ? item.participantIds
            : item.allocations.map(allocation => ({
              personId: allocation.personId,
              ...(item.allocationMethod === 'exact'
                ? { amount: allocation.cents / 100 }
                : item.allocationMethod === 'percentage'
                  ? { percentage: allocation.raw }
                  : { shares: allocation.raw }),
            })),
        })) : undefined,
      }
      successMessage = modal === 'expense-edit' ? 'Expense updated.' : 'Expense added.'
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
        method: submittedModal === 'members' || submittedModal === 'recurring-edit' || submittedModal === 'expense-edit'
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
      notify(error.status === 409 && modal === 'expense-edit'
        ? `Unable to save these changes because they conflict with recorded settlements: ${error.message}`
        : error.message)
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
              {authMode === 'login' && (
                <label className="remember-me-option">
                  <input name="rememberMe" type="checkbox" />
                  <span>Remember me</span>
                </label>
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
    <div className={`app ${mobileNavOpen ? 'mobile-nav-open' : ''}`}>
      {mobileNavOpen && (
        <button
          type="button"
          className="mobile-nav-scrim"
          aria-label="Close navigation"
          onClick={() => setMobileNavOpen(false)}
        />
      )}
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
          {[[LayoutDashboard, 'Overview'], [Users, 'Users'], [Users, 'Groups'], [ReceiptText, 'Activity'], [Wallet, 'Budgets'], [CalendarClock, 'Recurring'], [FileBarChart, 'Reports'], [ArrowLeftRight, 'Balances']].map(([Icon, name]) => (
            <button key={name} className={`nav-item ${tab === name ? 'active' : ''}`} onClick={() => { setTab(name); setMobileNavOpen(false) }}>
              <Icon size={18} />{name}
              {name === 'Activity' && <span className="nav-count">{data.activityCount || 0}</span>}
              {name === 'Recurring' && recurringOccurrences.some(occurrence => occurrence.status === 'needs_confirmation') &&
                <span className="nav-count">{recurringOccurrences.filter(occurrence => occurrence.status === 'needs_confirmation').length}</span>}
            </button>
          ))}
          <button className="nav-item settle-up-nav" type="button" aria-label="Settle up" title="Settle up" disabled={!Number(currentUser?.balance)} onClick={() => { openSettleAll(); setMobileNavOpen(false) }}>
            <Check size={18} />Settle up
          </button>
        </nav>
        <div className="nav-label groups-label">
          YOUR GROUPS
          <button aria-label="Create group" onClick={() => { setModal('group'); setMobileNavOpen(false) }}><Plus size={15} /></button>
        </div>
        <div className="group-links">
          {groups.map(group => {
            const Icon = groupIcons[group.icon] || Users
            return (
              <button key={group.id} className="group-link" onClick={() => { openGroup(group.id); setMobileNavOpen(false) }}>
                <span className="group-ico" style={{ background: group.color }}><Icon size={15} /></span>
                <span>{group.name}</span>
              </button>
            )
          })}
        </div>
        <div className="sidebar-bottom">
          <label className="theme-switcher">
            {themePreference === 'system' ? <Monitor size={15} aria-hidden="true" /> : themePreference === 'dark' ? <Moon size={15} aria-hidden="true" /> : <Sun size={15} aria-hidden="true" />}
            <span>Appearance</span>
            <select
              aria-label="Color theme"
              value={themePreference}
              onChange={event => setTheme(event.target.value)}
            >
              <option value="light">Light</option>
              <option value="dark">Dark</option>
              <option value="system">System</option>
            </select>
          </label>
          <button className="nav-item" disabled={people.length < 2} onClick={() => { openManualSettlement(); setMobileNavOpen(false) }}><ArrowLeftRight size={18} />Record settlement</button>
          <div className="profile">
            <div className="avatar me">{currentUser?.initials || 'ME'}</div>
            <div className="profile-copy"><b>{currentUser?.name || authUser.name}</b><small>{authUser.email}</small></div>
            <button type="button" className="sign-out-button" onClick={signOut} aria-label="Sign out" title="Sign out"><LogOut size={17} /></button>
          </div>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div className="topbar-leading">
            <button
              type="button"
              className="mobile-nav-toggle"
              aria-label={mobileNavOpen ? 'Close navigation' : 'Open navigation'}
              aria-expanded={mobileNavOpen}
              onClick={() => setMobileNavOpen(open => !open)}
            >
              {mobileNavOpen ? <X size={19} /> : <Menu size={19} />}
            </button>
            <div className="crumb">Workspace <span>/</span> <b>{pageTitle}</b></div>
          </div>
          <div className="top-actions">
            <label className="search">
              <Search size={16} />
              <input aria-label="Search expenses" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search expenses..." />
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
                {tab === 'Budgets' && 'Plan spending, track progress, and compare periods.'}
                {tab === 'Reports' && 'Build, preview, and export reports from your workspace records.'}
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

          {notice && <div className="toast" role="status" aria-live="polite"><Check size={16} />{notice}</div>}

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
          <section className="panel budget-overview-panel" aria-label="Budget overview">
            <div className="budget-overview-heading">
              <div><div className="section-title">Budget overview</div><div className="section-subtitle">{budgets.filter(budget => !budget.is_paused).length} active · {budgets.filter(budget => !budget.is_paused && budget.utilization.currentPeriod.percentUsed >= 100).length} exceeded</div></div>
              <button type="button" className="budget-overview-link" onClick={() => setTab('Budgets')}>View budgets<ArrowRight size={14} /></button>
            </div>
            {budgets.filter(budget => !budget.is_paused).length ? (
              <div className="budget-overview-list">
                {budgets.filter(budget => !budget.is_paused).slice(0, 3).map(budget => {
                  const utilization = budget.utilization.currentPeriod
                  const pct = utilization.percentUsed
                  const level = pct >= 100 ? 'red' : pct >= 80 ? 'amber' : 'green'
                  const status = pct > 100 ? 'Budget exceeded' : pct >= 100 ? 'Budget reached' : pct >= 90 ? 'Near limit' : pct >= 80 ? 'Warning' : 'On track'
                  return <div className="budget-overview-row" key={budget.id}>
                    <div className="budget-overview-label"><b>{budget.name}</b><small className={`budget-overview-status budget-overview-text-${level}`}>{status}</small><span>{pct >= 100 ? `${formatBudgetMoney(budget, Math.abs(utilization.remaining))} over` : `${formatBudgetMoney(budget, utilization.remaining)} remaining`}</span></div>
                    <div className={`budget-overview-meter budget-overview-${level}`}><i style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} /></div>
                    <span className={`budget-overview-percent budget-overview-text-${level}`}>{pct.toFixed(0)}%</span>
                  </div>
                })}
              </div>
            ) : <div className="budget-overview-empty">{budgetsLoading ? 'Loading budgets…' : 'No active budgets yet.'}</div>}
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

          {tab === 'Reports' && (
            <div className="reports-page">
              <section className="report-type-grid" aria-label="Report types">
                {reportTypes.map(type => (
                  <button
                    type="button"
                    className={`report-type-card ${selectedReportType === type.id ? 'selected' : ''}`}
                    key={type.id}
                    onClick={() => {
                      setSelectedReportType(type.id)
                      setReportResult(null)
                    }}
                  >
                    <span className="report-type-icon"><FileBarChart size={17} /></span>
                    <b>{type.label}</b>
                    <small>{type.description}</small>
                  </button>
                ))}
              </section>

              <section className="panel screen-panel report-filter-panel">
                <div className="panel-heading screen-panel-heading">
                  <div>
                    <div className="section-title">Report filters</div>
                    <div className="section-subtitle">Amounts are stored in INR; USD exports use the current display rate.</div>
                  </div>
                  <label className="report-currency-filter">
                    <span>Currency</span>
                    <select value={currency} onChange={event => setCurrency(event.target.value)}>
                      <option value="INR">INR</option>
                      <option value="USD">USD</option>
                    </select>
                  </label>
                </div>
                <div className="report-filter-grid">
                  <label>
                    <span>From</span>
                    <input
                      type="date"
                      value={reportFilters.startDate}
                      disabled={selectedReportType === 'outstanding'}
                      onChange={event => setReportFilters(filters => ({ ...filters, startDate: event.target.value }))}
                    />
                  </label>
                  <label>
                    <span>To</span>
                    <input
                      type="date"
                      value={reportFilters.endDate}
                      disabled={selectedReportType === 'outstanding'}
                      onChange={event => setReportFilters(filters => ({ ...filters, endDate: event.target.value }))}
                    />
                  </label>
                  <label>
                    <span>Group</span>
                    <select value={reportFilters.groupId} onChange={event => setReportFilters(filters => ({ ...filters, groupId: event.target.value }))}>
                      <option value="all">All groups</option>
                      {groups.map(group => <option value={group.id} key={group.id}>{group.name}</option>)}
                    </select>
                  </label>
                  <label>
                    <span>Member</span>
                    <select value={reportFilters.memberId} onChange={event => setReportFilters(filters => ({ ...filters, memberId: event.target.value }))}>
                      <option value="all">All members</option>
                      {people.map(person => <option value={person.id} key={person.id}>{person.name}</option>)}
                    </select>
                  </label>
                  <label>
                    <span>Category</span>
                    <select
                      value={reportFilters.category}
                      disabled={['settlement', 'outstanding'].includes(selectedReportType)}
                      onChange={event => setReportFilters(filters => ({ ...filters, category: event.target.value }))}
                    >
                      <option value="all">All categories</option>
                      {categoryOptions.map(category => <option value={category} key={category}>{category}</option>)}
                    </select>
                  </label>
                  <button className="button button-dark report-generate-button" disabled={reportLoading} onClick={() => runReport()}>
                    {reportLoading ? <LoaderCircle className="loading-icon" size={15} /> : <FileBarChart size={15} />}
                    Generate report
                  </button>
                </div>
              </section>

              <section className="panel screen-panel report-preview-panel">
                <div className="panel-heading screen-panel-heading">
                  <div>
                    <div className="section-title">Report preview</div>
                    <div className="section-subtitle">
                      {reportResult
                        ? `${reportResult.totalRecords.toLocaleString()} matching records · showing ${visibleReportRows.length.toLocaleString()}`
                        : 'Generate a report to load matching records from your database.'}
                    </div>
                  </div>
                  <div className="report-export-actions">
                    <button className="button button-light" disabled={!reportResult || reportLoading || !Number.isFinite(exchangeRate)} onClick={() => exportReport('xlsx')}>
                      <FileSpreadsheet size={14} />Excel
                    </button>
                    <button className="button button-light" disabled={!reportResult || reportLoading || !Number.isFinite(exchangeRate)} onClick={() => exportReport('csv')}>
                      <FileDown size={14} />CSV
                    </button>
                    <button className="button button-light" disabled={!reportResult || reportLoading || !Number.isFinite(exchangeRate)} onClick={() => exportReport('pdf')}>
                      <Download size={14} />PDF
                    </button>
                  </div>
                </div>
                {reportResult && (
                  <div className="report-total-strip">
                    <div><span>Total expense amount</span><b>{formatMoney(reportResult.totals.total_amount)}</b></div>
                    <div><span>Personal / selected-member share</span><b>{formatMoney(reportResult.totals.personal_share)}</b></div>
                    {reportResult.totals.balance !== undefined && (
                      <div><span>Net outstanding balance</span><b>{formatMoney(reportResult.totals.balance)}</b></div>
                    )}
                  </div>
                )}
                {reportResult?.breakdown?.length > 0 && (
                  <div className="report-breakdown">
                    <div className="section-title">
                      {selectedReportType === 'monthly' ? 'Monthly totals' : selectedReportType === 'group' ? 'Group totals' : 'Member contributions'}
                    </div>
                    <div className="report-breakdown-grid">
                      {reportResult.breakdown.map((item, index) => (
                        <article key={item.group_id || item.member_id || item.period || index}>
                          <span>{item.period || item.group_name || item.member_name}</span>
                          {item.expense_count !== undefined && <small>{Number(item.expense_count).toLocaleString()} expenses</small>}
                          <b>{formatMoney(item.total_amount ?? item.share_amount)}</b>
                          {item.personal_share !== undefined && <small>Your share · {formatMoney(item.personal_share)}</small>}
                          {item.paid_amount !== undefined && <small>Paid by member · {formatMoney(item.paid_amount)}</small>}
                        </article>
                      ))}
                    </div>
                  </div>
                )}
                {!reportResult && (reportLoading
                  ? <LoadingSkeleton rows={4} label="Loading report preview" />
                  : <div className="empty report-empty">Choose a report and filters, then generate a preview.</div>)}
                {reportResult && visibleReportRows.length > 0 && (
                  <div className="report-table-wrap">
                    <table className="report-table">
                      <thead><tr>{reportColumns.map(column => <th key={column.key}>{column.label}</th>)}</tr></thead>
                      <tbody>
                        {visibleReportRows.map((record, rowIndex) => (
                          <tr key={`${record.expense_id || record.record_id || record.member_id || rowIndex}-${rowIndex}`}>
                            {reportColumns.map(column => <td key={column.key}>{reportCell(record, column.key)}</td>)}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {reportResult && !visibleReportRows.length && <div className="empty report-empty">No records match these filters.</div>}
                {reportResult?.hasMore && (
                  <div className="report-pagination">
                    <span>Preview and exports are capped at 5,000 rows. Narrow filters for larger reports.</span>
                    <button
                      className="button button-light"
                      disabled={reportLoading}
                      onClick={() => runReport(reportResult.records.length, true)}
                    >
                      Load more
                    </button>
                  </div>
                )}
              </section>
            </div>
          )}

          {tab === 'Budgets' && (
            <div className="budgets-page">
              <section className="panel screen-panel budget-editor-panel">
                <div className="panel-heading screen-panel-heading">
                  <div><div className="section-title">Your budgets <span className="title-count">{budgets.length}</span></div><div className="section-subtitle">Actual expense shares for personal budgets and full expense amounts for group budgets.</div></div>
                  {!budgetFormOpen && <button className="button button-dark" onClick={() => { setBudgetEditing(null); setBudgetFormOpen(true) }}><Plus size={15} />Create budget</button>}
                </div>
                {budgetFormOpen && <BudgetForm key={budgetEditing?.id || 'new-budget'} budget={budgetEditing} groups={groups.filter(group => group.members?.some(member => member.id === data?.currentUserId))} categories={expenseCategories} currency={currency} exchangeRate={exchangeRate} onSubmit={saveBudget} onCancel={() => { setBudgetEditing(null); setBudgetFormOpen(false) }} busy={budgetBusy} />}
                {budgetsLoading && !budgets.length ? <LoadingSkeleton rows={3} label="Loading budgets" /> : budgets.length ? (
                  <div className="budget-list">
                    {budgets.map(budget => {
                      const current = budget.utilization.currentPeriod
                      const previous = budget.utilization.previousPeriod
                      const budgetFormat = amount => new Intl.NumberFormat(budget.currency === 'INR' ? 'en-IN' : 'en-US', { style: 'currency', currency: budget.currency }).format(Math.abs(Number(amount) / Number(budget.exchange_rate_to_inr || 1)))
                      const percent = current.percentUsed
                      const level = percent >= 100 ? 'red' : percent >= 80 ? 'amber' : 'green'
                      const change = current.spent - previous.spent
                      const statusLabel = percent > 100 ? 'Budget exceeded' : percent >= 100 ? 'Budget reached' : percent >= 90 ? 'Near limit' : percent >= 80 ? 'Warning' : 'On track'
                      const latestAlert = budget.alertNotifications?.[0]
                      return (
                        <article className={`budget-card budget-${level}`} key={budget.id}>
                          <div className="budget-card-top">
                            <div className="budget-card-title"><span className="budget-type-icon"><Wallet size={17} /></span><div><h3>{budget.name}</h3><p>{budget.budget_type === 'group' ? budget.group_name : 'Personal'}{budget.category ? ` · ${budget.category}` : ' · All categories'} · {budget.period}</p></div></div>
                            <span className={`budget-status-pill budget-status-${level}`}>{percent >= 80 && <Bell size={11} />}{statusLabel} · {percent.toFixed(0)}%{budget.is_paused ? ' · Paused' : ''}</span>
                          </div>
                          <div className="budget-meter" role="progressbar" aria-label={`${budget.name} budget used`} aria-valuenow={Math.min(100, percent)} aria-valuemin="0" aria-valuemax="100"><i style={{ width: `${Math.min(100, Math.max(0, percent))}%` }} /></div>
                          <div className="budget-card-stats"><span><b>{budgetFormat(current.spent)}</b> spent</span><span>of {budgetFormat(current.budgetAmount)}</span><span>{budgetFormat(Math.abs(current.remaining))} {current.remaining < 0 ? 'over' : 'left'}</span></div>
                          {percent >= 80 && <div className="budget-alert-indicator"><Bell size={13} /><b>{statusLabel}</b>{latestAlert ? <time dateTime={latestAlert.created_at}>Alert · {notificationTimestamp(latestAlert.created_at)}</time> : <span>{budget.is_paused ? 'Alerts paused' : 'Threshold reached'}</span>}</div>}
                          <div className="budget-compare-row"><span>Previous period: {budgetFormat(previous.spent)}</span><span className={change > 0 ? 'budget-change-up' : 'budget-change-down'}>{change > 0 ? '+' : change < 0 ? '−' : ''}{budgetFormat(Math.abs(change))} vs previous</span></div>
                          <div className="budget-card-actions">
                            <button type="button" className="button button-light" onClick={() => { setBudgetEditing(budget); setBudgetFormOpen(true) }}><Pencil size={14} />Edit</button>
                            <button type="button" className="button button-light" disabled={budgetBusy} onClick={() => setBudgetPaused(budget, !budget.is_paused)}>{budget.is_paused ? <Play size={14} /> : <Pause size={14} />}{budget.is_paused ? 'Resume' : 'Pause'}</button>
                            <button type="button" className="budget-delete-button" disabled={budgetBusy} onClick={() => removeBudget(budget)} aria-label={`Delete ${budget.name}`}><Trash2 size={15} /></button>
                            <button type="button" className="budget-history-toggle" onClick={() => setBudgetHistoryId(id => id === budget.id ? null : budget.id)}>{budgetHistoryId === budget.id ? 'Hide history' : 'History'}</button>
                          </div>
                          {budgetHistoryId === budget.id && <div className="budget-history-panel"><div className="budget-chart-legend"><span><i className="legend-actual" />Actual</span><span><i className="legend-budget" />Budget</span></div>{budgetHistory.length ? <><BudgetHistoryChart rows={budgetHistory} formatMoney={budgetFormat} /><div className="budget-history-rows">{[...budgetHistory].reverse().map(row => <div className="budget-history-detail" key={row.startDate}><b>{new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${row.startDate}T12:00:00Z`))}</b><span>Budget {budgetFormat(row.budgetAmount)}</span><span>Actual {budgetFormat(row.spent)}</span><span>{budgetFormat(Math.abs(row.budgetAmount - row.spent))} {row.spent > row.budgetAmount ? 'over' : 'remaining'}</span><strong>{row.percentUsed.toFixed(1)}%</strong></div>)}</div></> : <div className="empty">No completed periods yet.</div>}</div>}
                        </article>
                      )
                    })}
                  </div>
                ) : <div className="empty budget-empty">No budgets yet. Create a personal or group budget to start tracking spending.</div>}
              </section>
              <section className="budget-analytics-grid">
                <article className="panel screen-panel budget-analytics-panel"><div className="section-title">Budget vs actual</div><div className="section-subtitle">Current period limits, spending, and remaining amounts.</div>{budgets.length ? <div className="budget-analytics-list">{budgets.map(budget => { const spent = budget.utilization.currentPeriod.spent; const limit = Number(budget.amount); const remaining = limit - spent; const percent = budget.utilization.currentPeriod.percentUsed; const money = value => new Intl.NumberFormat(budget.currency === 'INR' ? 'en-IN' : 'en-US', { style: 'currency', currency: budget.currency }).format(Math.abs(Number(value) / Number(budget.exchange_rate_to_inr || 1))); return <div className="budget-analytics-row" key={budget.id}><div className="budget-analytics-values"><b>{budget.name}</b><span>Budget {money(limit)} · Actual {money(spent)} · {money(Math.abs(remaining))} {remaining < 0 ? 'over' : 'left'} · {percent.toFixed(1)}%</span></div><i className={`budget-analytics-meter budget-meter-${percent >= 100 ? 'red' : percent >= 80 ? 'amber' : 'green'}`}><b style={{ width: `${Math.min(100, Math.max(0, percent))}%` }} /></i></div> })}</div> : <div className="empty">Create a budget to see actual spending.</div>}</article>
                <article className="panel screen-panel budget-analytics-panel"><div className="section-title">Category budget breakdown</div><div className="section-subtitle">Budgets and spending assigned to each category.</div>{budgets.some(budget => budget.category) ? <div className="budget-category-list">{budgets.filter(budget => budget.category).map(budget => { const money = value => new Intl.NumberFormat(budget.currency === 'INR' ? 'en-IN' : 'en-US', { style: 'currency', currency: budget.currency }).format(Math.abs(Number(value) / Number(budget.exchange_rate_to_inr || 1))); return <div className="budget-category-row" key={budget.id}><span>{budget.category}</span><div><b>{money(budget.utilization.currentPeriod.spent)}</b><small> / {money(budget.amount)}</small></div><i><b style={{ width: `${Math.min(100, Math.max(0, budget.utilization.currentPeriod.percentUsed))}%` }} /></i></div> })}</div> : <div className="empty">Add category budgets to see the breakdown.</div>}</article>
              </section>
            </div>
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
                  ? <LoadingSkeleton rows={3} label="Loading recurring expenses" />
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
              <GroupAnalyticsDashboard
                analytics={groupAnalytics}
                loading={groupAnalyticsLoading}
                error={groupAnalyticsError}
                period={groupAnalyticsPeriod}
                setPeriod={value => {
                  setGroupAnalyticsPeriod(value)
                  if (value !== 'custom') { setGroupAnalyticsStartDate(''); setGroupAnalyticsEndDate('') }
                }}
                startDate={groupAnalyticsStartDate}
                setStartDate={setGroupAnalyticsStartDate}
                endDate={groupAnalyticsEndDate}
                setEndDate={setGroupAnalyticsEndDate}
                formatMoney={formatMoney}
                onRetry={() => setGroupAnalyticsRetry(value => value + 1)}
              />
              </>
            )}
            <section className="panel screen-panel activity-screen">
              <div className="panel-heading screen-panel-heading">
                <div>
                  <div className="section-title">{tab === 'Group' ? 'Group expenses' : 'All activity'} <span className="title-count">{visibleActivity.length}</span></div>
                  <div className="section-subtitle">{tab === 'Group' ? 'Transactions saved to this group.' : 'Your expense history, loaded from the database.'}</div>
                </div>
                <div className="activity-controls">
                  <label className="activity-voided-toggle">
                    <input type="checkbox" checked={showVoidedExpenses} onChange={event => setShowVoidedExpenses(event.target.checked)} />
                    <span>Show deleted</span>
                  </label>
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
                  onEditExpense={openExpenseEdit}
                  onVoidExpense={voidExpense}
                  voidingExpenseId={voidingExpenseId}
                  canVoidExpense={expense => groups.find(group => Number(group.id) === Number(expense.group_id))?.members?.some(person => Number(person.id) === Number(data.currentUserId))}
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
        <div className="overlay" onMouseDown={event => !busy && event.target === event.currentTarget && setModal('')}>
          <form className={`modal${['expense', 'expense-edit'].includes(modal) ? ' expense-modal' : ''}`} onSubmit={submit}>
            <div className="modal-top">
              <div><span className="eyebrow">GROUPBUK</span><h2>{modal === 'person' ? 'Add a user' : modal === 'invite' ? 'Invite to workspace' : modal === 'members' ? 'Manage group members' : modal === 'expense' ? 'Add an expense' : modal === 'expense-edit' ? 'Edit Expense' : modal === 'expense-category' ? 'Edit expense category' : modal === 'recurring' ? 'Create recurring expense' : modal === 'recurring-edit' ? 'Edit recurring expense' : modal === 'recurring-confirm' ? 'Confirm recurring amount' : modal === 'group' ? 'Create a group' : modal === 'expense-settlement' ? 'Settle expense shares' : modal === 'settle-all' ? 'Settle your balance' : settlementDefaults?.groupId ? 'Settle group balance' : 'Record a settlement'}</h2></div>
              <button type="button" className="close" aria-label="Close" disabled={busy} onClick={() => setModal('')}><X size={18} /></button>
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

            {(modal === 'expense' || modal === 'expense-edit') && (
              <>
                <fieldset className="expense-fields" disabled={busy}>
                <label>What was it for?<input required name="title" maxLength="255" placeholder="Enter an expense name" defaultValue={modal === 'expense-edit' ? expenseToEdit?.title || '' : ''} /></label>
                <div className="form-row">
                <label>Amount ({currency})<input name="amount" type="number" min="0.01" step="0.01" placeholder="0.00" value={expenseSplitMethod === 'itemwise' ? expenseItemwiseDisplayTotal : expenseTotalInput} onChange={event => setExpenseTotalInput(event.target.value)} readOnly={expenseSplitMethod === 'itemwise'} disabled={!Number.isFinite(exchangeRate)} required /></label>
                  <label>Category<select name="category" defaultValue={modal === 'expense-edit' ? expenseToEdit?.category || 'Other' : 'Food & Dining'}>{[...new Set([...expenseCategories, ...(modal === 'expense-edit' ? [expenseToEdit?.category || 'Other'] : [])])].map(category => <option key={category}>{category}</option>)}</select></label>
                </div>
                <label>Group<select name="groupId" required value={expenseGroupId} onChange={event => {
                  const nextGroupId = Number(event.target.value)
                  const nextGroup = groups.find(group => group.id === nextGroupId)
                  setExpenseGroupId(nextGroupId)
                  setExpenseParticipantIds((nextGroup?.members || []).map(person => person.id))
                  setExpensePaidBy(nextGroup?.members?.some(person => person.id === data.currentUserId)
                    ? data.currentUserId
                    : nextGroup?.members?.[0]?.id || '')
                  const nextMemberIds = new Set((nextGroup?.members || []).map(person => person.id))
                  setExpenseItems(current => current.map(item => ({
                    ...item,
                    participantIds: item.participantIds.filter(personId => nextMemberIds.has(personId)),
                  })))
                }} disabled={modal === 'expense-edit'}><option value="" disabled>Select a group</option>{groups.filter(group => group.members?.length).map(group => <option value={group.id} key={group.id}>{group.name}</option>)}</select></label>
                <label key={selectedExpenseGroup?.id}>Paid by<select name="paidBy" required value={expensePaidBy} onChange={event => setExpensePaidBy(Number(event.target.value))}>{(selectedExpenseGroup?.members || []).map(person => <option value={person.id} key={person.id}>{person.name}</option>)}</select></label>
                <label>Split method<select value={expenseSplitMethod} onChange={event => setExpenseSplitMethod(event.target.value)}><option value="equal">Split equally</option><option value="exact">Exact amounts</option><option value="percentage">Percentage</option><option value="shares">Shares</option><option value="itemwise">Item-wise</option></select></label>
                {expenseSplitMethod !== 'itemwise' && <fieldset className="participant-field">
                  <legend>{expenseSplitMethod === 'exact' ? 'Participants and exact amounts' : expenseSplitMethod === 'percentage' ? 'Participants and percentages' : expenseSplitMethod === 'shares' ? 'Participants and share counts' : 'Split equally between'}</legend>
                  <div className="participant-list">
                    {(selectedExpenseGroup?.members || []).map(person => {
                      const selected = expenseParticipantIds.includes(person.id)
                      const participantCheckboxId = `expense-participant-${person.id}`
                      return <div key={person.id} className={`expense-share-option expense-share-${expenseSplitMethod}`}>
                        <label className="expense-participant-toggle" htmlFor={participantCheckboxId}>
                          <input
                            id={participantCheckboxId}
                            type="checkbox"
                            name="participants"
                            value={person.id}
                            checked={selected}
                            onChange={event => {
                              const checked = event.target.checked
                              setExpenseParticipantIds(current => checked
                                ? current.includes(person.id) ? current : [...current, person.id]
                                : current.filter(id => id !== person.id))
                            }}
                          />
                          <span className="avatar tiny" style={{ background: person.color }}>{person.initials}</span>
                          <span className="expense-share-name">{person.name}</span>
                        </label>
                        {selected && expenseSplitMethod === 'exact' && <input
                          className="exact-share-input"
                          aria-label={`${person.name} exact share`}
                          type="number"
                          min="0"
                          step="0.01"
                          placeholder={`0.00 ${currency}`}
                          value={expenseExactAmounts[person.id] ?? ''}
                          onChange={event => setExpenseExactAmounts(current => ({ ...current, [person.id]: event.target.value }))}
                        />}
                        {selected && expenseSplitMethod === 'percentage' && <>
                          <input
                            className="exact-share-input percentage-share-input"
                            aria-label={`${person.name} percentage`}
                            type="number"
                            inputMode="decimal"
                            min="0"
                            max="100"
                            step="0.01"
                            placeholder="0.00%"
                            value={expensePercentages[person.id] ?? ''}
                            onChange={event => setExpensePercentages(current => ({ ...current, [person.id]: event.target.value }))}
                          />
                          <span className="percentage-calculated" aria-label={`Calculated share amount ${formatCurrentCurrency((expensePercentageCents[expenseParticipantIds.indexOf(person.id)]?.cents || 0) / 100)}`} title="Calculated share amount">{formatCurrentCurrency((expensePercentageCents[expenseParticipantIds.indexOf(person.id)]?.cents || 0) / 100)}</span>
                        </>}
                        {selected && expenseSplitMethod === 'shares' && <>
                          <input
                            className="exact-share-input shares-count-input"
                            aria-label={`${person.name} share count`}
                            type="number"
                            inputMode="numeric"
                            min="1"
                            step="1"
                            value={expenseShares[person.id] ?? '1'}
                            onChange={event => setExpenseShares(current => ({ ...current, [person.id]: event.target.value }))}
                          />
                          <span className="percentage-calculated" aria-label={`Calculated share amount ${formatCurrentCurrency((expenseShareCents[expenseParticipantIds.indexOf(person.id)]?.cents || 0) / 100)}`} title="Calculated share amount">{formatCurrentCurrency((expenseShareCents[expenseParticipantIds.indexOf(person.id)]?.cents || 0) / 100)}</span>
                        </>}
                      </div>
                    })}
                  </div>
                </fieldset>}
                {expenseSplitMethod === 'equal' ? <p className="form-hint">Choose who shares this expense. Any extra cents are split fairly.</p> : expenseSplitMethod === 'exact' ? <div className="exact-allocation-summary" aria-live="polite">
                  <p>Allocated: {formatCurrentCurrency(expenseAllocatedCents / 100)} of {expenseTotalCents === null ? formatCurrentCurrency(0) : formatCurrentCurrency(expenseTotalCents / 100)}</p>
                  {expenseTotalCents !== null && expenseAllocatedCents < expenseTotalCents && <p className="form-hint">Remaining: {formatCurrentCurrency((expenseTotalCents - expenseAllocatedCents) / 100)}</p>}
                  {expenseTotalCents !== null && expenseAllocatedCents > expenseTotalCents && <p className="exact-allocation-error">Over-allocated by {formatCurrentCurrency((expenseAllocatedCents - expenseTotalCents) / 100)}.</p>}
                  {(expenseTotalCents === null || expenseExactAllocations.some(allocation => !allocation.valid)) && <p className="exact-allocation-error">Enter a valid nonnegative amount (up to two decimal places) for each selected participant.</p>}
                  {expenseTotalCents !== null && expenseAllocatedCents === expenseTotalCents && expenseSplitValid && currency !== 'INR' && <p className="form-hint">Shares are converted to INR cents for storage; any paise rounding is distributed across the selected shares.</p>}
                </div> : expenseSplitMethod === 'percentage' ? <div className="exact-allocation-summary percentage-allocation-summary" aria-live="polite">
                  <strong className="allocation-summary-title">Allocation summary</strong>
                  <div className="allocation-summary-grid">
                    <div><span>Total percentage</span><strong>{(expensePercentageUnits / 100).toFixed(2)}%</strong></div>
                    <div><span>Remaining percentage</span><strong>{(Math.max(0, 10000 - expensePercentageUnits) / 100).toFixed(2)}%</strong></div>
                    <div><span>Total amount allocated</span><strong>{formatCurrentCurrency(expensePercentageAllocatedCents / 100)}</strong></div>
                    <div><span>Remaining amount</span><strong>{expenseTotalCents === null ? formatCurrentCurrency(0) : formatCurrentCurrency(Math.max(0, expenseTotalCents - expensePercentageAllocatedCents) / 100)}</strong></div>
                  </div>
                  {(expenseTotalCents === null || expensePercentageAllocations.some(allocation => !allocation.valid)) && <p className="exact-allocation-error">Enter a nonnegative percentage with up to two decimal places for every selected participant.</p>}
                  {expensePercentageUnits < 10000 && expensePercentageAllocations.every(allocation => allocation.valid) && <p className="exact-allocation-error">Percentages must total exactly 100% before saving.</p>}
                  {expensePercentageUnits > 10000 && <p className="exact-allocation-error">Percentages exceed 100% by {((expensePercentageUnits - 10000) / 100).toFixed(2)}%.</p>}
                  {expensePercentageUnits === 10000 && expensePercentageAllocations.every(allocation => allocation.valid) && expenseSplitValid && <p className="allocation-valid-message">Percentages are fully allocated.</p>}
                </div> : <div className="exact-allocation-summary percentage-allocation-summary" aria-live="polite">
                  <strong className="allocation-summary-title">Share allocation summary</strong>
                  <div className="allocation-summary-grid">
                    <div><span>Total shares</span><strong>{expenseTotalShares.toString()}</strong></div>
                    <div><span>Total amount allocated</span><strong>{formatCurrentCurrency(expenseShareAllocatedCents / 100)}</strong></div>
                    <div><span>Remaining amount</span><strong>{expenseTotalCents === null ? formatCurrentCurrency(0) : formatCurrentCurrency(Math.max(0, expenseTotalCents - expenseShareAllocatedCents) / 100)}</strong></div>
                  </div>
                  {expenseShareAllocations.some(allocation => !allocation.valid) && <p className="exact-allocation-error">Enter a positive whole number of shares for every selected participant.</p>}
                  {expenseShareAllocations.length > 0 && expenseShareAllocations.every(allocation => allocation.valid) && expenseSplitValid && <p className="allocation-valid-message">Shares are allocated. Rounding cents are distributed deterministically.</p>}
                </div>}
                {expenseSplitMethod === 'itemwise' && <section className="itemwise-editor" aria-label="Item-wise expense details">
                  <div className="itemwise-heading">
                    <div><strong>Items and participants</strong><span>Assign each item to the people who share it.</span></div>
                    <button type="button" className="button button-light itemwise-add" onClick={addExpenseItem}><Plus size={14} /> Add item</button>
                  </div>
                  {expenseItems.length === 0 && <p className="itemwise-empty">Add an item to start splitting this expense.</p>}
                  {expenseItems.map((item, itemIndex) => {
                    const detail = expenseItemwiseDetails[itemIndex]
                    const allocatedCents = detail?.allocations.reduce((sum, allocation) => sum + allocation.cents, 0) || 0
                    return <article className="itemwise-card" key={itemIndex}>
                      <div className="itemwise-card-heading"><strong>Item {itemIndex + 1}</strong><button type="button" className="itemwise-remove" aria-label={`Remove item ${itemIndex + 1}`} onClick={() => setExpenseItems(current => current.filter((_, index) => index !== itemIndex))}><Trash2 size={15} /></button></div>
                      <div className="itemwise-fields">
                        <label>Item name<input value={item.itemName} maxLength="255" placeholder="e.g. Dinner" onChange={event => updateExpenseItem(itemIndex, current => ({ ...current, itemName: event.target.value }))} /></label>
                        <label>Quantity<input type="number" min="0.001" step="0.001" value={item.quantity} onChange={event => updateExpenseItem(itemIndex, current => ({ ...current, quantity: event.target.value }))} /></label>
                        <label>Unit price ({currency})<input type="number" min="0" step="0.01" value={item.unitPrice} placeholder="0.00" disabled={!Number.isFinite(exchangeRate)} onChange={event => updateExpenseItem(itemIndex, current => ({ ...current, unitPrice: event.target.value }))} /></label>
                        <label>Item total<input readOnly value={detail?.totalCents === null ? '' : formatMoney((detail?.totalCents || 0) / 100)} /></label>
                      </div>
                      <div className="itemwise-allocation-head">
                        <label>Allocate this item<select value={item.allocationMethod} onChange={event => updateExpenseItem(itemIndex, current => ({ ...current, allocationMethod: event.target.value }))}>
                          <option value="equal">Equally</option><option value="exact">Exact amounts</option><option value="percentage">Percentage</option><option value="shares">Shares</option>
                        </select></label>
                        <span>Allocated: {formatMoney(allocatedCents / 100)} / {formatMoney((detail?.totalCents || 0) / 100)}</span>
                      </div>
                      {(selectedExpenseGroup?.members || []).length > 0 ? <div className="itemwise-participants">
                        {(selectedExpenseGroup?.members || []).map(person => {
                          const selected = item.participantIds.includes(person.id)
                          const allocation = detail?.allocations.find(row => row.personId === person.id)
                          const value = item.allocations?.[person.id] ?? (item.allocationMethod === 'shares' ? '1' : '')
                          return <div className="itemwise-participant" key={person.id}>
                            <label className="itemwise-person"><input type="checkbox" checked={selected} aria-label={`Assign ${person.name} to item ${itemIndex + 1}`} onChange={event => updateExpenseItem(itemIndex, current => ({
                              ...current,
                              participantIds: event.target.checked
                                ? current.participantIds.includes(person.id) ? current.participantIds : [...current.participantIds, person.id]
                                : current.participantIds.filter(id => id !== person.id),
                            }))} /><span className="avatar tiny" style={{ background: person.color }}>{person.initials}</span><span>{person.name}</span></label>
                            {selected && item.allocationMethod !== 'equal' && <input className="itemwise-allocation-input" aria-label={`${person.name} ${item.allocationMethod} allocation for ${item.itemName || `item ${itemIndex + 1}`}`} type="number" min="0" step={item.allocationMethod === 'shares' ? '1' : '0.01'} value={value} onChange={event => updateExpenseItem(itemIndex, current => ({ ...current, allocations: { ...current.allocations, [person.id]: event.target.value } }))} />}
                            {selected && <span className="itemwise-allocation-amount">{formatMoney((allocation?.cents || 0) / 100)}</span>}
                          </div>
                        })}
                      </div> : <p className="form-hint">Add members to the selected group before assigning item shares.</p>}
                      {item.allocationMethod === 'exact' && <p className={detail?.valid ? 'allocation-valid-message' : 'exact-allocation-error'}>{detail?.valid ? 'Exact amounts match this item.' : 'Enter exact amounts whose INR total matches the item total.'}</p>}
                      {item.allocationMethod === 'percentage' && <p className={detail?.valid ? 'allocation-valid-message' : 'exact-allocation-error'}>{detail?.valid ? 'Percentages total 100%.' : 'Percentages for this item must total exactly 100%.'}</p>}
                      {item.allocationMethod === 'shares' && <p className={detail?.valid ? 'allocation-valid-message' : 'exact-allocation-error'}>{detail?.valid ? 'Share counts are valid.' : 'Enter positive whole share counts for every assigned participant.'}</p>}
                      {!detail?.valid && item.allocationMethod === 'equal' && <p className="exact-allocation-error">Add a valid name, positive quantity, price, and at least one group member.</p>}
                    </article>
                  })}
                  <div className="exact-allocation-summary percentage-allocation-summary itemwise-summary" aria-live="polite">
                    <strong className="allocation-summary-title">Expense allocation summary</strong>
                    <div className="allocation-summary-grid">
                      <div><span>Expense total</span><strong>{formatMoney(expenseItemwiseTotalCents / 100)}</strong></div>
                      <div><span>Amount allocated</span><strong>{formatMoney(expenseItemwiseAllocatedCents / 100)}</strong></div>
                      <div><span>{expenseItemwiseAllocatedCents > expenseItemwiseTotalCents ? 'Over-allocated' : 'Remaining amount'}</span><strong>{formatMoney(Math.abs(expenseItemwiseTotalCents - expenseItemwiseAllocatedCents) / 100)}</strong></div>
                      <div><span>Items</span><strong>{expenseItems.length}</strong></div>
                    </div>
                    {expenseItems.length > 0 && expenseItemwiseDetails.some(item => !item.valid) && <p className="exact-allocation-error">Complete each item and make sure its allocation is valid before saving.</p>}
                    {expenseItems.length > 0 && expenseSplitValid && <p className="allocation-valid-message">All item totals and allocations match the expense total.</p>}
                    {currency !== 'INR' && <p className="form-hint">Item prices are converted to INR for storage and all allocations use INR cents.</p>}
                  </div>
                </section>}
                </fieldset>
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
              <button className="button button-dark modal-submit" disabled={busy || (['expense', 'expense-edit'].includes(modal) && !expenseSplitValid)}>
                {busy ? 'Saving…' : modal === 'person' ? 'Add user' : modal === 'invite' ? 'Create invitation & show share buttons' : modal === 'members' ? 'Save members' : modal === 'expense' ? 'Save expense' : modal === 'expense-edit' ? 'Save Changes' : modal === 'expense-category' ? 'Save category' : modal === 'recurring' ? 'Create schedule' : modal === 'recurring-edit' ? 'Save schedule' : modal === 'recurring-confirm' ? 'Confirm & record expense' : modal === 'group' ? 'Create group' : modal === 'expense-settlement' ? 'Record selected payments' : modal === 'settle-all' ? 'Confirm & clear my balance' : 'Save settlement'}
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
