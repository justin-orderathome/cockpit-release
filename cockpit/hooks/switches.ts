/**
 * [SKILL] 的開關：哪些 skill 關著、怎麼改設定檔、按完說什麼。純邏輯，不碰引擎；
 * 讀寫檔案與畫面在 `register.tsx`。`register.tsx` 只用兩個入口：`switchboard`（這一次畫面上每個 skill、組、
 * 分類的狀態與按下去做什麼）與 `planSwitch`（按下去之後要寫什麼、要不要代跑重載、說什麼）。
 *
 * 開關的狀態只有一份：目前專案的 `.claude/settings.local.json` 裡的 `skillOverrides`，
 * 和 Claude Code 的 `/skills` 選單共用。cockpit 不另外記。
 */

import type { CommandEntry, FrontmatterEntry, SkillGroup, SkillItem, SkillOverrides } from '../types'
import { BUILTIN_SKILLS, MY_SKILLS, categorize, pluginOf } from './skills'
import type { SkillCategory } from './skills'
import { shortTokens } from './usage'

/** 開關寫在專案裡的哪個檔（相對於專案根目錄） */
export const LOCAL_SETTINGS = '.claude/settings.local.json'

/** cockpit 關掉一個 skill 時寫的值：模型看不到，使用者仍可 `/名稱` */
const OFF = 'user-invocable-only'

/**
 * 一個開關動作：一批 skill 一起開或關（單一 skill、整組、整個分類都是這種），
 * 或停用／啟用整個 plugin（`key` 是 `enabledPlugins` 的完整鍵 `<plugin>@<marketplace>`）。
 */
export type SwitchAction =
  | { kind: 'skills'; turn: 'on' | 'off'; names: readonly string[] }
  | { kind: 'plugin'; turn: 'on' | 'off'; key: string }

/** 改寫的結果：要寫的新內容、不必寫，或原本的檔讀不懂（不寫，請使用者自己檢查） */
export type Rewrite = { kind: 'write'; text: string } | { kind: 'unchanged' } | { kind: 'unreadable' }

type Json = Record<string, unknown>

const isObject = (v: unknown): v is Json => v !== null && typeof v === 'object' && !Array.isArray(v)

/**
 * 設定檔改寫：輸入 `settings.local.json` 原本的文字（沒有這個檔是 undefined）與一個動作，輸出改好的文字。
 * 只動 `skillOverrides` 或 `enabledPlugins` 裡相關的鍵，其他鍵與內容原樣保留（順序也不變）。
 */
export function rewriteSettings(text: string | undefined, action: SwitchAction): Rewrite {
  let data: Json = {}
  if (text !== undefined) {
    try {
      const parsed: unknown = JSON.parse(text)
      if (!isObject(parsed)) return { kind: 'unreadable' }
      data = parsed
    } catch {
      return { kind: 'unreadable' }
    }
  }
  const field = action.kind === 'skills' ? 'skillOverrides' : 'enabledPlugins'
  const old = data[field] ?? {}
  if (!isObject(old)) return { kind: 'unreadable' }
  const next: Json = { ...old }
  const isChanged = action.kind === 'skills' ? flipSkills(next, action) : flipPlugin(next, action)
  if (!isChanged) return { kind: 'unchanged' }
  const out: Json = { ...data, [field]: next }
  // 打開最後一個時，空的 skillOverrides／enabledPlugins 也不留
  if (Object.keys(next).length === 0) delete out[field]
  return { kind: 'write', text: `${JSON.stringify(out, null, 2)}\n` }
}

/**
 * 停用寫 `false`，啟用刪掉鍵（沒寫就照上層設定，平常就是開）；有改才回傳 true。
 * 同一個 plugin 可能從幾個 marketplace 裝，和 `isPluginOff` 一樣看它所有的鍵：
 * 任一個已經是 `false` 就算停了，不再寫；啟用時把它是 `false` 的鍵全部刪掉。
 */
function flipPlugin(next: Json, action: Extract<SwitchAction, { kind: 'plugin' }>): boolean {
  const plugin = pluginOfKey(action.key)
  const offKeys = Object.keys(next).filter(key => next[key] === false && pluginOfKey(key) === plugin)
  if (action.turn === 'off') {
    if (offKeys.length > 0) return false
    next[action.key] = false
    return true
  }
  for (const key of offKeys) delete next[key]
  return offKeys.length > 0
}

/** 關寫 `OFF`，開刪掉那個 skill 的鍵；有改才回傳 true */
function flipSkills(next: Json, action: Extract<SwitchAction, { kind: 'skills' }>): boolean {
  let isChanged = false
  for (const name of action.names) {
    if (action.turn === 'off' && !isSkillOff(name, next)) {
      next[name] = OFF
      isChanged = true
    }
    if (action.turn === 'on') {
      for (const key of overrideKeys(name)) {
        if (!Object.hasOwn(next, key)) continue
        delete next[key]
        isChanged = true
      }
    }
  }
  return isChanged
}

/**
 * 一個 skill 在 `skillOverrides` 可能用的鍵：完整名稱，以及帶命名空間時最後一個冒號後的短名。
 * claude.ai 同步的 skill 在清單裡叫 `anthropic-skills:pdf`，但寫 `pdf` 或 `anthropic-skills:pdf`
 * Claude Code 都認（實測）。plugin 的 skill 不會走到這裡：`skillOverrides` 管不到它們。
 */
function overrideKeys(name: string): string[] {
  const short = name.slice(name.lastIndexOf(':') + 1)
  return short === name || short === '' ? [name] : [name, short]
}

/** JSON 檔裡的一個物件欄位；沒有檔、讀不懂、欄位不在或不是物件時是空的 */
function objectField(text: string | undefined, field: string): Json {
  if (text === undefined) return {}
  try {
    const data: unknown = JSON.parse(text)
    return isObject(data) && isObject(data[field]) ? data[field] : {}
  } catch {
    return {}
  }
}

/** 讀 `settings.local.json` 的 `skillOverrides`；沒有檔、讀不懂或格式不對時當作全開。 */
export const readOverrides = (text: string | undefined): Record<string, unknown> => objectField(text, 'skillOverrides')

// ── 停用整個 plugin ──

/** Claude Code 記的已安裝 plugin 清單（cockpit 找 plugin 安裝目錄時讀的也是它），相對於使用者目錄 */
export const INSTALLED_PLUGINS = '.claude/plugins/installed_plugins.json'

/**
 * 不能停用的 plugin：cockpit 自己。停了面板就不見，也沒辦法從面板再打開。
 * cockpit 沒有 skill，本來就不會出現在 [SKILL] 的 plugin 組；這裡再擋一次，免得之後加了 skill 才出事。
 */
const SELF = 'cockpit'

/** 已安裝 plugin 的完整鍵（`<plugin>@<marketplace>`）；沒有檔、讀不懂或格式不對時是空的 */
export const installedPlugins = (text: string | undefined): string[] => Object.keys(objectField(text, 'plugins'))

const pluginOfKey = (key: string) => key.split('@')[0] ?? ''

/** 停用或啟用一個 plugin 要改的 `enabledPlugins` 鍵；不在已安裝清單裡、或是 cockpit 自己時沒有（不能按） */
export function pluginKey(plugin: string, installed: readonly string[]): string | undefined {
  if (plugin === SELF) return undefined
  return installed.find(key => pluginOfKey(key) === plugin)
}

/** 讀 `settings.local.json` 的 `enabledPlugins`；沒有檔、讀不懂或格式不對時當作都沒寫 */
export const readEnabledPlugins = (text: string | undefined): Record<string, unknown> =>
  objectField(text, 'enabledPlugins')

/** 這個 plugin 在這個專案停用了沒：`enabledPlugins` 裡它的鍵（任一個 marketplace）是 `false` */
export function isPluginOff(plugin: string, enabled: Readonly<Record<string, unknown>>): boolean {
  return Object.entries(enabled).some(([key, value]) => value === false && pluginOfKey(key) === plugin)
}

/**
 * 停用了、而且還裝著的 plugin 名稱。停用並重新載入後，它的 skill 就不在 `$.command.list()` 裡了，
 * 面板要靠這份名單畫出它的組，使用者才按得到「啟用」。
 */
export function disabledPlugins(enabled: Readonly<Record<string, unknown>>, installed: readonly string[]): string[] {
  const names = installed.filter(key => enabled[key] === false).map(pluginOfKey)
  return [...new Set(names)].filter(name => name !== SELF)
}

/**
 * 這一組是不是 plugin 組，是的話是哪個 plugin。plugin 組是來源分組替一個 plugin 開的那一組：
 * 組 id 就是 plugin 名稱，而且底下全是那個 plugin 的 skill。`move` 開的自訂組就算收了某個 plugin 的全部 skill
 * 也不是；混了別的 skill 的組也不是。空的組（停用後 skill 都不見了）看它是不是停用名單裡的 plugin。
 */
export function groupPlugin(
  id: string,
  names: readonly string[],
  owners: ReadonlyMap<string, string>,
  disabled: readonly string[],
): string | undefined {
  if (names.length === 0) return disabled.includes(id) ? id : undefined
  return names.every(name => owners.get(name) === id) ? id : undefined
}

/** 這些組裡有幾個 plugin 組（`groupPlugin` 的定義，含停用後空了的）：整個分類的開關不動它們 */
export const pluginGroupCount = (
  groups: readonly SkillGroup[],
  owners: ReadonlyMap<string, string>,
  disabled: readonly string[],
): number =>
  groups.filter(g => groupPlugin(g.id, g.items.map(s => s.name), owners, disabled) !== undefined).length

/**
 * 停用的 plugin 照樣有一組（空的）：組名照 `groups` 改的名字，插在其他組之間照 id 該在的位置（其他組的順序不動），
 * 「我的 skill」「內建 skill」照舊在最後。
 * 已經有那一組（還沒重新載入，skill 還在）或被 `hidden` 藏掉的不加。
 */
export function withDisabledPlugins(
  groups: readonly SkillGroup[],
  disabled: readonly string[],
  overrides: SkillOverrides,
): SkillGroup[] {
  const ids = new Set(groups.map(g => g.id))
  const hidden = new Set(overrides.hidden)
  const added: SkillGroup[] = disabled
    .filter(id => !ids.has(id) && !hidden.has(id))
    .map(id => ({ id, title: overrides.groups[id] ?? id, items: [] }))
  const isFixed = (g: SkillGroup) => g.id === MY_SKILLS || g.id === BUILTIN_SKILLS
  // 原本的組順序不動：新的組插在第一個 id 排在它後面的組（或「我的 skill」「內建 skill」）前面
  const result = [...groups]
  for (const g of added) {
    const at = result.findIndex(x => isFixed(x) || (!added.includes(x) && x.id.localeCompare(g.id) > 0))
    result.splice(at === -1 ? result.length : at, 0, g)
  }
  return result
}

/**
 * 停用或啟用 plugin 之後的提示；`reloadError` 是代跑 `/reload-plugins` 失敗的原因。
 * `isUnchanged`：設定檔本來就是那個狀態，沒有改，也就沒有代跑 `/reload-plugins`。
 */
export function pluginToast(done: {
  turn: 'on' | 'off'
  plugin: string
  reloadError?: string
  isUnchanged?: boolean
}): string {
  if (done.isUnchanged)
    return `plugin「${done.plugin}」本來就${done.turn === 'off' ? '停用了' : '啟用著'}，設定檔沒有改，沒有代跑 /reload-plugins`
  const what =
    done.turn === 'off'
      ? `已停用 plugin「${done.plugin}」：它的 skill、指令、hook、agent 在這個專案一起停了`
      : `已啟用 plugin「${done.plugin}」：它的 skill、指令、hook、agent 回來了`
  return done.reloadError === undefined
    ? `${what}；已代跑 /reload-plugins`
    : `${what}；但 /reload-plugins 沒跑成（${done.reloadError}），請自己跑一次`
}

/** plugin 的 skill（名稱帶 `plugin:` 前綴的）：`skillOverrides` 管不到，沒有單獨的開關，只能整個停用 plugin。 */
export function pluginSkills(commands: readonly CommandEntry[]): Set<string> {
  return new Set(skillPlugins(commands).keys())
}

/** plugin 的 skill 各屬哪個 plugin：skill 名稱 → plugin 名稱（引擎沒給就取名稱的前綴） */
export function skillPlugins(commands: readonly CommandEntry[]): Map<string, string> {
  return new Map(
    commands.flatMap(c => {
      const plugin = pluginOf(c)
      return plugin === undefined ? [] : [[c.name, plugin] as const]
    }),
  )
}

/** 這個 skill 在模型清單裡佔幾個 token，取自用量明細；同步的 skill 明細裡可能是短名。不在明細裡的是 undefined。 */
export function skillTokens(name: string, frontmatter: readonly FrontmatterEntry[]): number | undefined {
  for (const key of overrideKeys(name)) {
    const hit = frontmatter.find(f => f.name === key)
    if (hit?.tokens !== undefined) return hit.tokens
  }
  return undefined
}

/**
 * `settings.local.json` 是個人設定，不該進版控。cockpit 建立這個檔、而專案的 git 沒有忽略它時，
 * 把這一行加進 repo 本機的忽略清單（`.git/info/exclude`：只在這台機器生效，不改到要 commit 的 `.gitignore`）。
 */
export const IGNORE_LINE = '**/.claude/settings.local.json'

/** 忽略清單加上 `IGNORE_LINE` 後的內容；已經有這一行就照原樣。 */
export function withIgnoreLine(text: string | undefined): string {
  const old = text ?? ''
  if (old.split(/\r?\n/).some(line => line.trim() === IGNORE_LINE)) return old
  return `${old}${old === '' || old.endsWith('\n') ? '' : '\n'}${IGNORE_LINE}\n`
}

/** 加進忽略清單後跳的提示 */
export const IGNORED_NOTICE = `${LOCAL_SETTINGS} 是個人設定，已加進這個 repo 本機的 git 忽略清單（.git/info/exclude）`

/** 設定檔讀不懂時跳的提示 */
export const UNREADABLE_SETTINGS = `沒有改 ${LOCAL_SETTINGS}：這個檔不是合法的 JSON，請自己檢查後再按`

/**
 * 按完開關跳的提示。token 數從下一個 session 起才省下（或多出）；沒有數字就省略那一段。
 * `plugins`：關掉整個分類時，分類裡沒動到的 plugin 組有幾個（整個分類的開關不停用 plugin）。
 */
export function switchToast(done: {
  turn: 'on' | 'off'
  label: string
  count: number
  tokens?: number
  plugins?: number
}): string {
  const tokens = done.tokens === undefined ? undefined : shortTokens(done.tokens)
  const plugins = done.plugins ?? 0
  return done.turn === 'off'
    ? `已關閉「${done.label}」${done.count} 個 skill：模型現在叫不到` +
        (tokens === undefined ? '' : `，下個 session 起省約 ${tokens} tokens`) +
        '；已經載入的內容不受影響' +
        (plugins > 0 ? `。另有 ${plugins} 個 plugin 組沒動，要停用請按該組` : '')
    : `已打開「${done.label}」${done.count} 個 skill：模型現在叫得到` +
        (tokens === undefined ? '' : `，下個 session 起清單多約 ${tokens} tokens`)
}

/** 一批 skill 的 token 合計：有數字的那幾個加起來；一個數字都沒有時是 undefined。 */
export function tokensOf(names: readonly string[], frontmatter: readonly FrontmatterEntry[]): number | undefined {
  const known = names.map(name => skillTokens(name, frontmatter)).filter((n): n is number => n !== undefined)
  return known.length === 0 ? undefined : known.reduce((a, n) => a + n, 0)
}

/** 組與分類的開關狀態：不存，由底下的 skill 算出 */
export type SwitchState = 'on' | 'off' | 'partial'

/** 一批 skill（一組或一個分類裡可開關的那些）的狀況：開的數、總數、開著的 token 合計與狀態；沒有 skill 時沒有狀態 */
export type SwitchSummary = { on: number; total: number; tokens?: number; state?: SwitchState }

/**
 * 組與分類的狀況。`names` 是底下可開關的 skill（不含 plugin 的：分類只算非 plugin 的 skill，
 * plugin 組另外看整個 plugin 有沒有停用）。全開是「開」、全關是「關」、其餘是「部分」。
 */
export function summarize(
  names: readonly string[],
  overrides: Readonly<Record<string, unknown>>,
  frontmatter: readonly FrontmatterEntry[],
): SwitchSummary {
  const on = names.filter(name => !isSkillOff(name, overrides))
  // 底下有任何一個在明細裡就有數字（全關時是 0）；一個都不在明細裡才沒有
  const tokens = tokensOf(names, frontmatter) === undefined ? undefined : (tokensOf(on, frontmatter) ?? 0)
  const summary: SwitchSummary = { on: on.length, total: names.length, ...(tokens === undefined ? {} : { tokens }) }
  if (names.length === 0) return summary
  return { ...summary, state: on.length === names.length ? 'on' : on.length === 0 ? 'off' : 'partial' }
}

/** 按組或分類的開關：目前是開或部分就把開著的全部關掉，是關就全部打開。沒有可開關的 skill 時沒有動作。 */
export function flipAll(names: readonly string[], overrides: Readonly<Record<string, unknown>>): SwitchAction | undefined {
  if (names.length === 0) return undefined
  const on = names.filter(name => !isSkillOff(name, overrides))
  return on.length === 0 ? { kind: 'skills', turn: 'on', names: [...names] } : { kind: 'skills', turn: 'off', names: on }
}

/** 分類標題列：`<分類>：<開的數>/<總數> 開 · <N> tokens`；沒有可開關的 skill 時只寫名稱。 */
export function categoryTitle(name: string, summary: SwitchSummary): string {
  if (summary.total === 0) return name
  const tokens = summary.tokens === undefined ? '' : ` · ${shortTokens(summary.tokens)} tokens`
  return `${name}：${summary.on}/${summary.total} 開${tokens}`
}

/** 狀態寫成的字：組與分類開關按鈕上的字，分類分頁籤的標記也用它 */
const STATE_WORDS: Readonly<Record<SwitchState, string>> = { on: '開', off: '關', partial: '部分' }

/** 組與分類開關按鈕上的字：開、關、部分 */
export const stateLabel = (state: SwitchState): string => STATE_WORDS[state]

/** 分類分頁籤的字：整個分類關掉加「·關」，部分關掉加「·部分」。 */
export function tabLabel(name: string, state: SwitchState | undefined): string {
  return state === undefined || state === 'on' ? name : `${name}·${STATE_WORDS[state]}`
}

/** 這個 skill 關著沒：`skillOverrides` 裡它的值（任一種寫法的鍵）不是 `"on"` 就算關；沒寫就是開。 */
export function isSkillOff(name: string, overrides: Readonly<Record<string, unknown>>): boolean {
  return overrideKeys(name).some(key => Object.hasOwn(overrides, key) && overrides[key] !== 'on')
}

// ── 一次畫面上的開關：每個 skill、組、分類是什麼狀態，按下去做什麼 ──

/** 按一個開關要做的事：動作、提示裡的名稱（skill、組或分類），按整個分類時還有沒動到的 plugin 組有幾個 */
export type Press = { action: SwitchAction; label: string; plugins?: number }

/** 一個 skill：關著沒、token 數；plugin 的 skill 沒有單獨的開關（`press` 是 undefined），只能整個停用 plugin */
export type SkillSwitch = { isOff: boolean; tokens?: number; press?: Press }

/**
 * 一組：`isPlugin` 是 plugin 組（開關是停用整個 plugin）。`state` 是開、關或部分（plugin 組只有開或關；
 * 沒有可開關的 skill 時沒有）；`tokens` 是開著的 token 合計。沒有 `press` 是沒有開關可按
 * （沒有可開關的 skill，或 plugin 查不到完整的鍵、是 cockpit 自己）。
 */
export type GroupSwitch = { isPlugin: boolean; state?: SwitchState; tokens?: number; press?: Press }

/** 一個分類：只算非 plugin 的 skill；按了不動分類裡的 plugin 組 */
export type CategorySwitch = { summary: SwitchSummary; press?: Press }

export type Switchboard = {
  /** 列表要畫的組：停用了的 plugin 照樣有一組（空的），才按得到「啟用」 */
  groups: SkillGroup[]
  /** 照 `categories` 歸好的分類；沒有分類層是 undefined */
  categories: SkillCategory[] | undefined
  skill: (s: SkillItem) => SkillSwitch
  /** 搜尋時傳進來的是篩過的組，狀態照樣用整組算（看組 id） */
  group: (g: SkillGroup) => GroupSwitch
  /** 不存在的分類是 undefined */
  category: (name: string) => CategorySwitch | undefined
}

/**
 * [SKILL] 這一次畫面上所有開關的狀態與動作。組與分類的狀態不存，由底下可開關（非 plugin）的 skill 算出；
 * plugin 的 skill（move 混進一般組的也是）看它的 plugin 有沒有停用；plugin 組的開關是停用整個 plugin。
 * `groups` 是分好的組（不含停用的 plugin），`switches` 是 `skillOverrides`，`enabledPlugins` 是 `enabledPlugins`，
 * `installed` 是已安裝 plugin 的完整鍵。
 */
export function switchboard(seen: {
  commands: readonly CommandEntry[]
  frontmatter: readonly FrontmatterEntry[]
  overrides: SkillOverrides
  groups: readonly SkillGroup[]
  switches: Readonly<Record<string, unknown>>
  enabledPlugins: Readonly<Record<string, unknown>>
  installed: readonly string[]
}): Switchboard {
  const { frontmatter, switches, enabledPlugins } = seen
  const offPlugins = disabledPlugins(enabledPlugins, seen.installed)
  const groups = withDisabledPlugins(seen.groups, offPlugins, seen.overrides)
  const categories = categorize(groups, seen.overrides.categories)
  const owners = skillPlugins(seen.commands)
  const full = new Map(groups.map(g => [g.id, g]))
  const fullGroup = (g: SkillGroup) => full.get(g.id) ?? g
  const switchable = (gs: readonly SkillGroup[]) =>
    gs.flatMap(g => fullGroup(g).items.filter(s => !owners.has(s.name)).map(s => s.name))
  const pressAll = (names: readonly string[], label: string, plugins?: number): Press | undefined => {
    const action = flipAll(names, switches)
    return action === undefined ? undefined : { action, label, ...(plugins === undefined ? {} : { plugins }) }
  }

  return {
    groups,
    categories,
    skill(s) {
      const owner = owners.get(s.name)
      const tokens = skillTokens(s.name, frontmatter)
      const isOff = owner === undefined ? isSkillOff(s.name, switches) : isPluginOff(owner, enabledPlugins)
      return {
        isOff,
        ...(tokens === undefined ? {} : { tokens }),
        ...(owner !== undefined
          ? {}
          : { press: { action: { kind: 'skills', turn: isOff ? 'on' : 'off', names: [s.name] }, label: s.label } }),
      }
    },
    group(g) {
      const items = fullGroup(g).items.map(s => s.name)
      const plugin = groupPlugin(g.id, items, owners, offPlugins)
      if (plugin === undefined) {
        const names = switchable([g])
        const { state, tokens } = summarize(names, switches, frontmatter)
        const press = pressAll(names, g.title)
        return {
          isPlugin: false,
          ...(state === undefined ? {} : { state }),
          ...(tokens === undefined ? {} : { tokens }),
          ...(press === undefined ? {} : { press }),
        }
      }
      const isOff = isPluginOff(plugin, enabledPlugins)
      const key = pluginKey(plugin, seen.installed)
      const tokens = isOff ? undefined : tokensOf(items, frontmatter)
      return {
        isPlugin: true,
        state: isOff ? 'off' : 'on',
        ...(tokens === undefined ? {} : { tokens }),
        ...(key === undefined ? {} : { press: { action: { kind: 'plugin', turn: isOff ? 'on' : 'off', key }, label: plugin } }),
      }
    },
    category(name) {
      const c = categories?.find(x => x.name === name)
      if (c === undefined) return undefined
      const names = switchable(c.groups)
      const press = pressAll(names, name, pluginGroupCount(c.groups, owners, offPlugins))
      return { summary: summarize(names, switches, frontmatter), ...(press === undefined ? {} : { press }) }
    },
  }
}

/**
 * 按下一個開關之後怎麼做：`text` 是剛讀到的 `settings.local.json`（沒有檔是 undefined）。
 * - `write`：要寫進設定檔的新內容；不必寫或讀不懂時沒有。
 * - `isNewFile`：設定檔原本不存在，寫之前先把它加進 repo 本機的 git 忽略清單。
 * - `reload`：要代跑 `/reload-plugins`（停用或啟用 plugin 才要，skillOverrides 會熱重載）。
 *   設定檔本來就是那個狀態時不代跑：它會連 cockpit 一起重新載入。
 * - `toast`：做完之後的提示；`reloadError` 是代跑 `/reload-plugins` 失敗的原因。
 */
export type SwitchPlan = { write?: string; isNewFile: boolean; reload: boolean; toast: (reloadError?: string) => string }

export function planSwitch(text: string | undefined, press: Press, frontmatter: readonly FrontmatterEntry[]): SwitchPlan {
  const done = rewriteSettings(text, press.action)
  const base = { ...(done.kind === 'write' ? { write: done.text } : {}), isNewFile: text === undefined }
  const { action, label } = press
  if (done.kind === 'unreadable') return { ...base, reload: false, toast: () => UNREADABLE_SETTINGS }
  if (action.kind === 'plugin') {
    if (done.kind === 'unchanged')
      return { ...base, reload: false, toast: () => pluginToast({ turn: action.turn, plugin: label, isUnchanged: true }) }
    return {
      ...base,
      reload: true,
      toast: reloadError => pluginToast({ turn: action.turn, plugin: label, ...(reloadError === undefined ? {} : { reloadError }) }),
    }
  }
  // token 是有數字的那幾個的合計（和組、分類顯示的一樣）；一個都沒有才省略
  const tokens = tokensOf(action.names, frontmatter)
  const count = action.names.length
  return { ...base, reload: false, toast: () => switchToast({ turn: action.turn, label, count, tokens, plugins: press.plugins ?? 0 }) }
}
