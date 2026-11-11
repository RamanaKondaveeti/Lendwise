export function monthValue(value) {
  const parsed = new Date(value)
  return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, '0')}`
}

export function calculateMonthlyAnalytics(expenses, currentUserId, selectedMonth, groupId = 'all', category = 'all') {
  const [year, month] = selectedMonth.split('-').map(Number)
  const previousDate = new Date(Date.UTC(year, month - 2, 1))
  const previousMonth = `${previousDate.getUTCFullYear()}-${String(previousDate.getUTCMonth() + 1).padStart(2, '0')}`
  const inScope = expenses.filter(expense => (
    !expense.voided_at &&
    (groupId === 'all' || Number(expense.group_id) === Number(groupId)) &&
    (category === 'all' || (expense.category || 'Other') === category)
  ))
  const expensesForMonth = inScope.filter(expense => monthValue(expense.created_at) === selectedMonth)
  const expensesForPreviousMonth = inScope.filter(expense => monthValue(expense.created_at) === previousMonth)
  const total = expensesForMonth.reduce((sum, expense) => sum + Number(expense.amount || 0), 0)
  const previousTotal = expensesForPreviousMonth.reduce((sum, expense) => sum + Number(expense.amount || 0), 0)
  const personalShare = expensesForMonth.reduce((sum, expense) => {
    const userShare = expense.shares?.find(share => Number(share.person_id) === Number(currentUserId))
    return sum + Number(userShare?.amount || 0)
  }, 0)
  const categories = new Map()
  for (const expense of expensesForMonth) {
    const key = expense.category || 'Other'
    categories.set(key, (categories.get(key) || 0) + Number(expense.amount || 0))
  }

  const monthlyTotals = Array(12).fill(0)
  for (const expense of inScope) {
    const expenseMonth = monthValue(expense.created_at)
    if (expenseMonth.startsWith(`${year}-`)) {
      const monthIndex = Number(expenseMonth.slice(5, 7)) - 1
      if (monthIndex >= 0 && monthIndex < monthlyTotals.length) {
        monthlyTotals[monthIndex] += Number(expense.amount || 0)
      }
    }
  }
  const monthlySeries = monthlyTotals.map((monthTotal, index) => ({
    month: `${year}-${String(index + 1).padStart(2, '0')}`,
    total: monthTotal,
  }))

  return {
    expenses: expensesForMonth,
    total,
    personalShare,
    previousTotal,
    changePercent: previousTotal > 0 ? ((total - previousTotal) / previousTotal) * 100 : null,
    categoryTotals: [...categories.entries()]
      .map(([name, amount]) => ({ name, amount }))
      .sort((left, right) => right.amount - left.amount),
    monthlySeries,
  }
}
