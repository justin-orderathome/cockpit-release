import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, ToolCallResult } from 'claude-code'

import type {
  BackgroundList,
  CommandEntry,
  Effort,
  EffortLevel,
  FrontmatterEntry,
  PromptGroup,
  SkillGroup,
  SkillItem,
  SkillOverrides,
  Subtab,
  Tab,
  TaskBoard,
  Ticket,
  UsageSnapshot,
} from '../types'
import {
  EMPTY_BACKGROUND,
  applyBackground,
  backgroundCells,
  parseNotification,
  runningByAgent,
  shellStart,
  viewBackground,
} from './background'
import type { SnapshotCron, SnapshotTask } from './background'
import { NO_CHANGELOG, changelogIn } from './changelog'
import { FIELDS, TABS, changedFields, parseSettings, rawValues, resetLabel } from './config'
import type { Field, Settings } from './config'
import type { Ask } from './ask'
import { rootedAt, safeFiles, tidy, under } from './files'
import type { Files } from './files'
import { composeFill } from './fill'
import { boardAfter, handledAfter, stepBoard } from './board'
import type { BoardState, BoardStep } from './board'
import { applyHandled, handledTickets, handlerMarks } from './handled'
import type { Handled, HandledEvent } from './handled'
import { dateOf, ranShell, reasonOf, succeeded, wroteFile } from './events'
import { howtoCount, howtoItems, howtoReport, makeHowtos, storedHowtos, withoutStale } from './howto'
import type { HowtoRound, HowtoRun, Howtos } from './howto'
import { viewHowtoPage } from './howtoPage'
import { ROW_GAP, chrome, fitText, foldLabel, footPlan, footWidth, gridRows, gridSlots, layout, tabBar as tabBarOf, tailWidth, textWidth } from './layout'
import type { Row } from './layout'
import { sessionMemory } from './memory'
import type { Reload } from './memory'
import { singleJob } from './once'
import { SAMPLE_PROMPTS, parsePrompts, withProject } from './prompts'
import { INDICATOR_MARK, STARTUP_CHECK_DELAY, SWITCH_NOW, indicatorFor, installedFrom, versionIn } from './release'
import type { Indicator, Install } from './release'
import { startTab, storedList, storedText, storedTranslations, toggled } from './remembered'
import { cronCreatedSignal, monitorSignal, wakeupSignal, workflowSignal } from './backgroundSource'
import type { BackgroundPorts, BackgroundSignal } from './backgroundSource'
import { roadmapSource, viewRoadmap } from './roadmap'
import type { RoadmapEvent } from './roadmap'
import { changes, isSame } from './same'
import {
  EMPTY_OVERRIDES,
  NO_SOURCES,
  SAMPLE_OVERRIDES,
  catalogCache,
  mergeSkillSources,
  parseOverrides,
  parseSkillLock,
  skillView,
} from './skills'
import type { SkillCatalog, SkillSources } from './skills'
import { findSkillFile } from './source'
import { NO_VERSIONS, groupVersion, groupVersionText, lockVersions, mergeLockVersions, pluginVersions, versionOf } from './versions'
import type { SkillVersions } from './versions'
import {
  IGNORED_NOTICE,
  INSTALLED_PLUGINS,
  LOCAL_SETTINGS,
  categoryTitle,
  installedPlugins,
  planSwitch,
  readEnabledPlugins,
  readOverrides,
  stateLabel,
  switchboard,
  tabLabel,
  withIgnoreLine,
} from './switches'
import type { Press, SwitchState } from './switches'
import { DEFAULT_SUBTAB, RUNNING_MARK, shownSubtab, subtabBar } from './subtabs'
import type { SubtabSources } from './subtabs'
import { tutorialPath, tutorialState, writeTutorial } from './tutorial'
import type { TutorialState, TutorialTarget } from './tutorial'
import type { Elements, TabContent, TabContext } from './tab'
import {
  EMPTY_BOARD,
  NO_TASK_TOOLS_HINT,
  agentCells,
  agentLabels,
  formatDuration,
  hasRunning,
  hasTaskTools,
  taskCells,
  timingOf,
  viewTasks,
} from './tasks'
import type { Progress, TaskEvent } from './tasks'
import { translateAll } from './translate'
import type { Translations } from './translate'
import { makeUpdater } from './updater'
import type { Updater, UpdaterPorts } from './updater'
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
 * 不碰引擎的部分各有自己的檔案：行數與欄數的預算在 `layout.ts`，每一列顯示什麼在 `tasks.ts`、
 * `roadmap.ts` 與 `background.ts`（背景工作），任務板的一件事動到哪幾份狀態在 `board.ts`，路線圖何時重讀也在 `roadmap.ts`；讀寫檔案的方式在 `files.ts`，
 * 跨 session 記住什麼在 `remembered.ts`，模組裡記著什麼、session 開始與 /clear 時忘掉哪些在 `memory.ts`，
 * 引擎的事件代表什麼在 `events.ts`；畫面那一側自己走的字（`Client`）在 `ticking.tsx`。
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
const board = atom({ plugin: 'cockpit', key: 'board' } as const, EMPTY_BOARD as TaskBoard)
// 查到之前當作有：不先閃一下提示
const taskTools = atom({ plugin: 'cockpit', key: 'taskTools' } as const, true)
// 任務板的完成數與總數：外框（分頁列的進度）只讀這個，任務板寫入時順便算、數字變了才寫
const progress = atom({ plugin: 'cockpit', key: 'progress' } as const, { doneCount: 0, total: 0 } as Progress)
const tab = atom({ plugin: 'cockpit', key: 'tab' } as const, 'tasks' as Tab)
/** [任務] 正在看的子分頁：同一個 session 內記住（`$.state`），不存回 `$.store`，新的 session 從「任務」開始 */
const subtab = atom({ plugin: 'cockpit', key: 'subtab' } as const, DEFAULT_SUBTAB as Subtab)
/**
 * 這個 session 的背景工作（「背景」子分頁）：放 `$.state`，mod 重載後還在；resume 與 /clear 隨 `$.state` 清空。
 * 和任務板分開：背景工作的變化不必重算任務的時程。怎麼變由 `background.ts` 的 `applyBackground` 決定
 */
const background = atom({ plugin: 'cockpit', key: 'background' } as const, EMPTY_BACKGROUND as BackgroundList)
/** 「背景」子分頁的「▸ 更早的 N 筆」攤開了沒：比照路線圖的收合，只記這個 session、重開回到收起 */
const backgroundOlderOpen = atom({ plugin: 'cockpit', key: 'backgroundOlderOpen' } as const, false)
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
/** plugin 與 npx skills 裝的 skill 的版號；停在 skill 或組名上才顯示 */
const skillVersions = atom({ plugin: 'cockpit', key: 'skillVersions' } as const, NO_VERSIONS as SkillVersions)
const openSkillGroups = atom({ plugin: 'cockpit', key: 'openSkillGroups' } as const, [] as string[])
const switchMode = atom({ plugin: 'cockpit', key: 'switchMode' } as const, false)
const skillSwitches = atom({ plugin: 'cockpit', key: 'skillSwitches' } as const, {} as Record<string, unknown>)
const pluginSwitches = atom({ plugin: 'cockpit', key: 'pluginSwitches' } as const, {} as Record<string, unknown>)
const installedPluginKeys = atom({ plugin: 'cockpit', key: 'installedPluginKeys' } as const, [] as string[])
/** [SKILL] 選中的分類名稱；'' 或已經不存在的分類就看第一個。跨 session 記住 */
const skillCategory = atom({ plugin: 'cockpit', key: 'skillCategory' } as const, '')
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
/** 這個 session 經手的票 → 最近一次經手的 loop；只記這個 session，不寫進票檔 */
const handled = atom({ plugin: 'cockpit', key: 'handled' } as const, {} as Handled)
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
// 打開用法頁之前，[SKILL] 列表停在第幾頁；返回時翻回去
let skillListPage = 0
// 路線圖放哪、什麼時候重讀、跟上次一不一樣，由 roadmap 自己記（模組重載時重來，/clear 時 reset）
const roadmapFrom = roadmapSource()

// 為了少問引擎、少讀檔而記在模組裡的東西；session 開始與 /clear 時各忘掉哪些，由 memory 決定
const memory = sessionMemory()
const { dirs, missedTranslations } = memory
/** 用法每整理好幾個才存一次（整份快取每次都要重寫） */
const HOWTO_SAVE_EVERY = 10

// ── 一起寫與背景工作 ─────────────────────────────────────

/**
 * 一筆要寫的狀態。一件事先把要寫的值都讀好、算好，收成這樣的一串，最後用 `writeAll` 一起寫：
 * 同一刻接連寫的值引擎只重畫一次；邊讀邊寫的話，每次寫入之間都夾著讀，會落在不同的畫格各畫一次。
 * 每一筆照樣寫明自己的 atom（引擎靠這個列出模組讀寫了什麼）。
 */
type Write = () => Promise<unknown>

/** 按鈕丟出去的非同步動作：不等它，失敗時用 toast 說原因（`what` 是「無法…」） */
function pressed($: EngineInterface, job: Promise<unknown>, what: string) {
  void job.catch(err => $.ui.toast(`${what}：${reasonOf(err)}`))
}

/** 一起寫出去（沒有要寫的就什麼都不做） */
async function writeAll(writes: readonly Write[]) {
  if (writes.length > 0) await Promise.all(writes.map(w => w()))
}

/**
 * 事件的後續工作排在背景：hook 不必等它，`next` 之後馬上回傳。
 * 一件做完才做下一件，照事件發生的順序（派出、結束、清單更新不會顛倒）；出錯只略過那一件。
 */
let backlog: Promise<void> = Promise.resolve()
function later(job: () => Promise<unknown>) {
  backlog = backlog.then(job).then(
    () => {},
    () => {},
  )
}

/** 一個 atom 存的值的型別 */
type Of<A extends { initial: unknown }> = A['initial']

/**
 * 要直接換成新值的狀態：有這個鍵才寫。規劃要寫什麼的程式只回傳這份資料，
 * 跟畫面上比、一起寫都在 `planWrites`。要套在當下最新值上的寫入（切換、翻頁、任務板）不走這裡。
 */
type Plan = {
  model?: Of<typeof model>
  chosenEffort?: Of<typeof chosenEffort>
  switching?: Of<typeof switching>
  effort?: Of<typeof effort>
  usage?: Of<typeof usage>
  alerted?: Of<typeof alerted>
  releasedVersion?: Of<typeof releasedVersion>
  downloadedVersion?: Of<typeof downloadedVersion>
  prompts?: Of<typeof prompts>
  hasProjectPrompts?: Of<typeof hasProjectPrompts>
  commands?: Of<typeof commands>
  frontmatter?: Of<typeof frontmatter>
  installedPluginKeys?: Of<typeof installedPluginKeys>
  overrides?: Of<typeof overrides>
  skillSources?: Of<typeof skillSources>
  skillVersions?: Of<typeof skillVersions>
  skillSwitches?: Of<typeof skillSwitches>
  pluginSwitches?: Of<typeof pluginSwitches>
  skillCategory?: Of<typeof skillCategory>
  translations?: Of<typeof translations>
  howtos?: Of<typeof howtos>
  makingHowtos?: Of<typeof makingHowtos>
  howtoPage?: Of<typeof howtoPage>
  tutorial?: Of<typeof tutorial>
  makingTutorial?: Of<typeof makingTutorial>
  tutorialMenu?: Of<typeof tutorialMenu>
  howtoMenu?: Of<typeof howtoMenu>
  roadmap?: Of<typeof roadmap>
  handled?: Of<typeof handled>
  tab?: Of<typeof tab>
  subtab?: Of<typeof subtab>
  taskTools?: Of<typeof taskTools>
}

/**
 * 一份 Plan 要寫的：一輪讀完畫面上的值，跟畫面上一樣的不寫（寫了就重繪）。
 * 引擎要 atom 寫明在讀寫的地方（ADR 0002），所以每個 atom 在這裡各寫一行，不從表裡挑。
 */
async function planWrites($: EngineInterface, plan: Plan): Promise<Write[]> {
  const keep = async <T,>(next: T | undefined, shown: () => Promise<T>, write: (value: T) => Write): Promise<Write[]> =>
    next === undefined || isSame(await shown(), next) ? [] : [write(next)]
  const writes = await Promise.all([
    keep(plan.model, () => read($, model), v => () => update($, model, () => v)),
    keep(plan.chosenEffort, () => read($, chosenEffort), v => () => update($, chosenEffort, () => v)),
    keep(plan.switching, () => read($, switching), v => () => update($, switching, () => v)),
    keep(plan.effort, () => read($, effort), v => () => update($, effort, () => v)),
    keep(plan.usage, () => read($, usage), v => () => update($, usage, () => v)),
    keep(plan.alerted, () => read($, alerted), v => () => update($, alerted, () => v)),
    keep(plan.releasedVersion, () => read($, releasedVersion), v => () => update($, releasedVersion, () => v)),
    keep(plan.downloadedVersion, () => read($, downloadedVersion), v => () => update($, downloadedVersion, () => v)),
    keep(plan.prompts, () => read($, prompts), v => () => update($, prompts, () => v)),
    keep(plan.hasProjectPrompts, () => read($, hasProjectPrompts), v => () => update($, hasProjectPrompts, () => v)),
    keep(plan.commands, () => read($, commands), v => () => update($, commands, () => v)),
    keep(plan.frontmatter, () => read($, frontmatter), v => () => update($, frontmatter, () => v)),
    keep(plan.installedPluginKeys, () => read($, installedPluginKeys), v => () => update($, installedPluginKeys, () => v)),
    keep(plan.overrides, () => read($, overrides), v => () => update($, overrides, () => v)),
    keep(plan.skillSources, () => read($, skillSources), v => () => update($, skillSources, () => v)),
    keep(plan.skillVersions, () => read($, skillVersions), v => () => update($, skillVersions, () => v)),
    keep(plan.skillSwitches, () => read($, skillSwitches), v => () => update($, skillSwitches, () => v)),
    keep(plan.pluginSwitches, () => read($, pluginSwitches), v => () => update($, pluginSwitches, () => v)),
    keep(plan.skillCategory, () => read($, skillCategory), v => () => update($, skillCategory, () => v)),
    keep(plan.translations, () => read($, translations), v => () => update($, translations, () => v)),
    keep(plan.howtos, () => read($, howtos), v => () => update($, howtos, () => v)),
    keep(plan.makingHowtos, () => read($, makingHowtos), v => () => update($, makingHowtos, () => v)),
    keep(plan.howtoPage, () => read($, howtoPage), v => () => update($, howtoPage, () => v)),
    keep(plan.tutorial, () => read($, tutorial), v => () => update($, tutorial, () => v)),
    keep(plan.makingTutorial, () => read($, makingTutorial), v => () => update($, makingTutorial, () => v)),
    keep(plan.tutorialMenu, () => read($, tutorialMenu), v => () => update($, tutorialMenu, () => v)),
    keep(plan.howtoMenu, () => read($, howtoMenu), v => () => update($, howtoMenu, () => v)),
    keep(plan.roadmap, () => read($, roadmap), v => () => update($, roadmap, () => v)),
    keep(plan.handled, () => read($, handled), v => () => update($, handled, () => v)),
    keep(plan.tab, () => read($, tab), v => () => update($, tab, () => v)),
    keep(plan.subtab, () => read($, subtab), v => () => update($, subtab, () => v)),
    keep(plan.taskTools, () => read($, taskTools), v => () => update($, taskTools, () => v)),
  ])
  return writes.flat()
}

/** 寫出一份 Plan；跟畫面上一樣的不寫 */
async function commit($: EngineInterface, plan: Plan) {
  await writeAll(await planWrites($, plan))
}

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
  // 換模型可能換掉任務工具（新模型預設沒有），一起查
  void checkTaskTools($)
  const current = await $.session.model()
  await commit($, { model: current })
  if ((await read($, chosenEffort)) !== '') return
  const level = await readEffort($)
  const fill = (known: string) => known || level
  if (level && changes(await read($, chosenEffort), fill)) await update($, chosenEffort, fill)
}

/**
 * 這個 session 有沒有任務工具（TaskCreate 或 TodoWrite）。延後載入的工具也列在 `$.tool.list()` 裡；
 * 查不到時維持原狀，不顯示提示。
 */
async function checkTaskTools($: EngineInterface) {
  try {
    const names = (await $.tool.list()).map(t => t.name)
    await commit($, { taskTools: hasTaskTools(names) })
  } catch {}
}

/** 以 slash command 切換，完成後更新顯示。 */
async function switchTo($: EngineInterface, command: 'model' | 'effort', value: string) {
  await commit($, { switching: command })
  try {
    await $.command.run({ command, args: value })
    if (command === 'effort') await commit($, { chosenEffort: value })
    await refresh($)
    $.ui.toast(`${command === 'model' ? '模型' : '深度'}已切換為 ${value}`)
  } catch (err) {
    $.ui.toast(`切換失敗：${reasonOf(err)}`)
  } finally {
    await commit($, { switching: '' })
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
  // 一樣的用量不必再寫（寫了就重畫）；用量與提醒過的門檻先算好再一起寫
  const json = JSON.stringify(snapshot)
  const isNew = json !== memory.shownUsage
  memory.shownUsage = json
  const checked = checkAlerts(snapshot, config.settings.toast, await read($, alerted), isFirst)
  await commit($, { ...(isNew ? { usage: snapshot } : {}), alerted: checked.alerted })
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

/** 更新用的 `claude plugin …` 指令最多等多久（毫秒）：要連 GitHub，比引擎預設的 30 秒寬 */
const UPDATE_TIMEOUT = 120_000

/**
 * 更新的流程（`updater.ts`）要用的引擎操作。記著的兩個版本放上畫面時，atom 一樣的不必再寫（寫了就重畫）。
 */
function updaterPorts($: EngineInterface): UpdaterPorts {
  return {
    run: argv => $.process.run(argv, { timeoutMs: UPDATE_TIMEOUT }),
    fetch: url => $.http.fetch(url),
    files: files($),
    store: { get: key => $.store.get(key), set: (key, value) => $.store.set(key, value) },
    now: () => $.clock.now(),
    home: () => homeDir($),
    toast: text => $.ui.toast(text),
    ask: (question, options) => $.ui.ask(question, options),
    reloadPlugins: async () => (await $.command.run({ command: 'reload-plugins' })).text,
    show: ({ released, downloaded }) => commit($, { releasedVersion: released, downloadedVersion: downloaded }),
  }
}

/** 這一份 cockpit 的更新流程：開場、檢查版本、重新載入 mod 都從這裡走 */
const updaterOf = async ($: EngineInterface): Promise<Updater> =>
  makeUpdater(updaterPorts($), {
    current: await readVersion($),
    install: await installOf($),
    autoUpdate: config.settings.autoUpdate,
  })

/**
 * 用 VS Code 開檔；檔案不存在時先寫入範例。`opened` 是開成功時要說的話，沒給就說開了哪個檔。
 * 相對路徑是專案裡的檔案，從專案根目錄算（shell `cd` 到別處也開得到）；說給使用者聽的還是原本那個短的。
 */
async function openInEditor($: EngineInterface, shown: string, sample?: string, opened?: string) {
  const path = under(await projectRoot($), shown)
  try {
    const disk = files($)
    if (sample !== undefined && (await disk.read(path)) === undefined) await disk.write(path, sample)
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
  const hasProject = projectText !== undefined
  const all = withProject(global, parsePrompts(projectText ?? '', 'project'))
  await commit($, { prompts: all, hasProjectPrompts: hasProject })
}

async function loadSkills($: EngineInterface) {
  // 先把 [SKILL] 要的都讀好、算好，有變的最後一起寫：載入的資料有變也只重畫一次
  const plan: Plan = {}
  try {
    const list = await $.command.list()
    const listed = list.map(c => ({ name: c.name, description: c.description, source: c.source, plugin: c.plugin }))
    plan.commands = listed
  } catch {}
  if (!memory.hasFrontmatter) {
    try {
      const u = await $.session.usage({ breakdown: 'summary' })
      const fm = u.context.breakdown?.skills?.skillFrontmatter ?? []
      const entries = fm.map(f => ({ name: f.name, source: f.source, pluginName: f.pluginName, tokens: f.tokens }))
      plan.frontmatter = entries
      memory.hasFrontmatter = true
    } catch {}
  }
  try {
    // 開關的狀態只看專案的 settings.local.json；每次切到 [SKILL] 都重讀，/skills 選單改的也看得到
    Object.assign(plan, switchPlan(await (await projectFiles($)).read(LOCAL_SETTINGS)))
    const home = await homeDir($)
    // plugin 組的開關要用完整的鍵；停用了的 plugin 也靠這份清單畫出它的組
    const installedText = await files($).read(`${home}/${INSTALLED_PLUGINS}`)
    const installed = installedPlugins(installedText)
    plan.installedPluginKeys = installed
    const text = await files($).read(`${home}/.claude/cockpit/skills.json`)
    const over = text === undefined ? EMPTY_OVERRIDES : parseOverrides(text)
    plan.overrides = over
    // 用 npx skills 裝的 skill 從哪裡來；沒用過 npx skills 就沒有這個檔
    const lock = await files($).read(`${home}/.agents/.skill-lock.json`)
    // 裝在專案裡的（不加 -g）記在專案根目錄的 skills-lock.json；根目錄和找專案 skill 原文時用同一份清單
    const projectLockTexts = await Promise.all(
      (await projectDirs($)).map(dir => files($).read(under(dir, 'skills-lock.json'))),
    )
    const sources = mergeSkillSources(parseSkillLock(lock), projectLockTexts.map(parseSkillLock))
    plan.skillSources = sources
    // 版號：plugin 看安裝紀錄，npx skills 裝的看 lock 檔
    plan.skillVersions = {
      plugins: pluginVersions(installedText),
      skills: mergeLockVersions(lockVersions(lock), projectLockTexts.map(lockVersions)),
    }
  } finally {
    // 中途讀不到時，之前已經讀好的照樣寫上去
    await commit($, plan)
  }
  // 用法排在說明的翻譯之後才整理；兩個開關各管各的
  void (async () => {
    if (config.settings.translate) await translateSkills($)
    // 用法一個 session 只自動整理一輪：每次切到 [SKILL] 都重跑的話，模型沒回應時會一直重問
    if (config.settings.howto && !memory.hasMadeHowtos) {
      memory.hasMadeHowtos = true
      await makeSkillHowtos($, 'auto')
    }
  })()
}

/** [SKILL] 目錄：原料（四個 atom）的 version 跟上次一樣就是上次那一份，列表與分組不重算 */
const catalogOf = catalogCache()

/**
 * 翻譯與整理用法要的目錄。和 [SKILL] 的重繪共用同一份記憶，所以一樣連同 version 讀：
 * 只給內容的話會用物件比，把畫面那邊記著的蓋掉，下一次重繪又得重新分組
 */
async function skillCatalog($: EngineInterface): Promise<SkillCatalog> {
  const [listedAt, fmAt, overAt, fromAt] = await Promise.all([
    $.state.get({ plugin: 'cockpit', key: 'commands' } as const),
    $.state.get({ plugin: 'cockpit', key: 'frontmatter' } as const),
    $.state.get({ plugin: 'cockpit', key: 'overrides' } as const),
    $.state.get({ plugin: 'cockpit', key: 'skillSources' } as const),
  ])
  return catalogOf(
    {
      commands: listedAt.value ?? commands.initial,
      frontmatter: fmAt.value ?? frontmatter.initial,
      overrides: overAt.value ?? overrides.initial,
      sources: fromAt.value ?? skillSources.initial,
    },
    { commands: listedAt.version, frontmatter: fmAt.version, overrides: overAt.version, sources: fromAt.version },
  )
}

// ── SKILL 的開關 ─────────────────────────────────────────

/** 讀專案的 settings.local.json，把 skillOverrides 與 enabledPlugins 寫進狀態；回傳讀到的原文（沒有檔是 undefined）。 */
async function loadSwitches($: EngineInterface): Promise<string | undefined> {
  const text = await (await projectFiles($)).read(LOCAL_SETTINGS)
  await showSwitches($, text)
  return text
}

async function showSwitches($: EngineInterface, text: string | undefined) {
  await commit($, switchPlan(text))
}

/** settings.local.json 的原文 → 兩份開關狀態 */
const switchPlan = (text: string | undefined): Plan => ({ skillSwitches: readOverrides(text), pluginSwitches: readEnabledPlugins(text) })

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
 * 按下一個開關：重讀專案的 settings.local.json，照 `planSwitch` 改寫、重讀狀態並跳提示。
 * 停用／啟用 plugin 要代跑 `/reload-plugins` 才套用到這個 session，之後重讀指令清單：停用的 plugin 的 skill 不見了，
 * 組改由停用名單畫出來。這會連 cockpit 自己一起重新載入；先跳提示，換上的新那一份照樣讀得到設定檔。
 */
async function applySwitch($: EngineInterface, press: Press) {
  const text = await loadSwitches($)
  const plan = planSwitch(text, press, await read($, frontmatter))
  if (plan.write !== undefined) {
    try {
      if (plan.isNewFile) await ignoreLocalSettings($)
      await (await projectFiles($)).write(LOCAL_SETTINGS, plan.write)
    } catch (err) {
      return void $.ui.toast(`無法寫入 ${LOCAL_SETTINGS}：${reasonOf(err)}`)
    }
    await showSwitches($, plan.write)
  }
  if (!plan.reload) return void $.ui.toast(plan.toast())
  let reloadError: string | undefined
  try {
    await $.command.run({ command: 'reload-plugins' })
  } catch (err) {
    reloadError = reasonOf(err)
  }
  $.ui.toast(plan.toast(reloadError))
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
        (await skillCatalog($)).listed(),
        await read($, translations),
        askModel($, 'haiku', 16000),
        async got => {
          // 這一批一筆都沒翻成就沒有東西要存
          if (Object.keys(got).length === 0) return
          const merge = (prev: Translations) => ({ ...prev, ...got })
          if (!changes(await read($, translations), merge)) return
          await $.store.set('translations', await update($, translations, merge))
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
        const items = await howtoItems((await skillCatalog($)).listed(), dirs, fs)
        // 原文改過的先從畫面上拿掉，舊的用法不留著
        const fresh = (prev: Howtos) => withoutStale(prev, items)
        const before = await read($, howtos)
        const known = changes(before, fresh) ? await update($, howtos, fresh) : before
        // 畫面每好一個就更新；存檔每幾個一次，最後再補存剩下的
        let unsaved = 0
        const round = await makeHowtos(
          items,
          // 重整不看快取；舊的用法留在畫面上，問到哪個換哪個，中途停下時還沒輪到的照舊
          run === 'full' ? {} : known,
          askModel($, 'haiku', 4000),
          async (name, entry) => {
            const put = (prev: Howtos) => ({ ...prev, [name]: entry })
            if (!changes(await read($, howtos), put)) return
            const next = await update($, howtos, put)
            if (++unsaved < HOWTO_SAVE_EVERY) return
            unsaved = 0
            await $.store.set('howtos', next)
          },
        )
        if (unsaved > 0) await $.store.set('howtos', await read($, howtos))
        return round
      },
      async running => {
        await commit($, { makingHowtos: running !== undefined })
      },
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
    // 每個工具跑完都會來這裡；跟路線圖無關的由 roadmap 擋掉，不讀任何檔
    const efforts = await roadmapFrom.next(event, await projectFiles($))
    if (efforts !== undefined) await showRoadmap($, efforts)
  } catch {}
}

/**
 * 把新的路線圖放上畫面，結案的票不再算經手：一起寫。roadmap 只給跟上次不一樣的；
 * mod 重新載入後它記的重來、畫面上的還在，所以照樣跟畫面上的比一次
 */
async function showRoadmap($: EngineInterface, efforts: Effort[]) {
  // 路線圖空了：選的子分頁不存在就一起寫回「任務」（規則在 subtabs）。路線圖還有東西時，這次變化不會讓任何子分頁消失
  const back = efforts.length === 0 ? await backIfGone($, async () => ({ efforts, background: await read($, background) })) : {}
  const writes = await Promise.all([planWrites($, { roadmap: efforts, ...back }), handledWrites($, { kind: 'closed', open: openTickets(efforts) })])
  await writeAll(writes.flat())
}

/**
 * 變化後選的子分頁不存在了：一起寫回「任務」，之後那一頁再出現也不會自己切回去（Plan 的一部分）。
 * 存在與否由 subtabs 決定，畫面用的是同一條規則。選的是「任務」（永遠存在）就不讀別的狀態：
 * 例如前景指令讓路線圖重讀時不碰背景清單
 */
async function backIfGone($: EngineInterface, sources: () => Promise<SubtabSources>): Promise<Pick<Plan, 'subtab'>> {
  const chosen = await read($, subtab)
  if (chosen === DEFAULT_SUBTAB) return {}
  const shown = shownSubtab(chosen, await sources())
  return shown === chosen ? {} : { subtab: shown }
}

// ── 經手 ─────────────────────────────────────────────────

/** 路線圖上還沒結案的票的路徑 */
const openTickets = (efforts: readonly Effort[]) =>
  efforts.flatMap(f => [...f.decisions, ...f.builds]).flatMap(t => (t.state === 'done' ? [] : [t.path]))

/** 只改經手的紀錄要寫的（不碰任務板，所以只讀這一份）；沒變就沒有 */
async function handledWrites($: EngineInterface, event: HandledEvent): Promise<Write[]> {
  const before = await read($, handled)
  return isSame(before, applyHandled(before, event)) ? [] : [() => update($, handled, h => applyHandled(h, event))]
}

/**
 * 某個 loop（主對話沒有 agentId）送出、派工或改檔的文字裡有沒有還沒結案的票：有就算它經手。
 * 跟票無關的先擋掉，不問引擎任何事。旁觀而已，出錯也不影響原本的事。
 */
async function touchTickets($: EngineInterface, text: string, agentId: string | undefined) {
  try {
    const touched = await touchedBy($, text, agentId)
    if (touched !== undefined) await writeAll(await handledWrites($, touched))
  } catch {}
}

/** 文字裡有還沒結案的票時，那個 loop 經手了哪幾張；沒有、或出錯都是 undefined */
async function touchedBy($: EngineInterface, text: string, agentId: string | undefined): Promise<HandledEvent | undefined> {
  try {
    if (!/\.md\b/i.test(text)) return undefined
    const open = openTickets(await read($, roadmap))
    if (open.length === 0) return undefined
    const tickets = handledTickets(text, open, await projectRoot($))
    return tickets.length > 0 ? { kind: 'touched', tickets, agentId } : undefined
  } catch {
    return undefined
  }
}

/** [設定] 的「更新紀錄」：用編輯器打開裝著的那一份；這一版沒有那個檔就說沒有。 */
async function openChangelog($: EngineInterface) {
  const path = changelogIn($.plugin.root)
  if ((await files($).read(path)) === undefined) return void $.ui.toast(NO_CHANGELOG)
  await openInEditor($, path, undefined, '已開啟更新紀錄')
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

/**
 * 切到某個分頁，並重讀那一頁的資料。
 * 換頁要寫的先算好一起寫，畫面立刻換；之後載入的資料有變才再寫一次。
 */
async function setTab($: EngineInterface, next: Tab) {
  // 離開用法頁；[任務] 的子分頁不動，回來時停在上次看的那一個
  const writes = await Promise.all([planWrites($, { tab: next }), howtoCloseWrites($)])
  await writeAll(writes.flat())
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
  let next: string[]
  if (fold === 'openEfforts') {
    const before = await read($, openEfforts)
    next = changes(before, flip) ? await update($, openEfforts, flip) : before
  } else if (fold === 'openSkillGroups') {
    const before = await read($, openSkillGroups)
    next = changes(before, flip) ? await update($, openSkillGroups, flip) : before
  } else {
    const before = await read($, closedPromptGroups)
    next = changes(before, flip) ? await update($, closedPromptGroups, flip) : before
  }
  await $.store.set(fold, next)
}

/**
 * 開場時把上個 session 存的面板狀態讀回來；各個鍵同時讀、同時寫，形狀不對的維持預設。
 * 更新用的鍵（記著的版本）由 `updater.ts` 的 `open` 讀回。
 */
async function restoreRemembered($: EngineInterface): Promise<{ lastTab: unknown }> {
  const [lastTab, cachedTranslations, cachedHowtos, efforts, skillGroups, promptGroups, category] = await Promise.all([
    $.store.get('lastTab'),
    $.store.get('translations'),
    $.store.get('howtos'),
    $.store.get('openEfforts'),
    $.store.get('openSkillGroups'),
    $.store.get('closedPromptGroups'),
    $.store.get('skillCategory'),
  ])
  const openE = (list: string[]) => storedList(efforts) ?? list
  const openS = (list: string[]) => storedList(skillGroups) ?? list
  const closedP = (list: string[]) => storedList(promptGroups) ?? list
  const picked = storedText(category)
  const translated = storedTranslations(cachedTranslations)
  // 用法的快取：形狀不對或舊版 prompt 整理的不收
  const cached = storedHowtos(cachedHowtos)
  await Promise.all([
    (async () => void (changes(await read($, openEfforts), openE) && (await update($, openEfforts, openE))))(),
    (async () => void (changes(await read($, openSkillGroups), openS) && (await update($, openSkillGroups, openS))))(),
    (async () => void (changes(await read($, closedPromptGroups), closedP) && (await update($, closedPromptGroups, closedP))))(),
    commit($, { skillCategory: picked, translations: translated, howtos: cached }),
  ])
  return { lastTab }
}

/** 打開一個 skill 的用法頁：從它的第一頁看起，並記下列表原本停在第幾頁。 */
async function openHowto($: EngineInterface, name: string) {
  skillListPage = (await read($, pages)).skill
  const first = (ps: Record<Tab, number>) => ({ ...ps, skill: 0 })
  if (changes(await read($, pages), first)) await update($, pages, first)
  // 教學的狀態要看檔案才知道：先當作沒有，看完再補上按鈕
  await commit($, { tutorial: { ...NO_TUTORIAL, name }, tutorialMenu: false, howtoPage: name })
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
  if ((await read($, howtoPage)) === name) await commit($, { tutorial: { name, status } })
}

/** 產生一個 skill 的教學（問的是 sonnet），存檔後在編輯器打開。同一時間只產一份。 */
async function makeSkillTutorial($: EngineInterface, name: string, label: string) {
  await showTutorialMenu($, false)
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
      async running => {
        await commit($, { makingTutorial: running ?? '' })
      },
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
  const fresh = (prev: { name: string; status: TutorialState }) => (prev.name === name ? { name, status: 'fresh' as const } : prev)
  if (changes(await read($, tutorial), fresh)) await update($, tutorial, fresh)
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
  await writeAll(await howtoCloseWrites($))
}

/** 離開用法頁要寫的：回到列表、翻回原本那一頁；本來就在列表時沒有 */
async function howtoCloseWrites($: EngineInterface): Promise<Write[]> {
  const [page, shown] = await Promise.all([read($, howtoPage), read($, pages)])
  if (isSame(page, '')) return []
  const back = (ps: Record<Tab, number>) => ({ ...ps, skill: skillListPage })
  const writes: Write[] = [() => update($, howtoPage, () => '')]
  if (changes(shown, back)) writes.push(() => update($, pages, back))
  return writes
}

/** 按「重新載入路線圖」：重讀（只在「路線圖」子分頁有這個鍵，不動自動跟隨） */
async function lookAtRoadmap($: EngineInterface) {
  await roadmapChanged($, { kind: 'open' })
}

/** 展開或收起 effort，並存起來 */
async function toggleEffort($: EngineInterface, name: string) {
  const open = toggled(await read($, openEfforts), name)
  await update($, openEfforts, list => toggled(list, name))
  await $.store.set('openEfforts', open)
}

/** 翻頁；`unfollows` 是在「任務」子分頁翻的（停止自動跟隨，和翻頁一起寫） */
async function turnPage($: EngineInterface, current: Tab, to: number, unfollows: boolean) {
  const turned = (ps: Record<Tab, number>) => ({ ...ps, [current]: Math.max(0, to) })
  const [shown, follow] = await Promise.all([read($, pages), unfollows ? taskWrites($, { task: { kind: 'unfollow' } }) : []])
  await writeAll([...(changes(shown, turned) ? [() => update($, pages, turned)] : []), ...follow])
}

/** 換 [任務] 的子分頁：從新那一頁的第一頁看起；子分頁與頁碼一起寫，只重繪一次 */
async function pickSubtab($: EngineInterface, next: Subtab) {
  const [now, shown] = await Promise.all([read($, subtab), read($, pages)])
  if (isSame(now, next)) return
  const top = (ps: Record<Tab, number>) => ({ ...ps, tasks: 0 })
  await writeAll([() => update($, subtab, () => next), ...(changes(shown, top) ? [() => update($, pages, top)] : [])])
}

// ── 任務 ─────────────────────────────────────────────────

async function dispatch($: EngineInterface, event: TaskEvent) {
  await writeAll(await taskWrites($, { task: event }))
}

/** 任務板、完成數與總數、經手：一輪讀完 */
async function boardState($: EngineInterface): Promise<BoardState> {
  const [b, p, h] = await Promise.all([read($, board), read($, progress), read($, handled)])
  return { board: b, progress: p, handled: h }
}

/**
 * 一件事要寫的：三份裡變了的才寫（停在別的分頁時，只有完成數與總數變了外框才重畫）。
 * 怎麼變由 `board.ts` 決定；寫入套在當下最新的值上，讀完之後別人寫的不會被蓋掉。
 */
function boardWrites($: EngineInterface, state: BoardState, step: BoardStep): Write[] {
  const { next, changed } = stepBoard(state, step)
  const writes: Write[] = []
  if (changed.board) writes.push(() => update($, board, b => boardAfter(b, step)))
  if (changed.progress) writes.push(() => update($, progress, () => next.progress))
  if (changed.handled) writes.push(() => update($, handled, h => handledAfter(h, next.board, step)))
  return writes
}

/** 一件事要寫的；沒變就沒有 */
async function taskWrites($: EngineInterface, step: BoardStep): Promise<Write[]> {
  return boardWrites($, await boardState($), step)
}

// ── 背景工作 ─────────────────────────────────────────────
// 什麼時候問引擎什麼、要套哪個事件都在 `backgroundSource.ts`；這裡只組 ports、照回答寫

/** 背景來源問引擎用的：讀清單、時間、CronList 的權限與內容（寫入不在這裡） */
function backgroundPorts($: EngineInterface): BackgroundPorts {
  return {
    list: () => read($, background),
    now: () => $.clock.now(),
    cronListAccess: async () => ((await $.tool.check({ tool: 'CronList', input: {} })).decision === 'allow' ? 'allow' : 'other'),
    cronList: async () => {
      try {
        const ran = await $.tool.call({ tool: 'CronList' })
        return succeeded(ran) ? ran.result.jobs : undefined
      } catch (err) {
        $.ui.log(`讀 CronList 失敗：${reasonOf(err)}`, { to: 'debug' })
        return undefined
      }
    },
  }
}

/**
 * 一件背景工作的事：問背景來源要套什麼，沒變就不寫。看得到的全沒了、而選的子分頁因此不存在時，
 * 子分頁一起寫回「任務」（同一批寫入，只重繪一次；規則在 subtabs）。寫入套在當下最新的清單上；事件自己帶著時刻，套幾次結果都一樣
 */
async function backgroundSignal($: EngineInterface, signal: BackgroundSignal) {
  const step = await memory.background.next(signal, backgroundPorts($))
  if (step === undefined) return
  const { event, isEmpty } = step
  const back = isEmpty ? await planWrites($, await backIfGone($, async () => ({ efforts: await read($, roadmap), background: EMPTY_BACKGROUND }))) : []
  await writeAll([() => update($, background, l => applyBackground(l, event)), ...back])
}

/** 對話停下（`classic.Stop`／`classic.SubagentStop`）帶的快照：兩者的處理一樣 */
type StopSnapshot = { session_id: string; background_tasks?: readonly SnapshotTask[]; session_crons?: readonly SnapshotCron[] }

/** 對話停下（主對話或 subagent）：快照排到背景校正，hook 不必等它 */
function snapshotLater($: EngineInterface, e: StopSnapshot) {
  const signal: BackgroundSignal = { kind: 'snapshot', sessionId: e.session_id, tasks: e.background_tasks ?? [], ...(e.session_crons === undefined ? {} : { crons: e.session_crons }) }
  later(() => backgroundSignal($, signal))
}

/**
 * shell 指令（Bash、PowerShell）跑完：指令裡有票的路徑算經手（被擋下、根本沒跑的不算）；告訴路線圖跑了指令；
 * 結果帶 `backgroundTaskId`（run_in_background、Ctrl+B、逾時轉背景）就加一筆背景工作。
 * 沒有這個欄位的前景指令不多任何 host 呼叫
 */
function shellDone(
  $: EngineInterface,
  e: { command: string; description?: string; agentId?: string },
  ran: ToolCallResult<'Bash'> | ToolCallResult<'PowerShell'>,
) {
  if (ran.deny === undefined) later(() => touchTickets($, e.command, e.agentId))
  void roadmapChanged($, ranShell(ran))
  const bgId = succeeded(ran) ? ran.result.backgroundTaskId : undefined
  if (bgId !== undefined) later(() => backgroundSignal($, { kind: 'started', work: shellStart(bgId, e.command, e.description, e.agentId) }))
}

/** 寫檔的工具（Write、Edit）跑完：改了票檔算經手；告訴路線圖寫了哪個檔（要不要重讀由它決定） */
function fileWritten($: EngineInterface, e: { file_path: string; agentId?: string }, ran: { deny?: unknown; isError?: boolean }) {
  if (succeeded(ran)) later(() => touchTickets($, e.file_path, e.agentId))
  void roadmapChanged($, wroteFile(e.file_path, ran))
}

// ── 面板上的小開關：每個都寫明自己的 atom，沒變就不寫（寫了就重畫） ──

async function showTutorialMenu($: EngineInterface, on: boolean) {
  await commit($, { tutorialMenu: on })
}

async function showHowtoMenu($: EngineInterface, on: boolean) {
  await commit($, { howtoMenu: on })
}

async function flipSwitchMode($: EngineInterface) {
  const flip = (on: boolean) => !on
  if (changes(await read($, switchMode), flip)) await update($, switchMode, flip)
}

async function flipDoneEfforts($: EngineInterface) {
  const flip = (on: boolean) => !on
  if (changes(await read($, showDoneEfforts), flip)) await update($, showDoneEfforts, flip)
}

async function flipBackgroundOlder($: EngineInterface) {
  const flip = (on: boolean) => !on
  if (changes(await read($, backgroundOlderOpen), flip)) await update($, backgroundOlderOpen, flip)
}

async function foldRoadmap($: EngineInterface, id: string, isOpen: boolean) {
  const fold = (folds: Record<string, boolean>) => ({ ...folds, [id]: !isOpen })
  if (changes(await read($, roadmapFolds), fold)) await update($, roadmapFolds, fold)
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
 * [任務] 分頁：子分頁「路線圖」（每個 effort 一行，展開後看票）、「任務」（待辦清單與 subagent 列）
 * 與「背景」（這個 session 的背景工作，依狀態分段），一次看一種。
 * 哪幾個分頁籤要畫、各寫什麼由 `subtabs.ts` 決定。
 * 每一行顯示哪些字、多寬時留哪幾欄，由 `viewRoadmap` 與 `taskCells` 決定；這裡只負責畫與掛上動作。
 */
async function tasksTab($: EngineInterface, { ui, cols, accent }: TabContext, now: number): Promise<TabContent> {
  const { Box, Text, Button } = ui
  // 會隨時間變的字畫成 Client，在畫面那一側自己走；沒有 Client 的介面畫成這一刻的樣子，下次重繪才更新
  const Client = 'Client' in ui ? ui.Client : undefined
  // 這個分頁要用的狀態一次讀完
  const [taskBoard, efforts, showDone, open, folds, handledNow, hasTools, chosenSubtab, works, showOlder] = await Promise.all([
    read($, board),
    read($, roadmap),
    read($, showDoneEfforts),
    read($, openEfforts),
    read($, roadmapFolds),
    read($, handled),
    read($, taskTools),
    read($, subtab),
    read($, background),
    read($, backgroundOlderOpen),
  ])
  // subagent 列的「· 背景 N」與背景說明區的「由 subagent「…」開」：兩份資料在這裡合起來，各自的狀態不互相塞
  const view = viewTasks(taskBoard, now, runningByAgent(works))
  const bg = viewBackground(works, now, { showOlder, agents: taskBoard.agents })
  const main = view.main
  // 經手的票行尾標經手者的模型；路線圖整個算一塊，和 [任務] 清單分開決定完整或縮寫
  const road = viewRoadmap(efforts, {
    open: new Set(open),
    showDone,
    width: cols,
    folds,
    handled: handlerMarks(handledNow, taskBoard),
    base: view.base,
  })

  // ── 子分頁籤：哪些存在、各寫什麼、實際看哪一個，都由 subtabs 決定 ──
  const bar = subtabBar(
    chosenSubtab,
    { efforts, background: works },
    { tasks: { main, agentCount: view.agentCount, isRunning: hasRunning(taskBoard) }, roadmap: road, background: bg },
    cols,
  )
  const isTasks = bar.shown === 'tasks'
  const isRoadmap = bar.shown === 'roadmap'
  const isBackground = bar.shown === 'background'
  const subtabLine = bar.segments && (
    <Box key="subtabs" flexDirection="row">
      {bar.segments.map(s =>
        s.kind === 'sep' ? (
          <Text key={`subtab-sep-${s.id}`} dimColor>
            {' │ '}
          </Text>
        ) : s.kind === 'current' ? (
          <Box key={`subtab-${s.id}`} flexDirection="row">
            <Text bold color={accent}>
              {s.label}
            </Text>
            {s.count !== undefined && <Text color={accent}>{` ${s.count}`}</Text>}
            {s.isRunning && <Text color={accent}>{` ${RUNNING_MARK}`}</Text>}
          </Box>
        ) : (
          <Button key={`subtab-${s.id}`} label={s.text} plain hotkey={s.hotkey} onPress={() => pressed($, pickSubtab($, s.id), '無法切換子分頁')}>
            <Text>{s.label}</Text>
            {s.count !== undefined && <Text dimColor>{` ${s.count}`}</Text>}
            {s.isRunning && <Text color={accent}>{` ${RUNNING_MARK}`}</Text>}
          </Button>
        ),
      )}
    </Box>
  )

  // 「任務」子分頁最上面只留「還需約」（有預估時才有）；進度與 subagent 數看分頁籤
  const remainingMs = main.total > 0 && main.doneCount < main.total ? main.remainingMs : undefined
  // 只有主清單有進行中的任務時才會隨時間變；只剩等著的，數字不變，照一般文字畫
  const isCounting = remainingMs !== undefined && main.rows.some(r => r.status === 'in_progress')
  const remainingLine =
    isTasks && remainingMs !== undefined ? (
      <Box key="tasks-head" flexDirection="row" overflow="hidden">
        {isCounting && Client ? (
          // 每秒走：交給 Client，數字照主清單還沒完成的列往後推
          <Client
            key="tasks-remaining"
            module="./ticking.tsx"
            props={{ kind: 'remaining', at: now, rows: main.rows.filter(r => r.status !== 'completed').map(timingOf) }}
          />
        ) : (
          <Text dimColor wrap="truncate-end">{`還需約 ${formatDuration(remainingMs)}`}</Text>
        )}
      </Box>
    ) : undefined
  // 沒有任務工具時，模型寫不出清單：「任務」子分頁多一行告訴使用者怎麼打開
  const hint =
    isTasks && !hasTools ? (
      <Text key="no-task-tools" color="warning" wrap="truncate-end">
        {NO_TASK_TOOLS_HINT}
      </Text>
    ) : undefined
  const topLines = [subtabLine, remainingLine, hint].filter((l): l is JSX.Element => Boolean(l))
  const top =
    topLines.length === 0 ? undefined : (
      <Box key="tasks-top" flexDirection="column">
        {topLines}
      </Box>
    )
  // ── 待辦清單：只有進行中的畫進度條與百分比，其餘整列暗色 ──
  // 模型標示整塊一起決定完整或縮寫
  const labels = agentLabels(view, cols)
  // 三個子分頁的列只建正在看的那一頁（其他頁的 view 仍要算：分頁籤的數字用得到）
  const todoRows: Row<JSX.Element>[] = (isTasks ? view.rows : []).map(r => {
    const indent = r.depth * 2
    if (r.kind === 'agent') {
      // subagent 列：狀態圖示、描述（有清單時帶 done/total）、模型標示、耗時；結束的整列變暗
      const cells = agentCells(r, cols - indent)
      const label = labels.get(r.id)
      return {
        id: r.id,
        group: r.group,
        isHeader: true,
        detail: r.detail,
        value: (
          <Box flexDirection="row" gap={ROW_GAP} paddingLeft={indent}>
            <Text
              color={cells.color === 'accent' ? accent : cells.color}
              dimColor={cells.isEnded}
            >
              {cells.icon}
            </Text>
            <Box flexGrow={1} flexShrink={1} flexDirection="row">
              <Box flexShrink={1}>
                <Text dimColor={cells.isEnded} wrap="truncate-end">
                  {cells.title}
                </Text>
              </Box>
              {cells.background !== undefined && (
                <Box flexShrink={0}>
                  <Text dimColor>{` ${cells.background}`}</Text>
                </Box>
              )}
            </Box>
            {label !== undefined && <Text dimColor={cells.isEnded}>{label}</Text>}
            {r.state === 'running' && r.elapsedMs !== undefined && Client ? (
              <Client key={`agent-time-${r.id}`} module="./ticking.tsx" props={{ kind: 'agent', at: now, elapsedMs: r.elapsedMs }} />
            ) : (
              <Text dimColor>{cells.time}</Text>
            )}
            {cells.canDismiss && (
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
    const isTicking = isRunning && Client !== undefined
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
          {isTicking && Client && (
            // 進度條、百分比與時間每秒走：交給 Client，照這一刻的數字往後推
            <Client
              key={`task-time-${task.id}`}
              module="./ticking.tsx"
              props={{ kind: 'task', at: now, row: timingOf(task), width: cols - indent, gap: ROW_GAP, accent }}
            />
          )}
          {!isTicking && cells.bar && (
            <Text key={`task-bar-${task.id}`}>
              <Text color={accent}>{cells.bar.filled}</Text>
              <Text dimColor>{cells.bar.rest}</Text>
            </Text>
          )}
          {!isTicking && cells.percent !== undefined && <Text>{cells.percent}</Text>}
          {!isTicking && (
            <Text color={cells.isOverdue ? 'error' : undefined} dimColor={!cells.isOverdue}>
              {cells.time}
            </Text>
          )}
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

  // ── 路線圖子分頁：每個 effort 一行，展開後看票 ──
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
  const roadmapRows: Row<JSX.Element>[] = (isRoadmap ? road.rows : []).map((r): Row<JSX.Element> => {
            const f = r.effort
            // 展開後的行算在這個 effort 的組裡，跨頁時「（續）」才看得出是哪一個
            const effortGroup = { id: `effort/${f.name}`, label: `路線圖：${f.name}` }
            if (r.kind === 'effort') {
              return {
                id: `effort/${f.name}`,
                value: (
                  <Box flexDirection="row" gap={ROW_GAP}>
                    <Box flexGrow={1} flexShrink={1}>
                      <Button key={`effort-btn-${f.name}`} label={r.label} plain onPress={() => void toggleEffort($, f.name)} />
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
                      onPress={() => void foldRoadmap($, r.foldId, r.isOpen)}
                    />
                  </Box>
                ),
              }
            }
            const t = r.ticket
            return {
              id: `ticket/${t.path}`,
              group: effortGroup,
              detail: r.detail,
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
                  {r.model !== undefined && <Text>{r.model}</Text>}
                </Box>
              ),
            }
          })

  // ── 背景子分頁：依狀態分段（執行中、排程、已結束），段標題比照組名；每一列圖示、名稱、種類、時間、× ──
  const backgroundRows: Row<JSX.Element>[] = (isBackground ? bg.rows : []).map((r): Row<JSX.Element> => {
    if (r.kind === 'section') {
      return {
        id: r.id,
        group: { id: `background/${r.section}`, label: r.label },
        isHeader: true,
        value: (
          <Box key={r.id} flexDirection="row">
            <Text bold>{r.label}</Text>
            <Text dimColor>{` ${r.count}`}</Text>
          </Box>
        ),
      }
    }
    if (r.kind === 'older') {
      // 「▸ 更早的 N 筆」：比照路線圖的「▸ 已結案 N」，點了攤開或收起
      return {
        id: r.id,
        group: r.group,
        value: <Button key="fold-background-older" label={r.text} plain dimColor onPress={() => pressed($, flipBackgroundOlder($), '無法攤開更早的')} />,
      }
    }
    const w = r.work
    const cells = backgroundCells(r, cols)
    // 名稱與時間的色調：完成的變暗，失敗與被停掉的紅色
    const tone = cells.tone === 'error' ? { color: 'error' } : { dimColor: cells.tone === 'dim' }
    // 有畫剩餘時間、而且它會往下走（有逾時的 Monitor）
    const leftTicks = cells.left !== undefined && r.remainingMs !== undefined
    return {
      id: r.id,
      group: r.group,
      detail: r.detail,
      value: (
        <Box key={`background-row-${w.id}`} flexDirection="row" gap={ROW_GAP}>
          {cells.at !== undefined && <Text color="cyan">{cells.at}</Text>}
          {cells.icon !== '' && (
            <Text color={cells.color === 'accent' ? accent : cells.color} dimColor={cells.color === undefined || cells.tone === 'dim'}>
              {cells.icon}
            </Text>
          )}
          <Box flexGrow={1} flexShrink={1}>
            <Text wrap="truncate-end" {...tone}>
              {cells.title}
            </Text>
          </Box>
          {cells.kind !== undefined && <Text dimColor>{cells.kind}</Text>}
          {/* Monitor 的「剩 25m」也交給 Client 往下走；「持續」與沒有 Client 時畫成固定的字 */}
          {cells.left !== undefined && !(leftTicks && cells.isTicking && Client) && <Text dimColor>{cells.left}</Text>}
          {cells.isTicking && Client ? (
            // 經過時間每秒走：交給 Client，plugin 這一側沒有計時器
            <Client
              key={`background-time-${w.id}`}
              module="./ticking.tsx"
              props={{ kind: 'background', at: now, elapsedMs: r.elapsedMs ?? 0, ...(leftTicks ? { remainingMs: r.remainingMs } : {}) }}
            />
          ) : (
            <Text {...(cells.tone === 'error' ? tone : { dimColor: true })}>{cells.time}</Text>
          )}
          {cells.canDismiss && (
            <Button
              key={`dismiss-background-${w.id}`}
              label="×"
              plain
              dimColor
              onPress={() => pressed($, backgroundSignal($, { kind: 'changed', event: { kind: 'dismiss', id: w.id } }), '無法隱藏這一列')}
            />
          )}
        </Box>
      ),
    }
  })

  // 分頁的操作疊在下框線上，跟著子分頁換：路線圖 d、r；任務 c；背景 c（只清背景）
  const doneLabel = showDone ? '隱藏已完成 effort' : `已完成 effort ${road.doneCount}`
  const showsDoneToggle = isRoadmap && road.doneCount > 0
  const showsClear = isTasks && view.hasCompleted
  const showsClearBackground = isBackground && bg.hasEnded
  const actionPieces = [
    ...(showsClear ? [{ hotkey: 'c', label: '清除已完成' }] : []),
    ...(showsClearBackground ? [{ hotkey: 'c', label: '清除已結束' }] : []),
    ...(showsDoneToggle ? [{ hotkey: 'd', label: doneLabel }] : []),
    ...(isRoadmap ? [{ hotkey: 'r', label: '重新載入路線圖' }] : []),
  ]
  const actions =
    actionPieces.length === 0 ? undefined : (
      <Box key="tasks-actions" flexDirection="row" gap={2}>
        {showsClear && (
          <Button
            key="clear-done"
            label="清除已完成"
            plain
            dimColor
            hotkey="c"
            onPress={() => void dispatch($, { kind: 'clearCompleted' })}
          />
        )}
        {showsClearBackground && (
          <Button
            key="clear-ended-background"
            label="清除已結束"
            plain
            dimColor
            hotkey="c"
            onPress={() => pressed($, backgroundSignal($, { kind: 'changed', event: { kind: 'clearEnded' } }), '無法清除已結束')}
          />
        )}
        {showsDoneToggle && (
          <Button
            key="toggle-done-efforts"
            label={doneLabel}
            plain
            dimColor
            hotkey="d"
            onPress={() => void flipDoneEfforts($)}
          />
        )}
        {isRoadmap && (
          <Button
            key="reload-roadmap"
            label="重新載入路線圖"
            plain
            dimColor
            hotkey="r"
            onPress={() => void lookAtRoadmap($)}
          />
        )}
      </Box>
    )
  const actionsWidth = footWidth(actionPieces)

  return {
    ...(top === undefined ? {} : { top, topRows: topLines.length }),
    ...(actions === undefined ? {} : { actions, actionsWidth }),
    rows: isTasks ? todoRows : isRoadmap ? roadmapRows : backgroundRows,
    emptyText: isTasks ? '模型使用待辦清單後，任務會顯示在這裡。' : isRoadmap ? '沒有進行中的 effort。' : '沒有背景工作。',
    // 自動跟隨只在「任務」子分頁裡翻頁，永遠不換子分頁
    ...(isTasks ? { followId: view.followId, unfollowsOnTurn: true } : {}),
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
  const actionsWidth = footWidth([
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


// [SKILL] 行尾留的寬度（名稱裁短時扣掉這些）；按鈕的字取最寬的那一個
/** 開關模式一個 skill：token 數與 `[ 開 ]` */
const SWITCH_TAIL = tailWidth([{ tokens: true }, { button: '開' }])
/** 開關模式 plugin 的 skill：只有 token 數（沒有開關） */
const TOKENS_TAIL = tailWidth([{ tokens: true }])
/** 開關模式的組：token 數與 `[ 部分 ]` */
const GROUP_SWITCH_TAIL = tailWidth([{ tokens: true }, { button: '部分' }])
/** 開關模式的 plugin 組：token 數與 `[ 停用整個 plugin ]` */
const PLUGIN_SWITCH_TAIL = tailWidth([{ tokens: true }, { button: '停用整個 plugin' }])
/** 平常模式的組：「部分關」 */
const GROUP_STATE_TAIL = tailWidth([{ plain: '部分關' }])

/** [SKILL] 分頁：已安裝的 skill，依 plugin 分組。點了把 `/<skill 名稱> ` 填進輸入框。 */
async function skillTab($: EngineInterface, { ui, cols, accent }: TabContext): Promise<TabContent> {
  const { Box, Text, Button } = ui
  const { settings } = config

  // 這個分頁要用的狀態一次讀完。目錄的原料連同 version 一起讀：讀出來每次都是新物件，
  // 目錄照 version 判斷原料沒變，沒變就不重新分組
  const [
    knownAt,
    listedAt,
    fmAt,
    overAt,
    translatedAt,
    [pageName, howtoState],
    openIds,
    isChoosing,
    isMakingNow,
    fromAt,
    chosenCategory,
    isSwitching,
    switches,
    enabledPlugins,
    installed,
    versionsKnown,
  ] = await Promise.all([
    $.state.get({ plugin: 'cockpit', key: 'howtos' } as const),
    $.state.get({ plugin: 'cockpit', key: 'commands' } as const),
    $.state.get({ plugin: 'cockpit', key: 'frontmatter' } as const),
    $.state.get({ plugin: 'cockpit', key: 'overrides' } as const),
    $.state.get({ plugin: 'cockpit', key: 'translations' } as const),
    // 用法頁開著才讀教學的狀態
    read($, howtoPage).then(async name =>
      name === '' ? ([name, undefined] as const) : ([name, await Promise.all([read($, tutorial), read($, makingTutorial), read($, tutorialMenu)])] as const),
    ),
    read($, openSkillGroups),
    read($, howtoMenu),
    read($, makingHowtos),
    $.state.get({ plugin: 'cockpit', key: 'skillSources' } as const),
    read($, skillCategory),
    read($, switchMode),
    read($, skillSwitches),
    read($, pluginSwitches),
    read($, installedPluginKeys),
    read($, skillVersions),
  ])
  // 還沒寫過的狀態讀出來是 undefined（version 0），照 atom 的初始值
  const known = knownAt.value ?? howtos.initial
  const listed = listedAt.value ?? commands.initial
  const fm = fmAt.value ?? frontmatter.initial
  const over = overAt.value ?? overrides.initial
  const translated = translatedAt.value ?? translations.initial
  const from = fromAt.value ?? skillSources.initial
  const versions = { commands: listedAt.version, frontmatter: fmAt.version, overrides: overAt.version, sources: fromAt.version }
  // 每個 skill、組、分類的開關狀態與按下去做什麼（停用了的 plugin 照樣有一組，才按得到「啟用」）
  const board = switchboard({
    commands: listed,
    frontmatter: fm,
    overrides: over,
    groups: catalogOf({ commands: listed, frontmatter: fm, overrides: over, sources: from }, versions).groups({
      ...(settings.translate ? { translations: translated } : {}),
      // 「整理用法」關掉時當作都沒有用法：沒有「?」、進不了用法頁、搜尋也不比對；存著的用法不動
      ...(settings.howto ? { howtos: known } : {}),
      versions: {
        ...(settings.translate ? { translations: translatedAt.version } : {}),
        ...(settings.howto ? { howtos: knownAt.version } : {}),
      },
    }),
    switches,
    enabledPlugins,
    installed,
  })
  const all = board.groups

  // ── 用法頁：列表換成一個 skill 的說明與用法 ──
  const shown = pageName === '' ? undefined : all.flatMap(g => g.items).find(s => s.name === pageName)
  if (shown?.howto !== undefined && howtoState !== undefined) {
    // 教學：找不到 SKILL.md 的沒有按鈕；已經有教學時，說明上面多一行狀態與「重新產生」
    const [known, making, isConfirming] = howtoState
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
                <Button key="tutorial-menu-close" label="×" onPress={() => void showTutorialMenu($, false)} />
              </Box>
            ) : (
              <Button key="tutorial-remake" label="重新產生" plain onPress={() => void showTutorialMenu($, true)} />
            )}
          </Box>
        ),
      }
    })
    return { top: head, rows: pageRows }
  }

  const open = new Set(openIds)
  // 有分類時一次看選中的那個分類（規則在 skills.ts 的 skillView）
  const { categories } = board
  const view = skillView(all, categories, chosenCategory)
  const { picked, isHeadOnTop } = view

  /** 「更新用法」選了怎麼跑：收起選單再開始 */
  const runHowtos = async (run: HowtoRun) => {
    await showHowtoMenu($, false)
    await makeSkillHowtos($, run)
  }

  // 開關模式：o 進出。按鈕和「更新用法」一起疊在下框線上（分頁的操作都在那裡），不跟著翻頁，o 在任何捲動位置都有效
  const switchButton = (
    <Button
      key="switch-mode"
      label={isSwitching ? '完成' : '開關'}
      plain
      hotkey="o"
      onPress={() => void flipSwitchMode($)}
    />
  )

  // 有用法的 skill，名稱後面多一個「?」，連同前面的間隔佔 2 格
  const HOWTO_MARK = 2

  // 分頁的操作（更新用法、開關）疊在下框線上；寬度照畫出來的字算
  const howtoAction = !settings.howto
    ? undefined
    : isMakingNow
      ? {
          pieces: [{ plain: '用法整理中…' }],
          el: (
            <Box key="howto-making" flexShrink={0}>
              <Text dimColor>用法整理中…</Text>
            </Box>
          ),
        }
      : isChoosing
        ? {
            // 按了「更新用法」：選只補缺的（快速），或全部重新問一次（重整）
            pieces: [{ hotkey: 'q', label: '快速' }, { hotkey: 'r', label: '重整' }, { button: '×' }],
            el: (
              <Box key="howto-menu" flexDirection="row" gap={2} flexShrink={0}>
                <Button key="howto-quick" label="快速" plain hotkey="q" onPress={() => void runHowtos('quick')} />
                <Button key="howto-full" label="重整" plain hotkey="r" onPress={() => void runHowtos('full')} />
                <Button key="howto-menu-close" label="×" onPress={() => void showHowtoMenu($, false)} />
              </Box>
            ),
          }
        : {
            pieces: [{ hotkey: 'u', label: '更新用法' }],
            el: (
              <Button
                key="refresh-howtos"
                label="更新用法"
                plain
                hotkey="u"
                onPress={() => void showHowtoMenu($, true)}
              />
            ),
          }
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
  const actions = (
    <Box key="skill-actions" flexDirection="row" gap={2}>
      {switchButton}
      {howtoAction?.el}
      {editOverrides}
    </Box>
  )
  const actionsWidth = footWidth([
    { hotkey: 'o', label: isSwitching ? '完成' : '開關' },
    ...(howtoAction?.pieces ?? []),
    { hotkey: 'e', label: '編輯覆寫' },
  ])

  /**
   * 開關模式裡一個 skill 的那一行：名稱、token 數與 [開]／[關]。
   * plugin 的 skill 沒有單獨的開關（要停用整個 plugin），行尾只有 token 數。
   */
  const switchRow = (s: SkillItem) => {
    const { isOff, tokens, press } = board.skill(s)
    const tail =
      press === undefined && tokens === undefined ? null : (
        <Box key={`switch-cell-${s.name}`} flexDirection="row" gap={1} flexShrink={0}>
          {tokens === undefined ? null : <Text dimColor>{String(tokens)}</Text>}
          {press === undefined ? null : (
            <Button key={`switch-${s.name}`} label={isOff ? '關' : '開'} dimColor={isOff} onPress={() => void applySwitch($, press)} />
          )}
        </Box>
      )
    const tailWidth = tail === null ? 0 : press === undefined ? TOKENS_TAIL : SWITCH_TAIL
    return (
      <Box flexDirection="row" paddingLeft={2} gap={1}>
        <Box flexGrow={1} flexShrink={1}>
          {skillButton(s, cols - 2 - tailWidth)}
        </Box>
        {tail}
      </Box>
    )
  }
  /**
   * 一組或一個分類行尾的 token 數與開關；沒有開關可按時沒有。plugin 組的開關寫「plugin 開」／「停用整個 plugin」，
   * 和一般的開、關、部分看得出不同。
   */
  const switchTail = (key: string, at: { isPlugin?: boolean; state?: SwitchState; tokens?: number; press?: Press }) => {
    const { state, tokens, press } = at
    if (state === undefined || press === undefined) return null
    const label = at.isPlugin ? (state === 'off' ? '停用整個 plugin' : 'plugin 開') : stateLabel(state)
    return (
      <Box key={`${key}-tail`} flexDirection="row" gap={1} flexShrink={0}>
        {tokens === undefined ? null : <Text dimColor>{shortTokens(tokens)}</Text>}
        <Button key={key} label={label} dimColor={state !== 'on'} onPress={() => void applySwitch($, press)} />
      </Box>
    )
  }
  /** 開關模式裡「整個分類」那一列；分類裡沒有可開關的 skill（只有 plugin 組）時沒有這一列 */
  const categorySwitchRow = (name: string): Row<JSX.Element> | undefined => {
    const c = board.category(name)
    if (c === undefined) return undefined
    const tail = switchTail(`category-switch-${name}`, { ...c.summary, ...(c.press === undefined ? {} : { press: c.press }) })
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
    const title = categoryTitle(name, board.category(name)?.summary ?? { on: 0, total: 0 })
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
    if (isSame(await read($, skillCategory), name)) return
    await update($, skillCategory, () => name)
    await $.store.set('skillCategory', name)
  }
  // 有分類時頂端是一排分類分頁籤，照寫的順序，「未分類」在最後；整個分類關掉或部分關掉時標「·關」「·部分」。
  // 看一個分類時，它的 token 數接在同一列的右端（開了幾個看分頁籤的標記就知道），不另佔一行。
  const pickedTokens = isHeadOnTop && picked !== undefined ? board.category(picked.name)?.summary.tokens : undefined
  const top =
    categories === undefined ? undefined : (
      <Box key="skill-top" flexDirection="row" gap={1}>
        <Box key="skill-categories" flexDirection="row" gap={1} flexGrow={1} flexShrink={1}>
          {categories.map(c => {
            const label = tabLabel(c.name, board.category(c.name)?.summary.state)
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
      dimColor={board.skill(s).isOff}
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
  // 說明欄標題後面的提示：版號與日期在前（查得到才有），接著是用法。
  // 日期一起寫：官方 marketplace 的是整個 repo 的 commit、npx skills 的是資料夾雜湊，看日期才知道有沒有更新
  const howtoHint = (s: SkillItem) => {
    const howto = s.howto
      ? `點 ? 看用法（${howtoCount(s.howto)} 項）`
      : isMaking && !Object.hasOwn(known, s.name)
        ? '用法整理中…'
        : undefined
    const found = versionOf(versionsKnown, s.name)
    const version = found === undefined ? undefined : groupVersionText(found)
    return version === undefined ? howto : howto === undefined ? version : `${version} · ${howto}`
  }

  /** 組名列浮出的版號字；組裡的 skill 版號不一致（例如混了來源的自訂組）就沒有 */
  const groupVersionOf = (g: SkillGroup) => {
    const v = groupVersion(
      versionsKnown,
      g.id,
      g.items.map(s => s.name),
    )
    return v === undefined ? undefined : groupVersionText(v)
  }

  const rows: Row<JSX.Element>[] = []
  for (const g of view.groups) {
    // 分類的第一組前面是分類的標題列（平常看一個分類時它固定在頂端，這裡不再畫），開關模式再多一列「整個分類」
    const category = view.before.get(g.id)
    if (category !== undefined) {
      if (!isHeadOnTop) rows.push({ id: `skill-category-${category}`, value: categoryHead(category) })
      const whole = isSwitching ? categorySwitchRow(category) : undefined
      if (whole !== undefined) rows.push(whole)
    }
    // 開關模式裡，組都自動展開
    const isOpen = isSwitching || open.has(g.id)
    const group = { id: g.id, label: g.title }
    // plugin 組（底下全是同一個 plugin 的 skill，或停用後空了的）的開關是停用整個 plugin；其他組照 skill 算
    const at = board.group(g)
    // 開關模式：行尾是 token 數與開關；平常模式：整組或部分關掉的組名變暗、行尾標「已關」「部分關」
    const tail = isSwitching
      ? switchTail(at.isPlugin ? `plugin-switch-${g.id}` : `group-switch-${g.id}`, at)
      : at.state === 'off' || at.state === 'partial' ? (
          <Box key={`group-state-${g.id}`} flexShrink={0}>
            <Text dimColor>{at.state === 'off' ? '已關' : '部分關'}</Text>
          </Box>
        ) : null
    const switchTailWidth = at.isPlugin && at.press !== undefined ? PLUGIN_SWITCH_TAIL : GROUP_SWITCH_TAIL
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
          {/* 版號：停在組名列時才浮在行尾（「已關」、開關的左邊）；疊在上面，不擠動組名。
              不給 key：給了它自己就成了 hover 範圍，而它平常藏著、滑鼠停不到 */}
          {groupVersionOf(g) === undefined ? null : (
            <Box
              position="absolute"
              right={tail === null ? 0 : groupTailWidth + 1}
              display="none"
              hover={{ display: 'flex' }}
            >
              <Text color={accent}>{` ${groupVersionOf(g)}`}</Text>
            </Box>
          )}
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
    actions,
    actionsWidth,
    rows,
    emptyText: '讀取中…',
  }
}

/** 標籤補到一樣寬（按顯示的格數，不是字數），下拉選單才會對齊 */
const LABEL_WIDTH = Math.max(...FIELDS.map(f => textWidth(f.label)))
const padded = (label: string) => label + ' '.repeat(LABEL_WIDTH - textWidth(label))

/** 留著的標示用的顏色：和目前分頁的強調色分開，停在 [設定] 時也看得出來 */
const INDICATOR_COLOR = 'warning'

/** [設定] 分頁：每個參數一個下拉選單，值存在 userConfig；改了模組會重載。 */
async function settingsTab($: EngineInterface, { ui, indicator }: TabContext): Promise<TabContent> {
  const { Box, Text, Button } = ui
  const Select = 'Select' in ui ? ui.Select : undefined
  // 下框線右端的版本（留著的標示外框已經讀好，跟著 ctx 來）
  const version = await readVersion($)
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
      <Button key="reload-mods" label="重新載入 mod" plain dimColor onPress={() => void updaterOf($).then(u => u.reload())} />
    </Box>
  )
  const actionsWidth = footWidth([{ plain: reset }, { plain: '重新載入 mod' }])

  // 目前裝的版本疊在下框線右端，回報問題或確認有沒有更新到時看這裡；後面的按鈕去看發布的是哪一版。
  // 發布的版本和裝的不同時，版本號後面留著高亮的標示，換上之後才消失。已經下載的話按鈕換成「立即換上」：
  // 不必詢問，重新載入 mod 就換上（不必重開 Claude Code），由新的那一份在開場講現在是哪一版
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
        <Button key="switch-now" label={SWITCH_NOW} plain onPress={() => void updaterOf($).then(u => u.reload())} />
      ) : (
        <Button key="check-version" label="檢查版本" plain onPress={() => void updaterOf($).then(u => u.check())} />
      )}
      <Button key="changelog" label="更新紀錄" plain onPress={() => void openChangelog($)} />
    </Box>
  )
  const statusWidth = footWidth([
    { plain: versionText },
    ...(indicator ? [{ plain: indicator.text }] : []),
    { plain: checkLabel },
    { plain: '更新紀錄' },
  ])
  return { actions, actionsWidth, status, statusWidth, rows }
}

// ── 每個 session 的開場 ──────────────────────────────────

/** /clear 之後隔多久重讀：等引擎換到新的 session id，寫進去的狀態才不會跟著舊的被丟掉 */
const CLEAR_RELOAD_DELAY = 300

/**
 * 把一個 session 畫面上要有的資料讀進來。session.start 與 /clear 之後各跑一次
 * （/clear 不會觸發 session.start，`$.state` 卻會清空）。模組裡記著的哪些要忘掉由 memory 決定：
 * /clear 不換專案，問過的目錄與整理過一輪的用法沿用，用法不再整套重讀一次。
 */
async function loadSession($: EngineInterface, reason: Reload) {
  memory.begin(reason)
  roadmapFrom.reset()
  // 教學與用法照實際有沒有在跑（/clear 時可能還在跑）；選單收起；經手只算這個 session 的
  await commit($, {
    makingTutorial: tutorialJob.current() ?? '',
    makingHowtos: howtoRound.current() !== undefined,
    tutorialMenu: false,
    handled: {},
  })
  const { lastTab } = await restoreRemembered($)
  const first = startTab(config.settings.defaultTab, lastTab)
  await commit($, { tab: first })

  // 背景預載：不等它們
  void Promise.allSettled([refresh($), loadUsage($), loadPrompts($), loadSkills($), roadmapChanged($, { kind: 'open' })])
  // 任務清單跨重載留著：完成數與總數照留著的清單對一次（耗時欄在畫面那一側自己走，這裡不開計時器）
  await writeAll(await taskWrites($, {}))
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
    await $.command.register({
      name: 'cockpit',
      description: '開啟 cockpit 面板：模型、用量、任務、常用 prompt 與 skill',
    })
    const { settings } = config
    const updater = await updaterOf($)
    await Promise.all([loadSession($, 'start'), updater.open()])
    if (settings.autoOpen) void $.ui.open({ id: PANE, title: TITLE })
    // 發布的版本排在最後、隔一下才去看：上面的事都排出去、面板開出來之後才開始，檢查不擋住面板的顯示
    $.clock.after(STARTUP_CHECK_DELAY, () => void updater.startupCheck())
    return next(e)
  })

  // /clear 換成新的 session id，`$.state` 跟著清空，但不會再來一次 session.start：
  // 等舊的 session 收完尾、換到新的之後，自己把畫面上的資料重讀一遍
  on('session.end', async ($, e, next) => {
    const ended = await next(e)
    if (e.reason === 'clear')
      $.clock.after(CLEAR_RELOAD_DELAY, () => void loadSession($, 'clear'))
    return ended
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
    if ((EFFORTS as readonly string[]).includes(level)) await commit($, { chosenEffort: level })
    await refresh($)
    return ran
  }).catch(($, e, next) => next(e))

  // 主執行緒每次送出請求時，記下實際使用的深度（已含模型的自動降級）
  on('turn.step', async function* ($, e, next) {
    // 這個 hook 的工作在 next 之前：量的是交給 next 之前的那一段（記下要做的事，排到背景）
    const level = e.agentId === undefined && e.effort !== undefined ? String(e.effort) : undefined
    // 模型標示：每個 loop 記住最近一次的模型與深度，主對話的是基準；沒變就不寫，免得每一步都重畫
    const step: TaskEvent = { kind: 'step', agentId: e.agentId, model: e.model, effort: e.effort === undefined ? undefined : String(e.effort) }
    later(async () => {
      const isNew = level !== undefined && level !== memory.lastEffort
      if (isNew) memory.lastEffort = level
      const writes = await Promise.all([planWrites($, isNew ? { effort: level } : {}), taskWrites($, { task: step })])
      await writeAll(writes.flat())
    })
    return yield* next(e)
  })

  on('session.measure', async ($, e, next) => {
    // 這個 hook 的工作在 next 之前：量的是交給 next 之前的那一段
    later(() => applyUsage($, usageOf(e), false))
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
      const owner = e.agentId
      later(async () => {
        // 時間與 subagent 的資料一起問
        const [now, agents] = await Promise.all([$.clock.now(), owner === undefined ? undefined : $.agent.list()])
        const info = agents?.find(a => a.id === owner)
        const agent = owner === undefined ? undefined : { label: info?.description ?? '', parentId: info?.parentId }
        await dispatch($, { kind: 'todos', todos: e.todos, now, agentId: owner, agent })
      })
    }
    return ran
  }).catch(($, e, next) => next(e))

  // subagent 列：派出就建一行（醒來再派出只更新）；帶名字派的 teammate 也列，workflow 的 agent 不列
  on('agent.spawn', async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny === undefined && ran.agentId !== undefined && e.workflow === undefined) {
      const agentId = ran.agentId
      const model = ran.model
      later(async () => {
        const now = await $.clock.now()
        // 新的一列，與派工的 prompt 裡有票的路徑時這個 subagent 的經手：同一件事，一起寫
        const spawned: TaskEvent = {
          kind: 'spawned',
          agentId,
          label: e.description,
          type: e.subagentType,
          prompt: e.prompt,
          parentAgentId: e.parentAgentId,
          model,
          now,
        }
        await writeAll(await taskWrites($, { task: spawned, handled: await touchedBy($, e.prompt, agentId) }))
      })
    }
    return ran
  }).catch(($, e, next) => next(e))

  // 經手：你送出的 prompt（包括按「繼續」填進去的）裡有票的路徑，算主對話經手。
  // subagent 回報的通知不算：它的回報常寫著票的路徑，但做的不是主對話
  on('prompt.submit', async ($, e, next) => {
    const ran = await next(e)
    // 背景工作的結束通知：先看文字本身（沒有 <status> 的 Monitor 每行輸出不做任何事），有才排到背景
    const note = e.origin.kind === 'task-notification' ? parseNotification(e.text) : undefined
    if (note !== undefined) later(() => backgroundSignal($, { kind: 'notified', note }))
    // 排程觸發：讀 CronList 看是哪一個（清單裡沒有排程就什麼都不做）
    if (e.origin.kind === 'scheduled-trigger') later(() => backgroundSignal($, { kind: 'cronTriggered', text: e.text }))
    if (!('drop' in ran) && e.origin.kind !== 'task-notification') {
      later(() => touchTickets($, e.text, undefined))
      // 設定改了 env 不用重開就生效：每次送出 prompt 重查一次任務工具
      later(() => checkTaskTools($))
    }
    return ran
  }).catch(($, e, next) => next(e))

  // subagent 的一輪結束：由當下 `$.agent.list()` 的狀態判斷真的結束了沒（等子 agent 回報時是 waiting）
  on('turn.complete', async ($, e, next) => {
    const ran = await next(e)
    const owner = e.agentId
    if (owner !== undefined)
      later(async () => {
        // 一輪讀完：不認識的 agent 先擋掉，不問引擎；認識的照這一輪讀到的算
        const state = await boardState($)
        if (!state.board.agents.some(g => g.id === owner)) return
        const [now, agents] = await Promise.all([$.clock.now(), $.agent.list()])
        const status = agents.find(a => a.id === owner)?.status
        // 真的結束了（不是在等它派的子 agent）時，它經手的票由 board.ts 一起拿掉
        await writeAll(boardWrites($, state, { task: { kind: 'ended', agentId: owner, reason: e.reason, status, now } }))
      })
    return ran
  }).catch(($, e, next) => next(e))

  // 任務來源二：TaskCreate / TaskUpdate（整個 session 共用一份，只收主對話的）
  on('tool.call', { tool: 'TaskCreate' }, async ($, e, next) => {
    const ran = await next(e)
    if (e.agentId === undefined && succeeded(ran)) {
      const id = String(ran.result.task.id)
      later(() => dispatch($, { kind: 'created', id, subject: e.subject }))
    }
    return ran
  }).catch(($, e, next) => next(e))
  on('tool.call', { tool: 'TaskUpdate' }, async ($, e, next) => {
    const ran = await next(e)
    if (e.agentId === undefined && succeeded(ran))
      later(async () => {
        const now = await $.clock.now()
        await dispatch($, { kind: 'updated', id: String(e.taskId), status: e.status, subject: e.subject, now })
      })
    return ran
  }).catch(($, e, next) => next(e))

  // 路線圖：把「寫了檔」「跑了 shell 指令」告訴 roadmap，要不要重讀由它決定。
  // 經手：改了票檔、或指令裡有票的路徑，算發出它的 loop 經手（只讀不算，所以 Read 不接）
  on('tool.call', { tool: 'Write' }, async ($, e, next) => {
    const ran = await next(e)
    fileWritten($, e, ran)
    return ran
  }).catch(($, e, next) => next(e))
  on('tool.call', { tool: 'Edit' }, async ($, e, next) => {
    const ran = await next(e)
    fileWritten($, e, ran)
    return ran
  }).catch(($, e, next) => next(e))
  // 背景工作：結果帶 `backgroundTaskId`（run_in_background、Ctrl+B、逾時轉背景）就加一筆；
  // 沒有這個欄位的前景指令和以前完全一樣，不多任何 host 呼叫
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const ran = await next(e)
    shellDone($, e, ran)
    return ran
  }).catch(($, e, next) => next(e))
  on('tool.call', { tool: 'PowerShell' }, async ($, e, next) => {
    const ran = await next(e)
    shellDone($, e, ran)
    return ran
  }).catch(($, e, next) => next(e))
  // Monitor：結果的 `taskId`、`timeoutMs`、`persistent` 建一筆；剩餘時間由畫面那一側走。
  // 每行輸出的通知（只有 `<event>`）在 prompt.submit 那裡就略過，結束通知照 shell 的路收
  on('tool.call', { tool: 'Monitor' }, async ($, e, next) => {
    const ran = await next(e)
    if (succeeded(ran)) {
      const signal = monitorSignal(e, ran.result)
      later(() => backgroundSignal($, signal))
    }
    return ran
  }).catch(($, e, next) => next(e))
  // TaskStop：不會有結束通知，結果的 `task_id` 對到的那筆標被停掉（停的是 subagent 就對不到、不寫）
  on('tool.call', { tool: 'TaskStop' }, async ($, e, next) => {
    const ran = await next(e)
    if (succeeded(ran)) {
      const id = ran.result.task_id
      later(() => backgroundSignal($, { kind: 'stopped', id }))
    }
    return ran
  }).catch(($, e, next) => next(e))

  // 背景工作的校正：對話停下時引擎給的快照（`background_tasks` 與 `session_crons`）。主對話與 subagent 停下都帶整個 session 的，
  // 處理一樣；MCP task 只從這裡進來。快照沒有擁有者，不拿它改擁有者
  on('classic.Stop', async ($, e, next) => {
    const ran = await next(e)
    snapshotLater($, e)
    return ran
  }).catch(($, e, next) => next(e))

  on('classic.SubagentStop', async ($, e, next) => {
    const ran = await next(e)
    snapshotLater($, e)
    return ran
  }).catch(($, e, next) => next(e))

  // 排程：CronCreate（含 `/loop` 走的）加一筆、CronDelete 拿掉，兩者之後都讀一次 CronList 比對
  on('tool.call', { tool: 'CronCreate' }, async ($, e, next) => {
    const ran = await next(e)
    if (succeeded(ran)) {
      const signal = cronCreatedSignal(e, ran.result)
      later(() => backgroundSignal($, signal))
    }
    return ran
  }).catch(($, e, next) => next(e))
  on('tool.call', { tool: 'CronDelete' }, async ($, e, next) => {
    const ran = await next(e)
    if (succeeded(ran)) later(() => backgroundSignal($, { kind: 'cronDeleted', id: e.id }))
    return ran
  }).catch(($, e, next) => next(e))
  // ScheduleWakeup（`/loop` 動態模式）與 Workflow：都沒在這台機器實測過，照引擎的型別寫。
  // 有機會實測時先驗這兩個（探測要先過引擎的原始碼掃描，在複本 validate 再換上）
  on('tool.call', { tool: 'ScheduleWakeup' }, async ($, e, next) => {
    const ran = await next(e)
    const signal = succeeded(ran) ? wakeupSignal(e, ran.result) : undefined
    if (signal !== undefined) later(() => backgroundSignal($, signal))
    return ran
  }).catch(($, e, next) => next(e))
  // Workflow：結果的 `taskId`、`workflowName`、`runId` 建一筆；結束照 shell 的通知收（task-notification）
  on('tool.call', { tool: 'Workflow' }, async ($, e, next) => {
    const ran = await next(e)
    const signal = succeeded(ran) ? workflowSignal(e, ran.result) : undefined
    if (signal !== undefined) later(() => backgroundSignal($, signal))
    return ran
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    // 事件排在背景的工作先做完再畫：畫出來的是那件事之後的樣子
    await backlog
    const ui = $.ui.resolve(e)
    const { Box, Text, Button } = ui
    const Select = 'Select' in ui ? ui.Select : undefined
    const Client = 'Client' in ui ? ui.Client : undefined
    const { settings } = config
    const accent = settings.accent
    // 外框要用的狀態一次讀完。外框不讀任務板，只讀它的完成數與總數（任務板只有 [任務] 讀）；
    // 5H 倒數會隨時間變，交給畫面那一側的 Client 自己走
    const [now, counted, currentTab, currentModel, actualEffort, chosen, busy, usageNow, allPages, indicator] = await Promise.all([
      $.clock.now(),
      read($, progress),
      read($, tab),
      read($, model),
      read($, effort),
      read($, chosenEffort),
      read($, switching),
      read($, usage),
      read($, pages),
      shownIndicator($),
    ])

    // ── 分頁列：[任務] 的標籤帶著進度 ──
    const tabLabel = (t: (typeof TABS)[number]) =>
      t.id === 'tasks' && counted.total > 0 && counted.doneCount < counted.total
        ? `${t.label} ${counted.doneCount}/${counted.total}`
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
            const resetsAt = c.key === 'h5' ? usageNow.rateLimits.find(r => r.kind === 'five_hour')?.resetsAt : undefined
            if (c.extra && resetsAt !== undefined && Client)
              // 5H 倒數每分鐘走：交給 Client，寬度照這一刻的字留好
              return (
                <Box key={`chip-${c.key}`} flexDirection="row">
                  <Text>
                    <Text dimColor>{`${c.label} `}</Text>
                    <Text color={tone}>{`${parts.percent} ${parts.filled}`}</Text>
                    <Text dimColor>{parts.rest}</Text>
                  </Text>
                  <Client
                    key="chip-h5-countdown"
                    module="./ticking.tsx"
                    props={{ kind: 'countdown', at: now, resetsAt, width: 1 + textWidth(c.extra) }}
                  />
                </Box>
              )
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
    const ctx: TabContext = { ui, cols, accent, indicator }
    const content =
      currentTab === 'tasks'
        ? await tasksTab($, ctx, now)
        : currentTab === 'basic'
          ? await basicTab($, ctx)
          : currentTab === 'skill'
            ? await skillTab($, ctx)
            : await settingsTab($, ctx)
    // 分頁的操作疊在下框線左端、狀態疊在右端（要翻頁時右端是翻頁鍵）；放不上的退回框內的最後幾行。
    // 有沒有要翻頁要排過才知道：兩種擺法的固定行數都交給 layout，由它決定用哪一種
    const footFor = (hasPages: boolean) =>
      footPlan(cols, { actions: content.actions && content.actionsWidth, status: content.status && content.statusWidth, hasPages })
    const fixedOf = ({ isActionsInside, isStatusInside }: ReturnType<typeof footFor>) =>
      (content.top ? (content.topRows ?? 1) : 0) + (content.bottom ? 1 : 0) + (isActionsInside ? 1 : 0) + (isStatusInside ? 1 : 0)
    const single = footFor(false)
    const paged = footFor(true)
    const shape = layout(content.rows, {
      bodyRows: e.props.scroll.bodyRows,
      // 用量的行數，加上模型與深度那一行
      stateRows: area.rows + 1,
      isTabsOnBorder,
      isInline: e.props.placement === 'inline',
      inlineRows: settings.inlineRows,
      fixedRows: fixedOf(single),
      pagedFixedRows: fixedOf(paged),
      detailColumns: cols,
      page: allPages[currentTab],
      followId: content.followId,
    })
    const foot = shape.isPaged ? paged : single
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
        <Button key="pg-prev" label="上頁" plain hotkey="k" onPress={() => void turnPage($, currentTab, p - 1, content.unfollowsOnTurn === true)} />
        <Text dimColor>{`${p + 1}/${shape.pageCount}`}</Text>
        <Button
          key="pg-next"
          label="下頁"
          plain
          hotkey="j"
          onPress={() => void turnPage($, currentTab, Math.min(shape.pageCount - 1, p + 1), content.unfollowsOnTurn === true)}
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

    const tree = (
      <Box flexDirection="column">
        {framed('card-a', <Text bold> 狀態 </Text>, stateBody)}
        {!isTabsOnBorder && tabBar}
        {framed('card-b', isTabsOnBorder ? tabBar : <Text />, tabBody, pager || statusFoot, actionsFoot)}
      </Box>
    )
    return tree
  })
}
