/**
 * 背景來源：一件跟背景工作有關的事來了，要不要問引擎、問什麼、最後要套哪個事件。
 * 只透過 `BackgroundPorts` 問引擎（讀清單、時間、CronList 的權限與內容），不碰 `$`；
 * 寫入（套在當下最新的清單上）與子分頁的寫回由 `register.tsx` 照回答做。比照 `roadmapSource`：
 * 有狀態（記著哪些 session 確認過沒有執行中的），session 開始與 `/clear` 時 `reset()`（在 `memory.ts`）。
 *
 * 效能規則（規格書 `.scratch/background-work/spec.md`）在這裡守：對不到的事不問時間、
 * 空的快照在安靜的 session 什麼都不問、CronList 只在排程可能變了時讀（有排程才讀、權限一個 session 只問一次）。
 */
import type { BackgroundList } from '../types'
import { applyBackground, hasSchedules, hasWakeups, isEmptyBackground, monitorStart, workflowStart } from './background'
import type { BackgroundEvent, CronJob, EndNotice, NewWork, SnapshotCron, SnapshotTask } from './background'

/** 背景來源要問引擎的四件事（register 用 `$` 組出正式的，測試用記憶體裡的） */
export type BackgroundPorts = {
  /** 現在的背景清單 */
  list: () => Promise<BackgroundList>
  /** 現在幾點（毫秒） */
  now: () => Promise<number>
  /** CronList 能不能直接讀（`tool.check`）：不是 `allow` 就不讀，面板不替使用者跳權限框 */
  cronListAccess: () => Promise<'allow' | 'other'>
  /** 讀 CronList；讀不到回 `undefined`（這次改用自己算的時間，下次再讀） */
  cronList: () => Promise<readonly CronJob[] | undefined>
}

/** 一件跟背景工作有關的事 */
export type BackgroundSignal =
  /** 一個背景工作開始了（Bash／PowerShell 帶 `backgroundTaskId`、Monitor、Workflow） */
  | { kind: 'started'; work: NewWork }
  /** 主對話收到的結束通知 */
  | { kind: 'notified'; note: EndNotice }
  /** TaskStop 停掉了一個 */
  | { kind: 'stopped'; id: string }
  /** 不用知道時間的變化：使用者按 ×、`c`，ScheduleWakeup `stop: true` 取消喚醒 */
  | { kind: 'changed'; event: BackgroundEvent }
  /** 對話停下（主對話或 subagent）帶的快照（原樣，subagent 由這裡濾掉）；`crons` 沒有是引擎沒給 `session_crons` */
  | { kind: 'snapshot'; sessionId: string; tasks: readonly SnapshotTask[]; crons?: readonly SnapshotCron[] }
  | { kind: 'cronCreated'; job: CronJob; agentId?: string }
  | { kind: 'cronDeleted'; id: string }
  /** 排程觸發（`scheduled-trigger`）：只有 prompt 原文、沒有 id */
  | { kind: 'cronTriggered'; text: string }
  /** ScheduleWakeup 排了一次喚醒（未實測） */
  | { kind: 'wakeupScheduled'; prompt: string; scheduledFor: number; agentId?: string }

/** 要寫的：把 `event` 套在當下最新的清單上；`isEmpty` 是套完之後看得到的全沒了（子分頁可能要寫回「任務」） */
export type BackgroundStep = { event: BackgroundEvent; isEmpty: boolean }

export type BackgroundSource = {
  /** 這件事要套的事件；`undefined` 是沒變、不寫 */
  next: (signal: BackgroundSignal, ports: BackgroundPorts) => Promise<BackgroundStep | undefined>
  /** 忘掉記著的（session 開始、`/clear`：背景清單跟著 `$.state` 清空了） */
  reset: () => void
}

const withAgent = (agentId: string | undefined) => (agentId === undefined ? {} : { agentId })

// ── 工具結果轉成背景訊號：register 的 hook 在工具成功後交給這裡，回傳要交給 `next` 的訊號（沒有就不交） ──

/** Monitor：結果的 `taskId`、`timeoutMs`、`persistent` 建一筆；盯的是 WebSocket（沒有 `command`）時寫網址 */
export function monitorSignal(
  e: { description: string; command?: string; ws?: { url?: string }; agentId?: string },
  r: { taskId: string; timeoutMs: number; persistent?: boolean },
): BackgroundSignal {
  const command = e.command ?? e.ws?.url ?? ''
  return { kind: 'started', work: monitorStart(r.taskId, { description: e.description, command, timeoutMs: r.timeoutMs, persistent: r.persistent, agentId: e.agentId }) }
}

/** CronCreate（含 `/loop` 走的）：輸入的 cron 與 prompt 加上結果的 id、是否重複、下次時間（可能沒有） */
export function cronCreatedSignal(
  e: { cron: string; prompt: string; agentId?: string },
  r: { id: string; recurring?: boolean; nextFireAt?: number },
): BackgroundSignal {
  const job: CronJob = { id: r.id, cron: e.cron, prompt: e.prompt, recurring: r.recurring, ...(r.nextFireAt === undefined ? {} : { nextFireAt: r.nextFireAt }) }
  return { kind: 'cronCreated', job, ...withAgent(e.agentId) }
}

/**
 * ScheduleWakeup（`/loop` 動態模式；未實測，照型別）：排了一次就列。`stop: true` 結束循環時取消還在等的喚醒，
 * 引擎說取消了 0 個就不動；沒有 prompt 或沒有排到時間（`scheduledFor` 是 0）也不列
 */
export function wakeupSignal(
  e: { prompt?: string; agentId?: string },
  r: { scheduledFor: number; stopped?: boolean; cancelledWakeups?: number },
): BackgroundSignal | undefined {
  if (r.stopped === true) return r.cancelledWakeups !== 0 ? { kind: 'changed', event: { kind: 'wakeupsCancelled' } } : undefined
  if (e.prompt === undefined || !(r.scheduledFor > 0)) return undefined
  return { kind: 'wakeupScheduled', prompt: e.prompt, scheduledFor: r.scheduledFor, ...withAgent(e.agentId) }
}

/**
 * Workflow（未實測，照型別）：結果的 `taskId`、`workflowName`、`runId` 建一筆，名稱沒有時用輸入的 `name`；
 * 語法檢查失敗（`error`）或沒有 `taskId` 的不列。結束照 shell 的通知收
 */
export function workflowSignal(
  e: { name?: string; agentId?: string },
  r: { taskId?: string; workflowName?: string; runId?: string; error?: unknown },
): BackgroundSignal | undefined {
  if (r.error !== undefined || !r.taskId) return undefined
  const name = r.workflowName ?? e.name ?? 'Workflow'
  return { kind: 'started', work: workflowStart(r.taskId, { name, ...(r.runId === undefined ? {} : { runId: r.runId }), ...withAgent(e.agentId) }) }
}

export function backgroundSource(): BackgroundSource {
  /**
   * 確認過「背景清單裡沒有執行中的」的 session（依快照的 `session_id`）：這種 session 收到空的快照時
   * 什麼都不用對，連清單都不讀。清單一有變化就整個清掉
   */
  const quiet = new Set<string>()

  /** 套得上才回答（同一個物件就是沒變） */
  const stepOf = (list: BackgroundList, event: BackgroundEvent): BackgroundStep | undefined => {
    const next = applyBackground(list, event)
    if (next === list) return undefined
    // 清單變了：之前「確認過沒有執行中的」不再算數，下一份快照要再讀一次
    quiet.clear()
    return { event, isEmpty: isEmptyBackground(next) }
  }

  /** CronList 能不能讀：同一個 session 只問一次（結果記在清單上，跟著下一次寫入存起來） */
  const accessOf = async (list: BackgroundList, ports: BackgroundPorts) => list.cronListAccess ?? (await ports.cronListAccess())

  /**
   * 讀一次 CronList、和清單裡的排程比對要套的事。清單裡沒有在等的排程就不讀（從沒出現過排程的 session 一次都不讀），
   * 不是 `allow` 也不讀，改用 cockpit 自己算的時間。`firedAt` 是排程觸發的那一刻
   */
  const cronCheck = async (list: BackgroundList, ports: BackgroundPorts, now: number, firedAt?: number): Promise<BackgroundEvent | undefined> => {
    if (!hasSchedules(list)) return undefined
    const access = await accessOf(list, ports)
    const jobs = access === 'allow' ? await ports.cronList() : undefined
    return { kind: 'cronListed', access, ...(jobs === undefined ? {} : { jobs }), ...(firedAt === undefined ? {} : { firedAt }), now }
  }

  /** 一件事加上之後讀的 CronList，合成一個事件 */
  const withCronCheck = async (list: BackgroundList, ports: BackgroundPorts, event: BackgroundEvent, now: number) => {
    const check = await cronCheck(applyBackground(list, event), ports, now)
    return stepOf(list, check === undefined ? event : { kind: 'sequence', events: [event, check] })
  }

  /** 一筆結束了：先用假的時刻試套，清單裡對不到那一筆（例如停的是 subagent）就不問時間 */
  const ended = async (ports: BackgroundPorts, at: (now: number) => BackgroundEvent) => {
    const list = await ports.list()
    if (applyBackground(list, at(0)) === list) return undefined
    return stepOf(list, at(await ports.now()))
  }

  return {
    reset: () => quiet.clear(),
    next: async (signal, ports) => {
      switch (signal.kind) {
        case 'started': {
          const [list, now] = await Promise.all([ports.list(), ports.now()])
          return stepOf(list, { kind: 'started', work: signal.work, now })
        }
        case 'notified':
          return ended(ports, now => ({ kind: 'notified', ...signal.note, now }))
        case 'stopped':
          return ended(ports, now => ({ kind: 'stopped', id: signal.id, now }))
        case 'changed':
          return stepOf(await ports.list(), signal.event)
        case 'snapshot': {
          const { sessionId, crons } = signal
          // subagent 不在背景頁，不算
          const tasks = signal.tasks.filter(t => t.type !== 'subagent')
          // 空的快照、這個 session 又確認過沒有執行中的：什麼都不問
          if (tasks.length === 0 && (crons ?? []).length === 0 && quiet.has(sessionId)) return undefined
          const [list, now] = await Promise.all([ports.list(), ports.now()])
          const event: BackgroundEvent = { kind: 'snapshot', tasks, ...(crons === undefined ? {} : { crons }), now }
          const step = stepOf(list, event)
          // 還在等的喚醒要靠快照順便判過期、還在等的排程要靠快照判不見了，有的話不算安靜
          const after = applyBackground(list, event)
          if (!after.works.some(w => w.status === 'running') && !hasWakeups(after) && !hasSchedules(after)) quiet.add(sessionId)
          return step
        }
        case 'cronCreated': {
          const [list, now] = await Promise.all([ports.list(), ports.now()])
          return withCronCheck(list, ports, { kind: 'cronCreated', job: signal.job, ...withAgent(signal.agentId), now }, now)
        }
        case 'cronDeleted': {
          // 清單裡沒有這一筆就不問時間、不讀 CronList
          const list = await ports.list()
          const event: BackgroundEvent = { kind: 'cronDeleted', id: signal.id }
          if (applyBackground(list, event) === list) return undefined
          return withCronCheck(list, ports, event, await ports.now())
        }
        case 'cronTriggered': {
          // 先看還在等的喚醒有沒有 prompt 原文相同的（不靠 CronList；未實測），對到了就是它；對不到再讀 CronList。
          // 清單裡沒有排程也沒有喚醒就什麼都不做
          const list = await ports.list()
          if (!hasSchedules(list) && !hasWakeups(list)) return undefined
          const now = await ports.now()
          const woke: BackgroundEvent = { kind: 'wakeupFired', text: signal.text, now }
          // 喚醒對到了：這次觸發是它的，不拿來猜 CronCreate 的排程（CronList 不能用時是靠時間猜的）
          const isWakeup = applyBackground(list, woke).works.some(w => w.kind === 'wakeup' && w.status === 'fired' && w.endedAt === now)
          const check = isWakeup ? undefined : await cronCheck(list, ports, now, now)
          return stepOf(list, check === undefined ? woke : { kind: 'sequence', events: [woke, check] })
        }
        case 'wakeupScheduled': {
          // 喚醒不靠 CronList 比對，不讀
          const [list, now] = await Promise.all([ports.list(), ports.now()])
          const { prompt, scheduledFor, agentId } = signal
          return stepOf(list, { kind: 'wakeupScheduled', prompt, scheduledFor, ...withAgent(agentId), now })
        }
      }
    },
  }
}
