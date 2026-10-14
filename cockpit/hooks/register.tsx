import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type {
  CommandEntry,
  Effort,
  EffortLevel,
  FrontmatterEntry,
  PromptGroup,
  SkillGroup,
  SkillItem,
  SkillOverrides,
  Tab,
  TaskBoard,
  Ticket,
  UsageSnapshot,
} from '../types'
import { NO_CHANGELOG, changelogBeside, changelogIn, notesBetween, withNotes } from './changelog'
import { FIELDS, TABS, changedFields, parseSettings, rawValues, resetLabel } from './config'
import type { Field, Settings } from './config'
import type { Ask } from './ask'
import { rootedAt, safeFiles, tidy, under } from './files'
import type { Files } from './files'
import { composeFill } from './fill'
import { dateOf, ranShell, reasonOf, succeeded, wroteFile } from './events'
import { howtoCount, howtoItems, howtoReport, makeHowtos, storedHowtos, withoutStale } from './howto'
import type { HowtoRound, HowtoRun, Howtos } from './howto'
import { viewHowtoPage } from './howtoPage'
import { ROW_GAP, chrome, fitText, foldLabel, footPlan, gridRows, gridSlots, keysWidth, layout, tabBar as tabBarOf, textWidth } from './layout'
import type { Row } from './layout'
import { singleJob } from './once'
import { SAMPLE_PROMPTS, parsePrompts, withProject } from './prompts'
import {
  INDICATOR_MARK,
  RELEASE_MANIFEST,
  STARTUP_CHECK_DELAY,
  SWITCH_NOW,
  UPDATE_LATER,
  catalogPath,
  indicatorFor,
  installCommand,
  installedFrom,
  marketplaceDir,
  refreshCommand,
  releasedManifest,
  shouldCheck,
  shouldDownload,
  shouldNotify,
  shouldRestore,
  updateCommand,
  verdict,
  versionIn,
  wordingFor,
} from './release'
import type { Indicator, Install, Verdict } from './release'
import {
  justReloaded,
  startTab,
  storedCategory,
  storedList,
  storedTranslations,
  storedVersion,
  toggled,
  versionChanged,
} from './remembered'
import { TRACKER_DOC, roadmapWatch, touchesRoadmap, trackerRoot, viewRoadmap } from './roadmap'
import type { RoadmapEvent } from './roadmap'
import {
  EMPTY_OVERRIDES,
  NO_SOURCES,
  SAMPLE_OVERRIDES,
  categorize,
  groupSkills,
  listedCommands,
  mergeSkillSources,
  parseOverrides,
  parseSkillLock,
  skillView,
} from './skills'
import type { SkillSources } from './skills'
import { findSkillFile } from './source'
import {
  GROUP_STATE_TAIL,
  GROUP_SWITCH_TAIL,
  IGNORED_NOTICE,
  INSTALLED_PLUGINS,
  LOCAL_SETTINGS,
  PLUGIN_SWITCH_TAIL,
  SWITCH_TAIL,
  TOKENS_TAIL,
  UNREADABLE_SETTINGS,
  categoryTitle,
  disabledPlugins,
  flipAll,
  groupPlugin,
  installedPlugins,
  isPluginOff,
  isSkillOff,
  pluginGroupCount,
  pluginKey,
  pluginSkills,
  pluginToast,
  readEnabledPlugins,
  readOverrides,
  rewriteSettings,
  skillPlugins,
  skillTokens,
  stateLabel,
  summarize,
  switchToast,
  tabLabel,
  tokensOf,
  withDisabledPlugins,
  withIgnoreLine,
} from './switches'
import type { SwitchAction, SwitchSummary } from './switches'
import { tutorialPath, tutorialState, writeTutorial } from './tutorial'
import type { TutorialState, TutorialTarget } from './tutorial'
import type { Elements, TabContent, TabContext } from './tab'
import { EMPTY_BOARD, applyTask, formatDuration, hasRunning, taskCells, taskColumns, timeStamp, viewTasks } from './tasks'
import type { TaskEvent, TaskView } from './tasks'
import { translateAll } from './translate'
import type { Translations } from './translate'
import { USAGE_HINT, checkAlerts, chipArea, chipColor, chipParts, shortTokens } from './usage'

/**
 * 面板裡所有會碰到引擎的程式都在這個檔案，這是引擎的規定：`$` 只能傳給同一個檔案裡宣告的函式，
 * atom 也要寫在用它的檔案裡，兩者都不會跟著 import 進別的檔案。由上到下分四段：
 *
 * 1. 狀態：畫面上的資料與目前的設定。
 * 2. 動作：讀資料寫進狀態、切換、填入、開檔。
 * 3. 四個分頁：各是一個函式，回傳 `TabContent`（固定在頂端與底端的行，加上要分頁的行）。
 * 4. `register`：登記 hook，並畫外框（「狀態」框、分頁列、說明欄、翻頁鍵）。
 *
 * 不碰引擎的部分各有自己的檔案：行數與欄數的預算在 `layout.ts`，每一列顯示什麼在 `tasks.ts`
 * 與 `roadmap.ts`，路線圖何時重讀也在 `roadmap.ts`；讀寫檔案的方式在 `files.ts`，
 * 跨 session 記住什麼在 `remembered.ts`，引擎的事件代表什麼在 `events.ts`。
 */

// ══ 狀態：畫面上的資料（`$.state` 的 atom）與目前的設定 ══════════════════════════

const PANE = 'cockpit'
const TITLE = 'Cockpit'

const MODELS = ['opus', 'sonnet', 'haiku', 'fable'] as const
const EFFORTS: readonly EffortLevel[] = ['low', 'medium', 'high', 'xhigh', 'max']
const PROJECT_PROMPTS = '.claude/prompts.md'

const model = atom({ plugin: 'cockpit', key: 'model' } as const, '')
const effort = atom({ plugin: 'cockpit', key: 'effort' } as const, '')
const chosenEffort = atom({ plugin: 'cockpit', key: 'chosenEffort' } as const, '')
const switching = atom({ plugin: 'cockpit', key: 'switching' } as const, '' as '' | 'model' | 'effort')
const usage = atom({ plugin: 'cockpit', key: 'usage' } as const, { rateLimits: [] } as UsageSnapshot)
const alerted = atom({ plugin: 'cockpit', key: 'alerted' } as const, [] as string[])
const minute = atom({ plugin: 'cockpit', key: 'minute' } as const, 0)
const board = atom({ plugin: 'cockpit', key: 'board' } as const, EMPTY_BOARD as TaskBoard)
const tick = atom({ plugin: 'cockpit', key: 'tick' } as const, 0)
const tab = atom({ plugin: 'cockpit', key: 'tab' } as const, 'tasks' as Tab)
const pages = atom(
  { plugin: 'cockpit', key: 'pages' } as const,
  { tasks: 0, basic: 0, skill: 0, settings: 0 } as Record<Tab, number>,
)
const prompts = atom({ plugin: 'cockpit', key: 'prompts' } as const, [] as PromptGroup[])
const hasProjectPrompts = atom({ plugin: 'cockpit', key: 'hasProjectPrompts' } as const, false)
const closedPromptGroups = atom({ plugin: 'cockpit', key: 'closedPromptGroups' } as const, [] as string[])
const commands = atom({ plugin: 'cockpit', key: 'commands' } as const, [] as CommandEntry[])
const frontmatter = atom({ plugin: 'cockpit', key: 'frontmatter' } as const, [] as FrontmatterEntry[])
const overrides = atom({ plugin: 'cockpit', key: 'overrides' } as const, EMPTY_OVERRIDES as SkillOverrides)
const skillSources = atom({ plugin: 'cockpit', key: 'skillSources' } as const, NO_SOURCES as SkillSources)
const openSkillGroups = atom({ plugin: 'cockpit', key: 'openSkillGroups' } as const, [] as string[])
const switchMode = atom({ plugin: 'cockpit', key: 'switchMode' } as const, false)
const skillSwitches = atom({ plugin: 'cockpit', key: 'skillSwitches' } as const, {} as Record<string, unknown>)
const pluginSwitches = atom({ plugin: 'cockpit', key: 'pluginSwitches' } as const, {} as Record<string, unknown>)
const installedPluginKeys = atom({ plugin: 'cockpit', key: 'installedPluginKeys' } as const, [] as string[])
/** [SKILL] 選中的分類名稱；'' 或已經不存在的分類就看第一個。跨 session 記住 */
const skillCategory = atom({ plugin: 'cockpit', key: 'skillCategory' } as const, '')
const search = atom({ plugin: 'cockpit', key: 'search' } as const, '')
const translations = atom({ plugin: 'cockpit', key: 'translations' } as const, {} as Translations)
const howtos = atom({ plugin: 'cockpit', key: 'howtos' } as const, {} as Howtos)
const howtoPage = atom({ plugin: 'cockpit', key: 'howtoPage' } as const, '')
const makingHowtos = atom({ plugin: 'cockpit', key: 'makingHowtos' } as const, false)
const howtoMenu = atom({ plugin: 'cockpit', key: 'howtoMenu' } as const, false)
const NO_TUTORIAL = { name: '', status: 'unavailable' } as const
const tutorial = atom({ plugin: 'cockpit', key: 'tutorial' } as const, NO_TUTORIAL as { name: string; status: TutorialState })
const makingTutorial = atom({ plugin: 'cockpit', key: 'makingTutorial' } as const, '')
const tutorialMenu = atom({ plugin: 'cockpit', key: 'tutorialMenu' } as const, false)
const roadmap = atom({ plugin: 'cockpit', key: 'roadmap' } as const, [] as Effort[])
const openEfforts = atom({ plugin: 'cockpit', key: 'openEfforts' } as const, [] as string[])
/** 路線圖裡手動攤開或收起過的組與「已結案」；只記這個 session，重開回到預設 */
const roadmapFolds = atom({ plugin: 'cockpit', key: 'roadmapFolds' } as const, {} as Record<string, boolean>)
const showDoneEfforts = atom({ plugin: 'cockpit', key: 'showDoneEfforts' } as const, false)
/** 上次查到的發布版本，留著的標示看它；'' 是還沒查到過。只有從 marketplace 裝的那一份會寫 */
const releasedVersion = atom({ plugin: 'cockpit', key: 'releasedVersion' } as const, '')
/** 已經下載、還沒換上的版本，標示是不是「已下載」看它；'' 是沒有 */
const downloadedVersion = atom({ plugin: 'cockpit', key: 'downloadedVersion' } as const, '')

/**
 * 目前的設定：`settings` 是解析過的值，`raw` 是 userConfig 存的原始字串（[設定] 的下拉選單用）。
 * userConfig 一改，模組就重載，`register` 會拿到新的 options 寫進這裡。
 */
const config: { settings: Settings; raw: Record<Field, string> } = {
  settings: parseSettings(undefined),
  raw: rawValues(undefined),
}

// ══ 動作：讀資料寫進狀態、切換模型與分頁、填入輸入框、開檔、存設定 ══════════════

// 三件背景工作各自同一時間只跑一件（模組重載時重來）：翻譯說明、整理用法、產生教學
const translating = singleJob()
const howtoRound = singleJob()
const tutorialJob = singleJob()
// 這個 session 已經自動整理過一輪用法；之後要再整理就由使用者按「更新用法」
let hasMadeHowtos = false
// 打開用法頁之前，[SKILL] 列表停在第幾頁；返回時翻回去
let skillListPage = 0
// 路線圖什麼時候要重讀，由 roadmap 自己記（模組重載時重來）
const freshRoadmap = roadmapWatch()

// 以下是為了少問引擎而記在模組裡的東西；模組重載時重來，session.start 時也清掉。
/** 整個 session 不會變的兩個目錄：問過一次就記著 */
const dirs: { home?: string; root?: { path: string | undefined } } = {}
/** effort 放在哪個目錄：undefined 是還沒看過 tracker 文件，null 是文件說沒有本機目錄 */
let roadmapDir: string | null | undefined
/** 目前畫面上的路線圖（JSON）；讀到一樣的就不寫，不必重畫 */
let shownRoadmap: string | undefined
/** 目前畫面上的用量（JSON）與已提醒過的門檻，一樣就不寫 */
let shownUsage: string | undefined
/** 上次記下的實際深度；一樣就不必讀狀態 */
let lastEffort: string | undefined
/** 這個 session 問過模型、但沒翻成的說明：不再重問（下個 session 再試） */
const missedTranslations = new Set<string>()
/** 內建 skill 的名稱來自用量明細，一個 session 問一次就夠 */
let hasFrontmatter = false
/** 每秒重畫耗時的計時器：只有在有進行中的任務時才開著 */
let ticker: { cancel: () => void } | undefined
/** 上一秒畫面上會隨時間變的字；一樣就不重畫 */
let shownTimes = ''
/** 用法每整理好幾個才存一次（整份快取每次都要重寫） */
const HOWTO_SAVE_EVERY = 10

// ── 模型與深度 ───────────────────────────────────────────

/** 從 /config 的列或 settings 讀出使用者選的深度，兩者皆無則回傳 ''。 */
async function readEffort($: EngineInterface): Promise<string> {
  try {
    const row = (await $.config.list()).find(r => /effort/i.test(r.key))
    if (typeof row?.value === 'string' && row.value) return row.value
  } catch {}
  try {
    const level = (await $.settings.read()).effortLevel
    if (typeof level === 'string' && level) return level
  } catch {}
  return ''
}

/** 重新讀取模型；選的深度只在尚未得知時才從設定補上，之後以 /effort 的參數為準。 */
async function refresh($: EngineInterface) {
  const current = await $.session.model()
  await update($, model, () => current)
  if ((await read($, chosenEffort)) !== '') return
  const level = await readEffort($)
  if (level) await update($, chosenEffort, known => known || level)
}

/** 以 slash command 切換，完成後更新顯示。 */
async function switchTo($: EngineInterface, command: 'model' | 'effort', value: string) {
  await update($, switching, () => command)
  try {
    await $.command.run({ command, args: value })
    if (command === 'effort') await update($, chosenEffort, () => value)
    await refresh($)
    $.ui.toast(`${command === 'model' ? '模型' : '深度'}已切換為 ${value}`)
  } catch (err) {
    $.ui.toast(`切換失敗：${reasonOf(err)}`)
  } finally {
    await update($, switching, () => '')
  }
}

// ── 用量 ─────────────────────────────────────────────────

/** 引擎回報的用量 → 面板存的用量：上下文的百分比、已用與窗口，以及各個額度 */
const usageOf = (reported: {
  context: { percent?: number; tokens?: number; window: number }
  rateLimits: UsageSnapshot['rateLimits']
}): UsageSnapshot => ({
  contextPercent: reported.context.percent,
  contextTokens: reported.context.tokens,
  contextWindow: reported.context.window,
  rateLimits: reported.rateLimits,
})

/** 寫入用量並依 toast 門檻提醒；`isFirst` 時只記下已超過的，不跳 toast。 */
async function applyUsage($: EngineInterface, snapshot: UsageSnapshot, isFirst: boolean) {
  // 一樣的用量不必再寫（寫了就重畫）
  const json = JSON.stringify(snapshot)
  if (json !== shownUsage) {
    shownUsage = json
    await update($, usage, () => snapshot)
  }
  const before = await read($, alerted)
  const checked = checkAlerts(snapshot, config.settings.toast, before, isFirst)
  if (checked.alerted.join('\n') !== before.join('\n')) await update($, alerted, () => checked.alerted)
  for (const text of checked.toasts) $.ui.toast(text)
}

async function loadUsage($: EngineInterface) {
  try {
    const u = await $.session.usage()
    await applyUsage($, usageOf(u), true)
  } catch {}
}

// ── 檔案 ─────────────────────────────────────────────────

/** 使用者目錄，用 / 分隔。 */
async function homeDir($: EngineInterface): Promise<string> {
  dirs.home ??= tidy((await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? '~')
  return dirs.home
}

/** 引擎的檔案操作包成面板唯一的檔案 interface：讀不到是 undefined、列不出來是空的 */
const files = ($: EngineInterface): Files =>
  safeFiles({
    read: path => $.fs.read(path),
    list: path => $.fs.list(path),
    write: (path, text) => $.fs.write(path, text),
  })

/** 專案根目錄（啟動 session 的目錄，不跟著 shell `cd` 走），用 / 分隔；問不到是 undefined */
async function projectRoot($: EngineInterface): Promise<string | undefined> {
  if (dirs.root !== undefined) return dirs.root.path
  let path: string | undefined
  try {
    const root = await $.session.root()
    path = root === '' ? undefined : tidy(root)
  } catch {}
  dirs.root = { path }
  return path
}

/** 專案裡的檔案：相對路徑一律從專案根目錄算；問不到根目錄才退回工作目錄 */
const projectFiles = async ($: EngineInterface): Promise<Files> => rootedAt(files($), await projectRoot($))

/** 專案層 skill 可能在的目錄：專案根目錄與 repo 根目錄；都問不到就用相對路徑（工作目錄）。 */
async function projectDirs($: EngineInterface): Promise<string[]> {
  const dirs: string[] = []
  const root = await projectRoot($)
  if (root !== undefined) dirs.push(root)
  try {
    const repo = await $.session.repo()
    if (repo !== null && repo.root !== '') dirs.push(tidy(repo.root))
  } catch {}
  return dirs.length > 0 ? [...new Set(dirs)] : ['.']
}

/** 去哪裡找 skill 的檔案、怎麼讀：整理用法與教學都從這裡拿。 */
async function skillFiles($: EngineInterface): Promise<{ dirs: { home: string; projects: string[] }; fs: Files }> {
  return { dirs: { home: await homeDir($), projects: await projectDirs($) }, fs: files($) }
}

/** 問模型一次的方式；沒回答時把引擎給的原因帶回去。 */
function askModel($: EngineInterface, model: 'haiku' | 'sonnet', maxTokens: number): Ask {
  return async ({ system, prompt }) => {
    // 翻譯與整理是照規則摘，不必多想；教學要寫長文，用模型預設的深度
    const reply = await $.model.complete({ model, system, prompt, maxTokens, ...(model === 'haiku' ? { effort: 'low' as const } : {}) })
    return reply.isAnswered ? { text: reply.text } : { reason: String(reply.reason) }
  }
}

// 這份 cockpit 的版本（plugin.json 寫的）；第一次要顯示時讀一次，讀不到就是空的（模組重載時重來）
let pluginVersion: string | undefined

async function readVersion($: EngineInterface): Promise<string> {
  if (pluginVersion !== undefined) return pluginVersion
  let version = ''
  try {
    version = versionIn(await files($).read(`${tidy($.plugin.root)}/.claude-plugin/plugin.json`))
  } catch {}
  pluginVersion = version
  return version
}

// 這一份是從哪裡裝的；問過一次就記著（模組重載時重來）
let installed: { from: Install | undefined } | undefined

/**
 * 這一份是從哪個 marketplace 裝的；從資料夾載入的是 undefined。
 * 面板測試不能指定 plugin 的資料夾，要假裝成裝來的就設環境變數 `COCKPIT_TEST_PLUGIN_ROOT`，值是假裝的資料夾
 * （`…/plugins/cache/<marketplace>/<plugin>/<版本>`）。只拿來判斷這一份是從哪裡裝的，讀檔仍然讀真的資料夾；
 * 沒設（正式環境）就看真的資料夾。
 */
async function installOf($: EngineInterface): Promise<Install | undefined> {
  if (installed !== undefined) return installed.from
  let pretended: string | undefined
  try {
    // 引擎規定變數名稱要直接寫成字面值
    pretended = await $.env.get('COCKPIT_TEST_PLUGIN_ROOT')
  } catch {}
  installed = { from: installedFrom(pretended ?? $.plugin.root) }
  return installed.from
}

/** 現在該留著哪一種標示（版本號那一列與分頁列的「設定」都看它）；沒有是 undefined。 */
async function shownIndicator($: EngineInterface): Promise<Indicator | undefined> {
  const [released, downloaded] = await Promise.all([read($, releasedVersion), read($, downloadedVersion)])
  return indicatorFor({ install: await installOf($), current: await readVersion($), released, downloaded })
}

// 記著的兩個版本各寫兩處：`$.store`（給下次開場）與 atom（讓面板上的標示跟著換）。
// atom 一樣的不必再寫（寫了就重畫）；`update` 的對象要寫明是哪個 atom，所以兩份各寫一個函式

/** 記下這次查到的發布版本。 */
async function rememberReleased($: EngineInterface, version: string) {
  await $.store.set('releasedVersion', version)
  if ((await read($, releasedVersion)) !== version) await update($, releasedVersion, () => version)
}

/** 記下已經下載、還沒換上的是哪一版（`null` 是沒有）。 */
async function rememberDownloaded($: EngineInterface, version: string | null) {
  await $.store.set('downloadedVersion', version)
  if ((await read($, downloadedVersion)) !== (version ?? '')) await update($, downloadedVersion, () => version ?? '')
}

/**
 * 用 VS Code 開檔；檔案不存在時先寫入範例。`opened` 是開成功時要說的話，沒給就說開了哪個檔。
 * 相對路徑是專案裡的檔案，從專案根目錄算（shell `cd` 到別處也開得到）；說給使用者聽的還是原本那個短的。
 */
async function openInEditor($: EngineInterface, shown: string, sample?: string, opened?: string) {
  const path = under(await projectRoot($), shown)
  try {
    if (sample !== undefined && (await files($).read(path)) === undefined) await $.fs.write(path, sample)
    const isWindows = (await $.env.get('OS')) === 'Windows_NT'
    const argv = isWindows ? ['cmd', '/c', 'code', path] : ['code', path]
    const ran = await $.process.run(argv)
    $.ui.toast(ran.exitCode === 0 ? (opened ?? `已開啟 ${shown}`) : `無法開啟 ${shown}：${ran.stderr.trim() || ran.exitCode}`)
  } catch (err) {
    $.ui.toast(`無法開啟 ${shown}：${reasonOf(err)}`)
  }
}

async function loadPrompts($: EngineInterface) {
  const home = await homeDir($)
  const global = parsePrompts((await files($).read(`${home}/.claude/cockpit/prompts.md`)) ?? '', 'global')
  const projectText = await (await projectFiles($)).read(PROJECT_PROMPTS)
  await update($, hasProjectPrompts, () => projectText !== undefined)
  await update($, prompts, () => withProject(global, parsePrompts(projectText ?? '', 'project')))
}

async function loadSkills($: EngineInterface) {
  try {
    const list = await $.command.list()
    await update($, commands, () =>
      list.map(c => ({ name: c.name, description: c.description, source: c.source, plugin: c.plugin })),
    )
  } catch {}
  if (!hasFrontmatter) {
    try {
      const u = await $.session.usage({ breakdown: 'summary' })
      const fm = u.context.breakdown?.skills?.skillFrontmatter ?? []
      await update($, frontmatter, () =>
        fm.map(f => ({ name: f.name, source: f.source, pluginName: f.pluginName, tokens: f.tokens })),
      )
      hasFrontmatter = true
    } catch {}
  }
  // 開關的狀態只看專案的 settings.local.json；每次切到 [SKILL] 都重讀，/skills 選單改的也看得到
  await loadSwitches($)
  const home = await homeDir($)
  // plugin 組的開關要用完整的鍵；停用了的 plugin 也靠這份清單畫出它的組
  const installed = installedPlugins(await files($).read(`${home}/${INSTALLED_PLUGINS}`))
  await update($, installedPluginKeys, () => installed)
  const text = await files($).read(`${home}/.claude/cockpit/skills.json`)
  await update($, overrides, () => (text === undefined ? EMPTY_OVERRIDES : parseOverrides(text)))
  // 用 npx skills 裝的 skill 從哪裡來；沒用過 npx skills 就沒有這個檔
  const lock = await files($).read(`${home}/.agents/.skill-lock.json`)
  // 裝在專案裡的（不加 -g）記在專案根目錄的 skills-lock.json；根目錄和找專案 skill 原文時用同一份清單
  const projectLocks = await Promise.all(
    (await projectDirs($)).map(async dir => parseSkillLock(await files($).read(under(dir, 'skills-lock.json')))),
  )
  await update($, skillSources, () => mergeSkillSources(parseSkillLock(lock), projectLocks))
  // 用法排在說明的翻譯之後才整理；兩個開關各管各的
  void (async () => {
    if (config.settings.translate) await translateSkills($)
    // 用法一個 session 只自動整理一輪：每次切到 [SKILL] 都重跑的話，模型沒回應時會一直重問
    if (config.settings.howto && !hasMadeHowtos) {
      hasMadeHowtos = true
      await makeSkillHowtos($, 'auto')
    }
  })()
}

// ── SKILL 的開關 ─────────────────────────────────────────

/** 讀專案的 settings.local.json，把 skillOverrides 與 enabledPlugins 寫進狀態；回傳讀到的原文（沒有檔是 undefined）。 */
async function loadSwitches($: EngineInterface): Promise<string | undefined> {
  const text = await (await projectFiles($)).read(LOCAL_SETTINGS)
  await showSwitches($, text)
  return text
}

async function showSwitches($: EngineInterface, text: string | undefined) {
  await update($, skillSwitches, () => readOverrides(text))
  await update($, pluginSwitches, () => readEnabledPlugins(text))
}

/**
 * 專案的 git 沒有忽略 settings.local.json 時，加進 repo 本機的忽略清單。
 * 不是 git repo、git 不能跑或已經忽略了都不做事；這一步失敗不擋開關本身。
 */
async function ignoreLocalSettings($: EngineInterface) {
  const root = await projectRoot($)
  const cwd = root === undefined ? {} : { cwd: root }
  try {
    const checked = await $.process.run(['git', 'check-ignore', '-q', LOCAL_SETTINGS], cwd)
    // 0：已經忽略；1：沒有忽略；其他（128 是不在 repo 裡）都不動
    if (checked.exitCode !== 1) return
    const found = await $.process.run(['git', 'rev-parse', '--git-path', 'info/exclude'], cwd)
    const path = found.stdout.trim()
    if (found.exitCode !== 0 || path === '') return
    const exclude = under(root, path)
    const old = await files($).read(exclude)
    const next = withIgnoreLine(old)
    if (next === old) return
    await files($).write(exclude, next)
    $.ui.toast(IGNORED_NOTICE)
  } catch {}
}

/**
 * 照一個開關動作改專案的 settings.local.json，重讀狀態並跳提示。`label` 是提示裡的名稱（skill、組或分類）；
 * `plugins` 是按整個分類時沒動到的 plugin 組有幾個。
 */
async function applySwitch($: EngineInterface, action: SwitchAction, label: string, plugins = 0) {
  const text = await loadSwitches($)
  const done = rewriteSettings(text, action)
  if (done.kind === 'unreadable') return void $.ui.toast(UNREADABLE_SETTINGS)
  if (done.kind === 'write') {
    try {
      if (text === undefined) await ignoreLocalSettings($)
      await (await projectFiles($)).write(LOCAL_SETTINGS, done.text)
    } catch (err) {
      return void $.ui.toast(`無法寫入 ${LOCAL_SETTINGS}：${reasonOf(err)}`)
    }
    await showSwitches($, done.text)
  }
  if (action.kind === 'plugin') {
    // 設定檔本來就是那個狀態：沒有東西要套用，不代跑 /reload-plugins（它會連 cockpit 一起重新載入）
    if (done.kind === 'unchanged')
      return void $.ui.toast(pluginToast({ turn: action.turn, plugin: label, isUnchanged: true }))
    return applyPlugin($, action.turn, label)
  }
  // token 是有數字的那幾個的合計（和組、分類顯示的一樣）；一個都沒有才省略
  const tokens = tokensOf(action.names, await read($, frontmatter))
  $.ui.toast(switchToast({ turn: action.turn, label, count: action.names.length, tokens, plugins }))
}

/**
 * plugin 的停用／啟用要 `/reload-plugins` 才套用到這個 session（skillOverrides 不用，設定檔會熱重載）。
 * 代跑之後重讀指令清單：停用的 plugin 的 skill 不見了，組改由停用名單畫出來。
 * 這會連 cockpit 自己一起重新載入；先跳提示，換上的新那一份照樣讀得到設定檔。
 */
async function applyPlugin($: EngineInterface, turn: 'on' | 'off', plugin: string) {
  let reloadError: string | undefined
  try {
    await $.command.run({ command: 'reload-plugins' })
  } catch (err) {
    reloadError = reasonOf(err)
  }
  $.ui.toast(pluginToast({ turn, plugin, ...(reloadError === undefined ? {} : { reloadError }) }))
  await loadSkills($)
}

/**
 * 把 SKILL 說明交給 haiku 翻成繁體中文。
 * 結果寫進 $.state 並存進 $.store，之後的 session 直接用快取。
 */
async function translateSkills($: EngineInterface) {
  let done = 0
  try {
    const ran = await translating.run('translate', async () =>
      translateAll(
        listedCommands(
          await read($, commands),
          await read($, frontmatter),
          await read($, overrides),
          await read($, skillSources),
        ),
        await read($, translations),
        askModel($, 'haiku', 16000),
        async got => {
          // 這一批一筆都沒翻成就沒有東西要存
          if (Object.keys(got).length === 0) return
          const next = await update($, translations, prev => ({ ...prev, ...got }))
          await $.store.set('translations', next)
        },
        missedTranslations,
      ),
    )
    if ('value' in ran) done = ran.value
  } catch {}
  if (done > 0) $.ui.toast(`已把 ${done} 個 SKILL 說明翻成繁體中文`)
}

/**
 * 讀每個 skill 的原文，交給 haiku 整理成用法；每好一個就寫進 $.state 並存進 $.store，畫面跟著更新。
 * 之後的 session 直接用快取，原文或 prompt 版本變了才重新整理。
 */
async function makeSkillHowtos($: EngineInterface, run: HowtoRun) {
  let made: HowtoRound = { done: 0, isComplete: false }
  try {
    const ran = await howtoRound.run(
      run,
      async () => {
        const { dirs, fs } = await skillFiles($)
        // 每個 skill 都先找原文；要不要重新整理由 makeHowtos 判斷
        const items = await howtoItems(
          listedCommands(
            await read($, commands),
            await read($, frontmatter),
            await read($, overrides),
            await read($, skillSources),
          ),
          dirs,
          fs,
        )
        // 原文改過的先從畫面上拿掉，舊的用法不留著
        const known = await update($, howtos, prev => withoutStale(prev, items))
        // 畫面每好一個就更新；存檔每幾個一次，最後再補存剩下的
        let unsaved = 0
        const round = await makeHowtos(
          items,
          // 重整不看快取；舊的用法留在畫面上，問到哪個換哪個，中途停下時還沒輪到的照舊
          run === 'full' ? {} : known,
          askModel($, 'haiku', 4000),
          async (name, entry) => {
            const next = await update($, howtos, prev => ({ ...prev, [name]: entry }))
            if (++unsaved < HOWTO_SAVE_EVERY) return
            unsaved = 0
            await $.store.set('howtos', next)
          },
        )
        if (unsaved > 0) await $.store.set('howtos', await read($, howtos))
        return round
      },
      async running => void (await update($, makingHowtos, () => running !== undefined)),
    )
    // 已經有一輪在跑：這次不跑，也不另外說什麼（按鈕那時是「用法整理中…」）
    if ('busy' in ran) return
    made = ran.value
  } catch {}
  const said = howtoReport(run, made)
  if (said !== undefined) $.ui.toast(said)
}

/**
 * 發生了一件可能讓路線圖變舊的事（開啟、寫檔、跑 shell 指令）。
 * 要不要重讀由 roadmap 決定；有新的結果才更新畫面。
 * `.scratch/` 從專案根目錄找：相對路徑跟著工作目錄走，shell `cd` 到別處就讀不到，路線圖會整個消失。
 */
async function roadmapChanged($: EngineInterface, event: RoadmapEvent) {
  try {
    // 那份文件被改了，目錄可能換了：當成重新開啟，一律重讀
    const isTrackerDoc = event.kind === 'wrote' && event.isOk && tidy(event.path).endsWith(TRACKER_DOC)
    // 每個工具跑完都會來這裡，所以跟路線圖無關的先擋掉，不問引擎任何事
    if (event.kind === 'ran' && (event.isBlocked || roadmapDir === null)) return
    if (event.kind === 'wrote' && !isTrackerDoc) {
      if (!event.isOk || roadmapDir === null) return
      if (roadmapDir !== undefined && !touchesRoadmap(event.path, roadmapDir)) return
    }
    const project = await projectFiles($)
    // effort 放在哪個目錄照專案的 issue tracker 文件；文件說是線上的 tracker 就沒有路線圖。
    // 文件只在重新開啟或它被寫的時候重看，其餘時候用記著的
    if (roadmapDir === undefined || event.kind === 'open' || isTrackerDoc)
      roadmapDir = trackerRoot(await project.read(TRACKER_DOC)) ?? null
    if (roadmapDir === null) {
      await showRoadmap($, [])
      return
    }
    const efforts = await freshRoadmap(isTrackerDoc ? { kind: 'open' } : event, project, roadmapDir)
    if (efforts !== undefined) await showRoadmap($, efforts)
  } catch {}
}

/** 把讀到的路線圖放上畫面；跟畫面上的一樣就不寫（寫了就重畫）。 */
async function showRoadmap($: EngineInterface, efforts: Effort[]) {
  const json = JSON.stringify(efforts)
  if (json === shownRoadmap) return
  shownRoadmap = json
  await update($, roadmap, () => efforts)
}

/**
 * 重新載入所有 mod（引擎沒有只重載自己的方法）：跑內建的 `/reload-plugins`。
 * 重載後這份程式會被換掉，所以先在 `$.store` 記下時間，由新的那一份在 session.start 回報。
 */
async function reloadMods($: EngineInterface) {
  try {
    await $.store.set('reloadingAt', await $.clock.now())
    const ran = await $.command.run({ command: 'reload-plugins' })
    const said = ran.text?.trim().split('\n')[0]
    if (said) $.ui.toast(said)
  } catch (err) {
    await $.store.set('reloadingAt', null)
    $.ui.toast(`無法重新載入 mod：${reasonOf(err)}`)
  }
}

// ── 更新 ─────────────────────────────────────────────────

/** 更新用的 `claude plugin …` 指令最多等多久（毫秒）：要連 GitHub，比引擎預設的 30 秒寬 */
const UPDATE_TIMEOUT = 120_000

/**
 * 看現在發布的是哪一版，和這一份比；看不到當作查不到。
 * 從 marketplace 裝的：先把 marketplace 拉到最新，讀它本機 clone 裡的 plugin.json（就是更新會裝的那一版）。
 * 從資料夾載入的：只能上網看發布 repo。
 * 從 marketplace 裝的查到了就記下查到的版本：留著的標示看它，所以開場的檢查與手動的「檢查版本」都會更新。
 * 檢查的時間不在這裡記（`rememberChecked`）：查到了、該做的事也做成了才算檢查過。
 * `changelog` 是發布的那一份更新紀錄（clone 裡、plugin.json 旁邊，剛拉到最新所以不必再上網）；從資料夾載入的沒有。
 */
async function checkRelease($: EngineInterface): Promise<{ current: string; found: Verdict; changelog?: string }> {
  const current = await readVersion($)
  const install = await installOf($)
  let latest = ''
  let changelog: string | undefined
  try {
    if (install) {
      const ran = await $.process.run(refreshCommand(install), { timeoutMs: UPDATE_TIMEOUT })
      if (ran.exitCode === 0) {
        const dir = marketplaceDir(await homeDir($), install.marketplace)
        const manifest = releasedManifest(dir, await files($).read(catalogPath(dir)), install.plugin)
        if (manifest !== undefined) latest = versionIn(await files($).read(manifest))
        if (manifest !== undefined && latest !== '' && latest !== current)
          changelog = await files($).read(changelogBeside(manifest))
      }
    } else {
      const reply = await $.http.fetch(RELEASE_MANIFEST)
      if (reply.ok) latest = versionIn(reply.text)
    }
  } catch {}
  if (install && latest !== '') await rememberReleased($, latest)
  return { current, found: verdict(current, latest, install), changelog }
}

/**
 * 記下這次檢查過了，開場檢查隔多久看它。查不到發布的版本、或開場該在背景做的下載沒做成時不記：
 * 那不算檢查過，下次開場不等四小時就再試。
 */
const rememberChecked = async ($: EngineInterface) => $.store.set('checkedAt', await $.clock.now())

/**
 * 把發布的那一版下載到磁碟上（跑著的這一份不變）；失敗時跳 toast 並回 false。
 * `quiet` 是開場在背景下載的那一次：失敗不講，下次檢查再試。
 */
async function downloadUpdate($: EngineInterface, install: Install, quiet = false): Promise<boolean> {
  const failed = (reason: string | number) => {
    if (!quiet) $.ui.toast(`無法更新 cockpit：${reason}`)
    return false
  }
  try {
    const ran = await $.process.run(updateCommand(install), { timeoutMs: UPDATE_TIMEOUT })
    if (ran.exitCode === 0) return true
    // 更新不成（最常見的是 Claude Code 還沒把這一份記成已安裝）：改用安裝；還是不成才算失敗，講的是更新那一次的原因
    const installed = await $.process.run(installCommand(install), { timeoutMs: UPDATE_TIMEOUT })
    return installed.exitCode === 0 || failed((ran.stderr.trim() || ran.stdout.trim()).split('\n')[0] || ran.exitCode)
  } catch (err) {
    return failed(reasonOf(err))
  }
}

/**
 * 查到發布的版本就是裝著的這一版時收尾（開場檢查與「檢查版本」共用）：之前下載、還沒換上的紀錄不再算數。
 * 已下載的是別的版本（作者發了又收回）時磁碟上還是那一版，下次開啟會換上它，所以先把磁碟換回發布的版本
 * （和下載是同一個指令），成功才清掉紀錄。換不回去就安靜略過、紀錄留著，也不算檢查過，下次再試。
 */
async function settleSame($: EngineInterface, current: string) {
  const install = await installOf($)
  if (install !== undefined) {
    const downloaded = storedVersion(await $.store.get('downloadedVersion'))
    if (shouldRestore(current, downloaded) && !(await downloadUpdate($, install, true))) return
    await rememberChecked($)
  }
  await rememberDownloaded($, null)
}

/**
 * [設定] 的「檢查版本」：和發布的版本不一樣就問要不要立即更新（退版時問要不要換上），要的話下載後重新載入 mod。
 * 升版時問句後面列出這幾版的更新紀錄；退版或讀不到更新紀錄時照樣問，只是不列。
 */
async function checkVersion($: EngineInterface) {
  const { current, found, changelog } = await checkRelease($)
  if (found.kind === 'unknown') return void $.ui.toast('查不到發布的版本，請確認網路後再試')
  if (found.kind === 'same') {
    await settleSame($, current)
    return void $.ui.toast(`cockpit ${current} 已經是發布的版本`)
  }
  if (found.kind === 'update') await rememberChecked($)
  if (found.kind === 'manual')
    return void $.ui.toast(`發布的版本是 ${found.latest}；這一份是從資料夾載入的，請自行換成新版`)
  const words = wordingFor(current, found.latest)
  // 問過就算提示過這一版，之後開場不再為它提示
  await $.store.set('notifiedVersion', found.latest)
  let answer: string
  try {
    const question = withNotes(words.question(current, found.latest), notesBetween(changelog, current, found.latest))
    answer = await $.ui.ask(question, [words.accept, UPDATE_LATER])
  } catch {
    // 把詢問關掉就是先不要
    return
  }
  if (answer !== words.accept) return
  $.ui.toast(words.switching(found.latest))
  if (!(await downloadUpdate($, found.install))) return
  await rememberDownloaded($, found.latest)
  await reloadMods($)
}

/** [設定] 的「更新紀錄」：用編輯器打開裝著的那一份；這一版沒有那個檔就說沒有。 */
async function openChangelog($: EngineInterface) {
  const path = changelogIn($.plugin.root)
  if ((await files($).read(path)) === undefined) return void $.ui.toast(NO_CHANGELOG)
  await openInEditor($, path, undefined, '已開啟更新紀錄')
}

/**
 * 開場查到不一樣的版本、而且該自己下載時（「自動更新」開著，或作者退版）做的事：下載，下次開啟時換上；同一版只下載一次。
 * 回傳這一版是不是已經在磁碟上了。下載失敗不講原因、回 false，標示維持還沒下載的樣子。
 */
async function autoUpdate($: EngineInterface, found: Extract<Verdict, { kind: 'update' }>): Promise<boolean> {
  if ((await $.store.get('downloadedVersion')) === found.latest) return true
  if (!(await downloadUpdate($, found.install, true))) return false
  await rememberDownloaded($, found.latest)
  return true
}

/**
 * 開場的檢查：從 marketplace 裝的那一份，距離上次檢查滿四小時才去看發布的版本，「自動更新」開不開都看。
 * 不一樣而「自動更新」開著，或發布的版本比裝的舊（退版，「自動更新」關著也一樣）：在背景下載。
 * 升版而「自動更新」關著：不下載；標示由 `checkRelease` 記下的版本留著。
 * 每個發布的版本開場只提示一次，不管是哪一句：下載好了講已下載，沒下載（不必下載或下載失敗）講到 [設定] 按「檢查版本」；
 * 提示過（含在「檢查版本」被問過）的那一版，之後下載好了也不再講。
 * 背景的下載失敗不算檢查過：不記檢查的時間，下次開場再試。
 * 發布的版本就是裝著的這一版：把之前下載、還沒換上的別的版本換回去（`settleSame`）。
 * 在背景跑，查不到或中途出錯都安靜略過。
 */
async function startupCheck($: EngineInterface) {
  try {
    const [checkedAt, now] = await Promise.all([$.store.get('checkedAt'), $.clock.now()])
    if (!shouldCheck(await installOf($), checkedAt, now)) return
    const { current, found } = await checkRelease($)
    if (found.kind === 'same') return void (await settleSame($, current))
    if (found.kind !== 'update') return
    const isWanted = shouldDownload(current, found.latest, config.settings.autoUpdate)
    const isDownloaded = isWanted && (await autoUpdate($, found))
    if (isDownloaded || !isWanted) await rememberChecked($)
    if (!shouldNotify(found.latest, await $.store.get('notifiedVersion'))) return
    await $.store.set('notifiedVersion', found.latest)
    const words = wordingFor(current, found.latest)
    $.ui.toast(isDownloaded ? words.downloadedNotice(found.latest) : words.availableNotice(found.latest))
  } catch {}
}

// ── 填入輸入框 ───────────────────────────────────────────

async function fillPrompt($: EngineInterface, text: string, label: string) {
  try {
    const box = await $.prompt.read()
    const filled = await $.prompt.fill(composeFill(box.text, text))
    $.ui.toast(filled.isFilled ? `已填入「${label}」，按 Esc 回到輸入框` : `無法填入「${label}」`)
  } catch (err) {
    $.ui.toast(`無法填入「${label}」：${reasonOf(err)}`)
  }
}

async function submitPrompt($: EngineInterface, text: string, label: string) {
  try {
    await $.prompt.submit({ text, asUser: true })
    $.ui.toast(`已送出「${label}」`)
  } catch (err) {
    $.ui.toast(`無法送出「${label}」：${reasonOf(err)}`)
  }
}

// ── 分頁與摺疊 ───────────────────────────────────────────

/** 切到某個分頁，並重讀那一頁的資料。 */
async function setTab($: EngineInterface, next: Tab) {
  await closeHowto($)
  await update($, tab, () => next)
  if (next !== 'settings') await $.store.set('lastTab', next)
  if (next === 'tasks') await roadmapChanged($, { kind: 'open' })
  if (next === 'basic') await loadPrompts($)
  if (next === 'skill') await loadSkills($)
}

/**
 * 跨 session 記住的收合狀態：atom 與 `$.store` 用同一個鍵，只從這裡寫、從這裡還原。
 * 存哪些、讀回來怎麼驗寫在 `remembered.ts`。
 */
type Fold = 'openEfforts' | 'openSkillGroups' | 'closedPromptGroups'

/**
 * 把 id 加入或移出一份記住的清單，並存起來。
 * `update` 的對象要寫明是哪個 atom（引擎靠這個列出模組讀寫了什麼），所以三份各寫一行。
 */
async function toggleFold($: EngineInterface, fold: Fold, id: string) {
  const flip = (list: string[]) => toggled(list, id)
  const next =
    fold === 'openEfforts'
      ? await update($, openEfforts, flip)
      : fold === 'openSkillGroups'
        ? await update($, openSkillGroups, flip)
        : await update($, closedPromptGroups, flip)
  await $.store.set(fold, next)
}

/** 開場時把上個 session 存的面板狀態讀回來；各個鍵同時讀、同時寫，形狀不對的維持預設。 */
async function restoreRemembered(
  $: EngineInterface,
): Promise<{ lastTab: unknown; reloadingAt: unknown; seenVersion: unknown }> {
  const [lastTab, reloadingAt, seenVersion, released, downloaded, cachedTranslations, cachedHowtos, efforts, skillGroups, promptGroups, install, category] = await Promise.all([
    $.store.get('lastTab'),
    $.store.get('reloadingAt'),
    $.store.get('seenVersion'),
    $.store.get('releasedVersion'),
    $.store.get('downloadedVersion'),
    $.store.get('translations'),
    $.store.get('howtos'),
    $.store.get('openEfforts'),
    $.store.get('openSkillGroups'),
    $.store.get('closedPromptGroups'),
    installOf($),
    $.store.get('skillCategory'),
  ])
  await Promise.all([
    // 上次查到的發布版本：沒有重新檢查的這次開場，標示也照它留著；從資料夾載入的不標示
    update($, releasedVersion, () => (install !== undefined ? storedVersion(released) : '')),
    update($, downloadedVersion, () => (install !== undefined ? storedVersion(downloaded) : '')),
    update($, openEfforts, list => storedList(efforts) ?? list),
    update($, openSkillGroups, list => storedList(skillGroups) ?? list),
    update($, closedPromptGroups, list => storedList(promptGroups) ?? list),
    update($, skillCategory, () => storedCategory(category)),
    update($, translations, () => storedTranslations(cachedTranslations)),
    // 用法的快取：形狀不對或舊版 prompt 整理的不收
    update($, howtos, () => storedHowtos(cachedHowtos)),
  ])
  return { lastTab, reloadingAt, seenVersion }
}

/** 打開一個 skill 的用法頁：從它的第一頁看起，並記下列表原本停在第幾頁。 */
async function openHowto($: EngineInterface, name: string) {
  skillListPage = (await read($, pages)).skill
  await update($, pages, ps => ({ ...ps, skill: 0 }))
  // 教學的狀態要看檔案才知道：先當作沒有，看完再補上按鈕
  await update($, tutorial, () => ({ ...NO_TUTORIAL, name }))
  await update($, tutorialMenu, () => false)
  await update($, howtoPage, () => name)
  void checkTutorial($, name)
}

// ── 教學 ─────────────────────────────────────────────────

/** 要看或要產生教學的那個 skill：它的 SKILL.md（找不到的沒有教學）與教學檔的位置，連同讀檔的方式。 */
async function tutorialTarget($: EngineInterface, name: string): Promise<{ target: TutorialTarget; fs: Files }> {
  const { dirs, fs } = await skillFiles($)
  const c = (await read($, commands)).find(c => c.name === name)
  return {
    target: {
      name,
      source: c === undefined ? undefined : await findSkillFile(c, dirs, fs),
      path: tutorialPath(`${dirs.home}/.claude/cockpit/tutorials`, name),
    },
    fs,
  }
}

/** 看用法頁上這個 skill 有沒有教學、是不是依目前的原文產的。 */
async function checkTutorial($: EngineInterface, name: string) {
  let status: TutorialState = 'unavailable'
  try {
    const { target, fs } = await tutorialTarget($, name)
    status = await tutorialState(target, fs.read)
  } catch {}
  // 看到一半使用者已經換到別頁就不寫回去
  if ((await read($, howtoPage)) === name) await update($, tutorial, () => ({ name, status }))
}

/** 產生一個 skill 的教學（問的是 sonnet），存檔後在編輯器打開。同一時間只產一份。 */
async function makeSkillTutorial($: EngineInterface, name: string, label: string) {
  await update($, tutorialMenu, () => false)
  const today = dateOf(await $.clock.now())
  let made: { path: string } | { error: string }
  try {
    const ran = await tutorialJob.run(
      name,
      async () => {
        const { target, fs } = await tutorialTarget($, name)
        return writeTutorial(
          target,
          { read: fs.read, write: fs.write, ask: askModel($, 'sonnet', 32000) },
          today,
        )
      },
      async running => void (await update($, makingTutorial, () => running ?? '')),
    )
    if ('busy' in ran) {
      $.ui.toast(ran.busy === name ? `「${label}」的教學還在產生` : `還有一份教學在產生（${ran.busy}），等它好了再按`)
      return
    }
    made = ran.value
  } catch (err) {
    made = { error: reasonOf(err) }
  }
  if ('error' in made) {
    $.ui.toast(`無法產生「${label}」的教學：${made.error}`)
    return
  }
  await update($, tutorial, prev => (prev.name === name ? { name, status: 'fresh' as const } : prev))
  await openInEditor($, made.path, undefined, `已產生「${label}」的教學，已在編輯器打開`)
}

/** 用法頁的「教學」：已經有就直接打開（舊的也是），沒有才產生。 */
async function pressTutorial($: EngineInterface, name: string, label: string) {
  const known = await read($, tutorial)
  if (known.name === name && (known.status === 'fresh' || known.status === 'stale'))
    // 檔案本來就開著時編輯器只會切到那個分頁，畫面可能沒變，所以把話說清楚
    await openInEditor($, (await tutorialTarget($, name)).target.path, undefined, `「${label}」的教學已在編輯器打開`)
  else await makeSkillTutorial($, name, label)
}

/** 離開用法頁，回到列表原本那一頁；本來就在列表時什麼都不做。 */
async function closeHowto($: EngineInterface) {
  if ((await read($, howtoPage)) === '') return
  await update($, howtoPage, () => '')
  await update($, pages, ps => ({ ...ps, skill: skillListPage }))
}

async function turnPage($: EngineInterface, current: Tab, to: number) {
  await update($, pages, ps => ({ ...ps, [current]: Math.max(0, to) }))
  if (current === 'tasks') await dispatch($, { kind: 'unfollow' })
}

// ── 任務 ─────────────────────────────────────────────────

async function dispatch($: EngineInterface, event: TaskEvent) {
  syncTicker($, await update($, board, b => applyTask(b, event)))
}

/**
 * 有進行中的任務才開著每秒的計時器，沒有就停掉。
 * 計時器每秒算一次畫面上會隨時間變的字，跟上一秒不一樣才重畫。
 */
function syncTicker($: EngineInterface, now: TaskBoard) {
  const isRunning = hasRunning(now)
  if (!isRunning) {
    ticker?.cancel()
    ticker = undefined
    return
  }
  ticker ??= $.clock.every(1000, async () => {
    const current = await read($, board)
    if (!hasRunning(current)) return
    const times = timeStamp(viewTasks(current, await $.clock.now()))
    if (times === shownTimes) return
    shownTimes = times
    await update($, tick, n => n + 1)
  })
}

// ── 設定 ─────────────────────────────────────────────────

async function setOption($: EngineInterface, field: Field, value: string) {
  try {
    await $.config.set({ key: `cockpit.${field}`, value })
  } catch (err) {
    $.ui.toast(`無法儲存設定：${reasonOf(err)}`)
  }
}

async function resetOptions($: EngineInterface) {
  for (const f of FIELDS) {
    if (config.raw[f.field] !== f.fallback) await setOption($, f.field, f.fallback)
  }
  $.ui.toast('設定已恢復預設值')
}

// ══ 分頁：每個分頁只管自己有哪些行，外框與分頁由 register 統一處理 ══════════════

/**
 * [任務] 分頁：上方是路線圖（每個 effort 一行，展開後看票），下方是待辦清單。
 * 每一行顯示哪些字、多寬時留哪幾欄，由 `viewRoadmap` 與 `taskCells` 決定；這裡只負責畫與掛上動作。
 */
async function tasksTab($: EngineInterface, { ui, cols, accent }: TabContext, view: TaskView): Promise<TabContent> {
  const { Box, Text, Button } = ui
  const main = view.main

  // 數字是重點，後面的補充（還要多久）用暗色
  const head = main.total === 0 ? '' : `${main.doneCount}/${main.total} 完成`
  const headNote =
    main.total === 0
      ? view.orphanCount > 0
        ? `${view.orphanCount} 個 subagent 有清單`
        : '目前沒有任務'
      : main.doneCount === main.total
        ? ' · 全部完成'
        : main.remainingMs !== undefined
          ? ` · 還需約 ${formatDuration(main.remainingMs)}`
          : ''
  const top = (
    <Box key="tasks-head" flexDirection="row" gap={2}>
      <Box flexGrow={1} flexShrink={1}>
        <Text wrap="truncate-end">
          <Text bold>{head}</Text>
          <Text dimColor>{headNote}</Text>
        </Text>
      </Box>
    </Box>
  )
  // 分頁的操作疊在下框線上，和其他分頁同一個位置
  const actions = view.hasCompleted ? (
    <Button
      key="clear-done"
      label="清除已完成"
      plain
      dimColor
      hotkey="c"
      onPress={() => void dispatch($, { kind: 'clearCompleted' })}
    />
  ) : undefined
  const actionsWidth = view.hasCompleted ? keysWidth([{ hotkey: 'c', label: '清除已完成' }]) : 0

  // ── 待辦清單：只有進行中的畫進度條與百分比，其餘整列暗色 ──
  const todoRows: Row<JSX.Element>[] = view.rows.map(r => {
    const indent = r.depth * 2
    if (r.kind === 'agent') {
      return {
        id: r.id,
        group: r.group,
        isHeader: true,
        value: (
          <Box flexDirection="row" gap={ROW_GAP} paddingLeft={indent}>
            <Text dimColor>↳</Text>
            <Box flexGrow={1} flexShrink={1}>
              <Text dimColor wrap="truncate-end">
                {`${r.label} ${r.doneCount}/${r.total}`}
              </Text>
            </Box>
            {taskColumns(cols - indent).showX && (
              <Button
                key={`dismiss-${r.id}`}
                label="×"
                plain
                dimColor
                onPress={() => void dispatch($, { kind: 'dismissAgent', id: r.agentId })}
              />
            )}
          </Box>
        ),
      }
    }
    const task = r.task
    const cells = taskCells(task, cols - indent)
    const isRunning = task.status === 'in_progress'
    return {
      id: r.id,
      group: r.group,
      value: (
        <Box flexDirection="row" gap={ROW_GAP} paddingLeft={indent}>
          <Text color={task.status === 'completed' ? 'success' : isRunning ? accent : undefined} dimColor={task.status === 'pending'}>
            {cells.icon}
          </Text>
          <Box flexGrow={1} flexShrink={1}>
            <Text wrap="truncate-end" dimColor={!isRunning}>
              {task.title}
            </Text>
          </Box>
          {cells.bar && (
            <Text key={`task-bar-${task.id}`}>
              <Text color={accent}>{cells.bar.filled}</Text>
              <Text dimColor>{cells.bar.rest}</Text>
            </Text>
          )}
          {cells.percent !== undefined && <Text>{cells.percent}</Text>}
          <Text color={cells.isOverdue ? 'error' : undefined} dimColor={!cells.isOverdue}>
            {cells.time}
          </Text>
          {cells.canDismiss && (
            <Button
              key={`dismiss-${task.id}`}
              label="×"
              plain
              dimColor
              onPress={() => void dispatch($, { kind: 'dismissTask', id: task.id })}
            />
          )}
        </Box>
      ),
    }
  })

  // ── 路線圖：放在待辦清單上方 ──
  const [efforts, showDone, open, folds] = await Promise.all([
    read($, roadmap),
    read($, showDoneEfforts),
    read($, openEfforts),
    read($, roadmapFolds),
  ])
  const road = viewRoadmap(efforts, { open: new Set(open), showDone, width: cols, folds })
  const ticketIcon = (t: Ticket) =>
    t.state === 'done' ? (
      <Text color="success">✓</Text>
    ) : t.state === 'claimed' ? (
      <Text color={accent}>●</Text>
    ) : t.state === 'takeable' ? (
      <Text color={accent}>→</Text>
    ) : (
      <Text dimColor>○</Text>
    )
  const roadmapGroup = { id: 'roadmap', label: '路線圖' }
  const roadmapRows: Row<JSX.Element>[] =
    efforts.length === 0
      ? []
      : [
          {
            id: 'roadmap-header',
            group: roadmapGroup,
            isHeader: true,
            value: (
              <Box flexDirection="row" gap={2}>
                <Box flexGrow={1} flexShrink={1}>
                  <Text bold wrap="truncate-end">
                    路線圖
                  </Text>
                </Box>
                {road.doneCount > 0 && (
                  <Button
                    key="toggle-done-efforts"
                    label={showDone ? '隱藏已完成' : `已完成 ${road.doneCount}`}
                    plain
                    dimColor
                    onPress={() => void update($, showDoneEfforts, v => !v)}
                  />
                )}
                <Button
                  key="reload-roadmap"
                  label="重新載入"
                  plain
                  dimColor
                  hotkey="r"
                  onPress={() => void roadmapChanged($, { kind: 'open' })}
                />
              </Box>
            ),
          },
          ...road.rows.map((r): Row<JSX.Element> => {
            const f = r.effort
            // 展開後的行算在這個 effort 的組裡，跨頁時「（續）」才看得出是哪一個
            const effortGroup = { id: `effort/${f.name}`, label: `路線圖：${f.name}` }
            if (r.kind === 'effort') {
              return {
                id: `effort/${f.name}`,
                group: roadmapGroup,
                value: (
                  <Box flexDirection="row" gap={ROW_GAP}>
                    <Box flexGrow={1} flexShrink={1}>
                      <Button key={`effort-btn-${f.name}`} label={r.label} plain onPress={() => void toggleFold($, 'openEfforts', f.name)} />
                    </Box>
                    {r.stage !== undefined && (
                      <Text color={f.stage === 'done' ? 'success' : undefined} dimColor={f.stage !== 'done'}>
                        {r.stage}
                      </Text>
                    )}
                    {r.count !== '' && <Text>{r.count}</Text>}
                    {f.next && (
                      <Button key={`effort-next-${f.name}`} label="繼續" plain onPress={() => void fillPrompt($, f.next ?? '', f.name)}>
                        <Text color={accent}>繼續</Text>
                      </Button>
                    )}
                  </Box>
                ),
              }
            }
            if (r.kind === 'destination') {
              return {
                id: `effort/${f.name}/destination`,
                group: effortGroup,
                value: (
                  <Box paddingLeft={r.indent}>
                    <Text dimColor wrap="truncate-end">
                      {r.text}
                    </Text>
                  </Box>
                ),
              }
            }
            if (r.kind === 'tickets' || r.kind === 'closed') {
              return {
                id: `effort/${f.name}/${r.id}`,
                group: effortGroup,
                value: (
                  <Box paddingLeft={r.indent}>
                    <Button
                      key={`fold-${r.foldId}`}
                      label={r.text}
                      plain
                      dimColor
                      onPress={() => void update($, roadmapFolds, folds => ({ ...folds, [r.foldId]: !r.isOpen }))}
                    />
                  </Box>
                ),
              }
            }
            const t = r.ticket
            return {
              id: `ticket/${t.path}`,
              group: effortGroup,
              detail: t.detail,
              value: (
                <Box flexDirection="row" gap={ROW_GAP} paddingLeft={r.indent}>
                  {ticketIcon(t)}
                  <Box flexGrow={1} flexShrink={1}>
                    <Button
                      key={`ticket-btn-${t.path}`}
                      label={r.label}
                      plain
                      dimColor={t.state === 'done'}
                      onPress={() => void openInEditor($, t.path)}
                    />
                  </Box>
                  {r.waiting && <Text dimColor>{r.waiting}</Text>}
                </Box>
              ),
            }
          }),
        ]

  // 有路線圖時，待辦清單前面加一行組名，跨頁時才看得出「（續）」是哪一組
  const todoGroup = { id: 'todos', label: '待辦' }
  const rows: Row<JSX.Element>[] =
    roadmapRows.length > 0 && todoRows.length > 0
      ? [
          ...roadmapRows,
          {
            id: 'todos-header',
            group: todoGroup,
            isHeader: true,
            value: (
              <Text bold wrap="truncate-end">
                待辦
              </Text>
            ),
          },
          ...todoRows.map(r => ({ ...r, group: r.group ?? todoGroup })),
        ]
      : [...roadmapRows, ...todoRows]

  return {
    top,
    ...(actions === undefined ? {} : { actions, actionsWidth }),
    rows,
    emptyText: '模型使用待辦清單後，任務會顯示在這裡。',
    followId: view.followId,
  }
}

/** [基本] 分頁：常用 prompt。點了填進輸入框，名稱結尾標 ` !` 的直接送出。 */
/**
 * 組名列的字：組名加粗（掃讀時的錨點），個數暗色；裁到 `width` 格以內時先裁組名。
 * `isDim`（整組關掉）時整行變暗、不加粗。`count` 不給就不寫個數。
 */
function groupHead(
  { Text }: Elements,
  isOpen: boolean,
  title: string,
  count: number | undefined,
  width: number,
  isDim = false,
) {
  const countText = count === undefined ? '' : ` (${count})`
  const name = fitText(foldLabel(isOpen, title), Math.max(4, width - textWidth(countText)))
  if (isDim) return <Text dimColor>{name + countText}</Text>
  return (
    <Text>
      <Text bold>{name}</Text>
      <Text dimColor>{countText}</Text>
    </Text>
  )
}

async function basicTab($: EngineInterface, { ui, cols, accent }: TabContext): Promise<TabContent> {
  const { Box, Text, Button } = ui
  const [groups, closedIds, hasProject] = await Promise.all([
    read($, prompts),
    read($, closedPromptGroups),
    read($, hasProjectPrompts),
  ])
  const closed = new Set(closedIds)

  const rows: Row<JSX.Element>[] = []
  for (const g of groups) {
    const isOpen = g.title === '' || !closed.has(g.id)
    const group = g.title === '' ? undefined : { id: g.id, label: g.title }
    if (group) {
      rows.push({
        id: `prompt-group-${g.id}`,
        group,
        isHeader: true,
        value: (
          <Button
            key={`pg-btn-${g.id}`}
            label={fitText(foldLabel(isOpen, `${g.title} (${g.entries.length})`), cols)}
            plain
            onPress={() => void toggleFold($, 'closedPromptGroups', g.id)}
          >
            {groupHead(ui, isOpen, g.title, g.entries.length, cols)}
          </Button>
        ),
      })
    }
    if (!isOpen) continue
    for (const p of g.entries) {
      const indent = group ? 2 : 0
      // 直接送出的在名稱後面多一個「⏎」，連同間隔佔兩格
      const room = cols - indent - (p.isSubmit ? 2 : 0)
      rows.push({
        id: `prompt-${p.id}`,
        group,
        detail: p.body,
        value: (
          <Box flexDirection="row" gap={1} paddingLeft={indent}>
            <Button
              key={`prompt-btn-${p.id}`}
              label={fitText(`› ${p.name}`, room)}
              plain
              onPress={() => void (p.isSubmit ? submitPrompt($, p.body, p.name) : fillPrompt($, p.body, p.name))}
            />
            {p.isSubmit && <Text color={accent}>⏎</Text>}
          </Box>
        ),
      })
    }
  }

  // 分頁的操作疊在下框線上，和其他分頁同一個位置
  const actionsWidth = keysWidth([
    { hotkey: 'e', label: '編輯' },
    ...(hasProject ? [{ hotkey: 'p', label: '編輯本專案' }] : []),
    { hotkey: 'r', label: '重新載入' },
  ])
  const actions = (
    <Box key="basic-actions" flexDirection="row" gap={2}>
      <Button
        key="edit-prompts"
        label="編輯"
        plain
        hotkey="e"
        onPress={() =>
          void (async () => {
            await openInEditor($, `${await homeDir($)}/.claude/cockpit/prompts.md`, SAMPLE_PROMPTS)
          })()
        }
      />
      {hasProject && (
        <Button
          key="edit-project-prompts"
          label="編輯本專案"
          plain
          hotkey="p"
          onPress={() => void openInEditor($, PROJECT_PROMPTS)}
        />
      )}
      <Button key="reload-prompts" label="重新載入" plain hotkey="r" onPress={() => void loadPrompts($)} />
    </Box>
  )

  return { actions, actionsWidth, rows, emptyText: '還沒有常用 prompt，按 [ 編輯 ] 建立。' }
}

/** 關掉翻譯或用法時傳給分組的空表；固定同一個，下面的記憶才比得出「沒變」 */
const NOTHING = {}

type GroupInputs = Parameters<typeof groupSkills>
let lastGroups: { inputs: GroupInputs; groups: ReturnType<typeof groupSkills> } | undefined

/**
 * 把 skill 分組（要排序、要算每個說明的雜湊）。輸入跟上次是同一份就用上次的結果；
 * 搜尋框每打一個字都會重畫，但清單本身沒變。
 */
function skillGroups(...inputs: GroupInputs) {
  if (lastGroups === undefined || inputs.some((v, i) => v !== lastGroups?.inputs[i]))
    lastGroups = { inputs, groups: groupSkills(...inputs) }
  return lastGroups.groups
}

/** [SKILL] 分頁：已安裝的 skill，依 plugin 分組；頂端是搜尋框。點了把 `/<skill 名稱> ` 填進輸入框。 */
async function skillTab($: EngineInterface, { ui, cols, accent }: TabContext): Promise<TabContent> {
  const { Box, Text, Button } = ui
  const Input = 'Input' in ui ? ui.Input : undefined
  const { settings } = config

  // 這個分頁要用的狀態一次讀完
  const [
    query,
    known,
    listed,
    fm,
    over,
    translated,
    pageName,
    openIds,
    isChoosing,
    isMakingNow,
    from,
    chosenCategory,
    isSwitching,
    switches,
    enabledPlugins,
    installed,
  ] = await Promise.all([
    read($, search),
    read($, howtos),
    read($, commands),
    read($, frontmatter),
    read($, overrides),
    read($, translations),
    read($, howtoPage),
    read($, openSkillGroups),
    read($, howtoMenu),
    read($, makingHowtos),
    read($, skillSources),
    read($, skillCategory),
    read($, switchMode),
    read($, skillSwitches),
    read($, pluginSwitches),
    read($, installedPluginKeys),
  ])
  // 停用了的 plugin，skill 已經不在清單裡；照樣畫出它的組（空的），才按得到「啟用」
  const offPlugins = disabledPlugins(enabledPlugins, installed)
  const all = withDisabledPlugins(
    skillGroups(
      listed,
      fm,
      over,
      settings.translate ? translated : NOTHING,
      // 「整理用法」關掉時當作都沒有用法：沒有「?」、進不了用法頁、搜尋也不比對；存著的用法不動
      settings.howto ? known : NOTHING,
      from,
    ),
    offPlugins,
    over,
  )

  // ── 用法頁：搜尋框與列表換成一個 skill 的說明與用法 ──
  const shown = pageName === '' ? undefined : all.flatMap(g => g.items).find(s => s.name === pageName)
  if (shown?.howto !== undefined) {
    // 教學：找不到 SKILL.md 的沒有按鈕；已經有教學時，說明上面多一行狀態與「重新產生」
    const [known, making, isConfirming] = await Promise.all([
      read($, tutorial),
      read($, makingTutorial),
      read($, tutorialMenu),
    ])
    const tutorialNow: TutorialState = known.name === shown.name ? known.status : 'unavailable'
    const isMakingTutorial = making === shown.name
    const hasTutorialButton = tutorialNow !== 'unavailable'
    const head = (
      <Box key="howto-head" flexDirection="row" gap={2}>
        <Text bold wrap="truncate-end">
          {shown.label}
        </Text>
        <Button
          key="howto-fill"
          label="填入"
          plain
          hotkey="f"
          onPress={() =>
            void (async () => {
              await fillPrompt($, `/${shown.name} `, shown.label)
              await closeHowto($)
            })()
          }
        />
        <Button key="howto-back" label="返回" plain hotkey="b" onPress={() => void closeHowto($)} />
        {isMakingTutorial ? (
          <Box key="tutorial-making" flexShrink={0}>
            <Text dimColor>教學產生中…</Text>
          </Box>
        ) : hasTutorialButton ? (
          <Button
            key="tutorial-open"
            label="教學"
            plain
            hotkey="t"
            onPress={() => void pressTutorial($, shown.name, shown.label)}
          />
        ) : null}
      </Box>
    )
    // 有哪些列、每列什麼字由 viewHowtoPage 決定；這裡只管怎麼畫
    const page = viewHowtoPage(shown, tutorialNow, isMakingTutorial, cols)
    const pageRows: Row<JSX.Element>[] = (page?.rows ?? []).map(row => {
      if (row.kind === 'description') return { id: row.id, value: <Text dimColor>{row.text}</Text> }
      if (row.kind === 'rule')
        return {
          id: row.id,
          value: (
            <Box flexDirection="row">
              <Text dimColor>{row.text}</Text>
              {row.note === '' ? null : <Text dimColor>{row.note}</Text>}
              <Text dimColor>{row.fill}</Text>
            </Box>
          ),
        }
      if (row.kind === 'part')
        return {
          id: row.id,
          value: (
            <Box flexDirection="row">
              <Box width={page?.labelWidth ?? 0} flexShrink={0}>
                <Text color={accent}>{row.label}</Text>
              </Box>
              <Text>{row.text}</Text>
            </Box>
          ),
        }
      return {
        id: row.id,
        value: (
          <Box flexDirection="row" gap={1}>
            <Text key="tutorial-state" color={row.isStale ? accent : undefined} dimColor={!row.isStale}>
              {row.text}
            </Text>
            {isConfirming ? (
              // 重新產生會整份蓋掉使用者在檔案裡加的筆記，要再按一次才做
              <Box key="tutorial-menu" flexDirection="row" gap={1} flexShrink={0}>
                <Button
                  key="tutorial-overwrite"
                  label="覆蓋"
                  plain
                  onPress={() => void makeSkillTutorial($, shown.name, shown.label)}
                />
                <Button key="tutorial-menu-close" label="×" onPress={() => void update($, tutorialMenu, () => false)} />
              </Box>
            ) : (
              <Button key="tutorial-remake" label="重新產生" plain onPress={() => void update($, tutorialMenu, () => true)} />
            )}
          </Box>
        ),
      }
    })
    return { top: head, rows: pageRows }
  }

  const open = new Set(openIds)
  const isSearching = query.trim() !== ''
  // 有分類時一次看選中的那個分類；搜尋時列出所有有符合項目的分類（規則在 skills.ts 的 skillView）
  const categories = categorize(all, over.categories)
  const view = skillView(all, categories, chosenCategory, query)
  const { picked, isHeadOnTop } = view

  /** 「更新用法」選了怎麼跑：收起選單再開始 */
  const runHowtos = async (run: HowtoRun) => {
    await update($, howtoMenu, () => false)
    await makeSkillHowtos($, run)
  }

  // 開關模式：o 進出。按鈕和「更新用法」一起疊在下框線上（分頁的操作都在那裡），不跟著翻頁，o 在任何捲動位置都有效
  const switchButton = (
    <Button
      key="switch-mode"
      label={isSwitching ? '完成' : '開關'}
      plain
      hotkey="o"
      onPress={() => void update($, switchMode, on => !on)}
    />
  )

  // 有用法的 skill，名稱後面多一個「?」，連同前面的間隔佔 2 格
  const HOWTO_MARK = 2

  const searchRow = (
    <Box key="skill-search-row" flexDirection="row" gap={1}>
      <Button
        key="focus-search"
        label="搜尋"
        plain
        hotkey="s"
        onPress={() => void $.ui.focus({ requestId: PANE, key: 'skill-search' })}
      />
      <Box flexGrow={1} flexShrink={1}>
        {Input ? (
          <Input
            key="skill-search"
            placeholder="名稱或說明"
            value={query}
            submitLabel="篩選"
            onInput={(v: string) => void update($, search, () => v)}
            onSubmit={(v: string) => void update($, search, () => v)}
          />
        ) : (
          <Text dimColor>{query || '（這個介面沒有輸入框）'}</Text>
        )}
      </Box>
      {isSearching && <Button key="clear-search" label="×" onPress={() => void update($, search, () => '')} />}
    </Box>
  )

  // 分頁的操作（更新用法、開關）疊在下框線上；寬度照畫出來的字算
  const howtoAction = !settings.howto
    ? undefined
    : isMakingNow
      ? {
          width: textWidth('用法整理中…'),
          el: (
            <Box key="howto-making" flexShrink={0}>
              <Text dimColor>用法整理中…</Text>
            </Box>
          ),
        }
      : isChoosing
        ? {
            // 按了「更新用法」：選只補缺的（快速），或全部重新問一次（重整）；「×」畫成「[ × ]」
            width: textWidth('q: 快速') + 2 + textWidth('r: 重整') + 2 + textWidth('[ × ]'),
            el: (
              <Box key="howto-menu" flexDirection="row" gap={2} flexShrink={0}>
                <Button key="howto-quick" label="快速" plain hotkey="q" onPress={() => void runHowtos('quick')} />
                <Button key="howto-full" label="重整" plain hotkey="r" onPress={() => void runHowtos('full')} />
                <Button key="howto-menu-close" label="×" onPress={() => void update($, howtoMenu, () => false)} />
              </Box>
            ),
          }
        : {
            width: keysWidth([{ hotkey: 'u', label: '更新用法' }]) - 2,
            el: (
              <Button
                key="refresh-howtos"
                label="更新用法"
                plain
                hotkey="u"
                onPress={() => void update($, howtoMenu, () => true)}
              />
            ),
          }
  const switchWidth = keysWidth([{ hotkey: 'o', label: isSwitching ? '完成' : '開關' }]) - 2
  // 覆寫檔（skills.json）管的是這個分頁怎麼分組與顯示，按鈕放在這裡；檔案還不存在時先建立範例
  const editOverrides = (
    <Button
      key="edit-overrides"
      label="編輯覆寫"
      plain
      hotkey="e"
      onPress={() =>
        void (async () => {
          await openInEditor($, `${await homeDir($)}/.claude/cockpit/skills.json`, SAMPLE_OVERRIDES)
        })()
      }
    />
  )
  const editWidth = keysWidth([{ hotkey: 'e', label: '編輯覆寫' }]) - 2
  const actions = (
    <Box key="skill-actions" flexDirection="row" gap={2}>
      {switchButton}
      {howtoAction?.el}
      {editOverrides}
    </Box>
  )
  // 頭尾各留一格（`keysWidth` 的算法）
  const actionsWidth = 2 + switchWidth + (howtoAction === undefined ? 0 : 2 + howtoAction.width) + 2 + editWidth

  // plugin 的 skill 沒有單獨的開關，看它的 plugin 有沒有停用（move 混進一般組的也是）；其他的照 skillOverrides 算開或關
  const plugins = pluginSkills(listed)
  const owners = skillPlugins(listed)
  const isOff = (s: SkillItem) => {
    const owner = owners.get(s.name)
    return owner === undefined ? isSkillOff(s.name, switches) : isPluginOff(owner, enabledPlugins)
  }
  /**
   * 開關模式裡一個 skill 的那一行：名稱、token 數與 [開]／[關]。
   * plugin 的 skill 沒有單獨的開關（要停用整個 plugin），行尾只有 token 數。
   */
  const switchRow = (s: SkillItem) => {
    const off = isOff(s)
    const tokens = skillTokens(s.name, fm)
    const isPluginSkill = plugins.has(s.name)
    const tail =
      isPluginSkill && tokens === undefined ? null : (
        <Box key={`switch-cell-${s.name}`} flexDirection="row" gap={1} flexShrink={0}>
          {tokens === undefined ? null : <Text dimColor>{String(tokens)}</Text>}
          {isPluginSkill ? null : (
            <Button
              key={`switch-${s.name}`}
              label={off ? '關' : '開'}
              dimColor={off}
              onPress={() =>
                void applySwitch($, { kind: 'skills', turn: off ? 'on' : 'off', names: [s.name] }, s.label)
              }
            />
          )}
        </Box>
      )
    const tailWidth = tail === null ? 0 : isPluginSkill ? TOKENS_TAIL : SWITCH_TAIL
    return (
      <Box flexDirection="row" paddingLeft={2} gap={1}>
        <Box flexGrow={1} flexShrink={1}>
          {skillButton(s, cols - 2 - tailWidth)}
        </Box>
        {tail}
      </Box>
    )
  }
  // ── 組與分類的開關：不存狀態，由底下可開關（非 plugin）的 skill 算出 ──
  /** 整組（搜尋時也算整組、整個分類，不只符合的那幾個） */
  const fullGroups = new Map(all.map(g => [g.id, g]))
  const fullGroup = (g: SkillGroup) => fullGroups.get(g.id) ?? g
  /** 底下可開關的 skill */
  const switchable = (groups: readonly SkillGroup[]) =>
    groups.flatMap(g => fullGroup(g).items.filter(s => !plugins.has(s.name)).map(s => s.name))
  const summaryOf = (groups: readonly SkillGroup[]) => summarize(switchable(groups), switches, fm)
  const fullCategory = (name: string) => categories?.find(c => c.name === name)
  /** 這一組是哪個 plugin 的 plugin 組；不是 plugin 組（move 開的自訂組、混了一般 skill 的組）是 undefined */
  const pluginOf = (g: SkillGroup) => groupPlugin(g.id, fullGroup(g).items.map(s => s.name), owners, offPlugins)
  /**
   * plugin 組的狀態與開關模式的行尾：狀態看 enabledPlugins；開關寫「plugin 開」／「停用整個 plugin」，和一般的開關看得出不同。
   * 不是 plugin 組是 undefined；查不到完整的鍵（不在已安裝清單、或是 cockpit 自己）時有狀態、沒有開關。
   */
  const pluginSwitchTail = (g: SkillGroup) => {
    const plugin = pluginOf(g)
    if (plugin === undefined) return undefined
    const isGroupOff = isPluginOff(plugin, enabledPlugins)
    const key = pluginKey(plugin, installed)
    if (key === undefined) return { isOff: isGroupOff, tail: null }
    const tokens = isGroupOff ? undefined : tokensOf(fullGroup(g).items.map(s => s.name), fm)
    const tail = (
      <Box key={`plugin-switch-${g.id}-tail`} flexDirection="row" gap={1} flexShrink={0}>
        {tokens === undefined ? null : <Text dimColor>{shortTokens(tokens)}</Text>}
        <Button
          key={`plugin-switch-${g.id}`}
          label={isGroupOff ? '停用整個 plugin' : 'plugin 開'}
          dimColor={isGroupOff}
          onPress={() => void applySwitch($, { kind: 'plugin', turn: isGroupOff ? 'on' : 'off', key }, plugin)}
        />
      </Box>
    )
    return { isOff: isGroupOff, tail }
  }
  /** 一組或一個分類行尾的 token 數與開關；沒有可開關的 skill 時沒有 */
  const batchTail = (key: string, summary: SwitchSummary, onPress: () => void) =>
    summary.state === undefined ? null : (
      <Box key={`${key}-tail`} flexDirection="row" gap={1} flexShrink={0}>
        {summary.tokens === undefined ? null : <Text dimColor>{shortTokens(summary.tokens)}</Text>}
        <Button key={key} label={stateLabel(summary.state)} dimColor={summary.state !== 'on'} onPress={onPress} />
      </Box>
    )
  /** 按組或分類的開關：開或部分就把開著的全部關掉，關就全部打開 */
  const flipBatch = (groups: readonly SkillGroup[], label: string, pluginGroups = 0) => {
    const action = flipAll(switchable(groups), switches)
    if (action !== undefined) void applySwitch($, action, label, pluginGroups)
  }
  /** 開關模式裡「整個分類」那一列；分類裡沒有可開關的 skill（只有 plugin 組）時沒有這一列 */
  const categorySwitchRow = (name: string): Row<JSX.Element> | undefined => {
    const c = fullCategory(name)
    if (c === undefined) return undefined
    const tail = batchTail(`category-switch-${name}`, summaryOf(c.groups), () =>
      flipBatch(c.groups, name, pluginGroupCount(c.groups, owners, offPlugins)),
    )
    if (tail === null) return undefined
    return {
      id: `skill-category-switch-${name}`,
      value: (
        <Box key={`category-switch-row-${name}`} flexDirection="row" gap={1}>
          <Box flexGrow={1} flexShrink={1}>
            <Text>整個分類</Text>
          </Box>
          {tail}
        </Box>
      ),
    }
  }
  /** 分類的標題列：`<分類>：<開的數>/<總數> 開 · <N> tokens`；在頂端的那一列右邊是開關模式的按鈕 */
  const categoryHead = (name: string) => {
    const c = fullCategory(name)
    const title = categoryTitle(name, c === undefined ? { on: 0, total: 0 } : summaryOf(c.groups))
    return (
      <Box key={`skill-cat-head-${name}`} flexDirection="row" gap={1}>
        <Box flexGrow={1} flexShrink={1}>
          {/* 統計是次要資訊，暗色；組名才是掃讀的錨點 */}
          <Text dimColor>{fitText(title, cols)}</Text>
        </Box>
      </Box>
    )
  }

  /** 點分類分頁籤：換成那個分類，存起來下次開還停在這裡 */
  const pickCategory = async (name: string) => {
    await update($, skillCategory, () => name)
    await $.store.set('skillCategory', name)
  }
  // 有分類時頂端是一排分類分頁籤，照寫的順序，「未分類」在最後；整個分類關掉或部分關掉時標「·關」「·部分」。
  // 平常看一個分類時，它的 token 數接在同一列的右端（開了幾個看分頁籤的標記就知道），不另佔一行。
  // 搜尋框在底部（說明區下面）
  const pickedTokens =
    isHeadOnTop && picked !== undefined ? summaryOf(fullCategory(picked.name)?.groups ?? picked.groups).tokens : undefined
  const top =
    categories === undefined ? undefined : (
      <Box key="skill-top" flexDirection="row" gap={1}>
        <Box key="skill-categories" flexDirection="row" gap={1} flexGrow={1} flexShrink={1}>
          {categories.map(c => {
            const label = tabLabel(c.name, summaryOf(c.groups).state)
            return (
              <Button key={`skill-cat-${c.name}`} label={label} plain onPress={() => void pickCategory(c.name)}>
                {c === picked ? (
                  <Text color={accent} bold>
                    [{label}]
                  </Text>
                ) : (
                  <Text> {label} </Text>
                )}
              </Button>
            )
          })}
        </Box>
        {pickedTokens !== undefined && (
          <Box key="skill-category-tokens" flexShrink={0}>
            <Text dimColor>{`${shortTokens(pickedTokens)} tokens`}</Text>
          </Box>
        )}
      </Box>
    )

  /** 一個 skill 名稱的按鈕，裁到 `room` 格以內（有用法時替「?」留位置）。點了填入 */
  const skillName = (s: SkillItem, room: number) => (
    <Button
      key={`skill-btn-${s.name}`}
      label={fitText(s.label, s.howto ? room - HOWTO_MARK : room)}
      plain
      // 關掉的 skill 變暗，照樣點了填入
      dimColor={isOff(s)}
      onPress={() => void fillPrompt($, `/${s.name} `, s.label)}
    />
  )
  /** 有用法的 skill 的「?」：點了開用法頁。平常藏著，停在那個 skill 上才出現，強調色才不會滿版都是 */
  const howtoMark = (s: SkillItem) =>
    s.howto ? (
      <Button key={`howto-btn-${s.name}`} label="?" plain onPress={() => void openHowto($, s.name)}>
        <Text color={accent}>?</Text>
      </Button>
    ) : undefined
  /** 名稱連同「?」排在同一行（開關模式那一行用；那裡的「?」不藏，暗色） */
  const skillButton = (s: SkillItem, room: number) => {
    const name = skillName(s, room)
    if (!s.howto) return name
    return (
      <Box key={`skill-cell-${s.name}`} flexDirection="row" gap={1}>
        {name}
        <Button key={`howto-btn-${s.name}`} label="?" plain dimColor onPress={() => void openHowto($, s.name)} />
      </Box>
    )
  }

  // 說明欄標題的提示：有用法的寫有幾項；這一輪還在整理、而且還沒輪到的寫整理中
  const isMaking = settings.howto && isMakingNow
  const howtoHint = (s: SkillItem) =>
    s.howto
      ? `點 ? 看用法（${howtoCount(s.howto)} 項）`
      : isMaking && !Object.hasOwn(known, s.name)
        ? '用法整理中…'
        : undefined

  const rows: Row<JSX.Element>[] = []
  for (const g of view.groups) {
    // 分類的第一組前面是分類的標題列（平常看一個分類時它固定在頂端，這裡不再畫），開關模式再多一列「整個分類」
    const category = view.before.get(g.id)
    if (category !== undefined) {
      if (!isHeadOnTop) rows.push({ id: `skill-category-${category}`, value: categoryHead(category) })
      const whole = isSwitching ? categorySwitchRow(category) : undefined
      if (whole !== undefined) rows.push(whole)
    }
    // 搜尋時與開關模式裡，組都自動展開
    const isOpen = isSearching || isSwitching || open.has(g.id)
    const group = { id: g.id, label: g.title }
    // plugin 組（底下全是同一個 plugin 的 skill，或停用後空了的）的開關是停用整個 plugin；其他組照 skill 算
    const pluginTail = pluginSwitchTail(g)
    const summary: SwitchSummary =
      pluginTail === undefined ? summaryOf([g]) : { on: 0, total: 0, state: pluginTail.isOff ? 'off' : 'on' }
    // 開關模式：行尾是 token 數與開關；平常模式：整組或部分關掉的組名變暗、行尾標「已關」「部分關」
    const tail = isSwitching
      ? pluginTail !== undefined
        ? pluginTail.tail
        : batchTail(`group-switch-${g.id}`, summary, () => flipBatch([g], g.title))
      : summary.state === 'off' || summary.state === 'partial' ? (
          <Box key={`group-state-${g.id}`} flexShrink={0}>
            <Text dimColor>{summary.state === 'off' ? '已關' : '部分關'}</Text>
          </Box>
        ) : null
    const switchTailWidth = pluginTail?.tail ? PLUGIN_SWITCH_TAIL : GROUP_SWITCH_TAIL
    const groupTailWidth = tail === null ? 0 : isSwitching ? switchTailWidth : GROUP_STATE_TAIL
    rows.push({
      id: `skill-group-${g.id}`,
      group,
      isHeader: true,
      value: (
        <Box key={`sg-row-${g.id}`} flexDirection="row" gap={1}>
          <Box flexGrow={1} flexShrink={1}>
            <Button
              key={`sg-btn-${g.id}`}
              // 停用的 plugin 組是空的（skill 已經不在清單裡），不寫個數
              label={fitText(
                foldLabel(isOpen, g.items.length === 0 ? g.title : `${g.title} (${g.items.length})`),
                cols - groupTailWidth,
              )}
              plain
              dimColor={!isSwitching && tail !== null}
              onPress={() => void toggleFold($, 'openSkillGroups', g.id)}
            >
              {groupHead(
                ui,
                isOpen,
                g.title,
                g.items.length === 0 ? undefined : g.items.length,
                cols - groupTailWidth,
                !isSwitching && tail !== null,
              )}
            </Button>
          </Box>
          {tail === null ? null : <Box key={`group-tail-${g.id}`} flexShrink={0}>{tail}</Box>}
        </Box>
      ),
    })
    if (!isOpen) continue
    // 開關模式：每個 skill 一行，行尾是 token 數與開關（plugin 的 skill 只有 token 數）
    if (isSwitching) {
      for (const s of g.items)
        rows.push({ id: `skill-${s.name}`, group, detail: s.description, detailHint: howtoHint(s), value: switchRow(s) })
      continue
    }
    if (settings.skillLayout === 'grid') {
      // 橫向：排成等寬的幾欄，每一格各有自己的說明
      rows.push(
        ...gridRows(g.items, cols, {
          rowId: `skill-line-${g.id}`,
          group,
          id: s => `skill-${s.name}`,
          labelWidth: s => textWidth(s.label) + (s.howto ? HOWTO_MARK : 0),
          detail: s => s.description,
          detailHint: howtoHint,
          cell: skillName,
          trailing: howtoMark,
        }),
      )
      continue
    }
    for (const s of g.items) {
      const trailing = howtoMark(s)
      rows.push({
        id: `skill-${s.name}`,
        group,
        detail: s.description,
        detailHint: howtoHint(s),
        value: <Box paddingLeft={2}>{skillName(s, cols - 2)}</Box>,
        ...(trailing === undefined ? {} : { trailing }),
      })
    }
  }

  return {
    ...(top === undefined ? {} : { top, topRows: view.topRows }),
    // 搜尋框在框內最後一行（說明區下面），像在底下打字篩選
    bottom: searchRow,
    actions,
    actionsWidth,
    rows,
    emptyText: isSearching ? '沒有符合的 skill' : '讀取中…',
  }
}

/** 標籤補到一樣寬（按顯示的格數，不是字數），下拉選單才會對齊 */
const LABEL_WIDTH = Math.max(...FIELDS.map(f => textWidth(f.label)))
const padded = (label: string) => label + ' '.repeat(LABEL_WIDTH - textWidth(label))

/** 留著的標示用的顏色：和目前分頁的強調色分開，停在 [設定] 時也看得出來 */
const INDICATOR_COLOR = 'warning'

/** [設定] 分頁：每個參數一個下拉選單，值存在 userConfig；改了模組會重載。 */
async function settingsTab($: EngineInterface, { ui }: TabContext): Promise<TabContent> {
  const { Box, Text, Button } = ui
  const Select = 'Select' in ui ? ui.Select : undefined
  const changed = new Set(changedFields(config.raw))

  const rows: Row<JSX.Element>[] = []
  for (const name of [...new Set(FIELDS.map(f => f.group))]) {
    const group = { id: name, label: name }
    rows.push({
      id: `set-group-${name}`,
      group,
      isHeader: true,
      value: <Text dimColor>{name}</Text>,
    })
    for (const f of FIELDS.filter(x => x.group === name)) {
      // 還是預設值的標籤變暗，改過的維持一般色、值後面多一個「•」，看得出改過哪些
      const isChanged = changed.has(f.field)
      rows.push({
        id: `set-${f.field}`,
        group,
        value: (
          <Box flexDirection="row" gap={1} paddingLeft={2}>
            <Text dimColor={!isChanged}>{padded(f.label)}</Text>
            {Select ? (
              <Select
                key={`set-select-${f.field}`}
                value={config.raw[f.field]}
                options={f.options}
                onSelect={(v: string) => {
                  if (v !== config.raw[f.field]) void setOption($, f.field, v)
                }}
              />
            ) : (
              <Text>{config.raw[f.field]}</Text>
            )}
            {isChanged && <Text dimColor>•</Text>}
          </Box>
        ),
      })
    }
  }

  // 少用的維護按鈕疊在下框線左端，暗色、沒有快捷鍵（免得誤按）。
  // 「恢復預設值」寫出會改幾項；都是預設值時暗著、按了沒有作用
  const reset = resetLabel(changed.size)
  const actions = (
    <Box key="settings-actions" flexDirection="row" gap={2}>
      <Button
        key="reset-options"
        label={reset}
        plain
        dimColor
        onPress={() => void (changed.size > 0 ? resetOptions($) : undefined)}
      />
      {/* 面板的狀態怪怪的時候救急用 */}
      <Button key="reload-mods" label="重新載入 mod" plain dimColor onPress={() => void reloadMods($)} />
    </Box>
  )
  const actionsWidth = 2 + textWidth(reset) + 2 + textWidth('重新載入 mod')

  // 目前裝的版本疊在下框線右端，回報問題或確認有沒有更新到時看這裡；後面的按鈕去看發布的是哪一版。
  // 發布的版本和裝的不同時，版本號後面留著高亮的標示，換上之後才消失。已經下載的話按鈕換成「立即換上」：
  // 不必詢問，重新載入 mod 就換上（不必重開 Claude Code），由新的那一份在開場講現在是哪一版
  const version = await readVersion($)
  const indicator = await shownIndicator($)
  if (version === '') return { actions, actionsWidth, rows }
  const versionText = `cockpit ${version}`
  const checkLabel = indicator?.kind === 'downloaded' ? SWITCH_NOW : '檢查版本'
  const status = (
    <Box key="settings-version" flexDirection="row" gap={2}>
      <Text dimColor>{versionText}</Text>
      {indicator && (
        <Text bold color={INDICATOR_COLOR}>
          {indicator.text}
        </Text>
      )}
      {indicator?.kind === 'downloaded' ? (
        <Button key="switch-now" label={SWITCH_NOW} plain onPress={() => void reloadMods($)} />
      ) : (
        <Button key="check-version" label="檢查版本" plain onPress={() => void checkVersion($)} />
      )}
      <Button key="changelog" label="更新紀錄" plain onPress={() => void openChangelog($)} />
    </Box>
  )
  const statusWidth =
    2 +
    textWidth(versionText) +
    (indicator ? 2 + textWidth(indicator.text) : 0) +
    2 +
    textWidth(checkLabel) +
    2 +
    textWidth('更新紀錄')
  return { actions, actionsWidth, status, statusWidth, rows }
}

// ══ 登記 hook 與外框 ══════════════════════════════════════════════════════

const ESTIMATE_PROMPT =
  "When you write a todo list or create a task, end each item's text with an estimate of how many minutes " +
  'it will take, as `(~Nm)` with N a whole number of at least 1, e.g. `Write the tests (~3m)`. ' +
  'Keep the estimate when you rewrite or reorder the list. A panel uses it to show progress.'

export const register: Register = (on, options) => {
  config.settings = parseSettings(options)
  config.raw = rawValues(options)

  on('session.start', async ($, e, next) => {
    hasMadeHowtos = false
    hasFrontmatter = false
    roadmapDir = undefined
    dirs.home = undefined
    dirs.root = undefined
    missedTranslations.clear()
    // 上一個 session 留下來的教學狀態不算數
    await Promise.all([
      update($, makingTutorial, () => ''),
      update($, makingHowtos, () => false),
      update($, tutorialMenu, () => false),
      $.command.register({
        name: 'cockpit',
        description: '開啟 cockpit 面板：模型、用量、任務、常用 prompt 與 skill',
      }),
    ])
    const { settings } = config
    const { lastTab, reloadingAt, seenVersion } = await restoreRemembered($)
    // 版本和上次開場時不一樣：講一聲換到哪一版（版本號變小是作者退版，說「退回」）
    const version = await readVersion($)
    const seen = typeof seenVersion === 'string' ? seenVersion : undefined
    const isNewVersion = versionChanged(seen, version)
    if (version !== '' && version !== seen) await $.store.set('seenVersion', version)
    if (isNewVersion && seen !== undefined) $.ui.toast(wordingFor(seen, version).switched(version))
    // 剛按過「重新載入 mod」：這一份是重載後的，回報一聲（已經講過換版就不重複）
    if (typeof reloadingAt === 'number') {
      await $.store.set('reloadingAt', null)
      if (!isNewVersion && justReloaded(reloadingAt, await $.clock.now())) $.ui.toast('cockpit 已重新載入')
    }
    await update($, tab, () => startTab(settings.defaultTab, lastTab))

    void refresh($)
    void loadUsage($)
    void loadPrompts($)
    void loadSkills($)
    void roadmapChanged($, { kind: 'open' })
    if (settings.autoOpen) void $.ui.open({ id: PANE, title: TITLE })
    // 發布的版本排在最後、隔一下才去看：上面的事都排出去、面板開出來之後才開始，檢查不擋住面板的顯示
    $.clock.after(STARTUP_CHECK_DELAY, () => void startupCheck($))

    // 有進行中的任務時，每秒看一次耗時要不要重畫（任務清單跨重載留著，所以開場先看一次要不要開計時器）
    syncTicker($, await read($, board))
    // 有額度資料時，每 60 秒重畫一次 5H 倒數
    $.clock.every(60_000, async () => {
      if ((await read($, usage)).rateLimits.length > 0) await update($, minute, n => n + 1)
    })

    return next(e)
  })

  on('command.run', { command: 'cockpit' }, async $ => {
    await refresh($)
    await $.ui.open({ id: PANE, title: TITLE, focus: true })

    return { text: 'Cockpit 面板已開啟。' }
  })

  // 使用者自己打 /model 或 /effort 時，跑完後同步面板
  on('command.run', { command: 'model' }, async ($, e, next) => {
    const ran = await next(e)
    await refresh($)
    return ran
  }).catch(($, e, next) => next(e))
  on('command.run', { command: 'effort' }, async ($, e, next) => {
    const ran = await next(e)
    const level = e.args.trim()
    if ((EFFORTS as readonly string[]).includes(level)) await update($, chosenEffort, () => level)
    await refresh($)
    return ran
  }).catch(($, e, next) => next(e))

  // 主執行緒每次送出請求時，記下實際使用的深度（已含模型的自動降級）
  on('turn.step', async function* ($, e, next) {
    if (e.agentId === undefined && e.effort !== undefined) {
      const level = String(e.effort)
      if (level !== lastEffort) {
        lastEffort = level
        void update($, effort, () => level)
      }
    }
    return yield* next(e)
  })

  on('session.measure', async ($, e, next) => {
    try {
      await applyUsage($, usageOf(e), false)
    } catch {}
    return next(e)
  })

  // 請模型在任務名稱後附上 (~Nm) 預估，面板用它預測剩餘時間
  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    return {
      sections: [...composed.sections, { id: 'cockpit:estimates', text: ESTIMATE_PROMPT, scope: 'session' }],
    }
  })

  // 任務來源只是旁觀：記錄失敗也不能影響工具本身，所以後處理一律吞掉例外
  // 任務來源一：TodoWrite 每次送來整份清單；subagent 的清單掛在派出它的任務底下
  on('tool.call', { tool: 'TodoWrite' }, async ($, e, next) => {
    const ran = await next(e)
    if (succeeded(ran)) {
      try {
        const owner = e.agentId
        // 時間與 subagent 的資料一起問
        const [now, agents] = await Promise.all([$.clock.now(), owner === undefined ? undefined : $.agent.list()])
        const info = agents?.find(a => a.id === owner)
        const agent = owner === undefined ? undefined : { label: info?.description ?? '', parentId: info?.parentId }
        await dispatch($, { kind: 'todos', todos: e.todos, now, agentId: owner, agent })
      } catch {}
    }
    return ran
  }).catch(($, e, next) => next(e))

  // 任務來源二：TaskCreate / TaskUpdate（整個 session 共用一份，只收主對話的）
  on('tool.call', { tool: 'TaskCreate' }, async ($, e, next) => {
    const ran = await next(e)
    // 這裡要用到 `ran.result`，條件寫開來型別才縮得進去
    if (e.agentId === undefined && ran.deny === undefined && ran.isError !== true) {
      try {
        await dispatch($, { kind: 'created', id: String(ran.result.task.id), subject: e.subject })
      } catch {}
    }
    return ran
  }).catch(($, e, next) => next(e))
  on('tool.call', { tool: 'TaskUpdate' }, async ($, e, next) => {
    const ran = await next(e)
    if (e.agentId === undefined && succeeded(ran)) {
      try {
        const now = await $.clock.now()
        await dispatch($, { kind: 'updated', id: String(e.taskId), status: e.status, subject: e.subject, now })
      } catch {}
    }
    return ran
  }).catch(($, e, next) => next(e))

  // 路線圖：把「寫了檔」「跑了 shell 指令」告訴 roadmap，要不要重讀由它決定
  on('tool.call', { tool: 'Write' }, async ($, e, next) => {
    const ran = await next(e)
    void roadmapChanged($, wroteFile(e.file_path, ran))
    return ran
  }).catch(($, e, next) => next(e))
  on('tool.call', { tool: 'Edit' }, async ($, e, next) => {
    const ran = await next(e)
    void roadmapChanged($, wroteFile(e.file_path, ran))
    return ran
  }).catch(($, e, next) => next(e))
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const ran = await next(e)
    void roadmapChanged($, ranShell(ran))
    return ran
  }).catch(($, e, next) => next(e))
  on('tool.call', { tool: 'PowerShell' }, async ($, e, next) => {
    const ran = await next(e)
    void roadmapChanged($, ranShell(ran))
    return ran
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const ui = $.ui.resolve(e)
    const { Box, Text, Button } = ui
    const Select = 'Select' in ui ? ui.Select : undefined
    const { settings } = config
    const accent = settings.accent
    // 外框要用的狀態一次讀完
    const [now, taskBoard, currentTab, currentModel, actualEffort, chosen, busy, usageNow, allPages] = await Promise.all([
      $.clock.now(),
      read($, board),
      read($, tab),
      read($, model),
      read($, effort),
      read($, chosenEffort),
      read($, switching),
      read($, usage),
      read($, pages),
    ])
    // 會隨時間變的只有 [任務] 上進行中的任務與額度的倒數：有它們才讀計時的狀態，
    // 其餘時候計時器跳了也不會重畫這個面板
    if (currentTab === 'tasks' && hasRunning(taskBoard)) await read($, tick)
    if (usageNow.rateLimits.length > 0) await read($, minute)
    const indicator = await shownIndicator($)

    // ── 分頁列：[任務] 的標籤帶著進度 ──
    const view = viewTasks(taskBoard, now)
    const tabLabel = (t: (typeof TABS)[number]) =>
      t.id === 'tasks' && view.main.total > 0 && view.main.doneCount < view.main.total
        ? `${t.label} ${view.main.doneCount}/${view.main.total}`
        : t.label
    // 有留著的標示時，「設定」變色並帶記號：停在別的分頁也看得出 [設定] 裡有事
    const isFlagged = (id: Tab) => id === 'settings' && indicator !== undefined
    // 分頁列有哪幾段、多寬由 layout 算；這裡照段落畫
    const bar = tabBarOf(
      TABS.map(t => ({ id: t.id, label: isFlagged(t.id) ? `${t.label} ${INDICATOR_MARK}` : tabLabel(t), hotkey: t.hotkey })),
      currentTab,
    )
    const { columns: cols, isTabsOnBorder } = chrome(e.props.bodyColumns, bar.width)
    const tabBar = (
      <Box key="tabs" flexDirection="row">
        <Text>{' '.repeat(bar.edge)}</Text>
        {bar.segments.map(s =>
          s.kind === 'sep' ? (
            // 不在框線上時分隔只留空白，寬度一樣
            <Text key={`tab-sep-${s.id}`} dimColor>
              {isTabsOnBorder ? s.text : ' '.repeat(textWidth(s.text))}
            </Text>
          ) : s.kind === 'current' ? (
            <Box key={`tab-${s.id}`}>
              <Text bold color={isFlagged(s.id) ? INDICATOR_COLOR : accent}>
                {s.text}
              </Text>
            </Box>
          ) : isFlagged(s.id) ? (
            <Button key={`tab-${s.id}`} plain hotkey={s.hotkey} onPress={() => void setTab($, s.id)}>
              <Text color={INDICATOR_COLOR}>{s.text}</Text>
            </Button>
          ) : (
            <Button key={`tab-${s.id}`} label={s.text} plain hotkey={s.hotkey} onPress={() => void setTab($, s.id)} />
          ),
        )}
        <Text>{' '.repeat(bar.edge)}</Text>
      </Box>
    )

    // ── 「狀態」框：用量，下面一行是模型與深度 ──
    const shownEffort = actualEffort || chosen
    const modelValue = MODELS.find(m => currentModel.toLowerCase().includes(m)) ?? currentModel
    const modelOptions = [
      ...MODELS.map(m => ({ value: m })),
      ...(modelValue !== '' && !(MODELS as readonly string[]).includes(modelValue) ? [{ value: modelValue }] : []),
    ]
    const selects = (
      <Box key="a-selects" flexDirection="row" gap={2}>
        <Box key="a-model" flexDirection="row" gap={1}>
          {Select ? (
            <Select
              key="model"
              label="模型 "
              value={modelValue || undefined}
              options={modelOptions}
              onSelect={(v: string) => {
                if (v !== modelValue) void switchTo($, 'model', v)
              }}
            />
          ) : (
            <Text>{`模型 ${modelValue || '讀取中…'}`}</Text>
          )}
          {busy === 'model' && <Text color="yellow">切換中…</Text>}
        </Box>
        <Box key="a-effort" flexDirection="row" gap={1}>
          {Select ? (
            <Select
              key="effort"
              label="深度 "
              value={shownEffort || undefined}
              options={EFFORTS.map(v => ({ value: v }))}
              onSelect={(v: string) => {
                if (v !== shownEffort) void switchTo($, 'effort', v)
              }}
            />
          ) : (
            <Text>{`深度 ${shownEffort || '—'}`}</Text>
          )}
          {busy === 'effort' && <Text color="yellow">切換中…</Text>}
          {busy !== 'effort' && actualEffort !== '' && chosen !== '' && actualEffort !== chosen && (
            <Text dimColor>{`(選 ${chosen})`}</Text>
          )}
        </Box>
      </Box>
    )
    const area = chipArea(usageNow, now, cols)
    const stateBody = (
      <Box key="a-body" flexDirection="column">
        <Box key="a-chips" flexDirection={area.isOneLine ? 'row' : 'column'} gap={area.gap}>
          {area.chips.map(c => {
            // 平常跟一般文字一樣，到門檻才上色；標籤、空心的部分與進度條後面的文字是暗色
            const tone = chipColor(c.percent, settings.yellow, settings.red)
            const parts = chipParts(c, area.barWidth)
            return (
              <Text key={`chip-${c.key}`}>
                <Text dimColor>{`${c.label} `}</Text>
                <Text color={tone}>{`${parts.percent} ${parts.filled}`}</Text>
                <Text dimColor>{`${parts.rest}${c.extra ? ` ${c.extra}` : ''}`}</Text>
              </Text>
            )
          })}
          {area.showHint && <Text dimColor>{USAGE_HINT}</Text>}
        </Box>
        {selects}
      </Box>
    )

    // ── 目前分頁的內容，交給 layout 分頁 ──
    const ctx: TabContext = { ui, cols, accent }
    const content =
      currentTab === 'tasks'
        ? await tasksTab($, ctx, view)
        : currentTab === 'basic'
          ? await basicTab($, ctx)
          : currentTab === 'skill'
            ? await skillTab($, ctx)
            : await settingsTab($, ctx)
    // 分頁的操作疊在下框線左端、狀態疊在右端（要翻頁時右端是翻頁鍵）；放不上的退回框內的最後幾行。
    // 有沒有要翻頁要排過才知道，所以先照不翻頁排一次，真的要翻頁再照翻頁排
    const footFor = (hasPages: boolean) =>
      footPlan(cols, { actions: content.actions && content.actionsWidth, status: content.status && content.statusWidth, hasPages })
    const shapeWith = ({ isActionsInside, isStatusInside }: ReturnType<typeof footFor>) =>
      layout(content.rows, {
        bodyRows: e.props.scroll.bodyRows,
        // 用量的行數，加上模型與深度那一行
        stateRows: area.rows + 1,
        isTabsOnBorder,
        isInline: e.props.placement === 'inline',
        inlineRows: settings.inlineRows,
        fixedRows:
          (content.top ? (content.topRows ?? 1) : 0) +
          (content.bottom ? 1 : 0) +
          (isActionsInside ? 1 : 0) +
          (isStatusInside ? 1 : 0),
        detailColumns: cols,
        page: allPages[currentTab],
        followId: content.followId,
      })
    const single = footFor(false)
    const singleShape = shapeWith(single)
    const foot = singleShape.pageCount > 1 ? footFor(true) : single
    const shape = foot === single ? singleShape : shapeWith(foot)
    const { isActionsOnBorder, isActionsInside, isStatusOnBorder, isStatusInside } = foot
    const p = shape.page
    /** 停在這一行（格）時才出現的東西；這一頁沒有說明欄（沒有 scope）時照常顯示 */
    const trailingOf = (key: string, trailing: JSX.Element | undefined, scope: string | undefined) =>
      trailing === undefined ? null : scope === undefined ? (
        <Box key={`${key}-trailing`} paddingLeft={1} flexShrink={0}>
          {trailing}
        </Box>
      ) : (
        <Box key={`${key}-trailing`} paddingLeft={1} flexShrink={0} display="none" hover={{ scope, display: 'flex' }}>
          {trailing}
        </Box>
      )
    const lineEls = shape.lines.map(l =>
      l.kind === 'row' ? (
        <Box
          key={l.row.id}
          flexDirection={l.row.trailing === undefined ? 'column' : 'row'}
          {...(l.scope ? { hover: { scope: l.scope } } : {})}
        >
          {l.row.value}
          {trailingOf(l.row.id, l.row.trailing, l.scope)}
        </Box>
      ) : l.kind === 'cells' ? (
        // 每一格自己是一個 hover scope：滑鼠在哪一格上，說明欄就顯示哪一個。
        // 欄與欄之間的間隔畫一條暗色直線，眼睛順著欄往下讀（格子是先由上往下排滿一欄）
        <Box key={l.row.id} flexDirection="row" paddingLeft={l.indent}>
          {gridSlots(l.cells, l.row.columnWidth, l.gap).map(({ cell: c, column, blanks }) => (
            <Box key={`${c.id}-column`} flexDirection="row" flexShrink={0}>
              {/* 前面空著的欄（被跨欄的名稱佔走、或那一欄到這裡已經排完）補空白，直線才會對齊 */}
              {Array.from({ length: blanks }, (_, k) => column - blanks + k).map(at => (
                <Box key={`${c.id}-blank-${at}`} flexDirection="row" flexShrink={0}>
                  {at > 0 && (
                    <Box width={l.gap} flexShrink={0}>
                      <Text dimColor>│</Text>
                    </Box>
                  )}
                  <Box width={l.row.columnWidth ?? 0} flexShrink={0} />
                </Box>
              ))}
              {column > 0 && (
                <Box key={`${c.id}-sep`} width={l.gap} flexShrink={0}>
                  <Text dimColor>│</Text>
                </Box>
              )}
              <Box
                key={c.id}
                flexDirection="row"
                flexShrink={0}
                {...(c.width !== undefined ? { width: c.width } : {})}
                {...(c.scope ? { hover: { scope: c.scope } } : {})}
              >
                <Text dimColor>{l.mark}</Text>
                {c.value}
                {trailingOf(c.id, c.trailing, c.scope)}
              </Box>
            </Box>
          ))}
        </Box>
      ) : (
        <Text key={l.key} dimColor wrap="truncate-end">
          {`${l.label}（續）`}
        </Text>
      ),
    )
    // 說明不疊在列表上（疊上去會擋住下面幾行的滑鼠），而是用 hover scope 顯示在這一區；
    // 標題是一條帶字的分隔線，說明文字不會壓在別的字上，所以不需要底色
    const detailTitle = '── 說明 '
    const ruleFrom = (used: number) => '─'.repeat(Math.max(0, cols - used))
    const detailArea = shape.detailRows > 0 && (
      <Box key="detail" flexDirection="column">
        <Box key="detail-title" height={1}>
          <Text dimColor>{detailTitle + ruleFrom(textWidth(detailTitle))}</Text>
          {/* 有提示的行（或格）各有一份帶提示的標題，和它的說明用同一個 scope，停留時蓋過上面那條 */}
          {shape.details.map(d => {
            if (d.hint === undefined) return null
            const lead = `${detailTitle}· `
            const hint = fitText(d.hint, cols - textWidth(lead))
            return (
              <Box
                key={`hint-${d.id}`}
                position="absolute"
                top={0}
                left={0}
                width={cols}
                height={1}
                overflow="hidden"
                display="none"
                hover={{ scope: d.scope, display: 'flex' }}
              >
                <Text wrap="truncate-end">
                  <Text dimColor>{lead}</Text>
                  {hint}
                  <Text dimColor>{` ${ruleFrom(textWidth(lead) + textWidth(hint) + 1)}`}</Text>
                </Text>
              </Box>
            )
          })}
        </Box>
        <Box key="detail-body" height={shape.detailRows} overflow="hidden">
          {shape.details.map(d => (
            <Box
              key={`detail-${d.id}`}
              position="absolute"
              top={0}
              left={0}
              width={cols}
              height={shape.detailRows}
              overflow="hidden"
              display="none"
              hover={{ scope: d.scope, display: 'flex' }}
            >
              {/* 說明欄放不下的部分不必送出去 */}
              <Text wrap="wrap">{fitText(d.text, shape.detailRows * cols)}</Text>
            </Box>
          ))}
        </Box>
      </Box>
    )
    // 翻頁鍵疊在下框線的右端，不另外佔一行
    const pager = shape.pageCount > 1 && (
      <Box key="pager" flexDirection="row" gap={2}>
        <Text> </Text>
        <Button key="pg-prev" label="上頁" plain hotkey="k" onPress={() => void turnPage($, currentTab, p - 1)} />
        <Text dimColor>{`${p + 1}/${shape.pageCount}`}</Text>
        <Button
          key="pg-next"
          label="下頁"
          plain
          hotkey="j"
          onPress={() => void turnPage($, currentTab, Math.min(shape.pageCount - 1, p + 1))}
        />
        <Text> </Text>
      </Box>
    )
    // 沒有列表時顯示的那一行也佔掉一行空白
    const isEmpty = content.emptyText !== undefined && content.rows.length === 0
    const spareRows = Math.max(0, shape.spareRows - (isEmpty ? 1 : 0))
    const tabBody = (
      <Box key="b-body" flexDirection="column">
        {content.top}
        {isEmpty && <Text dimColor>{content.emptyText}</Text>}
        {lineEls}
        {spareRows > 0 && <Box key="spare" height={spareRows} />}
        {detailArea}
        {content.bottom}
        {isStatusInside && content.status}
        {isActionsInside && content.actions}
      </Box>
    )
    // 操作疊在下框線上時頭尾各留一格，和翻頁鍵一樣
    // 狀態疊在下框線右端時頭尾各留一格
    const statusFoot = isStatusOnBorder && (
      <Box key="status" flexDirection="row">
        <Text> </Text>
        {content.status}
        <Text> </Text>
      </Box>
    )
    const actionsFoot = isActionsOnBorder && (
      <Box key="actions" flexDirection="row">
        <Text> </Text>
        {content.actions}
        <Text> </Text>
      </Box>
    )

    // 一個框：暗色圓角框線，標題疊在上框線上，`foot` 疊在下框線的右端、`footLeft` 疊在左端。
    // 引擎的框線不能嵌文字，所以標題另外用 absolute 蓋在框線那一行上
    const framed = (
      key: string,
      title: JSX.Element,
      body: JSX.Element,
      foot?: JSX.Element | false,
      footLeft?: JSX.Element | false,
    ) => (
      <Box key={key} flexDirection="column" position="relative">
        <Box flexDirection="column" borderStyle="round" borderDimColor paddingX={1}>
          {body}
        </Box>
        <Box key={`${key}-title`} position="absolute" top={0} left={2} flexDirection="row">
          {title}
        </Box>
        {footLeft && (
          <Box key={`${key}-foot-left`} position="absolute" bottom={0} left={2} flexDirection="row">
            {footLeft}
          </Box>
        )}
        {foot && (
          <Box key={`${key}-foot`} position="absolute" bottom={0} right={2} flexDirection="row">
            {foot}
          </Box>
        )}
      </Box>
    )

    return (
      <Box flexDirection="column">
        {framed('card-a', <Text bold> 狀態 </Text>, stateBody)}
        {!isTabsOnBorder && tabBar}
        {framed('card-b', isTabsOnBorder ? tabBar : <Text />, tabBody, pager || statusFoot, actionsFoot)}
      </Box>
    )
  })
}
