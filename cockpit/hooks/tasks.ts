import type { AgentGroup, TaskBoard, TaskItem, TaskStatus } from '../types'
import { ROW_GAP } from './layout'

const ESTIMATE = /\s*\(~\s*(\d+(?:\.\d+)?)\s*(?:m|min)\)\s*$/i

/** 把「撰寫測試 (~3m)」拆成名稱與預估毫秒數。 */
export function parseEstimate(raw: string): { title: string; estimateMs?: number } {
  const hit = ESTIMATE.exec(raw)
  if (!hit) return { title: raw.trim() }
  return { title: raw.replace(ESTIMATE, '').trim(), estimateMs: Math.round(Number(hit[1]) * 60_000) }
}

/** 套用狀態轉換，並蓋上開始 / 完成的時間。 */
function withStatus(task: TaskItem, status: TaskStatus, now: number): TaskItem {
  if (task.status === status) return task
  if (status === 'in_progress') return { ...task, status, startedAt: now, doneAt: undefined }
  if (status === 'completed') return { ...task, status, startedAt: task.startedAt ?? now, doneAt: now }
  return { ...task, status, startedAt: undefined, doneAt: undefined }
}

export type Todo = { content: string; status: TaskStatus }

/**
 * TodoWrite 每次送來整份清單（每個 agent 各一份）：同名的任務沿用原本的時間與隱藏狀態，
 * 新的才建新項目；其他 agent 與 TaskCreate 來的任務不動。
 */
function syncTodos(
  prev: readonly TaskItem[],
  todos: readonly Todo[],
  now: number,
  agentId?: string,
): TaskItem[] {
  const isMine = (t: TaskItem) => t.source === 'todo' && t.agentId === agentId
  const pool = prev.filter(isMine)
  const synced = todos.map((todo, i): TaskItem => {
    const { title, estimateMs } = parseEstimate(todo.content)
    const at = pool.findIndex(t => t.title === title)
    const old = at >= 0 ? pool.splice(at, 1)[0] : undefined
    const base: TaskItem = old
      ? { ...old, estimateMs: estimateMs ?? old.estimateMs }
      : {
          id: agentId === undefined ? `todo-${now}-${i}` : `todo-${agentId}-${now}-${i}`,
          source: 'todo',
          title,
          status: 'pending',
          estimateMs,
          isDismissed: false,
          agentId,
        }
    return withStatus(base, todo.status, now)
  })
  return [...prev.filter(t => !isMine(t)), ...synced]
}

export const EMPTY_BOARD: TaskBoard = { tasks: [], agents: [], isFollowing: true, isHeld: false }

/** 會改變任務的事：三種工具的呼叫，以及使用者在面板上的操作。 */
export type TaskEvent =
  /** TodoWrite 送來某個 agent 的整份清單；subagent 附上它的描述與派出者 */
  | { kind: 'todos'; todos: readonly Todo[]; now: number; agentId?: string; agent?: { label: string; parentId?: string } }
  /** TaskCreate；`id` 是工具回傳的編號 */
  | { kind: 'created'; id: string; subject: string }
  /** TaskUpdate；`id` 是工具的編號 */
  | { kind: 'updated'; id: string; status?: TaskStatus | 'deleted'; subject?: string; now: number }
  | { kind: 'dismissTask'; id: string }
  | { kind: 'dismissAgent'; id: string }
  /** 隱藏所有已完成的任務，以及所有任務都完成的 subagent 群組 */
  | { kind: 'clearCompleted' }
  /** 使用者手動翻頁：停止自動跟隨，也不再算在看路線圖 */
  | { kind: 'unfollow' }
  /** 使用者要看路線圖（按「重新載入路線圖」、展開 effort）：停止自動跟隨，任務有變化也不恢復 */
  | { kind: 'hold' }
  /** 不看路線圖了（收起 effort、切換分頁）：之後任務有變化就恢復自動跟隨 */
  | { kind: 'release' }

const isShown = (t: TaskItem) => !t.isDismissed

/** TaskCreate / TaskUpdate 的任務在面板上的 id */
const toolTaskId = (id: string) => `task-${id}`

/**
 * 任務的所有變化都在這裡：回傳新的任務、subagent 群組與跟隨狀態。
 * 任務有狀態變化時恢復自動跟隨；使用者正在看路線圖時（`isHeld`）不恢復，免得看票看到一半被拉走。
 */
export function applyTask(board: TaskBoard, event: TaskEvent): TaskBoard {
  switch (event.kind) {
    case 'todos': {
      const owner = event.agentId
      let agents = board.agents
      if (owner !== undefined && !agents.some(g => g.id === owner)) {
        const parentId = event.agent?.parentId
        const parentTaskId = board.tasks.find(t => t.agentId === parentId && t.status === 'in_progress' && isShown(t))?.id
        const group: AgentGroup = { id: owner, label: event.agent?.label || 'subagent', parentTaskId, isDismissed: false }
        agents = [...agents, group]
      }
      return {
        tasks: syncTodos(board.tasks, event.todos, event.now, owner),
        agents,
        isFollowing: !board.isHeld,
        isHeld: board.isHeld,
      }
    }
    case 'created': {
      const id = toolTaskId(event.id)
      const { title, estimateMs } = parseEstimate(event.subject)
      const item: TaskItem = { id, source: 'task', title, status: 'pending', estimateMs, isDismissed: false }
      return { ...board, tasks: [...board.tasks.filter(t => t.id !== id), item] }
    }
    case 'updated': {
      const id = toolTaskId(event.id)
      if (event.status === 'deleted') return { ...board, tasks: board.tasks.filter(t => t.id !== id) }
      const status = event.status
      const tasks = board.tasks.map(t => {
        if (t.id !== id) return t
        const parsed = event.subject !== undefined ? parseEstimate(event.subject) : undefined
        const renamed = parsed ? { ...t, title: parsed.title, estimateMs: parsed.estimateMs ?? t.estimateMs } : t
        return status !== undefined ? withStatus(renamed, status, event.now) : renamed
      })
      return { ...board, tasks, isFollowing: (status !== undefined && !board.isHeld) || board.isFollowing }
    }
    case 'dismissTask':
      return { ...board, tasks: board.tasks.map(t => (t.id === event.id ? { ...t, isDismissed: true } : t)) }
    case 'dismissAgent':
      return { ...board, agents: board.agents.map(g => (g.id === event.id ? { ...g, isDismissed: true } : g)) }
    case 'clearCompleted': {
      const isAllDone = (g: AgentGroup) => {
        const own = board.tasks.filter(t => t.agentId === g.id && isShown(t))
        return own.length > 0 && own.every(t => t.status === 'completed')
      }
      return {
        ...board,
        agents: board.agents.map(g => (isAllDone(g) ? { ...g, isDismissed: true } : g)),
        tasks: board.tasks.map(t => (t.status === 'completed' ? { ...t, isDismissed: true } : t)),
      }
    }
    case 'unfollow':
      return board.isFollowing || board.isHeld ? { ...board, isFollowing: false, isHeld: false } : board
    case 'hold':
      return board.isHeld && !board.isFollowing ? board : { ...board, isFollowing: false, isHeld: true }
    case 'release':
      return board.isHeld ? { ...board, isHeld: false } : board
  }
}

/**
 * 畫面上會隨時間變的字：標題列的「還需約」，以及每個任務列的百分比與時間。
 * 每秒算一次，跟上一秒一樣就不必重畫（做了十分鐘以上的任務，時間只顯示到分鐘）。
 */
export const timeStamp = (view: TaskView): string =>
  [
    view.main.remainingMs === undefined ? '' : formatDuration(view.main.remainingMs),
    ...view.rows.map(r => (r.kind === 'agent' ? '' : `${r.task.percent ?? ''}|${taskCells(r.task, 0).time}`)),
  ].join('\n')

/** 有沒有看得到的進行中任務（決定要不要每秒重畫耗時）。 */
export const hasRunning = (board: TaskBoard) => board.tasks.some(t => t.status === 'in_progress' && isShown(t))

export type TaskRow = {
  id: string
  title: string
  status: TaskStatus
  /** 0–100；無法預測的進行中任務為 undefined */
  percent?: number
  /** 預計還需毫秒數；完成的任務為 undefined */
  remainingMs?: number
  /** 進行中任務已超過預測的毫秒數 */
  overdueMs?: number
  /** 進行中的已耗時，或完成任務的實際耗時 */
  elapsedMs?: number
  /** 預測值是否來自模型的預估（否則是已完成任務的平均） */
  isEstimated: boolean
}

export type TaskSummary = {
  rows: TaskRow[]
  doneCount: number
  total: number
  percent: number
  remainingMs?: number
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))

/**
 * 預測：模型預估 × 校正係數（已完成任務的 實際 ÷ 預估）；
 * 沒附預估的任務退回已完成任務的平均耗時；兩者皆無就不預測。
 */
export function summarize(all: readonly TaskItem[], now: number): TaskSummary {
  const tasks = all.filter(t => !t.isDismissed)
  const actual = (t: TaskItem) => Math.max(0, (t.doneAt ?? now) - (t.startedAt ?? now))
  const done = tasks.filter(t => t.status === 'completed')

  const calibrated = done.filter(t => t.estimateMs !== undefined && actual(t) > 0)
  const estSum = calibrated.reduce((sum, t) => sum + (t.estimateMs ?? 0), 0)
  const factor = estSum > 0 ? clamp(calibrated.reduce((sum, t) => sum + actual(t), 0) / estSum, 0.25, 4) : 1

  const timed = done.filter(t => actual(t) > 0)
  const average = timed.length > 0 ? timed.reduce((sum, t) => sum + actual(t), 0) / timed.length : undefined

  const predict = (t: TaskItem) =>
    t.estimateMs !== undefined ? { ms: t.estimateMs * factor, isEstimated: true } : { ms: average, isEstimated: false }

  const rows = tasks.map((t): TaskRow => {
    const { ms, isEstimated } = predict(t)
    if (t.status === 'completed') {
      return { id: t.id, title: t.title, status: t.status, percent: 100, elapsedMs: actual(t), isEstimated }
    }
    if (t.status === 'pending') {
      return { id: t.id, title: t.title, status: t.status, percent: 0, remainingMs: ms, isEstimated }
    }
    const elapsed = actual(t)
    if (ms === undefined || ms <= 0) {
      return { id: t.id, title: t.title, status: t.status, elapsedMs: elapsed, isEstimated }
    }
    return {
      id: t.id,
      title: t.title,
      status: t.status,
      percent: Math.min(99, Math.floor((elapsed / ms) * 100)),
      remainingMs: Math.max(0, ms - elapsed),
      overdueMs: elapsed > ms ? elapsed - ms : undefined,
      elapsedMs: elapsed,
      isEstimated,
    }
  })

  const open = rows.filter(r => r.status !== 'completed')
  const isKnown = open.length > 0 && open.every(r => r.remainingMs !== undefined)
  return {
    rows,
    doneCount: done.length,
    total: tasks.length,
    percent: tasks.length === 0 ? 0 : Math.round((done.length / tasks.length) * 100),
    remainingMs: isKnown ? open.reduce((sum, r) => sum + (r.remainingMs ?? 0), 0) : undefined,
  }
}

/** [任務] 的一行：一個任務，或一個 subagent 群組的標題。`depth` 是縮排層數。 */
export type TreeRow =
  | { kind: 'task'; id: string; depth: number; group?: { id: string; label: string }; task: TaskRow }
  | {
      kind: 'agent'
      id: string
      /** subagent 的 id，按 × 時用 */
      agentId: string
      depth: number
      group: { id: string; label: string }
      label: string
      doneCount: number
      total: number
    }

export type TaskView = {
  /** 主對話的任務摘要（標題列與分頁列的進度） */
  main: TaskSummary
  rows: TreeRow[]
  /** 找不到派出者的 subagent 群組數，接在主清單後面 */
  orphanCount: number
  hasCompleted: boolean
  /** 自動跟隨時要翻到的任務：最近開始的進行中任務 */
  followId?: string
}

/** subagent 最多往下展開幾層 */
const MAX_DEPTH = 3

/**
 * 把任務攤平成要畫的行：主對話的清單，每個任務底下接著它派出的 subagent（遞迴，最多三層），
 * 找不到派出者的 subagent 接在最後。
 */
export function viewTasks(board: TaskBoard, now: number): TaskView {
  const { tasks, agents } = board
  const knownIds = new Set(tasks.map(t => t.id))
  const shownAgents = agents.filter(g => !g.isDismissed)
  const orphans = shownAgents.filter(g => g.parentTaskId === undefined || !knownIds.has(g.parentTaskId))
  const mine = (owner: string | undefined) =>
    summarize(
      tasks.filter(t => t.agentId === owner),
      now,
    )

  const ownerRows = (owner: string | undefined, depth: number, group?: { id: string; label: string }): TreeRow[] =>
    mine(owner).rows.flatMap(r => [
      { kind: 'task' as const, id: r.id, depth, group, task: r },
      ...shownAgents.filter(g => g.parentTaskId === r.id).flatMap(g => agentRows(g, depth + 1)),
    ])

  const agentRows = (g: AgentGroup, depth: number): TreeRow[] => {
    if (depth > MAX_DEPTH) return []
    const own = mine(g.id)
    const group = { id: g.id, label: `${'  '.repeat(depth)}↳ ${g.label}` }
    const header: TreeRow = {
      kind: 'agent',
      id: `agent-${g.id}`,
      agentId: g.id,
      depth,
      group,
      label: g.label,
      doneCount: own.doneCount,
      total: own.total,
    }
    return [header, ...ownerRows(g.id, depth, group)]
  }

  const rows = [...ownerRows(undefined, 0), ...orphans.flatMap(g => agentRows(g, 0))]
  const shown = new Set(rows.map(r => r.id))
  const running = tasks
    .filter(t => t.status === 'in_progress' && isShown(t) && shown.has(t.id))
    .sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0))[0]
  return {
    main: mine(undefined),
    rows,
    orphanCount: orphans.length,
    hasCompleted: tasks.some(t => t.status === 'completed' && isShown(t)),
    followId: board.isFollowing ? running?.id : undefined,
  }
}

/** 任務列各欄的寬度：圖示加間隔、名稱至少、時間加間隔、×、百分比 */
const ICON = 1 + ROW_GAP
const MIN_TITLE = 12
const TIME = 6 + ROW_GAP
const DISMISS = 1 + ROW_GAP
const PERCENT = 4 + ROW_GAP

/** 寬度不夠時依序拿掉：進度條 → % → ×。 */
export function taskColumns(width: number): { barWidth: number; showX: boolean; showPct: boolean; showBar: boolean } {
  const barWidth = Math.min(16, Math.max(6, Math.floor(width * 0.2)))
  const base = ICON + MIN_TITLE + TIME
  return {
    barWidth,
    showX: width >= base + DISMISS,
    showPct: width >= base + DISMISS + PERCENT,
    showBar: width >= base + DISMISS + PERCENT + barWidth + 1,
  }
}

/** 45s、2m10s、12m；不到 1 秒當 0s。 */
export function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m >= 10) return `${Math.round(ms / 60_000)}m`
  const rest = s - m * 60
  return rest === 0 ? `${m}m` : `${m}m${String(rest).padStart(2, '0')}s`
}

/** 以實心方塊畫進度條：已完成的部分上色，其餘由呼叫端畫成暗色底軌。 */
export function bar(percent: number | undefined, width: number): { filled: string; rest: string } {
  const n = percent === undefined ? 0 : Math.round((clamp(percent, 0, 100) / 100) * width)
  return { filled: '█'.repeat(n), rest: '█'.repeat(width - n) }
}

/** 一個任務列要畫的字；百分比與時間已經補到欄寬，照著畫就對得齊 */
export type TaskCells = {
  icon: '✓' | '●' | '○'
  /** 進度條；只有進行中、而且夠寬時才有 */
  bar?: { filled: string; rest: string }
  /** 百分比，無法預測時是「…」；只有進行中、而且夠寬時才有 */
  percent?: string
  /** 完成的是實際耗時，超時的是「+超過多久」，其餘是「~還要多久」或已耗時；都沒有就是「—」 */
  time: string
  isOverdue: boolean
  /** 夠寬才畫 × */
  canDismiss: boolean
}

/**
 * 一個任務列要畫哪些欄。`width` 是這一列可用的寬度（已扣掉縮排）；
 * 不夠時依序拿掉：進度條 → % → ×。進度條與百分比只有進行中的任務才畫。
 */
export function taskCells(row: TaskRow, width: number): TaskCells {
  const columns = taskColumns(width)
  const isRunning = row.status === 'in_progress'
  const time =
    row.status === 'completed'
      ? formatDuration(row.elapsedMs ?? 0)
      : row.overdueMs !== undefined
        ? `+${formatDuration(row.overdueMs)}`
        : row.remainingMs !== undefined
          ? `~${formatDuration(row.remainingMs)}`
          : row.elapsedMs !== undefined
            ? formatDuration(row.elapsedMs)
            : '—'
  const percent = row.percent === undefined ? '…' : `${row.percent}%`
  return {
    icon: row.status === 'completed' ? '✓' : isRunning ? '●' : '○',
    bar: isRunning && columns.showBar ? bar(row.percent, columns.barWidth) : undefined,
    percent: isRunning && columns.showPct ? percent.padStart(PERCENT - 1) : undefined,
    time: time.padStart(TIME - 1),
    isOverdue: row.overdueMs !== undefined,
    canDismiss: columns.showX,
  }
}
