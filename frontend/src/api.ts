// Talks to the Python backend. Amounts arrive as exact decimal text, e.g. "1200.00".

export type Money = string

export interface Currency {
  code: string
  name: string
}

export interface Group {
  id: number
  name: string
  location_id: number
  sort_order: number
  usual_recipient_id: number | null
}

export interface Location {
  id: number
  name: string
  default_currency: string
  sort_order: number
  groups: Group[]
}

export interface Account {
  id: number
  name: string
  currency_code: string
  kind: string
  active: boolean
}

export interface Meta {
  currencies: Currency[]
  locations: Location[]
  accounts: Account[]
}

/** A total shown three ways: per currency as entered, all in KES, all in NTD. */
export interface Total {
  native: Record<string, Money>
  KES: Money
  NTD: Money
}

export interface MonthTotals {
  grand: Total
  groups: Record<string, Total>
  locations: Record<string, Total>
  priority: Record<string, Total>
  kind: Record<string, Total>
  needs_review: number
  line_count: number
}

export type LineType = 'fixed' | 'variable' | 'one_off'
export type LineKind = 'expense' | 'saving' | 'debt_repayment'
export type Priority = 'essential' | 'flexible'

export interface Line {
  id: number
  month_id: number
  group_id: number
  name: string
  currency_code: string
  line_type: LineType
  kind: LineKind
  priority: Priority
  weekly_amount: Money | null
  planned: Money
  actual: Money | null
  needs_review: boolean
  is_core: boolean
  destination_account_id: number | null
  goal_id: number | null
  recipient_id: number | null
  debt_id: number | null
  note: string | null
  sort_order: number
}

export interface Recipient {
  id: number
  name: string
  usual_method: string | null
  active: boolean
}

export interface SendLine {
  id: number
  name: string
  priority: Priority
  kind: LineKind
  is_core: boolean
  planned: Money
  /** Typed on the Month plan; what really goes to the line. */
  actual: Money | null
  /** Who it is sent to: the line's own recipient, or else the section's usual one. */
  recipient_id: number | null
  own_recipient: boolean
  set_aside: Money
  sent: Money
  /** Cash set aside from income and not sent yet. */
  to_send: Money
  /** Budget not sent yet. */
  remaining: Money
  /** Budget no income has covered yet. */
  waiting: Money
  over: Money
}

export interface SendGroup {
  group_id: number
  name: string
  location_name: string | null
  usual_recipient_id: number | null
  planned: Money
  set_aside: Money
  sent: Money
  /** Cash set aside from income and not sent yet. */
  to_send: Money
  /** Budget not sent yet. */
  remaining: Money
  /** Budget no income has covered yet. */
  waiting: Money
  over: Money
  lines: SendLine[]
}

export interface SendPurposeRow {
  budget_line_id: number
  line_name: string | null
  group_id: number | null
  group_name: string | null
  via_group_id: number | null
  amount_kes: Money
}

export interface SendRow {
  id: number
  sent_date: string
  recipient_id: number
  recipient_name: string
  amount_kes: Money
  amount_ntd: Money | null
  fee_ntd: Money | null
  rate: string | null
  platform: string | null
  reference: string | null
  note: string | null
  assigned: Money
  unassigned: Money
  purposes: SendPurposeRow[]
}

export interface SendsView {
  month_id: number
  status: 'planning' | 'active' | 'closed'
  planning_rate: string
  recipients: Recipient[]
  groups: SendGroup[]
  sends: SendRow[]
  per_recipient: { recipient_id: number; name: string; count: number; amount_kes: Money }[]
  totals: {
    planned: Money
    set_aside: Money
    sent: Money
    assigned: Money
    to_send: Money
    remaining: Money
    waiting: Money
    over: Money
    unassigned: Money
    count: number
    ntd_paid: Money
    fees_ntd: Money
    average_rate: string | null
  }
}

export interface SendBody {
  sent_date: string
  recipient_id: number
  amount_kes: string
  amount_ntd?: string | null
  fee_ntd?: string | null
  platform?: string | null
  reference?: string | null
  note?: string | null
  purposes: { budget_line_id?: number; group_id?: number; amount: string }[]
}

export type GoalKind = 'project' | 'saving_goal'
export type GoalStatus = 'planning' | 'active' | 'on_hold' | 'completed' | 'cancelled'
export type Importance = 'high' | 'medium' | 'low'

export interface GoalLine {
  line_id: number
  name: string
  where: string | null
  currency_code: string
  planned: Money
  actual: Money
  planned_in_goal_currency: Money
  set_aside_to_send: Money
}

export interface GoalItem {
  id: number
  name: string
  category: string | null
  estimate: Money
  actual: Money | null
  done: boolean
}

export interface Goal {
  id: number
  name: string
  kind: GoalKind
  category: string | null
  currency_code: string
  target: Money
  opening_amount: Money
  monthly_amount: Money | null
  target_date: string | null
  importance: Importance
  status: GoalStatus
  rank: number
  funded_from: string | null
  note: string | null
  funded: Money
  from_lines: Money
  from_savings: Money
  from_entries: Money
  needed: Money
  percent: number | null
  spent: Money
  estimate: Money
  this_month: Money
  pace: Money
  months_left: number | null
  finish: string | null
  on_time: boolean | null
  lines: GoalLine[]
  history: { when: string; source: string; amount: Money; entry_id?: number }[]
  items: GoalItem[]
}

export interface GoalsView {
  month: { id: number; label: string; rate: string } | null
  goals: Goal[]
  totals: Record<string, { target: Money; funded: Money; needed: Money; this_month: Money }>
  needed_kes: Money
  this_month_kes: Money
  open_count: number
  savings_shared_kes: Money
  savings_unshared: Record<string, Money>
  linkable_lines: { line_id: number; name: string; kind: LineKind; where: string | null; currency_code: string; planned: Money }[]
}

export type SplitOrder = 'bills_first' | 'savings_first'

export interface ReviewView {
  month_id: number
  label: string
  status: 'planning' | 'active' | 'closed'
  closed_at: string | null
  review_note: string | null
  close_log: string | null
  figures: {
    budget: Total
    actual: Total
    income: Total
    saved: Total
    free: Total
    sent_kes: Money
    locations: Record<string, { budget: Total; actual: Total }>
  }
  checks: {
    over_budget: { id: number; name: string; section: string; currency_code: string; planned: Money; actual: Money }[]
    nothing_given: { id: number; name: string; section: string; currency_code: string; planned: Money; typed: boolean }[]
    ready_to_send: { name: string; section: string; amount: Money }[]
    unassigned_sends: Money
    income_not_arrived: { source_id: number; name: string; currency_code: string; amount: Money }[]
    needs_review: number
  }
  balances: {
    accounts: { account_id: number; name: string; currency_code: string; kind: string; actual_balance: Money | null; note: string | null }[]
    currencies: {
      currency_code: string
      opening: Money | null
      income: Money
      spent: Money
      sends_cost: Money
      expected: Money | null
      entered: Money | null
      difference: Money | null
    }[]
    has_previous: boolean
    previous_label: string | null
  }
}

export interface HistoryRow {
  id: number
  year: number
  month: number
  label: string
  status: string
  income_kes: Money
  income: Record<string, Money>
  budget_kes: Money
  actual_kes: Money
  saved_kes: Money
  free_kes: Money
  sent_kes: Money
  income_ntd: Money
  budget_ntd: Money
  actual_ntd: Money
  saved_ntd: Money
  sent_ntd: Money
}

export interface HistoryView {
  months: HistoryRow[]
  years: {
    year: number
    months: number
    income_kes: Money
    budget_kes: Money
    actual_kes: Money
    saved_kes: Money
    sent_kes: Money
    income_ntd: Money
    budget_ntd: Money
    actual_ntd: Money
    saved_ntd: Money
    sent_ntd: Money
  }[]
}

export interface CompareView {
  a: { id: number; label: string }
  b: { id: number; label: string }
  lines: {
    location: string
    section: string
    name: string
    currency_code: string
    a: { budget: Money; actual: Money } | null
    b: { budget: Money; actual: Money } | null
  }[]
}

export interface Debt {
  id: number
  lender: string
  currency_code: string
  starting_balance: Money
  monthly_repayment: Money | null
  started_on: string | null
  status: 'open' | 'cleared'
  note: string | null
  borrowed: Money
  repaid: Money
  balance: Money
  this_month: Money
  months_left: number | null
  clear_by: string | null
  lines: { line_id: number; name: string; currency_code: string; planned: Money; actual: Money; where: string | null }[]
  history: { when: string; what: string; amount: Money; entry_id?: number }[]
}

export interface DebtsView {
  month: { id: number; label: string } | null
  debts: Debt[]
  totals: Record<string, Money>
  total_kes: Money
  total_ntd: Money
  linkable_lines: { line_id: number; name: string; currency_code: string; planned: Money; kind: string; where: string | null }[]
}

export type RuleType = 'none' | 'percent_first' | 'fixed_first' | 'three_way'

export interface Source {
  id: number
  name: string
  currency_code: string
  usual_day: number | null
  reliability: 'regular' | 'irregular'
  active: boolean
  rule_type: RuleType
  save_percent: Money | null
  save_fixed: Money | null
  obligations_percent: Money | null
}

export interface SourceRow extends Source {
  expected: Money | null
  expected_day: number | null
  arrived: Money
}

/** One slice of a payment. `amount` is in the payment's currency. */
export interface Slice {
  id: number
  kind: 'core_saving' | 'savings' | 'essential' | 'flexible' | 'project' | 'free'
  amount: Money
  budget_line_id: number | null
  line_amount: Money | null
  line_name: string | null
  line_currency: string | null
  line_planned: Money | null
  group_name: string | null
  location_name: string | null
}

export interface Arrival {
  id: number
  source_id: number
  source_name: string
  amount: Money
  currency_code: string
  received_date: string
  note: string | null
  confirmed: boolean
  /** Changed by hand, so it is kept when other payments change. */
  adjusted: boolean
  allocations: Slice[]
  essentials_left?: Total
  reliable_after?: Total
}

export interface Fit {
  reliable: Total
  irregular: Total
  plan: Total
  gap_kes: Money
  gap_ntd: Money
  fits: boolean
  needs_review: number
  flexible_lines: { id: number; name: string; planned: Money; currency_code: string }[]
}

export interface Progress {
  planned: Total
  covered: Total
}

export interface IncomeView {
  month_id: number
  status: 'planning' | 'active' | 'closed'
  shortfall_amount: Money | null
  shortfall_source: string | null
  core_note: string | null
  sources: SourceRow[]
  fit: Fit
  arrivals: Arrival[]
  coverage: Record<string, Money>
  summary: {
    arrived: Total
    savings_reserved: Total
    free: Total
    core: { line_id: number; name: string; currency_code: string; planned: Money; covered: Money } | null
    essential: Progress
    flexible: Progress
    locations: Record<string, Progress>
    essentials_left: Total
    upcoming: {
      source_id: number
      name: string
      currency_code: string
      amount: Money
      expected_day: number | null
      reliability: string
    }[]
    upcoming_reliable: Total
  }
}

export interface MonthSummary {
  id: number
  year: number
  month: number
  status: 'planning' | 'active' | 'closed'
  fx_rate_ntd_kes: Money
  weeks: number
  totals: MonthTotals
}

/** Budget against actual for one line. Amounts are in the line's currency. */
export interface LineActual {
  auto: Money
  actual: Money
  /** True when the actual was typed over the automatic figure. */
  manual: boolean
  left: Money
  over: boolean
  /** Set aside from income in another currency, not yet sent. */
  set_aside_to_send: Money
}

export interface MonthDetail extends MonthSummary {
  lines: Line[]
  copied_from: string | null
  actuals: Record<string, LineActual>
}

export interface SignedInUser {
  username: string
  is_admin: boolean
}

/** Someone who can sign in to the app (not a bank account). */
export interface AppAccount extends SignedInUser {
  id: number
  created_at: string
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch('/api' + path, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  if (res.status === 401 && !path.startsWith('/auth/')) {
    // The session ended: tell the app to show the sign-in screen.
    window.dispatchEvent(new Event('budget-signed-out'))
  }
  if (!res.ok) {
    let message = `Something went wrong (${res.status})`
    try {
      const data = await res.json()
      if (typeof data.detail === 'string') message = data.detail
      else if (Array.isArray(data.detail) && data.detail[0]?.msg) message = data.detail[0].msg
    } catch {
      // keep the generic message
    }
    throw new Error(message)
  }
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

export const api = {
  meta: () => request<Meta>('GET', '/meta'),
  months: () => request<MonthSummary[]>('GET', '/months'),
  month: (id: number) => request<MonthDetail>('GET', `/months/${id}`),
  createMonth: (body: { year: number; month: number; copy_previous: boolean; fx_rate_ntd_kes?: string }) =>
    request<MonthDetail>('POST', '/months', body),
  updateMonth: (id: number, body: { fx_rate_ntd_kes?: string; weeks?: number }) =>
    request<MonthDetail>('PATCH', `/months/${id}`, body),
  deleteMonth: (id: number) => request<void>('DELETE', `/months/${id}`),
  confirmAll: (id: number) => request<MonthDetail>('POST', `/months/${id}/confirm-all`),

  createLine: (monthId: number, body: Partial<Line> & { group_id: number; name: string; currency_code: string }) =>
    request<Line>('POST', `/months/${monthId}/lines`, body),
  updateLine: (id: number, body: Omit<Partial<Line>, 'actual'> & { actual?: string | null; reason?: string }) => request<Line>('PATCH', `/lines/${id}`, body),
  deleteLine: (id: number, reason?: string) =>
    request<void>('DELETE', `/lines/${id}` + (reason ? `?reason=${encodeURIComponent(reason)}` : '')),

  income: (monthId: number) => request<IncomeView>('GET', `/months/${monthId}/income`),
  setExpected: (monthId: number, body: { source_id: number; amount?: string; expected_day?: number | null }) =>
    request<IncomeView>('PUT', `/months/${monthId}/expected`, body),
  activate: (monthId: number, shortfall_source?: string) =>
    request<IncomeView>('POST', `/months/${monthId}/activate`, { shortfall_source: shortfall_source ?? null }),
  backToPlanning: (monthId: number) => request<IncomeView>('POST', `/months/${monthId}/back-to-planning`),
  recordArrival: (monthId: number, body: { source_id: number; amount: string; received_date: string; note?: string }) =>
    request<IncomeView>('POST', `/months/${monthId}/arrivals`, body),
  resuggest: (arrivalId: number) => request<IncomeView>('POST', `/arrivals/${arrivalId}/resuggest`),
  setAllocations: (arrivalId: number, body: { kind: string; budget_line_id: number | null; amount: string }[]) =>
    request<IncomeView>('PUT', `/arrivals/${arrivalId}/allocations`, body),
  confirmArrival: (arrivalId: number) => request<IncomeView>('POST', `/arrivals/${arrivalId}/confirm`),
  deleteArrival: (arrivalId: number) => request<IncomeView>('DELETE', `/arrivals/${arrivalId}`),

  sends: (monthId: number) => request<SendsView>('GET', `/months/${monthId}/sends`),
  createSend: (monthId: number, body: SendBody) => request<SendsView>('POST', `/months/${monthId}/sends`, body),
  updateSend: (id: number, body: SendBody) => request<SendsView>('PUT', `/sends/${id}`, body),
  deleteSend: (id: number) => request<SendsView>('DELETE', `/sends/${id}`),
  recipients: () => request<Recipient[]>('GET', '/recipients'),
  createRecipient: (body: { name: string; usual_method?: string | null }) =>
    request<{ id: number }>('POST', '/recipients', body),
  updateRecipient: (id: number, body: Partial<Recipient>) => request<{ id: number }>('PATCH', `/recipients/${id}`, body),
  deleteRecipient: (id: number) => request<void>('DELETE', `/recipients/${id}`),

  goals: (monthId: number) => request<GoalsView>('GET', `/goals?month_id=${monthId}`),
  createGoal: (monthId: number, body: Partial<Goal> & { name: string }) =>
    request<GoalsView>('POST', `/goals?month_id=${monthId}`, body),
  updateGoal: (monthId: number, id: number, body: Partial<Goal>) =>
    request<GoalsView>('PATCH', `/goals/${id}?month_id=${monthId}`, body),
  deleteGoal: (monthId: number, id: number) => request<GoalsView>('DELETE', `/goals/${id}?month_id=${monthId}`),
  moveGoal: (monthId: number, id: number, direction: 'up' | 'down') =>
    request<GoalsView>('POST', `/goals/${id}/move?month_id=${monthId}`, { direction }),
  addGoalItem: (monthId: number, id: number, body: { name: string; category?: string | null; estimate: string; actual?: string | null }) =>
    request<GoalsView>('POST', `/goals/${id}/items?month_id=${monthId}`, body),
  updateGoalItem: (monthId: number, id: number, body: Partial<{ name: string; category: string | null; estimate: string; actual: string | null; done: boolean }>) =>
    request<GoalsView>('PATCH', `/goal-items/${id}?month_id=${monthId}`, body),
  deleteGoalItem: (monthId: number, id: number) => request<GoalsView>('DELETE', `/goal-items/${id}?month_id=${monthId}`),
  addGoalEntry: (monthId: number, id: number, body: { entry_date: string; amount: string; note?: string | null }) =>
    request<GoalsView>('POST', `/goals/${id}/entries?month_id=${monthId}`, body),
  deleteGoalEntry: (monthId: number, id: number) => request<GoalsView>('DELETE', `/goal-entries/${id}?month_id=${monthId}`),

  orderGoals: (monthId: number, ids: number[]) => request<GoalsView>('PUT', `/goals/order?month_id=${monthId}`, { ids }),
  splitOrder: () => request<{ order: SplitOrder }>('GET', '/settings/split-order'),
  setSplitOrder: (order: SplitOrder) => request<{ order: SplitOrder }>('PUT', '/settings/split-order', { order }),
  /** Whether this budget still opens on the first-time set-up guide. */
  setup: () => request<{ pending: boolean }>('GET', '/settings/setup'),
  setSetup: (pending: boolean) => request<{ pending: boolean }>('PUT', '/settings/setup', { pending }),

  review: (monthId: number) => request<ReviewView>('GET', `/months/${monthId}/review`),
  setBalance: (monthId: number, body: { account_id: number; actual_balance: string; note?: string | null }) =>
    request<ReviewView>('PUT', `/months/${monthId}/balances`, body),
  setReviewNote: (monthId: number, note: string) => request<ReviewView>('PATCH', `/months/${monthId}/review-note`, { note }),
  closeMonth: (monthId: number, note?: string) => request<ReviewView>('POST', `/months/${monthId}/close`, { note: note ?? null }),
  reopenMonth: (monthId: number, reason: string) => request<ReviewView>('POST', `/months/${monthId}/reopen`, { reason }),
  history: () => request<HistoryView>('GET', '/history'),
  compare: (a: number, b: number) => request<CompareView>('GET', `/compare?a=${a}&b=${b}`),
  exportMonthUrl: (monthId: number) => `/api/export/month/${monthId}`,
  exportYearUrl: (year: number) => `/api/export/year/${year}`,

  debts: (monthId: number) => request<DebtsView>('GET', `/debts?month_id=${monthId}`),
  createDebt: (monthId: number, body: Partial<Debt> & { lender: string }) =>
    request<DebtsView>('POST', `/debts?month_id=${monthId}`, body),
  updateDebt: (monthId: number, id: number, body: Partial<Debt>) =>
    request<DebtsView>('PATCH', `/debts/${id}?month_id=${monthId}`, body),
  deleteDebt: (monthId: number, id: number) => request<DebtsView>('DELETE', `/debts/${id}?month_id=${monthId}`),
  addDebtEntry: (monthId: number, id: number, body: { entry_date: string; kind: 'borrowed' | 'repaid'; amount: string; note?: string | null }) =>
    request<DebtsView>('POST', `/debts/${id}/entries?month_id=${monthId}`, body),
  deleteDebtEntry: (monthId: number, id: number) => request<DebtsView>('DELETE', `/debt-entries/${id}?month_id=${monthId}`),

  authStatus: () =>
    request<{ set_up: boolean; signed_in: boolean; min_length: number; user: SignedInUser | null }>('GET', '/auth/status'),
  authSignup: (username: string, password: string, remember: boolean) =>
    request<{ signed_in: boolean }>('POST', '/auth/signup', { username, password, remember }),
  authLogin: (username: string, password: string, remember: boolean) =>
    request<{ signed_in: boolean }>('POST', '/auth/login', { username, password, remember }),
  authLogout: () => request<{ signed_in: boolean }>('POST', '/auth/logout', {}),
  changePassword: (current: string, next: string) =>
    request<{ signed_in: boolean }>('POST', '/auth/change-password', { current, new: next }),

  // the owner only
  appAccounts: () => request<AppAccount[]>('GET', '/admin/accounts'),
  setAccountPassword: (id: number, next: string) => request<{ ok: boolean }>('POST', `/admin/accounts/${id}/password`, { new: next }),
  removeAccount: (id: number) => request<{ ok: boolean }>('DELETE', `/admin/accounts/${id}`),

  sources: () => request<Source[]>('GET', '/income-sources'),
  createSource: (body: Partial<Source> & { name: string; currency_code: string }) =>
    request<{ id: number }>('POST', '/income-sources', body),
  updateSource: (id: number, body: Partial<Source>) => request<{ id: number }>('PATCH', `/income-sources/${id}`, body),
  deleteSource: (id: number) => request<void>('DELETE', `/income-sources/${id}`),

  createLocation: (body: { name: string; default_currency: string }) =>
    request<Location>('POST', '/locations', body),
  updateLocation: (id: number, body: { name?: string; default_currency?: string }) =>
    request<Location>('PATCH', `/locations/${id}`, body),
  deleteLocation: (id: number) => request<void>('DELETE', `/locations/${id}`),

  createGroup: (body: { name: string; location_id: number }) => request<Group>('POST', '/groups', body),
  updateGroup: (id: number, body: { name?: string; usual_recipient_id?: number | null }) =>
    request<Group>('PATCH', `/groups/${id}`, body),
  deleteGroup: (id: number) => request<void>('DELETE', `/groups/${id}`),

  createAccount: (body: { name: string; currency_code: string; kind: string }) =>
    request<Account>('POST', '/accounts', body),
  updateAccount: (id: number, body: Partial<Account>) => request<Account>('PATCH', `/accounts/${id}`, body),
  deleteAccount: (id: number) => request<void>('DELETE', `/accounts/${id}`),
}

export const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

export function monthLabel(m: { year: number; month: number }): string {
  return `${MONTH_NAMES[m.month - 1]} ${m.year}`
}

const wholeFormat = new Intl.NumberFormat('en-KE', { maximumFractionDigits: 0 })
const centsFormat = new Intl.NumberFormat('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** "47950.00" -> "47,950", "27107.2" -> "27,107.20" */
export function fmt(amount: Money | number | null | undefined): string {
  if (amount === null || amount === undefined || amount === '') return '–'
  const n = Math.round(Number(amount) * 100) / 100
  return Number.isInteger(n) ? wholeFormat.format(n) : centsFormat.format(n)
}

/** "KES 47,950" */
export function money(amount: Money | number | null | undefined, currency: string): string {
  return `${currency} ${fmt(amount)}`
}

export function otherCurrency(code: string): string {
  return code === 'KES' ? 'NTD' : 'KES'
}
