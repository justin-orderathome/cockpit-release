/**
 * 在等你：agent 停下來、要你動作才會往下時，狀態框多的那一行（規格書 agent-interaction 第一章）。
 *
 * - 等你決定：一輪中途跳出對話框（權限核准、AskUserQuestion、核准計畫、MCP elicitation），警告色。
 *   主對話與 subagent 都算；清除依 loop 分開：主對話的一步、一輪結束或新 prompt 不清 subagent 的。
 * - 輪到你：主對話一輪結束，等你送下一個 prompt，暗色。
 *
 * 這裡只有不碰引擎的規則：一件事之後在等什麼（`applyWaiting`）、狀態框那一行寫什麼（`waitingLine`）、
 * [任務] 哪些 subagent 列在等你決定（`waitingAgents`）。
 * 事件從哪來、何時寫進 `$.state` 在 `register.tsx`。只寫開始時刻，不跑計時（閒置時面板不做任何事）。
 */
import type { Decision, DecisionKind, Waiting } from '../types'
import { fitText, textWidth } from './layout'
import { clockOf } from './tasks'

export const NO_WAITING: Waiting = { decisions: [] }

/**
 * 一件會改變「在等什麼」的事：
 * - `asked`：跳出對話框（`classic.PermissionRequest`、`classic.Elicitation`）。
 * - `answered`：MCP elicitation 有了結果（`classic.ElicitationResult`）：那一個 elicitation 拿掉。
 * - `moved`：那個 loop 往下走了（它的下一個 `turn.step`）：回應過對話框了，它的等你決定一起拿掉。
 * - `ended`：那個 loop 的一輪結束（`turn.complete`）：它的等你決定拿掉；主對話的還是輪到你的開始。
 *   subagent 結束（含被 TaskStop 停掉）也是它的一輪結束，它的等待一起拿掉。
 * - `prompted`：你自己送出 prompt（`origin.kind` 是 composer）：輪到你結束，主對話的等你決定也拿掉
 *   （subagent 的不拿）。
 */
export type WaitingEvent =
  | { kind: 'asked'; decision: Decision }
  | { kind: 'answered'; agentId: string | undefined; elicitationId?: string }
  | { kind: 'moved'; agentId: string | undefined }
  | { kind: 'ended'; agentId: string | undefined; now: number }
  | { kind: 'prompted' }
  | { kind: 'reset' }
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const textOf = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() !== '' ? v : undefined)
const firstLine = (v: unknown): string | undefined => textOf(v)?.split(/\r?\n/)[0]?.trim() || undefined

/** 檔案類工具的路徑欄位 */
const PATH_FIELDS = ['file_path', 'notebook_path'] as const

/** 權限對話框要顯示的工具內容：Bash／PowerShell 是指令的第一行，檔案類工具是路徑，其他只寫工具名稱 */
function toolDetail(tool: string, input: unknown): string {
  if (!isRecord(input)) return tool
  if (tool === 'Bash' || tool === 'PowerShell') {
    const first = firstLine(input.command)
    return first ? `${tool} \`${first}\`` : tool
  }
  for (const field of PATH_FIELDS) {
    const path = textOf(input[field])
    if (path !== undefined) return `${tool} \`${path}\``
  }
  return tool
}

/** AskUserQuestion 的第一個問題（`tool_input.questions[0].question`） */
function firstQuestion(input: unknown): string | undefined {
  if (!isRecord(input) || !Array.isArray(input.questions)) return undefined
  const first: unknown = input.questions[0]
  return isRecord(first) ? firstLine(first.question) : undefined
}

/** 哪個 loop：主對話什麼都不帶，subagent 帶 agentId 與（知道時）它的描述 */
const loopFields = (agentId: string | undefined, label: string | undefined) =>
  agentId === undefined ? {} : { agentId, ...(label ? { label } : {}) }

/** `classic.PermissionRequest` 的工具名稱與輸入，換成一個等你決定；subagent 的帶它的 agentId 與描述 */
export function decisionOf(tool: string, input: unknown, now: number, agentId?: string, label?: string): Decision {
  const loop = loopFields(agentId, label)
  if (tool === 'AskUserQuestion') {
    const question = firstQuestion(input)
    return { ...loop, kind: 'question', ...(question === undefined ? {} : { detail: question }), since: now }
  }
  if (tool === 'ExitPlanMode') return { ...loop, kind: 'plan', since: now }
  return { ...loop, kind: 'permission', detail: toolDetail(tool, input), since: now }
}

/**
 * `classic.Elicitation`（MCP 伺服器要你填東西）換成一個等你決定：寫伺服器與訊息的第一行。
 * 未實測，照引擎的型別寫（`mcp_server_name`、`message`、`elicitation_id`）
 */
export function elicitationOf(
  server: string,
  message: string,
  now: number,
  agentId?: string,
  label?: string,
  elicitationId?: string,
): Decision {
  const first = firstLine(message)
  return {
    ...loopFields(agentId, label),
    kind: 'elicitation',
    detail: first === undefined ? server : `${server}「${first}」`,
    ...(elicitationId === undefined ? {} : { elicitationId }),
    since: now,
  }
}

/** 拿掉某個 loop 的等你決定 */
const without = (decisions: readonly Decision[], agentId: string | undefined) => decisions.filter(d => d.agentId !== agentId)

/** 一件事之後在等什麼；沒變時回傳同一個物件 */
export function applyWaiting(w: Waiting, e: WaitingEvent): Waiting {
  switch (e.kind) {
    case 'asked':
      return { ...w, decisions: [...w.decisions, e.decision] }
    case 'answered': {
      // 有 id 照 id 對；沒有 id 時那個 loop 的 elicitation 一起拿掉
      const isIt = (d: Decision) =>
        d.kind === 'elicitation' && d.agentId === e.agentId && (e.elicitationId === undefined || d.elicitationId === e.elicitationId)
      const decisions = w.decisions.filter(d => !isIt(d))
      return decisions.length === w.decisions.length ? w : { ...w, decisions }
    }
    case 'moved':
      return w.decisions.some(d => d.agentId === e.agentId) ? { ...w, decisions: without(w.decisions, e.agentId) } : w
    case 'ended': {
      const decisions = without(w.decisions, e.agentId)
      if (e.agentId !== undefined) return decisions.length === w.decisions.length ? w : { ...w, decisions }
      return { decisions, turnOverSince: e.now }
    }
    case 'prompted': {
      const decisions = without(w.decisions, undefined)
      return decisions.length === w.decisions.length && w.turnOverSince === undefined ? w : { decisions }
    }
    case 'reset':
      return isWaiting(w) ? NO_WAITING : w
  }
}

/** 模組裡記著的摘要：哪些 loop 有等你決定（主對話是 `MAIN`）、主對話是不是輪到你 */
export type WaitingMarks = { loops: ReadonlySet<string>; isTurnOver: boolean }

/** 主對話在 `WaitingMarks.loops` 裡的名字（主對話沒有 agentId） */
export const MAIN = ''

const loopOf = (agentId: string | undefined) => agentId ?? MAIN

export const marksOf = (w: Waiting): WaitingMarks => ({
  loops: new Set(w.decisions.map(d => loopOf(d.agentId))),
  isTurnOver: w.turnOverSince !== undefined,
})

/**
 * 這件事要不要讀狀態來套：只看事件本身與記著的摘要，不問引擎。`turn.step` 每一步都會問，
 * 沒在等、或這一步的 loop 沒在等時就是 false，那一步這個功能零 host 呼叫。摘要是 undefined（還不知道）時照讀
 */
export function needsLook(marks: WaitingMarks | undefined, e: WaitingEvent): boolean {
  if (e.kind === 'asked' || e.kind === 'reset') return true
  if (e.kind === 'ended' && e.agentId === undefined) return true
  if (marks === undefined) return true
  if (e.kind === 'prompted') return marks.isTurnOver || marks.loops.has(MAIN)
  return marks.loops.has(loopOf(e.agentId))
}

/** 有沒有在等任何東西 */
export const isWaiting = (w: Waiting): boolean => w.decisions.length > 0 || w.turnOverSince !== undefined

/** 狀態框那一行：`decide` 是警告色的等你決定，`turn` 是暗色的輪到你 */
export type WaitingLine = { tone: 'decide' | 'turn'; text: string }

const DECISION_WORDS: Record<DecisionKind, string> = {
  permission: '等你核准',
  question: '等你回答',
  plan: '等你核准計畫',
  elicitation: '等你回答',
}

/** 照開始的先後排 */
const byStart = (decisions: readonly Decision[]) => [...decisions].sort((a, b) => a.since - b.since)

/**
 * [任務] 在等你決定的 subagent 列：agentId → 說明區的狀態字樣（「等你核准」等），一個 loop 取最早的那個。
 * 沒有 subagent 在等就是空的
 */
export function waitingAgents(w: Waiting): ReadonlyMap<string, string> {
  const out = new Map<string, string>()
  for (const d of byStart(w.decisions)) if (d.agentId !== undefined && !out.has(d.agentId)) out.set(d.agentId, DECISION_WORDS[d.kind])
  return out
}

/** 等你決定那一行的各段；`label` 是 subagent 的描述（窄的時候只截它） */
type DecisionParts = { isAgent: boolean; label?: string; word: string; detail?: string; time?: string; others?: string }

function joinParts(p: DecisionParts): string {
  const who = !p.isAgent ? '' : p.label === undefined ? 'subagent ' : `subagent「${p.label}」`
  const what = p.detail === undefined ? p.word : `${p.word}：${p.detail}`
  const time = p.time === undefined ? '' : ` · ${p.time}`
  const others = p.others === undefined ? '' : ` · ${p.others}`
  return `● ${who}${what}${time}${others}`
}

/**
 * 等你決定那一行放進 `width` 格：一定保留「● 等你…」與「另 N 個」，
 * 依序拿掉工具內容、開始時間，還放不下才截 subagent 的描述（不從行尾截）
 */
function fitDecision(p: DecisionParts, width: number): string {
  const bare: DecisionParts = { ...p, detail: undefined, time: undefined }
  for (const t of [p, { ...p, detail: undefined }, bare]) {
    const text = joinParts(t)
    if (textWidth(text) <= width) return text
  }
  if (bare.label !== undefined) {
    const room = width - textWidth(joinParts({ ...bare, label: '' }))
    if (room >= 1) return joinParts({ ...bare, label: fitText(bare.label, room) })
  }
  // 窄到連描述只剩「…」都放不下：只好從行尾截
  return fitText(joinParts(bare), width)
}

/**
 * 狀態框那一行，放進 `width` 格；沒有在等就是 undefined（狀態框不多這一行）。
 * 等你決定優先於輪到你；好幾個在等時寫最早開始的那一個，後面加「另 N 個」（N 以 loop 計，輪到你不算）。
 */
export function waitingLine(w: Waiting, width = Number.POSITIVE_INFINITY): WaitingLine | undefined {
  const first = byStart(w.decisions)[0]
  if (first !== undefined) {
    const others = new Set(w.decisions.filter(d => d.agentId !== first.agentId).map(d => loopOf(d.agentId))).size
    const parts: DecisionParts = {
      isAgent: first.agentId !== undefined,
      ...(first.label === undefined ? {} : { label: first.label }),
      word: DECISION_WORDS[first.kind],
      ...(first.detail === undefined ? {} : { detail: first.detail }),
      time: `${clockOf(first.since)} 起`,
      ...(others === 0 ? {} : { others: `另 ${others} 個` }),
    }
    return { tone: 'decide', text: fitDecision(parts, width) }
  }
  if (w.turnOverSince !== undefined) return { tone: 'turn', text: fitText(`輪到你 · ${clockOf(w.turnOverSince)} 起`, width) }
  return undefined
}
