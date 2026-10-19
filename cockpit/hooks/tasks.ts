import type { ModelUse, Subagent, SubagentState, TaskBoard, TaskItem, TaskStatus } from '../types'
import { ROW_GAP } from './layout'
import { isSameUse, modelLabels } from './modelLabel'

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

/** subagent 一輪結束的原因（`turn.complete` 的 `reason`） */
export type EndReason = 'answer' | 'aborted' | 'error' | 'refusal'

export const EMPTY_BOARD: TaskBoard = { tasks: [], agents: [], isFollowing: true, isHeld: false }

/** 會改變任務的事：三種工具的呼叫、subagent 的派出與結束，以及使用者在面板上的操作。 */
export type TaskEvent =
  /**
   * TodoWrite 送來某個 agent 的整份清單。subagent 的列在派出時就建好，這裡只把任務掛上去；
   * 派出時沒聽到的（例如 mod 重新載入之前派的），才用附上的描述與派出者補一行。
   */
  | { kind: 'todos'; todos: readonly Todo[]; now: number; agentId?: string; agent?: { label: string; parentId?: string } }
  /**
   * `agent.spawn`：派出一個 subagent。同一個 agentId 再來一次是它醒來接著跑：
   * 只更新描述與狀態，不重新計時、不多一行。`parentAgentId` 是派出它的 subagent（主對話派的沒有）。
   */
  | { kind: 'spawned'; agentId: string; label: string; type: string; prompt: string; parentAgentId?: string; model?: string; now: number }
  /** `turn.step`：某個 loop（主對話沒有 agentId）這一步用的模型與深度 */
  | { kind: 'step'; agentId?: string; model: string; effort?: string }
  /** `turn.complete`：subagent 的一輪結束；`status` 是當下 `$.agent.list()` 裡它的狀態（查不到就沒有） */
  | { kind: 'ended'; agentId: string; reason: EndReason; status?: string; now: number }
  /** TaskCreate；`id` 是工具回傳的編號 */
  | { kind: 'created'; id: string; subject: string }
  /** TaskUpdate；`id` 是工具的編號 */
  | { kind: 'updated'; id: string; status?: TaskStatus | 'deleted'; subject?: string; now: number }
  | { kind: 'dismissTask'; id: string }
  | { kind: 'dismissAgent'; id: string }
  /** 隱藏所有已完成的任務，以及已結束（完成、被停掉、出錯）的 subagent 列與它底下的任務 */
  | { kind: 'clearCompleted' }
  /** 使用者手動翻頁：停止自動跟隨，也不再算在看路線圖 */
  | { kind: 'unfollow' }
  /** 使用者要看路線圖（按「重新載入路線圖」、展開 effort）：停止自動跟隨，任務有變化也不恢復 */
  | { kind: 'hold' }
  /** 不看路線圖了（收起 effort、切換分頁）：之後任務有變化就恢復自動跟隨 */
  | { kind: 'release' }

const isShown = (t: TaskItem) => !t.isDismissed

/** subagent 的狀態；舊版存下來、沒有狀態的當作完成 */
const stateOf = (g: Pick<Subagent, 'state'>): SubagentState => g.state ?? 'done'

/** 已結束（完成、被停掉、出錯）的 subagent */
export const isEnded = (g: Pick<Subagent, 'state'>) => stateOf(g) !== 'running'

/** 隱藏這些 subagent 列，連同它們底下的任務（免得沒做完的任務還在每秒重畫） */
function dismissAgents(board: TaskBoard, hide: (g: Subagent) => boolean): TaskBoard {
  const hidden = new Set(board.agents.filter(hide).map(g => g.id))
  return {
    ...board,
    agents: board.agents.map(g => (hidden.has(g.id) ? { ...g, isDismissed: true } : g)),
    tasks: board.tasks.map(t => (t.agentId !== undefined && hidden.has(t.agentId) ? { ...t, isDismissed: true } : t)),
  }
}

/** TaskCreate / TaskUpdate 的任務在面板上的 id */
const toolTaskId = (id: string) => `task-${id}`

/** 某個 loop（主對話為 undefined）此刻正在進行的任務：subagent 派出時掛在它底下 */
const runningTaskOf = (board: TaskBoard, owner: string | undefined) =>
  board.tasks.find(t => t.agentId === owner && t.status === 'in_progress' && isShown(t))?.id

/** 派工 prompt 留幾行給說明區 */
const PROMPT_LINES = 3

/** 派工 prompt 的開頭：去掉空行，留前幾行 */
const promptHead = (prompt: string) =>
  prompt
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(l => l !== '')
    .slice(0, PROMPT_LINES)
    .join('\n')

/**
 * 一輪結束後 subagent 的狀態：被停掉（`killed` 或中斷）、出錯（`error`／`refusal`）、
 * 還在等它派的子 agent 回報（`waiting`）就仍是進行中，其餘是完成。
 */
function stateAfter(reason: EndReason, status: string | undefined): SubagentState {
  if (status === 'killed' || reason === 'aborted') return 'stopped'
  if (reason === 'error' || reason === 'refusal' || status === 'failed') return 'failed'
  if (status === 'waiting') return 'running'
  return 'done'
}

/** `agent.spawn` 給的模型：換了模型才換（深度要等它的 `turn.step` 才知道），沒給就沿用 */
const withModel = (old: ModelUse | undefined, model: string | undefined): ModelUse | undefined =>
  model === undefined || old?.model === model ? old : { model }

/** `earlySteps` 最多記幾個還沒派出的 agent */
const EARLY_STEPS = 8

/** 新的一行 subagent 列：進行中，掛在派出者此刻正在進行的任務底下 */
function newAgent(
  board: TaskBoard,
  row: Pick<Subagent, 'id' | 'label' | 'type' | 'prompt' | 'parentAgentId' | 'model'> & { now: number },
): Subagent {
  const { now, ...rest } = row
  return {
    ...rest,
    label: row.label || 'subagent',
    parentTaskId: runningTaskOf(board, row.parentAgentId),
    state: 'running',
    startedAt: now,
    isDismissed: false,
  }
}

/**
 * 任務的所有變化都在這裡：回傳新的任務、subagent 列與跟隨狀態。
 * 任務有狀態變化時恢復自動跟隨；使用者正在看路線圖時（`isHeld`）不恢復，免得看票看到一半被拉走。
 */
export function applyTask(board: TaskBoard, event: TaskEvent): TaskBoard {
  switch (event.kind) {
    case 'spawned': {
      const known = board.agents.find(g => g.id === event.agentId)
      if (known) {
        // 醒來接著跑：位置、開始時間、描述與原本的派工 prompt 都不變（醒來時的 prompt 是叫醒它的訊息）
        const woke: Subagent = { ...known, state: 'running', endedAt: undefined, model: withModel(known.model, event.model) }
        return { ...board, agents: board.agents.map(g => (g.id === known.id ? woke : g)) }
      }
      // 第一步比派出早到時，那一步的模型與深度先記在 earlySteps，這裡補上
      const { [event.agentId]: early, ...earlySteps } = board.earlySteps ?? {}
      const row = newAgent(board, {
        id: event.agentId,
        label: event.label,
        type: event.type,
        prompt: promptHead(event.prompt),
        parentAgentId: event.parentAgentId,
        model: withModel(early, event.model),
        now: event.now,
      })
      // 新派出的 subagent 跟任務有變化一樣恢復自動跟隨；在看路線圖時不拉走
      return { ...board, agents: [...board.agents, row], earlySteps, isFollowing: !board.isHeld }
    }
    case 'step': {
      // 每一步都會來：模型與深度沒變就回傳同一份，不必重畫
      const use: ModelUse = { model: event.model, effort: event.effort }
      if (event.agentId === undefined) return isSameUse(board.mainModel, use) ? board : { ...board, mainModel: use }
      const known = board.agents.find(g => g.id === event.agentId)
      if (known === undefined) {
        // 比 agent.spawn 早到：先記著，派出時補上。永遠不會派出的（workflow）也會來，只留最近幾筆
        const early = board.earlySteps ?? {}
        if (isSameUse(early[event.agentId], use)) return board
        const { [event.agentId]: _, ...others } = early
        const kept = Object.entries(others).slice(-(EARLY_STEPS - 1))
        return { ...board, earlySteps: { ...Object.fromEntries(kept), [event.agentId]: use } }
      }
      // teammate 閒著時收到訊息就醒來接著跑，不會再來一次 agent.spawn：它又走一步，列就回到進行中
      const isWoken = known.state === 'done'
      if (!isWoken && isSameUse(known.model, use)) return board
      const woke: Partial<Subagent> = isWoken ? { state: 'running', endedAt: undefined } : {}
      return { ...board, agents: board.agents.map(g => (g === known ? { ...g, ...woke, model: use } : g)) }
    }
    case 'ended': {
      const state = stateAfter(event.reason, event.status)
      const agents = board.agents.map(g =>
        g.id === event.agentId ? { ...g, state, endedAt: state === 'running' ? undefined : event.now } : g,
      )
      return { ...board, agents }
    }
    case 'todos': {
      const owner = event.agentId
      let agents = board.agents
      if (owner !== undefined && !agents.some(g => g.id === owner)) {
        // 派出時沒聽到的 subagent：照它第一次寫清單的時候補一行
        const row = newAgent(board, { id: owner, label: event.agent?.label ?? '', parentAgentId: event.agent?.parentId, now: event.now })
        agents = [...agents, row]
      }
      return {
        ...board,
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
      return dismissAgents(board, g => g.id === event.id)
    case 'clearCompleted': {
      const cleared = dismissAgents(board, isEnded)
      return { ...cleared, tasks: cleared.tasks.map(t => (t.status === 'completed' ? { ...t, isDismissed: true } : t)) }
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
    ...view.rows.map(r =>
      r.kind === 'agent' ? (r.elapsedMs === undefined ? '' : formatDuration(r.elapsedMs)) : `${r.task.percent ?? ''}|${taskCells(r.task, 0).time}`,
    ),
  ].join('\n')

/** 有沒有看得到的進行中任務或 subagent 列（決定要不要每秒重畫耗時）。 */
export const hasRunning = (board: TaskBoard) =>
  board.tasks.some(t => t.status === 'in_progress' && isShown(t)) ||
  board.agents.some(g => !isEnded(g) && !g.isDismissed)

/** 主對話清單的完成數與總數（分頁列的進度）；和 `viewTasks(...).main` 的兩個數字一樣，不必知道現在幾點 */
export type Progress = { doneCount: number; total: number }

export function progressOf(board: TaskBoard): Progress {
  const tasks = board.tasks.filter(t => t.agentId === undefined && !t.isDismissed)
  return { doneCount: tasks.filter(t => t.status === 'completed').length, total: tasks.length }
}

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

/** 任務列裡會隨時間變的部分：畫面那一側（`ticking.tsx`）拿它往後推 */
export type RowTiming = Pick<TaskRow, 'status' | 'percent' | 'remainingMs' | 'overdueMs' | 'elapsedMs'>

/** 只放有值的欄位：要當 `Client` 的 props，引擎不收 undefined */
export const timingOf = (row: TaskRow): RowTiming => ({
  status: row.status,
  ...(row.percent === undefined ? {} : { percent: row.percent }),
  ...(row.remainingMs === undefined ? {} : { remainingMs: row.remainingMs }),
  ...(row.overdueMs === undefined ? {} : { overdueMs: row.overdueMs }),
  ...(row.elapsedMs === undefined ? {} : { elapsedMs: row.elapsedMs }),
})

/**
 * 一個任務列過了 `ms` 之後的樣子：只有進行中的會變，算法和 `summarize` 一樣（預測的總時間不變）。
 * 預測的總時間從列上的數字倒推：超時的是「已過 − 超出」，其餘是「已過 + 剩下」。
 */
export function advanceRow<R extends RowTiming>(row: R, ms: number): R {
  if (row.status !== 'in_progress' || row.elapsedMs === undefined || ms <= 0) return row
  const elapsed = row.elapsedMs + ms
  const predicted =
    row.overdueMs !== undefined
      ? row.elapsedMs - row.overdueMs
      : row.remainingMs === undefined
        ? undefined
        : row.elapsedMs + row.remainingMs
  if (predicted === undefined || predicted <= 0) return { ...row, elapsedMs: elapsed }
  return {
    ...row,
    percent: Math.min(99, Math.floor((elapsed / predicted) * 100)),
    remainingMs: Math.max(0, predicted - elapsed),
    overdueMs: elapsed > predicted ? elapsed - predicted : undefined,
    elapsedMs: elapsed,
  }
}

/** 標題列的「還需約」過了 `ms` 之後是多少：`rows` 是主清單還沒完成的列（和 `summarize` 一樣全都有預測才算） */
export function remainingAfter(rows: readonly RowTiming[], ms: number): number | undefined {
  const later = rows.map(r => advanceRow(r, ms))
  if (later.length === 0 || later.some(r => r.remainingMs === undefined)) return undefined
  return later.reduce((sum, r) => sum + (r.remainingMs ?? 0), 0)
}

/** [任務] 的一行：一個任務，或一行 subagent 列。`depth` 是縮排層數。 */
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
      /** 它的清單做完幾項、共幾項；沒寫清單時 total 是 0 */
      doneCount: number
      total: number
      state: SubagentState
      /** 從第一次派出到現在（進行中）或到結束；舊版存下來、不知道何時派出的沒有 */
      elapsedMs?: number
      /** 它最近一次的模型與深度（模型標示用）；不知道的沒有 */
      use?: ModelUse
      /** 滑鼠移上去時說明區的內容 */
      detail: string
    }

export type TaskView = {
  /** 主對話的任務摘要（標題列與分頁列的進度） */
  main: TaskSummary
  rows: TreeRow[]
  /** 看得到的 subagent 列數（含巢狀的；主對話沒有任務時標題列寫「N 個 subagent」） */
  agentCount: number
  /** 有沒有東西可以清：看得到的完成任務或已結束的 subagent 列 */
  hasCompleted: boolean
  /** 自動跟隨時要翻到的列：最近開始的進行中任務或 subagent 列 */
  followId?: string
  /** 主對話最近一次的模型與深度：模型標示的基準 */
  base?: ModelUse
}

/** subagent 最多往下展開幾層 */
const MAX_DEPTH = 3

/** 說明區的狀態字樣：被停掉與出錯在列上都是 ✗，在這裡分開寫 */
const STATE_WORDS: Record<SubagentState, string> = { running: '進行中', done: '完成', stopped: '被停掉', failed: '出錯' }

/** 某一刻的時與分（HH:MM，本地時間）；`ms` 來自引擎的時鐘 */
export function clockOf(ms: number): string {
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/**
 * subagent 列的說明：`subagent「描述」 · 類型`、`完整 model id · 深度 · 狀態`、`prompt：開頭幾行`。
 * 結束的狀態帶總耗時；進行中的寫派出的時刻（說明區是一般文字，不會每秒更新，耗時看列上那一欄）。
 */
function agentDetail(g: Subagent, state: SubagentState, elapsedMs: number | undefined): string {
  const head = g.type === undefined ? `subagent「${g.label}」` : `subagent「${g.label}」 · ${g.type}`
  const status =
    state === 'running'
      ? g.startedAt === undefined
        ? STATE_WORDS[state]
        : `${STATE_WORDS[state]}（${clockOf(g.startedAt)} 派出）`
      : elapsedMs === undefined
        ? STATE_WORDS[state]
        : `${STATE_WORDS[state]} ${formatDuration(elapsedMs)}`
  const model = g.model === undefined ? [] : [g.model.model, ...(g.model.effort === undefined ? [] : [g.model.effort])]
  return [head, [...model, status].join(' · '), ...(g.prompt ? [`prompt：${g.prompt}`] : [])].join('\n')
}

/**
 * 把任務攤平成要畫的行：主對話的清單，每個任務底下接著派出那一刻它正在做時派出的 subagent 列
 * （遞迴，最多三層）。派出時派出者沒有進行中的任務：主對話派的接在最後，subagent 派的接在派出者那一列底下。
 */
export function viewTasks(board: TaskBoard, now: number): TaskView {
  const { tasks, agents } = board
  const knownIds = new Set(tasks.map(t => t.id))
  const shownTaskIds = new Set(tasks.filter(isShown).map(t => t.id))
  const shownAgents = agents.filter(g => !g.isDismissed)
  const shownAgentIds = new Set(shownAgents.map(g => g.id))
  // 掛的任務找不到、或被隱藏了而它還在跑：不掛在任務底下（結束的跟著任務一起不見）
  const isLoose = (g: Subagent) =>
    g.parentTaskId === undefined || !knownIds.has(g.parentTaskId) || (!shownTaskIds.has(g.parentTaskId) && !isEnded(g))
  // 沒有掛在任務底下、派出者也不在畫面上的，接在主清單後面
  const orphans = shownAgents.filter(g => isLoose(g) && (g.parentAgentId === undefined || !shownAgentIds.has(g.parentAgentId)))
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

  const agentRows = (g: Subagent, depth: number): TreeRow[] => {
    if (depth > MAX_DEPTH) return []
    const own = mine(g.id)
    const group = { id: g.id, label: `${'  '.repeat(depth)}↳ ${g.label}` }
    const state = stateOf(g)
    const elapsedMs = g.startedAt === undefined ? undefined : Math.max(0, (g.endedAt ?? now) - g.startedAt)
    const header: TreeRow = {
      kind: 'agent',
      id: `agent-${g.id}`,
      agentId: g.id,
      depth,
      group,
      label: g.label,
      doneCount: own.doneCount,
      total: own.total,
      state,
      elapsedMs,
      use: g.model,
      detail: agentDetail(g, state, elapsedMs),
    }
    // 它派出時沒有進行中任務的子 subagent，接在它自己的清單後面
    const loose = shownAgents.filter(c => c.parentAgentId === g.id && isLoose(c)).flatMap(c => agentRows(c, depth + 1))
    return [header, ...ownerRows(g.id, depth, group), ...loose]
  }

  const rows = [...ownerRows(undefined, 0), ...orphans.flatMap(g => agentRows(g, 0))]
  const shown = new Set(rows.map(r => r.id))
  const agentRowsShown = rows.filter((r): r is Extract<TreeRow, { kind: 'agent' }> => r.kind === 'agent')
  // 跟隨的候選：進行中的任務與 subagent 列，取最近開始的；同時開始的先取任務
  const candidates = [
    ...tasks.filter(t => t.status === 'in_progress' && isShown(t) && shown.has(t.id)).map(t => ({ id: t.id, at: t.startedAt ?? 0 })),
    ...agentRowsShown.flatMap(r => {
      const g = agents.find(a => a.id === r.agentId)
      return !isEnded(r) && g ? [{ id: r.id, at: g.startedAt ?? 0 }] : []
    }),
  ]
  const running = candidates.reduce<{ id: string; at: number } | undefined>((best, c) => (best === undefined || c.at > best.at ? c : best), undefined)
  return {
    main: mine(undefined),
    rows,
    agentCount: agentRowsShown.length,
    hasCompleted:
      tasks.some(t => t.status === 'completed' && isShown(t)) || agentRowsShown.some(isEnded),
    followId: board.isFollowing ? running?.id : undefined,
    base: board.mainModel,
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

/** subagent 列的狀態圖示與顏色（`accent` 是使用者選的主色）：被停掉與出錯都是 ✗ */
export const AGENT_LOOKS: Record<SubagentState, { icon: '●' | '✓' | '✗'; color: 'accent' | 'success' | 'error' }> = {
  running: { icon: '●', color: 'accent' },
  done: { icon: '✓', color: 'success' },
  stopped: { icon: '✗', color: 'error' },
  failed: { icon: '✗', color: 'error' },
}

/** subagent 列要畫的字：狀態圖示與顏色、名稱（有清單時帶 done/total）、補到欄寬的耗時。沒有進度條與百分比 */
export type AgentCells = {
  icon: '●' | '✓' | '✗'
  color: 'accent' | 'success' | 'error'
  title: string
  time: string
  /** 已結束（完成、被停掉、出錯）：整列變暗 */
  isEnded: boolean
  canDismiss: boolean
}

/**
 * [任務] 清單這一塊的模型標示：subagent 列的 id → 補到同一欄寬的字（不標的列不在裡面）。
 * `width` 是清單的寬度；每一列扣掉縮排、圖示、耗時與 × 之後是名稱的位置。整塊一起決定完整或縮寫。
 */
export function agentLabels(view: TaskView, width: number): Map<string, string> {
  const agents = view.rows.filter(r => r.kind === 'agent')
  const slots = agents.map(r => {
    const w = width - r.depth * 2
    return { use: r.use, room: w - ICON - TIME - (taskColumns(w).showX ? DISMISS : 0) }
  })
  const { labels } = modelLabels(slots, view.base)
  return new Map(agents.flatMap((r, i) => (labels[i] === undefined ? [] : [[r.id, labels[i]] as const])))
}

/** subagent 列的耗時欄：補到欄寬；不知道何時派出的是 — */
export const agentTime = (elapsedMs: number | undefined): string =>
  (elapsedMs === undefined ? '—' : formatDuration(elapsedMs)).padStart(TIME - 1)

export function agentCells(row: Extract<TreeRow, { kind: 'agent' }>, width: number): AgentCells {
  return {
    ...AGENT_LOOKS[row.state],
    title: row.total > 0 ? `${row.label} ${row.doneCount}/${row.total}` : row.label,
    time: agentTime(row.elapsedMs),
    isEnded: isEnded(row),
    canDismiss: taskColumns(width).showX,
  }
}

/**
 * 一個任務列要畫哪些欄。`width` 是這一列可用的寬度（已扣掉縮排）；
 * 不夠時依序拿掉：進度條 → % → ×。進度條與百分比只有進行中的任務才畫。
 */
export function taskCells(row: RowTiming, width: number): TaskCells {
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
