/**
 * [SKILL] 的版號：plugin 從 `installed_plugins.json` 讀，`npx skills` 裝的從 lock 檔讀。
 * 那兩份都是別的工具的格式，讀不懂的部分當作沒有版號，不顯示就好。
 */

/** 一個版號：顯示的字（semver 前面加 v，commit 或雜湊取前 7 碼）與更新日期（`YYYY-MM-DD`，沒有就是 ''） */
export type SkillVersion = { label: string; date: string }

/** plugin 名稱 → 版號；`npx skills` 裝的 skill 名稱 → 版號 */
export type SkillVersions = { plugins: Record<string, SkillVersion>; skills: Record<string, SkillVersion> }

export const NO_VERSIONS: SkillVersions = { plugins: {}, skills: {} }

type Json = Record<string, unknown>
const isObject = (v: unknown): v is Json => v !== null && typeof v === 'object' && !Array.isArray(v)

function parse(text: string | undefined): Json | undefined {
  if (text === undefined) return undefined
  try {
    const data: unknown = JSON.parse(text)
    return isObject(data) ? data : undefined
  } catch {
    return undefined
  }
}

/** 版號的顯示字：十六進位的長字串（commit、資料夾雜湊）取前 7 碼，數字開頭的加 v，其他照原樣 */
export function versionLabel(raw: string): string {
  const v = raw.trim()
  if (/^[0-9a-f]{8,64}$/i.test(v)) return v.slice(0, 7)
  return /^\d/.test(v) ? `v${v}` : v
}

/** ISO 時間的日期部分；不像日期的當作沒有 */
const dateOf = (v: unknown): string => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : '')

/** `installed_plugins.json` 的 `{ plugins: { "<名稱>@<marketplace>": [{ version, lastUpdated }] } }`；同名的取第一筆 */
export function pluginVersions(text: string | undefined): Record<string, SkillVersion> {
  const plugins = parse(text)?.plugins
  if (!isObject(plugins)) return {}
  const out: Record<string, SkillVersion> = {}
  for (const [key, installs] of Object.entries(plugins)) {
    const name = key.split('@')[0] ?? ''
    const first: unknown = Array.isArray(installs) ? installs[0] : undefined
    if (name === '' || Object.hasOwn(out, name) || !isObject(first)) continue
    const raw = typeof first.version === 'string' ? first.version : typeof first.gitCommitSha === 'string' ? first.gitCommitSha : ''
    if (raw.trim() === '' || raw.trim() === 'unknown') continue
    out[name] = { label: versionLabel(raw), date: dateOf(first.lastUpdated) || dateOf(first.installedAt) }
  }
  return out
}

/** `npx skills` 的 lock 檔：`{ skills: { <名稱>: { skillFolderHash, updatedAt } } }` */
export function lockVersions(text: string | undefined): Record<string, SkillVersion> {
  const skills = parse(text)?.skills
  if (!isObject(skills)) return {}
  const out: Record<string, SkillVersion> = {}
  for (const [name, entry] of Object.entries(skills)) {
    if (!isObject(entry)) continue
    const raw = typeof entry.skillFolderHash === 'string' ? entry.skillFolderHash : typeof entry.computedHash === 'string' ? entry.computedHash : ''
    if (raw.trim() === '') continue
    out[name] = { label: versionLabel(raw), date: dateOf(entry.updatedAt) || dateOf(entry.installedAt) }
  }
  return out
}

/** 全域的 lock 檔與各專案的合併，規則和 `mergeSkillSources` 一樣：全域的優先，專案之間前面的優先 */
export function mergeLockVersions(
  globalVersions: Record<string, SkillVersion>,
  projects: readonly Record<string, SkillVersion>[],
): Record<string, SkillVersion> {
  return Object.assign({}, ...[...projects].reverse(), globalVersions)
}

/** 一個 skill 的版號：名稱有 `plugin:` 前綴的看 plugin，否則看 lock 檔；都查不到是 undefined */
export function versionOf(versions: SkillVersions, name: string): SkillVersion | undefined {
  const colon = name.indexOf(':')
  if (colon > 0) {
    const plugin = name.slice(0, colon)
    if (Object.hasOwn(versions.plugins, plugin)) return versions.plugins[plugin]
  }
  return Object.hasOwn(versions.skills, name) ? versions.skills[name] : undefined
}

/**
 * 一個組的版號：底下每個 skill 的版號都一樣才有（plugin 組、來源組通常是這樣；混了不同來源的自訂組沒有）。
 * 空的組（停用了的 plugin）照組的 id 查 plugin。
 */
export function groupVersion(versions: SkillVersions, id: string, names: readonly string[]): SkillVersion | undefined {
  if (names.length === 0) return Object.hasOwn(versions.plugins, id) ? versions.plugins[id] : undefined
  const first = versionOf(versions, names[0] ?? '')
  if (first === undefined) return undefined
  return names.every(n => {
    const v = versionOf(versions, n)
    return v !== undefined && v.label === first.label && v.date === first.date
  })
    ? first
    : undefined
}

/** 組名列浮出的那段字：`v1.3.1 · 10-12`（沒有日期就只有版號） */
export const groupVersionText = (v: SkillVersion): string => (v.date === '' ? v.label : `${v.label} · ${v.date.slice(5)}`)
