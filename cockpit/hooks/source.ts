import type { CommandEntry } from '../types'
import { tidy } from './files'
import type { Files } from './files'

/**
 * 找一個 skill 的原文：作者寫的 SKILL.md；找不到檔案就用 description。
 * 整理用法時送給模型的就是這一份。
 * 定位規則都收在這裡，畫面與整理用法的流程不必知道檔案在哪。
 */

/** 找原文只讀不寫；路徑都是絕對路徑 */
export type SourceFs = Pick<Files, 'read' | 'list'>

/** 去哪裡找：使用者目錄，以及專案層 skill 可能在的目錄（啟動目錄、repo 根目錄），都用 / 分隔 */
export type SourceDirs = { home: string; projects: readonly string[] }

/** 找到的那個檔：路徑（用 / 分隔）與全文。教學要從它所在的資料夾找引用的檔 */
export type SkillFile = { path: string; text: string }

/** 原文與它的種類：`skill` 是 SKILL.md 的全文，`description` 是找不到檔案時改用的 description */
export type SkillSource = { text: string; kind: 'skill' | 'description' }

/** 原文的上限（UTF-8 位元組）；超過的截掉尾端 */
export const SOURCE_LIMIT = 60 * 1024

const SKILL_FILE = 'SKILL.md'

/** 名稱最後一個冒號之後的字串（`anthropic-skills:deep-research` 的目錄是 `deep-research`） */
const lastPart = (name: string) => name.slice(name.lastIndexOf(':') + 1)

/** 一個字的 UTF-8 位元組數；原文與教學原料的上限都用它算 */
export const charBytes = (ch: string) => {
  const code = ch.codePointAt(0) ?? 0
  return code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4
}

/** 空白的檔案也當作沒有 */
async function readFile(fs: SourceFs, path: string): Promise<string | undefined> {
  const text = await fs.read(path)
  return text === undefined || text.trim() === '' ? undefined : text
}

/** 一個目錄底下的子目錄名稱 */
async function listDirs(fs: SourceFs, path: string): Promise<readonly string[]> {
  return (await fs.list(path)).filter(e => e.kind === 'dir').map(e => e.name)
}

async function readJson(fs: SourceFs, path: string): Promise<Record<string, unknown> | undefined> {
  const text = await readFile(fs, path)
  if (text === undefined) return undefined
  try {
    const data: unknown = JSON.parse(text)
    return data !== null && typeof data === 'object' && !Array.isArray(data) ? (data as Record<string, unknown>) : undefined
  } catch {
    return undefined
  }
}

async function fileAt(fs: SourceFs, path: string): Promise<SkillFile | undefined> {
  const text = await readFile(fs, path)
  return text === undefined ? undefined : { path, text }
}

/** 依序試每個路徑，回傳第一個讀得到的 */
async function firstFile(fs: SourceFs, paths: readonly string[]): Promise<SkillFile | undefined> {
  for (const path of paths) {
    const file = await fileAt(fs, path)
    if (file !== undefined) return file
  }
  return undefined
}

/**
 * `user` 來源：使用者層 → claude.ai 同步的（`synced/` 底下的子目錄名稱不能寫死）→ 專案層。
 * 專案層排最後，因為同名時使用者層生效；專案層多包一層分類的目錄不會被 Claude Code 載入，不找。
 */
async function userFile(c: CommandEntry, dirs: SourceDirs, fs: SourceFs): Promise<SkillFile | undefined> {
  const name = lastPart(c.name)
  const root = `${tidy(dirs.home)}/.claude/skills`
  const own = await fileAt(fs, `${root}/${name}/${SKILL_FILE}`)
  if (own !== undefined) return own
  const buckets = await listDirs(fs, `${root}/synced`)
  const synced = await firstFile(fs, buckets.map(b => `${root}/synced/${b}/${name}/${SKILL_FILE}`))
  if (synced !== undefined) return synced
  return firstFile(fs, dirs.projects.map(p => `${tidy(p)}/.claude/skills/${name}/${SKILL_FILE}`))
}

/** plugin 的安裝目錄：`installed_plugins.json` 裡 key 在 `@` 之前等於 plugin 名稱的那筆 */
async function installPath(plugin: string, home: string, fs: SourceFs): Promise<string | undefined> {
  const installed = await readJson(fs, `${tidy(home)}/.claude/plugins/installed_plugins.json`)
  const plugins = installed?.plugins
  if (plugins === null || typeof plugins !== 'object') return undefined
  for (const [key, installs] of Object.entries(plugins)) {
    if (key.split('@')[0] !== plugin || !Array.isArray(installs)) continue
    const path: unknown = (installs[0] as { installPath?: unknown } | undefined)?.installPath
    if (typeof path === 'string' && path !== '') return tidy(path)
  }
  return undefined
}

/** manifest 的 `skills` 裡結尾為 `/<skill 名稱>` 的那條路徑（相對於安裝目錄）；往上跳或絕對路徑的不認 */
function manifestPath(skills: unknown, skill: string): string | undefined {
  if (!Array.isArray(skills)) return undefined
  for (const entry of skills) {
    if (typeof entry !== 'string') continue
    const path = tidy(entry).replace(/^(\.\/)+/, '')
    if (path.startsWith('/') || /^[A-Za-z]:/.test(path) || path.split('/').includes('..')) continue
    if (path === skill || path.endsWith(`/${skill}`)) return path
  }
  return undefined
}

/**
 * `plugin` 來源：一律從 `installPath` 進去，不用搜尋檔名的方式找。
 * 同一個 skill 在磁碟上常有多份（舊版本目錄、marketplace 的 clone、備份），生效的只有 `installPath` 指到的那一份。
 */
async function pluginFile(c: CommandEntry, dirs: SourceDirs, fs: SourceFs): Promise<SkillFile | undefined> {
  const colon = c.name.indexOf(':')
  const plugin = c.plugin ?? (colon > 0 ? c.name.slice(0, colon) : '')
  if (plugin === '') return undefined
  const base = await installPath(plugin, dirs.home, fs)
  if (base === undefined) return undefined
  const skill = c.name.slice(colon + 1)

  const manifest = await readJson(fs, `${base}/.claude-plugin/plugin.json`)
  const listed = manifestPath(manifest?.skills, skill)
  if (listed !== undefined) {
    const file = await fileAt(fs, `${base}/${listed}/${SKILL_FILE}`)
    if (file !== undefined) return file
  }
  const flat = await fileAt(fs, `${base}/skills/${skill}/${SKILL_FILE}`)
  if (flat !== undefined) return flat
  const categories = await listDirs(fs, `${base}/skills`)
  const nested = await firstFile(fs, categories.map(k => `${base}/skills/${k}/${skill}/${SKILL_FILE}`))
  if (nested !== undefined) return nested
  // 舊式指令
  return fileAt(fs, `${base}/commands/${skill}.md`)
}

/** 超過上限就截掉尾端；不切在一個字的中間 */
function clip(text: string): string {
  let bytes = 0
  let end = 0
  for (const ch of text) {
    bytes += charBytes(ch)
    if (bytes > SOURCE_LIMIT) return text.slice(0, end)
    end += ch.length
  }
  return text
}

/** 依來源找 SKILL.md 這個檔，先找到的就用；`builtin`、其他來源與找不到檔案的是 undefined。 */
export async function findSkillFile(c: CommandEntry, dirs: SourceDirs, fs: SourceFs): Promise<SkillFile | undefined> {
  return c.source === 'user' ? userFile(c, dirs, fs) : c.source === 'plugin' ? pluginFile(c, dirs, fs) : undefined
}

/**
 * 整理用法的原文：找得到 SKILL.md 就用它，找不到的改用 description。
 * 只讀 SKILL.md 本身，不讀它引用的參考檔。description 也是空的就沒有原文，回傳 undefined。
 */
export async function findSource(c: CommandEntry, dirs: SourceDirs, fs: SourceFs): Promise<SkillSource | undefined> {
  const file = await findSkillFile(c, dirs, fs)
  if (file !== undefined) return { text: clip(file.text), kind: 'skill' }
  return c.description.trim() === '' ? undefined : { text: clip(c.description), kind: 'description' }
}

/** 同一輪裡同一個路徑只讀一次、列一次（`installed_plugins.json`、manifest、`synced/` 每個 skill 都會用到） */
export function memoFs(fs: SourceFs): SourceFs {
  const reads = new Map<string, ReturnType<SourceFs['read']>>()
  const lists = new Map<string, ReturnType<SourceFs['list']>>()
  const once = <T>(seen: Map<string, Promise<T>>, path: string, load: () => Promise<T>): Promise<T> => {
    const hit = seen.get(path)
    if (hit !== undefined) return hit
    const made = load()
    seen.set(path, made)
    return made
  }
  return {
    read: path => once(reads, path, () => fs.read(path)),
    list: path => once(lists, path, () => fs.list(path)),
  }
}
