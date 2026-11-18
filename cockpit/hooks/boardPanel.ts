/**
 * [討論版] 分頁不碰引擎的部分：`board_panel` 的回傳怎麼解讀、讀取的結果怎麼留著、子分頁與聊天版列要畫什麼。
 * 呼叫工具與畫面在 `register.tsx`。回傳的格式由 cc-board 維護（公開介面 `v: 1`），不認得的欄位一律忽略。
 */
import type { BoardBlock, BoardFeed, BoardLink, BoardMember, BoardPanel, BoardRoom, BoardSub } from '../types'
import { cleanText } from './cleanText'
import { composeFill } from './fill'
import { fitText, tabBar, textWidth } from './layout'
import type { TabSegment } from './layout'

/** 裝了這個 plugin 才有 [討論版] */
export const BOARD_PLUGIN = 'trm-board@trm-board'
/** 面板唯一會呼叫的工具 */
export const BOARD_PANEL_TOOL = 'mcp__plugin_trm-board_trm-board__board_panel'
/** 跑聊天版加入流程的 skill：只帶聊天版，暱稱由它的原生選單問 */
export const BOARD_JOIN_COMMAND = 'trm-board:join'
/** trm-board 所有討論版工具的共同開頭 */
const BOARD_TOOL_PREFIX = 'mcp__plugin_trm-board_trm-board__board_'
/** [更新] 填進輸入框的指令：由使用者按 Enter，換版一定經過同意（R-07） */
export const BOARD_UPDATE_COMMAND = '/trm-board:update'

/** 分享的原始資料：欄位型別不對的一律當成沒有 */
export type Share = Record<string, unknown>

/** 「使用者/session」裡的使用者 */
export const userOfSession = (session: string) => session.split('/')[0] ?? ''

export const NO_FEED: BoardFeed = { block: null, panel: null, readAt: null, failure: null, isStopped: false, isReading: false }

/** `isStopped`：伺服器拒絕這個 client，`reason` 是它給的原因與下一步 */
export type BoardReply = { ok: true; panel: BoardPanel } | { ok: false; reason: string; isStopped?: true } | { ok: false; block: BoardBlock }

/** 連線被停止、bridge 卻沒有給原因時的說明 */
const STOPPED_TEXT = '討論版連線已停止，請重開 session'

/** 用工具清單判斷這個 session 的 trm-board 能不能用：看功能在不在，不比對版本號 */
export function toolsBlock(names: readonly string[]): BoardBlock | null {
  if (names.includes(BOARD_PANEL_TOOL)) return null
  return names.some(n => n.startsWith(BOARD_TOOL_PREFIX)) ? 'old-client' : 'no-mcp'
}

/** 分頁用不了時顯示的說明與下一步 */
export const BOARD_BLOCK_TEXT: Record<BoardBlock, { text: string; next: string }> = {
  'old-client': { text: 'trm-board 太舊，還不支援討論版分頁', next: '按 [更新] 把指令填進輸入框，再按 Enter 執行' },
  'no-mcp': { text: '討論版的 MCP 工具沒有連上，請用 /mcp 檢查連線', next: '連上後按 r 重試' },
  'not-registered': { text: '這台電腦還沒註冊討論版', next: '請執行 /trm-board:register 註冊，完成後按 r 重試' },
  'unknown-format': { text: '這版 cockpit 看不懂討論版的資料格式，請更新 cockpit', next: '更新後按 r 重試' },
}

const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v)
const textOr = (v: unknown, fallback: string) => (typeof v === 'string' && v !== '' ? v : fallback)

/** 工具結果裡可能放 JSON 文字的地方：引擎給的 `text`，或 MCP 的 `content[0].text` */
function jsonOf(ran: { text?: unknown; result?: unknown }): unknown {
  const result = ran.result
  const blocks = Array.isArray(result) ? result : isRecord(result) ? result.content : undefined
  const first: unknown = Array.isArray(blocks) ? blocks[0] : undefined
  for (const text of [ran.text, isRecord(first) ? first.text : undefined, result]) {
    if (typeof text !== 'string') continue
    try {
      return JSON.parse(text)
    } catch {
      // 這一處放的不是 JSON，看下一處
    }
  }
  return undefined
}

function memberOf(v: unknown): BoardMember[] {
  if (!isRecord(v) || typeof v.session !== 'string') return []
  return [{ session: v.session, online: v.online === true, nick: typeof v.nick === 'string' ? v.nick : null }]
}

function openRoomOf(v: unknown): BoardRoom[] {
  if (!isRecord(v) || typeof v.name !== 'string' || v.open !== true) return []
  return [{ name: v.name, host: textOr(v.host, ''), members: Array.isArray(v.members) ? v.members.flatMap(memberOf) : [] }]
}

const sharesIn = (v: unknown): Share[] => (Array.isArray(v) ? v.filter(isRecord) : [])

const LINKS: readonly BoardLink[] = ['online', 'offline', 'not_joined', 'stopped', 'lost']
/** 不認得的連線狀態當成暫時離線：不擋操作，由 bridge 回報實際結果 */
const linkOf = (v: unknown): BoardLink => LINKS.find(l => l === v) ?? 'offline'

/** `$.tool.call` 的結果 → 讀到的清單，或讀不到的原因 */
export function boardReply(ran: { deny?: unknown; isError?: unknown; text?: unknown; result?: unknown }): BoardReply {
  if (typeof ran.deny === 'string') return { ok: false, reason: ran.deny }
  if (ran.isError === true) return { ok: false, reason: textOr(ran.text, 'board_panel 回報錯誤') }
  const data = jsonOf(ran)
  if (!isRecord(data)) return { ok: false, reason: 'board_panel 的回應看不懂' }
  if (data.v !== 1) return { ok: false, block: 'unknown-format' }
  if (data.registered === false) return { ok: false, block: 'not-registered' }
  const session = isRecord(data.session) ? data.session : {}
  // 伺服器拒絕這個 client：原因照它寫的顯示，下一步也在裡面，這裡不解讀內容
  if (session.link === 'stopped' && !Array.isArray(data.rooms)) return { ok: false, reason: cleanText(textOr(session.reason, STOPPED_TEXT)), isStopped: true }
  if (typeof data.error === 'string' && data.error !== '') return { ok: false, reason: data.error }
  if (!Array.isArray(data.rooms)) return { ok: false, reason: textOr(session.reason, '讀不到聊天版清單') }
  const shares = isRecord(data.shares) ? { sent: sharesIn(data.shares.sent), received: sharesIn(data.shares.received) } : null
  return {
    ok: true,
    panel: {
      user: textOr(data.user, ''),
      server: typeof data.server === 'string' ? data.server : null,
      sessionName: typeof session.name === 'string' ? session.name : null,
      link: linkOf(session.link),
      linkReason: typeof session.reason === 'string' && session.reason !== '' ? session.reason : null,
      hasChannel: session.channel_ok !== false,
      rooms: data.rooms.flatMap(openRoomOf),
      shares,
      isServerOld: data.shares_supported === false,
    },
  }
}

// ── 動作 ─────────────────────────────────────────────────

/** 帶 `action` 呼叫 `board_panel` 的參數（公開介面的動作表） */
export type BoardAction =
  | { action: 'leave'; room: string }
  | { action: 'close'; share: string }
  | { action: 'revoke'; share: string; user: string }
  | { action: 'fetch'; share: string }

/** 同一個動作做完之前不再送一次；畫面也用它標出做到一半的列 */
export const boardActionKey = (a: BoardAction) => Object.values(a).join(':')

/** 動作的結果：`changed` 是狀態已經被別人改了（409），直接重繪，不算錯誤 */
export type BoardOutcome = { kind: 'done' } | { kind: 'changed' } | { kind: 'failed'; reason: string }

/** 讀不到清單時給人看的原因；讀到了是 undefined */
export function replyFailure(reply: BoardReply): string | undefined {
  if (reply.ok) return undefined
  return 'block' in reply ? BOARD_BLOCK_TEXT[reply.block].text : reply.reason
}

/** 動作呼叫的結果 → 動作本身成功了沒。清單讀不讀得到另外看 `boardReply` */
export function boardOutcome(ran: Parameters<typeof boardReply>[0], reply: BoardReply): BoardOutcome {
  const data = typeof ran.deny === 'string' || ran.isError === true ? undefined : jsonOf(ran)
  const result = isRecord(data) ? data.result : undefined
  if (isRecord(result)) {
    if (result.conflict === true) return { kind: 'changed' }
    if (result.ok === true) return { kind: 'done' }
    return { kind: 'failed', reason: textOr(result.error, '討論版沒有說明原因') }
  }
  // 太舊的 trm-board 不認得 action，只回清單：動作其實沒做
  return { kind: 'failed', reason: replyFailure(reply) ?? '這個 trm-board 不支援這個動作，請更新' }
}

/**
 * 下載的呼叫沒等到結果：呼叫被中斷（`isCut`）或 MCP 回報錯誤（逾時走這條），bridge 仍在下載，不算失敗。
 * `deny` 是工具根本沒執行，`result.ok` 是 false 是 bridge 說失敗，這兩種才是真的失敗
 */
export const isFetchUnsettled = (action: BoardAction, ran: { isCut?: unknown; isError?: unknown }) =>
  action.action === 'fetch' && (ran.isCut === true || ran.isError === true)

/** agent 這次呼叫會不會改變清單：查暱稱的 preview 不會，`board_send` 只有帶分享才算 */
export function changesBoard(call: { tool?: unknown; preview?: unknown; share?: unknown }): boolean {
  if (typeof call.tool === 'string' && call.tool.endsWith('__board_send')) return typeof call.share === 'string' && call.share !== ''
  return call.preview !== true
}

/** 這個 session 是不是已經在這個聊天版裡 */
export function isInRoom(panel: BoardPanel, room: string): boolean {
  if (panel.sessionName === null) return false
  const self = `${panel.user}/${panel.sessionName}`
  return panel.rooms.some(r => r.name === room && r.members.some(m => m.session === self))
}

/** 聊天版名稱裡的空白會被 `/trm-board:join` 當成暱稱的開始，控制字元不該進到指令 */
export const isJoinableName = (room: string) => room !== '' && !/[\s\p{Cc}\p{Cf}]/u.test(room)

/** 不能加入的原因與下一步；可以加入時是 null */
export function joinBlock(panel: BoardPanel): string | null {
  if (panel.link === 'stopped') return cleanText(panel.linkReason ?? STOPPED_TEXT)
  if (panel.link === 'lost') return '討論版連線中斷，收不到訊息，暫時不能加入。請結束並重開這個 session'
  if (!panel.hasChannel) return '這個 session 啟動時沒有帶討論版參數，不能加入聊天版。請結束這個 session，在終端機輸入 trm-board 重新開啟'
  return null
}

/** 分享清單拿不到時，分享子分頁要說的話；拿得到是 null */
export function boardSharesNotice(panel: BoardPanel): string | null {
  if (panel.isServerOld) return '討論版伺服器還沒更新，請聯絡管理員'
  return panel.shares === null ? '這次沒有讀到分享清單，按 r 重試' : null
}

/** 開始讀：還沒有清單時畫面寫「讀取中」；已經有清單就照舊顯示，讀完才換 */
export const feedReading = (feed: BoardFeed): BoardFeed =>
  feed.panel === null ? { ...feed, failure: null, isReading: true } : feed

/** 讀完：成功換上新清單；失敗留著舊清單，記下原因；用不了時清單不再有意義，一起拿掉 */
export const feedAfter = (feed: BoardFeed, reply: BoardReply, now: number): BoardFeed =>
  reply.ok
    ? { block: null, panel: reply.panel, readAt: now, failure: null, isStopped: false, isReading: false }
    : 'block' in reply
      ? { ...NO_FEED, block: reply.block }
      : { ...feed, block: null, failure: reply.reason, isStopped: reply.isStopped === true, isReading: false }

/** 時刻 → 「13:40」（本地時間） */
export function clockText(ms: number): string {
  const at = new Date(ms)
  return `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`
}

// ── 子分頁 ───────────────────────────────────────────────

/**
 * 子分頁的順序、名稱與熱鍵。面板按鈕的熱鍵只能是一個數字或小寫字母；
 * `1`–`5`、`c d e f o p q r u`、`m t b` 與翻頁的 `j k` 都被占用了
 */
export const BOARD_SUBS: readonly { id: BoardSub; label: string; hotkey: string }[] = [
  { id: 'rooms', label: '聊天版', hotkey: 'a' },
  { id: 'sent', label: '我分享的', hotkey: 's' },
  { id: 'received', label: '別人分享的', hotkey: 'w' },
]

const CLOSE_REASONS = new Map([
  ['manual', '已關閉'],
  ['expired', '已到期'],
  ['exit', '分享方已結束'],
  ['gone', '內容已失效'],
])

/** 分享結束的原因；還開著是 null。`now` 是這次讀取的時間：到期不一定等得到伺服器標記 `close_reason` */
export function shareEnded(share: Share, now: number): string | null {
  const reason = typeof share.close_reason === 'string' ? CLOSE_REASONS.get(share.close_reason) : undefined
  if (reason !== undefined) return reason
  if (share.closed_at !== null) return '已關閉'
  return typeof share.expires_at === 'number' && share.expires_at > now ? null : '已到期'
}

/** 子分頁標籤上的數量：聊天版是開放中的，分享只算有效的（我分享的至少要還有一位收件人沒被撤銷） */
export function boardCounts(panel: BoardPanel, now: number): Record<BoardSub, number | undefined> {
  const isOpen = (s: Share) => shareEnded(s, now) === null
  const hasRecipient = (s: Share) => Array.isArray(s.recipients) && s.recipients.some(r => isRecord(r) && r.revoked_at === null)
  return {
    rooms: panel.rooms.length,
    sent: panel.shares?.sent.filter(s => isOpen(s) && hasRecipient(s)).length,
    received: panel.shares?.received.filter(s => isOpen(s) && s.revoked_at === null).length,
  }
}

/** 子分頁籤的段落；寬度放不下 `columns` 格時拿掉數量 */
export function boardSubBar(
  chosen: BoardSub,
  counts: Record<BoardSub, number | undefined>,
  columns: number,
): { segments: TabSegment<BoardSub>[]; edge: number } {
  const build = (withCount: boolean) =>
    tabBar(
      BOARD_SUBS.map(s => {
        const count = counts[s.id]
        return { id: s.id, hotkey: s.hotkey, label: withCount && count !== undefined ? `${s.label} ${count}` : s.label }
      }),
      chosen,
    )
  const full = build(true)
  return full.width <= columns ? full : build(false)
}

// ── 聊天版列 ─────────────────────────────────────────────

/** 框內比這個窄時，只留最要緊的字 */
export const NARROW_COLUMNS = 46

/** 聊天版列右邊的操作：`wait` 是做到一半，`isLive` 是現在按得下去 */
export type BoardRoomAction = { kind: 'join' | 'leave' | 'wait'; text: string; isLive: boolean }

/** 畫聊天版列要知道的操作狀態 */
export type BoardRoomMarks = {
  joining: readonly string[]
  acting: readonly string[]
  canJoin: boolean
  canLeave: boolean
  /** 現在能不能用 [分享] [訊息]：連線正常、清單不是舊的 */
  canQuick: boolean
}

/** 快速按鈕的對象：`target` 是指令裡的收件對象，`who` 是提示裡給人看的名稱 */
export type BoardQuick = { id: string; target: string; who: string }

/** 快速按鈕由左到右的順序。按下去只把指令填進輸入框，由使用者按 Enter 送出 */
export const BOARD_QUICK_ACTIONS = [
  { kind: 'share', text: '分享', command: '/trm-board:share' },
  { kind: 'send', text: '訊息', command: '/trm-board:send' },
] as const

/** 兩顆快速按鈕佔的寬度（含前面的間隔） */
const QUICK_WIDTH = BOARD_QUICK_ACTIONS.reduce((sum, a) => sum + textWidth(a.text) + 1, 0)

export type BoardRoomRow =
  | { kind: 'room'; id: string; room: string; label: string; tail: string; action: BoardRoomAction; quick: BoardQuick | null }
  | { kind: 'member'; id: string; label: string; isOnline: boolean; tag: string; quick: BoardQuick | null }

/** 成員顯示的名稱：有暱稱時是「使用者/暱稱」 */
function memberName(m: BoardMember): string {
  return cleanText(m.nick === null || m.nick === '' ? m.session : `${userOfSession(m.session)}/${m.nick}`)
}

/** 上一則親手送出的指令：Claude Code 會把被 hook 攔下的 prompt 放回輸入框，送出後它還留在那裡 */
const LEFTOVER_COMMAND = /^\s*\/trm-board:(send|share)(\s|$)/

/** 快速按鈕要填什麼：輸入框留著上一則指令時整個換掉（接在後面會把舊內容再送一次），其他照共用的填入規則 */
export const composeBoardQuick = (current: string, text: string) =>
  LEFTOVER_COMMAND.test(current) ? { text, mode: 'replace' as const } : composeFill(current, text)

/** 能不能放進收件對象：空白會結束對象、逗號分隔多人、冒號分隔聊天版，控制字元不該進到指令 */
const isTargetWord = (word: string) => word !== '' && !/[\s\p{Cc}\p{Cf},:]/u.test(word)

/** 這位成員的收件對象：優先用暱稱，暱稱不能當對象時用 session；都不行是 null */
function memberTarget(room: string, m: BoardMember): string | null {
  if (m.nick && isTargetWord(m.nick) && !m.nick.includes('/')) return `${room}:${userOfSession(m.session)}/${m.nick}`
  return isTargetWord(m.session) ? `${room}:${m.session}` : null
}

function roomAction(room: string, isMine: boolean, marks: BoardRoomMarks): BoardRoomAction {
  if (marks.acting.includes(boardActionKey({ action: 'leave', room }))) return { kind: 'wait', text: '離開中…', isLive: false }
  if (isMine) return { kind: 'leave', text: '離開', isLive: marks.canLeave }
  if (marks.joining.includes(room)) return { kind: 'wait', text: '等待加入…', isLive: false }
  return { kind: 'join', text: '加入', isLive: marks.canJoin }
}

/** 聊天版清單攤成畫面列：每個聊天版一列，展開的接著列成員。名稱太長的截斷，右邊的資訊與操作保留 */
export function boardRoomRows(panel: BoardPanel, openRooms: readonly string[], cols: number, marks: BoardRoomMarks): BoardRoomRow[] {
  const isNarrow = cols < NARROW_COLUMNS
  const self = panel.sessionName === null ? undefined : `${panel.user}/${panel.sessionName}`
  return panel.rooms.flatMap((room): BoardRoomRow[] => {
    const online = room.members.filter(m => m.online).length
    const count = `${online}/${room.members.length}${isNarrow ? '' : ' 在線'}`
    const mine = room.members.find(m => m.session === self)
    const nick = mine?.nick ? cleanText(mine.nick) : ''
    const state = mine === undefined ? '' : isNarrow ? nick || '已加入' : nick ? `已加入·${nick}` : '已加入'
    const tail = fitText(state, Math.floor(cols / 3))
    const isOpen = openRooms.includes(room.name)
    const fold = isOpen ? '▾ ' : '▸ '
    const action = roomAction(room.name, mine !== undefined, marks)
    // 同一個聊天版的成員才能互傳：沒進這個聊天版就沒有快速按鈕
    const canQuick = marks.canQuick && mine !== undefined && isTargetWord(room.name)
    const quick = canQuick ? { id: `room-${room.name}`, target: room.name, who: '全版' } : null
    const nameWidth =
      cols - textWidth(fold) - textWidth(count) - 2 - (tail === '' ? 0 : textWidth(tail) + 1) - textWidth(action.text) - 1 - (quick === null ? 0 : QUICK_WIDTH)
    const label = `${fold}${fitText(cleanText(room.name), Math.max(4, nameWidth))}  ${count}`
    const head: BoardRoomRow = { kind: 'room', id: `board-line-${room.name}`, room: room.name, label, tail, action, quick }
    if (!isOpen) return [head]
    const members = room.members.map((m): BoardRoomRow => {
      const isHost = userOfSession(m.session) === room.host
      const tag = [...(isHost ? ['主持人'] : []), ...(m.session === self ? ['你'] : [])].join('·')
      const target = canQuick && m.online && m.session !== self ? memberTarget(room.name, m) : null
      const memberQuick = target === null ? null : { id: `${room.name}-${m.session}`, target, who: memberName(m) }
      const memberWidth = cols - 6 - (tag === '' ? 0 : textWidth(tag) + 1) - (memberQuick === null ? 0 : QUICK_WIDTH)
      return {
        kind: 'member',
        id: `board-member-${room.name}-${m.session}`,
        label: fitText(memberName(m), Math.max(4, memberWidth)),
        isOnline: m.online,
        tag,
        quick: memberQuick,
      }
    })
    return [head, ...members]
  })
}
