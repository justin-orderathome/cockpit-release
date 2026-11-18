/**
 * [討論版] 兩個分享子分頁不碰引擎的部分：分享的狀態文字、依使用者分組與排序、按兩下確認的按鈕要畫成什麼，
 * 以及「我分享的」、「別人分享的」攤成哪些畫面列。呼叫工具與畫面在 `register.tsx`。
 * 分享是 `board_panel` 的原始資料，欄位型別不對的一律當成沒有；同事提供的文字顯示前都經過 `cleanText`。
 */
import { NARROW_COLUMNS, boardActionKey, shareEnded, userOfSession } from './boardPanel'
import type { BoardAction, Share } from './boardPanel'
import { cleanText } from './cleanText'
import { fitText, textWidth, wrapText } from './layout'

// ── 狀態 ─────────────────────────────────────────────────

/** `live` 照常、`warn` 黃字、`ended` 變灰 */
export type ShareStatus = { text: string; tone: 'live' | 'warn' | 'ended' }

/** 一列分享的狀態。`revoked` 是這一列被撤銷時的文字（分享方看「已撤銷」、收件方看「已被撤銷」），沒被撤銷是 null */
export function shareStatus(share: Share, now: number, revoked: string | null): ShareStatus {
  const ended = shareEnded(share, now) ?? revoked
  if (ended !== null) return { text: ended, tone: 'ended' }
  return share.sharer_online === false ? { text: '分享方離線', tone: 'warn' } : { text: '', tone: 'live' }
}

// ── 分組 ─────────────────────────────────────────────────

export type ShareGroup<T> = { user: string; liveCount: number; items: T[] }

/** 依使用者分組：組依有效份數由多到少（全部失效的自然排最後），組內有效的排前面；其餘照原本的順序 */
export function shareGroups<T>(entries: readonly T[], userOf: (entry: T) => string, isLive: (entry: T) => boolean): ShareGroup<T>[] {
  const byUser = new Map<string, T[]>()
  for (const entry of entries) byUser.set(userOf(entry), [...(byUser.get(userOf(entry)) ?? []), entry])
  return [...byUser]
    .map(([user, items]) => ({
      user,
      liveCount: items.filter(isLive).length,
      items: [...items.filter(isLive), ...items.filter(i => !isLive(i))],
    }))
    .sort((a, b) => b.liveCount - a.liveCount)
}

// ── 按兩下確認的按鈕 ─────────────────────────────────────

/** `armed` 是按過第一下、等第二下的按鈕；`acting` 是還沒做完的動作；`canAct` 是現在能不能改資料 */
export type ShareMarks = { armed: string; acting: readonly string[]; canAct: boolean }

/** `ready` 按第一下、`armed` 再按一下才執行、`busy` 做到一半、`off` 停用 */
export type ShareButton = { armId: string; action: BoardAction; what: string; text: string; state: 'ready' | 'armed' | 'busy' | 'off' }

/** 要按兩下才生效的按鈕現在長什麼樣子。`armId` 在畫面上要唯一：同一份分享出現在兩組時，各按各的 */
export function shareButton(armId: string, action: BoardAction, labels: { verb: string; busy: string; what: string }, marks: ShareMarks): ShareButton {
  const base = { armId, action, what: labels.what }
  if (marks.acting.includes(boardActionKey(action))) return { ...base, text: labels.busy, state: 'busy' }
  if (!marks.canAct) return { ...base, text: labels.verb, state: 'off' }
  return marks.armed === armId ? { ...base, text: `確定${labels.verb}？`, state: 'armed' } : { ...base, text: labels.verb, state: 'ready' }
}

// ── 顯示用的文字 ─────────────────────────────────────────

/** 位元組 → 「2.0 KB」 */
export function sizeText(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  return `${value.toFixed(1)} ${units[unit]}`
}

/** 離到期還有多久 → 「剩 3 小時」 */
export function leftText(ms: number): string {
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 1) return '剩不到 1 分鐘'
  if (minutes < 60) return `剩 ${minutes} 分鐘`
  const hours = Math.floor(minutes / 60)
  return hours < 24 ? `剩 ${hours} 小時` : `剩 ${Math.floor(hours / 24)} 天`
}

const sizeOf = (share: Share) => (typeof share.size === 'number' ? [sizeText(share.size)] : [])

/** 展開後的檔案資訊：「資料夾 · 12 個檔案 · 20.0 KB」 */
export function shareFileInfo(share: Share): string {
  if (share.kind !== 'dir') return ['檔案', ...sizeOf(share)].join(' · ')
  return ['資料夾', ...(typeof share.files === 'number' ? [`${share.files} 個檔案`] : []), ...sizeOf(share)].join(' · ')
}

/** 分享來自哪裡：有暱稱時是「使用者/暱稱」 */
export function shareSource(share: Share): string {
  const sharer = typeof share.sharer === 'string' ? share.sharer : ''
  const nick = typeof share.sharer_nick === 'string' ? share.sharer_nick : ''
  return cleanText(nick === '' ? sharer : `${userOfSession(sharer)}/${nick}`)
}

/** 分享的名稱 */
export const shareName = (share: Share, id: string) => cleanText(typeof share.name === 'string' && share.name !== '' ? share.name : id)

// ── 我分享的 ─────────────────────────────────────────────

/** 畫「我分享的」要知道的狀態。`closedGroups`、`openShares` 的 id 帶子分頁開頭，兩個分享子分頁不互相影響 */
export type SentMarks = ShareMarks & { closedGroups: readonly string[]; openShares: readonly string[] }

export type SentRow =
  | { kind: 'group'; id: string; foldId: string; label: string; isDim: boolean }
  | { kind: 'share'; id: string; foldId: string; label: string; tail: string; status: ShareStatus; button: ShareButton | null }
  | { kind: 'detail'; id: string; text: string }
  | { kind: 'close'; id: string; button: ShareButton }

/** 分享列的縮排：組底下兩格 */
const SHARE_INDENT = '  '
/** 展開內容的縮排 */
export const SENT_DETAIL_INDENT = 6

type Recipient = { user: string; isRevoked: boolean }

function recipientsOf(share: Share): Recipient[] {
  if (!Array.isArray(share.recipients)) return []
  return share.recipients.flatMap((r: unknown): Recipient[] => {
    if (r === null || typeof r !== 'object') return []
    const { user, revoked_at: revokedAt } = r as { user?: unknown; revoked_at?: unknown }
    return typeof user === 'string' ? [{ user, isRevoked: revokedAt !== null }] : []
  })
}

/** 「我分享的」攤成畫面列：第一層是收件人，第二層是分享；組預設展開、分享列預設收合 */
export function sentRows(sent: readonly Share[], now: number, cols: number, marks: SentMarks): SentRow[] {
  const isNarrow = cols < NARROW_COLUMNS
  const entries = sent.flatMap(share => {
    const id = share.id
    if (typeof id !== 'string') return []
    const recipients = recipientsOf(share)
    return recipients.map(recipient => ({ share, id, recipient, recipients, status: shareStatus(share, now, recipient.isRevoked ? '已撤銷' : null) }))
  })
  const groups = shareGroups(
    entries,
    e => e.recipient.user,
    e => e.status.tone !== 'ended',
  )
  return groups.flatMap((group): SentRow[] => {
    const foldId = `sent:${group.user}`
    const isClosed = marks.closedGroups.includes(foldId)
    const count = `  ${group.liveCount} 份有效`
    const fold = isClosed ? '▸ ' : '▾ '
    const head: SentRow = {
      kind: 'group',
      id: `board-sent-group-${group.user}`,
      foldId,
      label: `${fold}${fitText(cleanText(group.user), Math.max(4, cols - textWidth(fold) - textWidth(count)))}${count}`,
      isDim: group.liveCount === 0,
    }
    if (isClosed) return [head]
    return [
      head,
      ...group.items.flatMap(({ share, id, recipient, recipients, status }): SentRow[] => {
        const rowId = `${group.user}-${id}`
        const openId = `sent:${group.user}/${id}`
        const isOpen = marks.openShares.includes(openId)
        const button =
          status.tone === 'ended'
            ? null
            : shareButton(`board-revoke-${rowId}`, { action: 'revoke', share: id, user: recipient.user }, { verb: '撤銷', busy: '撤銷中…', what: '無法撤銷' }, marks)
        const left = typeof share.expires_at === 'number' ? [leftText(share.expires_at - now)] : []
        const tail = status.text !== '' ? status.text : isNarrow ? '' : [...sizeOf(share), ...left].join(' · ')
        const lead = `${SHARE_INDENT}${isOpen ? '▾ ' : '▸ '}`
        const nameWidth = cols - textWidth(lead) - (tail === '' ? 0 : textWidth(tail) + 1) - (button === null ? 0 : textWidth(button.text) + 1)
        const row: SentRow = {
          kind: 'share',
          id: `board-sent-share-${rowId}`,
          foldId: openId,
          label: `${lead}${fitText(shareName(share, id), Math.max(4, nameWidth))}`,
          tail,
          status,
          button,
        }
        if (!isOpen) return [row]
        const others = recipients.filter(r => r.user !== recipient.user && !r.isRevoked).map(r => cleanText(r.user))
        const lines = [shareFileInfo(share), `來自 ${shareSource(share)}`, ...(others.length > 0 ? [`也分享給 ${others.join('、')}`] : [])]
        const details = lines.map(
          (text, i): SentRow => ({ kind: 'detail', id: `board-sent-detail-${rowId}-${i}`, text: fitText(text, Math.max(4, cols - SENT_DETAIL_INDENT)) }),
        )
        if (shareEnded(share, now) !== null) return [row, ...details]
        const close = shareButton(`board-close-${rowId}`, { action: 'close', share: id }, { verb: '關閉整個分享', busy: '關閉中…', what: '無法關閉分享' }, marks)
        return [row, ...details, { kind: 'close', id: `board-sent-close-${rowId}`, button: close }]
      }),
    ]
  })
}

// ── 別人分享的 ───────────────────────────────────────────

/** `canAct` 只管下載：開啟不會改資料，讀取失敗時照樣可按 */
export type ReceivedMarks = SentMarks

/** 第一次下載按一下就開始；`isLive` 是現在按得下去 */
export type ReceivedFetch = { kind: 'first'; action: BoardAction; text: string; isLive: boolean } | { kind: 'again'; button: ShareButton }

export type ReceivedRow =
  | { kind: 'group'; id: string; foldId: string; label: string; isOnline: boolean; isDim: boolean }
  | {
      kind: 'share'
      id: string
      rowId: string
      foldId: string
      fold: string
      label: string
      tail: string
      status: ShareStatus
      /** `board_panel` 給的原始網址：還沒驗證，開啟前一定要過 `isBoardShareUrl` */
      url: unknown
      /** 不能開啟時整列不動作 */
      canOpen: boolean
      /** 已結束的分享沒有 [開啟] 與 [下載] */
      hasActions: boolean
      fetch: ReceivedFetch | null
    }
  | { kind: 'detail'; id: string; text: string; isWarning: boolean }
  | { kind: 'folder'; id: string; rowId: string; path: string }

/** 下載的檔案不可信的提醒 */
export const UNTRUSTED_TEXT = '內容來自別人的電腦，請勿直接執行'

/** 這份分享下載到收件匣的資料夾；還沒下載是 null */
const downloadedOf = (share: Share) => (typeof share.downloaded === 'string' && share.downloaded !== '' ? share.downloaded : null)

/** 分享方的使用者：「別人分享的」依它分組 */
const sharerUser = (share: Share) => userOfSession(typeof share.sharer === 'string' ? share.sharer : '')

/** 「別人分享的」一列展開時記的 id */
const receivedOpenId = (user: string, id: string) => `received:${user}/${id}`

/** 下載完成要展開哪一列、提醒什麼；回傳的資料裡沒有下載結果是 null */
export function fetchedNotice(received: readonly Share[], id: string): { openId: string; text: string } | null {
  const share = received.find(s => s.id === id)
  const downloaded = share === undefined ? null : downloadedOf(share)
  if (share === undefined || downloaded === null) return null
  return { openId: receivedOpenId(sharerUser(share), id), text: `已下載到 ${cleanText(downloaded)}。${UNTRUSTED_TEXT}` }
}

/** 下載的按鈕：還沒下載過按一下，已經下載過會覆蓋舊檔，要按兩下 */
function receivedFetch(rowId: string, id: string, isDownloaded: boolean, isOffline: boolean, marks: ReceivedMarks): ReceivedFetch {
  const action: BoardAction = { action: 'fetch', share: id }
  const canFetch = marks.canAct && !isOffline
  if (isDownloaded) {
    const labels = { verb: '重新下載', busy: '下載中…', what: '無法下載' }
    return { kind: 'again', button: shareButton(`board-refetch-${rowId}`, action, labels, { ...marks, canAct: canFetch }) }
  }
  const isBusy = marks.acting.includes(boardActionKey(action))
  return { kind: 'first', action, text: isBusy ? '下載中…' : '下載', isLive: canFetch && !isBusy }
}

/** 「別人分享的」攤成畫面列：第一層是分享方，第二層是分享；組預設展開、分享列預設收合 */
export function receivedRows(received: readonly Share[], now: number, cols: number, marks: ReceivedMarks): ReceivedRow[] {
  const isNarrow = cols < NARROW_COLUMNS
  const entries = received.flatMap(share => {
    const id = share.id
    if (typeof id !== 'string') return []
    return [{ share, id, user: sharerUser(share), status: shareStatus(share, now, share.revoked_at !== null ? '已被撤銷' : null) }]
  })
  const groups = shareGroups(
    entries,
    e => e.user,
    e => e.status.tone !== 'ended',
  )
  return groups.flatMap((group): ReceivedRow[] => {
    const foldId = `received:${group.user}`
    const isClosed = marks.closedGroups.includes(foldId)
    const isOnline = group.items.some(e => e.share.sharer_online === true)
    const count = isNarrow ? '' : `  ${group.liveCount} 份有效`
    const fold = isClosed ? '▸ ' : '▾ '
    const head: ReceivedRow = {
      kind: 'group',
      id: `board-received-group-${group.user}`,
      foldId,
      label: `${fold}${fitText(cleanText(group.user), Math.max(4, cols - textWidth(fold) - textWidth(count) - textWidth('● 在線') - 1))}${count}`,
      isOnline,
      isDim: group.liveCount === 0,
    }
    if (isClosed) return [head]
    return [
      head,
      ...group.items.flatMap(({ share, id, status }): ReceivedRow[] => {
        const rowId = `${group.user}-${id}`
        const openId = receivedOpenId(group.user, id)
        const isOpen = marks.openShares.includes(openId)
        const downloaded = downloadedOf(share)
        const hasActions = status.tone !== 'ended'
        const fetch = hasActions ? receivedFetch(rowId, id, downloaded !== null, status.tone === 'warn', marks) : null
        const canOpen = status.tone === 'live' && typeof share.url === 'string'
        const left = typeof share.expires_at === 'number' ? [leftText(share.expires_at - now)] : []
        const tail = status.text !== '' ? status.text : downloaded !== null ? '已下載' : isNarrow ? '' : [...sizeOf(share), ...left].join(' · ')
        const fetchText = fetch === null ? '' : fetch.kind === 'first' ? fetch.text : fetch.button.text
        const buttons = hasActions ? textWidth('開啟') + 1 + textWidth(fetchText) + 1 : 0
        const lead = `${SHARE_INDENT}${isOpen ? '▾ ' : '▸ '}`
        const nameWidth = cols - textWidth(lead) - (tail === '' ? 0 : textWidth(tail) + 1) - buttons
        const row: ReceivedRow = {
          kind: 'share',
          id: `board-received-share-${rowId}`,
          rowId,
          foldId: openId,
          fold: lead,
          label: fitText(shareName(share, id), Math.max(4, nameWidth)),
          tail,
          status,
          url: share.url,
          canOpen,
          hasActions,
          fetch,
        }
        if (!isOpen) return [row]
        const width = Math.max(4, cols - SENT_DETAIL_INDENT)
        const lines = [shareFileInfo(share), `來自 ${shareSource(share)}`, ...(downloaded === null ? [] : wrapText(`已下載到 ${cleanText(downloaded)}`, width))]
        const details = lines.map((text, i): ReceivedRow => ({ kind: 'detail', id: `board-received-detail-${rowId}-${i}`, text: fitText(text, width), isWarning: false }))
        if (downloaded === null) return [row, ...details]
        return [
          row,
          ...details,
          { kind: 'detail', id: `board-received-untrusted-${rowId}`, text: fitText(UNTRUSTED_TEXT, width), isWarning: true },
          { kind: 'folder', id: `board-received-folder-${rowId}`, rowId, path: downloaded },
        ]
      }),
    ]
  })
}
