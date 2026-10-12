/**
 * 更新：發布的版本去哪裡看、這一份是從哪裡裝的、看完之後該做什麼。
 * 上網、讀檔與跑指令在 `register.tsx`（`$` 只能留在那裡）；這裡是不碰引擎的判斷，可以直接測。
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

/** 請 Claude Code 把 marketplace 的 clone 拉到最新 */
export const refreshCommand = ({ marketplace }: Install): string[] => ['claude', 'plugin', 'marketplace', 'update', marketplace]

/** 把 plugin 換成 marketplace 現在的那一版（下載到磁碟，跑著的不變） */
export const updateCommand = ({ id }: Install): string[] => ['claude', 'plugin', 'update', id]

/** 詢問要不要更新時的兩個選項 */
export const UPDATE_NOW = '立即更新'
export const UPDATE_LATER = '先不要'
