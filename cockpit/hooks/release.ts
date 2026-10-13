/**
 * 更新：發布的版本去哪裡看、這一份是從哪裡裝的、看完之後該做什麼、換版時怎麼講（升版與退版的措辭不同），
 * 以及開場該不該檢查、該不該自己下載、該不該提示、該不該把磁碟換回發布的版本、面板上該留著哪一種標示。
 * 上網、讀檔與跑指令在 `register.tsx`（`$` 只能留在那裡）；這裡是不碰引擎的判斷，可以直接測。
 * 更新紀錄（放在哪裡、詢問裡列哪幾條）在 `changelog.ts`。
 *
 * 從 marketplace 裝的那一份，發布的版本看的是 marketplace 在本機的那份 clone（先請 Claude Code 拉到最新）：
 * 那就是 `claude plugin update` 會裝的版本，問使用者的版本號和實際換上的才會一致。
 * 發布 repo 的網址有幾分鐘的快取，只拿來告知從資料夾載入的那一份。
 */

/** 發布 repo 裡的 plugin.json；只給不是從 marketplace 裝的那一份看發布的版本 */
export const RELEASE_MANIFEST =
  'https://raw.githubusercontent.com/justin-orderathome/cockpit-release/main/cockpit/.claude-plugin/plugin.json'

/** plugin.json 的內容寫的版本；不是 JSON 或沒有 `version` 是空的 */
export function versionIn(text: string | undefined): string {
  if (text === undefined) return ''
  try {
    const found = (JSON.parse(text) as { version?: unknown } | null)?.version
    return typeof found === 'string' ? found : ''
  } catch {
    return ''
  }
}

/** 從 marketplace 裝的那一份：`id` 是 `claude plugin update` 認的名稱 */
export type Install = { id: string; plugin: string; marketplace: string }

/**
 * 這一份是從哪個 marketplace 裝的，看它的資料夾：`…/plugins/cache/<marketplace>/<plugin>/<版本>`。
 * 不在 cache 底下的（`CLAUDE_CODE_PLUGIN_DIRS`、`--plugin-dir`）不是裝來的，沒辦法替它更新。
 */
export function installedFrom(root: string): Install | undefined {
  const parts = root.split('\\').join('/').split('/').filter(Boolean)
  const at = parts.lastIndexOf('cache')
  if (at < 1 || parts[at - 1] !== 'plugins' || parts.length !== at + 4) return undefined
  const [marketplace, plugin] = [parts[at + 1], parts[at + 2]]
  return marketplace && plugin ? { id: `${plugin}@${marketplace}`, plugin, marketplace } : undefined
}

/** marketplace 在本機的那份 clone 放哪（`home` 是家目錄） */
export const marketplaceDir = (home: string, marketplace: string): string =>
  `${home}/.claude/plugins/marketplaces/${marketplace}`

/** marketplace 的目錄檔（`.claude-plugin/marketplace.json`） */
export const catalogPath = (dir: string): string => `${dir}/.claude-plugin/marketplace.json`

/**
 * 發布的 plugin.json 在 clone 裡的哪裡：照目錄檔裡那個 plugin 的 `source`（同一個 repo 裡的相對路徑）。
 * 目錄檔讀不懂、沒有這個 plugin，或 `source` 不是相對路徑（放在別的 repo）就是 undefined。
 */
export function releasedManifest(dir: string, catalog: string | undefined, plugin: string): string | undefined {
  if (catalog === undefined) return undefined
  try {
    const listed = (JSON.parse(catalog) as { plugins?: unknown } | null)?.plugins
    if (!Array.isArray(listed)) return undefined
    const source = (listed as { name?: unknown; source?: unknown }[]).find(p => p?.name === plugin)?.source
    if (typeof source !== 'string' || !source.startsWith('.')) return undefined
    const inside = source.split('/').filter(part => part !== '' && part !== '.')
    if (inside.includes('..')) return undefined
    return [dir, ...inside, '.claude-plugin', 'plugin.json'].join('/')
  } catch {
    return undefined
  }
}

/**
 * 看完發布的版本之後該做什麼。比的是「不同」不是「較新」：作者退版時發布的版本號會變小，一樣要跟著換。
 * - `unknown`：查不到發布的版本。
 * - `same`：已經是發布的那一版。
 * - `manual`：不一樣，但這一份不是從 marketplace 裝的，只能自己換。
 * - `update`：不一樣，可以替使用者更新。
 */
export type Verdict =
  | { kind: 'unknown' }
  | { kind: 'same' }
  | { kind: 'manual'; latest: string }
  | { kind: 'update'; latest: string; install: Install }

export function verdict(current: string, latest: string, install: Install | undefined): Verdict {
  if (latest === '') return { kind: 'unknown' }
  if (latest === current) return { kind: 'same' }
  return install ? { kind: 'update', latest, install } : { kind: 'manual', latest }
}

/**
 * `version` 比 `than` 舊嗎：按數字逐段比，段數不同時少的那幾段當 0。
 * 有哪一段不是純數字就比不出來，一律不算舊（照升版處理）。只用在措辭上，要不要換版看的仍是「不同」。
 */
export function isOlder(version: string, than: string): boolean {
  const segments = (text: string) => text.split('.').map(part => (/^\d+$/.test(part) ? Number(part) : NaN))
  const [left, right] = [segments(version), segments(than)]
  if ([...left, ...right].some(Number.isNaN)) return false
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const gap = (left[i] ?? 0) - (right[i] ?? 0)
    if (gap !== 0) return gap < 0
  }
  return false
}

/** 「立即換上」：已下載時版本號那一列的按鈕，也是退版的詢問裡答應的那個選項 */
export const SWITCH_NOW = '立即換上'

/**
 * 換版時講的話：升版與退版各一套，句子裡的版本號都是要換過去的那一版。
 * 開場跳的提示（`…Notice`）與留在版本號那一列的標示（`…Label`）各有「還沒下載」與「已下載」兩句。
 */
export type Wording = {
  /** 提示：開場查到不同的版本、還沒下載（不必下載或下載失敗） */
  availableNotice: (to: string) => string
  /** 提示：開場在背景下載好了 */
  downloadedNotice: (to: string) => string
  /** 標示：還沒下載 */
  availableLabel: (to: string) => string
  /** 標示：已經下載、還沒換上 */
  downloadedLabel: (to: string) => string
  /** 換了之後開場講的那一句 */
  switched: (to: string) => string
  /** 「檢查版本」查到不同的版本時問的那一句 */
  question: (from: string, to: string) => string
  /** 詢問裡答應的那個選項 */
  accept: string
  /** 答應之後、下載期間講的那一句 */
  switching: (to: string) => string
}

const UPGRADE: Wording = {
  availableNotice: to => `cockpit 有新版 ${to}，到 [設定] 按「檢查版本」換上`,
  downloadedNotice: to => `cockpit ${to} 已下載，下次開啟時換上`,
  availableLabel: to => `有新版 ${to}`,
  downloadedLabel: to => `${to} 已下載，重開後換上`,
  switched: to => `cockpit 已更新到 ${to}`,
  question: (from, to) => `cockpit 發布的版本是 ${to}（目前 ${from}），要立即更新嗎？`,
  accept: '立即更新',
  switching: to => `正在更新到 cockpit ${to}…`,
}

// 退版多半自己下載，`availableNotice` 與 `availableLabel` 用在背景的下載失敗時
const ROLLBACK: Wording = {
  availableNotice: to => `cockpit 發布的版本已退回 ${to}，到 [設定] 按「檢查版本」換上`,
  downloadedNotice: to => `cockpit 發布的版本已退回 ${to}，已下載，下次開啟時換上`,
  availableLabel: to => `發布的版本已退回 ${to}`,
  downloadedLabel: to => `已退回 ${to}，重開後換上`,
  switched: to => `cockpit 已退回 ${to}`,
  question: (from, to) => `cockpit 發布的版本已退回 ${to}（目前 ${from}），要立即換上嗎？`,
  accept: SWITCH_NOW,
  switching: to => `正在退回 cockpit ${to}…`,
}

/** 從 `from` 換到 `to` 該用哪一套話：`to` 比較舊是作者退版，其餘（含比不出來）照升版 */
export const wordingFor = (from: string, to: string): Wording => (isOlder(to, from) ? ROLLBACK : UPGRADE)

/** 請 Claude Code 把 marketplace 的 clone 拉到最新 */
export const refreshCommand = ({ marketplace }: Install): string[] => ['claude', 'plugin', 'marketplace', 'update', marketplace]

/** 把 plugin 換成 marketplace 現在的那一版（下載到磁碟，跑著的不變） */
export const updateCommand = ({ id }: Install): string[] => ['claude', 'plugin', 'update', id]

/**
 * 更新指令失敗時的補救：裝成 marketplace 現在的那一版。只靠設定檔裝起來的那一份，Claude Code 還沒把它記成已安裝，
 * `claude plugin update` 會說 is not installed；裝一次就記下了，磁碟上也是發布的那一版。
 */
export const installCommand = ({ id }: Install): string[] => ['claude', 'plugin', 'install', id]

/** 詢問裡不答應的那個選項（答應的那個跟著升版或退版換，在 `Wording`） */
export const UPDATE_LATER = '先不要'

/** 開場檢查最少隔多久（毫秒）：一天開很多個 session 時不必每次都去看 */
export const CHECK_INTERVAL = 4 * 60 * 60 * 1000

/**
 * 開場之後等多久才開始檢查（毫秒）：開場該做的事都排出去、面板開出來之後才去看，檢查不能擋住面板的顯示。
 * 還沒在真的機器上量過檢查會讓面板慢多少，先用保守的做法。
 */
export const STARTUP_CHECK_DELAY = 3_000

/**
 * 開場該不該去看發布的版本：只有從 marketplace 裝的那一份，而且距離上次檢查滿 `CHECK_INTERVAL`。
 * `checkedAt` 是存起來的上次檢查時間，沒檢查過不是數字；比現在還晚（時鐘被調過）當作沒檢查過。
 * 手動按「檢查版本」不問這個。
 */
export const shouldCheck = (install: Install | undefined, checkedAt: unknown, now: number): boolean =>
  install !== undefined && !(typeof checkedAt === 'number' && checkedAt <= now && now - checkedAt < CHECK_INTERVAL)

/**
 * 開場查到不同的版本時要不要自己下載：「自動更新」開著就下載；關著時只有退版（發布的版本比裝的舊）下載，
 * 作者收回出事的版本時同事的機器才會自己跟著退回。這是「自動更新」關著也不經同意就下載的唯一情況，
 * 升版（含版本號比不出來的）關著就不下載。
 */
export const shouldDownload = (current: string, released: string, autoUpdate: boolean): boolean =>
  autoUpdate || isOlder(released, current)

/**
 * 發布的版本就是裝著的這一版時，要不要把磁碟換回發布的版本：已下載、還沒換上的是別的版本就要。
 * 那是作者發了又收回的版本，不換回去的話下次開啟會換上它。`downloaded` 是記著的已下載版本（沒有是空的）。
 */
export const shouldRestore = (current: string, downloaded: string): boolean => downloaded !== '' && downloaded !== current

/** 這個發布的版本要不要提示：每個發布的版本只提示一次，`notified` 是存起來的、已經提示過的那一版 */
export const shouldNotify = (released: string, notified: unknown): boolean => released !== notified

/**
 * 留在面板上的標示：`text` 接在版本號後面高亮顯示，那一列的按鈕跟著 `kind` 換。
 * - `available`：發布的版本和裝的不同、還沒下載；按鈕是「檢查版本」。
 * - `downloaded`：發布的版本已經下載、還沒換上；按鈕是「立即換上」（不必詢問，重新載入 mod 就換上）。
 * 升版與退版是同一種狀態，只差在 `text` 用哪一套話。
 */
export type Indicator = { kind: 'available' | 'downloaded'; text: string }

/** 分頁列的「設定」有標示時帶的記號 */
export const INDICATOR_MARK = '●'

/**
 * 該顯示哪一種標示；沒有是 undefined。`released` 是記著的、上次查到的發布版本，`downloaded` 是記著的、
 * 已經下載還沒換上的版本；沒有都是空的（存起來的值怎麼驗在 `remembered.ts`）。
 * 從資料夾載入的不標示；裝的和發布的一樣了標示就消失，使用者不能自己點掉。
 * 已下載只在下載的就是發布的那一版時算數：作者在這之間又發了別的版本，就照新的發布版本當作還沒下載。
 */
export function indicatorFor(seen: {
  install: Install | undefined
  current: string
  released: string
  downloaded: string
}): Indicator | undefined {
  const { install, current, released, downloaded } = seen
  if (install === undefined || current === '' || released === '' || released === current) return undefined
  const words = wordingFor(current, released)
  return downloaded === released
    ? { kind: 'downloaded', text: words.downloadedLabel(released) }
    : { kind: 'available', text: words.availableLabel(released) }
}
