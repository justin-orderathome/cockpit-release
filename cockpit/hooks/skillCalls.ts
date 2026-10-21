/**
 * skill 的叫用紀錄（規格書第四章）：「叫用」＝skill 的內文被展開給模型一次。
 *
 * `skill.prompt` 本身不帶是誰叫的，靠它前後的事件判斷（2026-10-21 實測，`.scratch/agent-interaction/issues/07`）：
 * - 落在同名、還沒結束的 Skill 工具呼叫裡：模型叫（主對話或 subagent），等工具結束看了結果再算；
 * - 緊接在 composer 送出的 `/name` 之後：手打，算；
 * - 兩者皆非：預載進 subagent，不算。
 *
 * 這裡是不碰引擎的規則：叫法的判斷（`skillCallers`，記在模組裡、只有這個 session 的）、
 * 存進 `$.store` 的紀錄（`skillCalls` 鍵，全域）怎麼驗、怎麼加一次，以及畫面上的字。
 */

// ── 存進 `$.store` 的紀錄（鍵 `skillCalls`，全域：跨 session、不分專案） ──

/** 一個 skill 的紀錄：叫用幾次、最後一次是哪天（`YYYY-MM-DD`，本地時間） */
export type SkillCallRecord = { count: number; last: string }

/**
 * 全部的紀錄：`since` 是開始記錄的日期（第一次寫入時記下），`calls` 照 `skill.prompt` 帶的名稱原樣當鍵
 * （plugin 的含前綴）。解除安裝或改名的 skill 紀錄不清，裝回來接著算；不提供歸零。
 */
export type SkillCalls = { since: string; calls: Record<string, SkillCallRecord> }

export const NO_SKILL_CALLS: SkillCalls = { since: '', calls: {} }

const isObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v)
const isDay = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)

/** 存起來的紀錄；形狀不對當作沒有，壞掉的項目（次數不是正整數、日期不對）丟掉 */
export function storedSkillCalls(value: unknown): SkillCalls {
  if (!isObject(value) || !isObject(value.calls)) return NO_SKILL_CALLS
  const calls: Record<string, SkillCallRecord> = {}
  for (const [name, entry] of Object.entries(value.calls)) {
    if (!isObject(entry)) continue
    const { count, last } = entry
    if (typeof count === 'number' && Number.isInteger(count) && count > 0 && isDay(last)) calls[name] = { count, last }
  }
  return { since: isDay(value.since) ? value.since : '', calls }
}

/** 沒記過開始記錄日時補上今天（紀錄照留）；記過的原樣回傳，不必寫 */
export const startedCalls = (calls: SkillCalls, today: string): SkillCalls =>
  calls.since === '' ? { since: today, calls: calls.calls } : calls

/** 叫用一次：這個 skill 的次數加一、最後改成今天；沒記過開始記錄日的一起記下 */
export function withCall(calls: SkillCalls, name: string, today: string): SkillCalls {
  const was = Object.hasOwn(calls.calls, name) ? calls.calls[name] : undefined
  return {
    since: calls.since === '' ? today : calls.since,
    calls: { ...calls.calls, [name]: { count: (was?.count ?? 0) + 1, last: today } },
  }
}

/**
 * [SKILL] 一列的紀錄：先找完整的名稱，沒有再找短名（同步的 skill 在清單與事件裡可能一邊是短名），
 * 和 `skillTokens` 的對名規則一樣；只看名稱，不看來源字串（兩邊的來源寫法不同）。
 */
export function callsOf(calls: SkillCalls, name: string): SkillCallRecord | undefined {
  for (const key of new Set([name, shortName(name)])) if (key !== '' && Object.hasOwn(calls.calls, key)) return calls.calls[key]
  return undefined
}

/** `YYYY-MM-DD` 寫成 `M/D` */
const monthDay = (day: string) => `${Number(day.slice(5, 7))}/${Number(day.slice(8, 10))}`

/**
 * 次數的字：`12 次 · 最後 10/21`；沒用過的寫 `沒用過（自 10/21 起）`，日期取開始記錄日與該 skill
 * 版號更新日（`versionDate`，查不到是空的）較晚的那個，剛裝或剛更新的不會看起來像放了很久。
 */
export function callText(record: SkillCallRecord | undefined, since: string, versionDate: string): string {
  if (record !== undefined) return `${record.count} 次 · 最後 ${monthDay(record.last)}`
  if (since === '') return '沒用過'
  const from = isDay(versionDate) && versionDate > since ? versionDate : since
  return `沒用過（自 ${monthDay(from)} 起）`
}

// ── 叫法的判斷 ──

/** 去掉前導的「/」 */
const bare = (name: string) => (name.startsWith('/') ? name.slice(1) : name)
/** 帶命名空間時最後一個冒號後的短名 */
const shortName = (name: string) => name.slice(name.lastIndexOf(':') + 1)

/**
 * Skill 工具帶的名稱與展開的名稱是不是同一個：一樣，或其中一邊是另一邊的短名
 * （模型可能寫 `/pdf` 或 `pdf`，展開的是 `anthropic-skills:pdf`）。
 */
function sameSkill(asked: string, expanded: string): boolean {
  const a = bare(asked)
  const b = bare(expanded)
  if (a === b) return true
  return (!a.includes(':') && a === shortName(b)) || (!b.includes(':') && b === shortName(a))
}

/**
 * Skill 工具的結果說這個 skill 在對話裡已經載入過，這次沒有把內文給模型（實測的文字是
 * 「Skill /<name> is already loaded above; instructions unchanged.」）。
 * 結果在 `tool.call` 的 `text`（模型讀到的字）；這個欄位的形狀沒實測，對不到時照算（多算一次）。
 */
export const isAlreadyLoaded = (text: string | undefined): boolean => text !== undefined && /\bis already loaded\b/i.test(text)

/** `skill.prompt` 是怎麼來的 */
export type Expansion = 'tool' | 'typed' | 'preload'

/**
 * 正在用的 skill（規格書第四章「正在用」）：主對話的（`main`）與每個 subagent 的（`agents`，鍵是 agentId）。
 * 主對話的在這一輪結束、下一個 skill 被叫用、你送出新 prompt 時結束；subagent 的在它結束或叫用下一個時結束。
 * 不計時、不逾時。
 */
export type SkillInUse = { main?: string; agents: Record<string, string> }

export const NO_SKILL_IN_USE: SkillInUse = { agents: {} }

/**
 * [SKILL] 名稱是 `name` 的那一列是不是正在用的 `skill`（`skill.prompt` 帶的名稱）：和 `callsOf` 的對名規則一樣，
 * 先比完整的名稱，再比短名（同步的 skill 在清單與事件裡可能一邊是短名）。
 */
export const isUsing = (skill: string | undefined, name: string): boolean =>
  skill !== undefined && (skill === name || skill === shortName(name))

export type SkillCallers = {
  /**
   * Skill 工具開始（`agentId` 是 subagent 的，主對話沒有）；回傳這次呼叫的號碼，結束時交回
   * （`tool_use_id` 在型別上可以沒有，所以自己編號）
   */
  toolStarted: (skill: string, agentId: string | undefined) => number
  /**
   * composer 送出了一段文字：以 `/<name>` 開頭的記成等著的手打（後面接空白或結尾）。
   * 這是你送出新 prompt，主對話的正在用一起結束（背景工作的通知不走這裡）
   */
  typed: (text: string) => void
  /**
   * `skill.prompt` 到了：先配進行中的 Skill 呼叫，再配等著的手打，都沒有就是預載。
   * 配到的換成叫用者（主對話或那個 subagent）正在用的；`isFork`（`context: fork`）的跑在沒有 subagent 列的
   * agent 裡，主對話那邊的工具呼叫也馬上結束，不標
   */
  expanded: (skill: string, isFork?: boolean) => Expansion
  /** Skill 工具結束：這次要算一次的 skill 名稱（展開的名稱）；沒展開或「已載入」的是 undefined */
  toolEnded: (id: number, text: string | undefined) => string | undefined
  /**
   * 主對話一輪結束：等著的手打作廢（`/clear` 這種不是 skill 的指令，不留到之後誤配預載），
   * 主對話的正在用一起結束
   */
  turnEnded: () => void
  /** 這個 subagent 結束了：它的正在用拿掉 */
  agentEnded: (agentId: string) => void
  /** 現在正在用的 skill；沒變過時回同一個物件（比一下就知道要不要寫） */
  inUse: () => SkillInUse
}

/** 一個 session 的叫法判斷與正在用；記在模組裡，mod 重載時重來 */
export function skillCallers(): SkillCallers {
  /** 進行中的 Skill 呼叫，照開始的順序；`expanded` 是配到的 `skill.prompt` 名稱 */
  const running: { id: number; skill: string; agentId: string | undefined; expanded?: string }[] = []
  let waitingTyped: string | undefined
  let lastId = 0
  /** 正在用的；換掉時整個換新的物件，沒變的不換 */
  let using: SkillInUse = NO_SKILL_IN_USE
  const use = (agentId: string | undefined, skill: string) => {
    using =
      agentId === undefined
        ? { ...using, main: skill }
        : { ...using, agents: { ...using.agents, [agentId]: skill } }
  }
  const mainEnded = () => {
    if (using.main !== undefined) using = { agents: using.agents }
  }
  return {
    toolStarted: (skill, agentId) => {
      const id = ++lastId
      running.push({ id, skill, agentId })
      return id
    },
    typed: text => {
      const hit = /^\/(\S+)(?:\s|$)/.exec(text)
      waitingTyped = hit?.[1]
      mainEnded()
    },
    expanded: (skill, isFork = false) => {
      const call = running.find(c => c.expanded === undefined && sameSkill(c.skill, skill))
      if (call !== undefined) {
        call.expanded = skill
        if (!isFork) use(call.agentId, skill)
        return 'tool'
      }
      if (waitingTyped !== undefined && sameSkill(waitingTyped, skill)) {
        waitingTyped = undefined
        if (!isFork) use(undefined, skill)
        return 'typed'
      }
      return 'preload'
    },
    toolEnded: (id, text) => {
      const at = running.findIndex(c => c.id === id)
      if (at < 0) return undefined
      const [call] = running.splice(at, 1)
      return call?.expanded === undefined || isAlreadyLoaded(text) ? undefined : call.expanded
    },
    turnEnded: () => {
      waitingTyped = undefined
      mainEnded()
    },
    agentEnded: agentId => {
      if (!Object.hasOwn(using.agents, agentId)) return
      const { [agentId]: _gone, ...rest } = using.agents
      using = using.main === undefined ? { agents: rest } : { main: using.main, agents: rest }
    },
    inUse: () => using,
  }
}
