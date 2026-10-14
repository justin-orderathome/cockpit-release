import { notesBetween, withNotes, changelogBeside } from './changelog'
import { reasonOf } from './events'
import type { Files } from './files'
import {
  RELEASE_MANIFEST,
  UPDATE_LATER,
  catalogPath,
  installCommand,
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
import type { Install, Verdict } from './release'
import { justReloaded, storedText, versionChanged } from './remembered'

/**
 * 更新的整個流程：開場讀回記著的版本並講換了哪一版、開場在背景檢查與下載、「檢查版本」的詢問、重新載入 mod。
 * 哪些事要記進 `$.store`、什麼時候算檢查過、每版只提示一次、被收回的版本要換回來，都在這裡走完；
 * 跑指令、上網、讀檔、存取 `$.store`、跳提示與詢問的方式由 `register.tsx` 給（`UpdaterPorts`），這裡不碰引擎。
 * 各個判斷（該不該檢查、該不該下載、措辭）在 `release.ts`。
 *
 * 這裡用到的 `$.store` 鍵：
 * - `seenVersion`：上次開場時的版本，用來發現換了版本。
 * - `reloadingAt`：按「重新載入 mod」的時間，給重載後的那一份回報用。
 * - `checkedAt`：上次檢查過發布版本的時間；查不到、或開場該做的下載沒做成時不記。
 * - `releasedVersion`：上次查到的發布版本，留著的標示看它；沒有重新檢查的開場也照它顯示。
 * - `downloadedVersion`：已經下載、還沒換上的版本，免得同一版下載兩次；它就是發布的版本時標示是「已下載」。
 * - `notifiedVersion`：已經提示過的發布版本，同一版不提示第二次（在「檢查版本」被問過也算）。
 */

/** 跑完一個指令的結果 */
export type Ran = { exitCode: number; stdout: string; stderr: string }

/** 面板上的標示要看的兩個記著的版本；沒有是空的 */
export type Remembered = { released: string; downloaded: string }

export type UpdaterPorts = {
  /** 跑一個 `claude plugin …` 指令（要連 GitHub，等得比一般的指令久）；跑不起來丟例外 */
  run: (argv: string[]) => Promise<Ran>
  /** 上網讀一個網址；連不上丟例外 */
  fetch: (url: string) => Promise<{ ok: boolean; text: string }>
  files: Files
  store: { get: (key: string) => Promise<unknown>; set: (key: string, value: unknown) => Promise<void> }
  now: () => Promise<number>
  /** 使用者目錄，用 / 分隔 */
  home: () => Promise<string>
  toast: (text: string) => void
  /** 問使用者一題；使用者把詢問關掉時丟例外 */
  ask: (question: string, options: string[]) => Promise<string>
  /** 跑內建的 `/reload-plugins`（這份程式會被換掉），回傳它講的話；失敗丟例外 */
  reloadPlugins: () => Promise<string | undefined>
  /** 記著的版本換了：面板上的標示跟著換 */
  show: (remembered: Remembered) => Promise<void>
}

/**
 * 這一份 cockpit 的事實：`current` 是 plugin.json 寫的版本（讀不到是空的），
 * `install` 是從哪個 marketplace 裝的（從資料夾載入的是 undefined），`autoUpdate` 是設定的「自動更新」。
 */
export type Facts = { current: string; install: Install | undefined; autoUpdate: boolean }

export type Updater = {
  /** 開場：讀回記著的版本放上標示；版本和上次不同就講換到哪一版，剛按過「重新載入 mod」就回報一聲 */
  open: () => Promise<void>
  /** 開場隔一下的檢查：在背景跑，查不到或中途出錯都安靜略過 */
  startupCheck: () => Promise<void>
  /** [設定] 的「檢查版本」 */
  check: () => Promise<void>
  /** 重新載入所有 mod：「重新載入 mod」與「立即換上」 */
  reload: () => Promise<void>
}

export function makeUpdater(ports: UpdaterPorts, facts: Facts): Updater {
  const { store, toast } = ports
  const { current, install } = facts

  /** 記下這次查到的發布版本（存起來，標示也跟著換） */
  async function rememberReleased(released: string) {
    await store.set('releasedVersion', released)
    await ports.show({ released, downloaded: storedText(await store.get('downloadedVersion')) })
  }

  /** 記下已經下載、還沒換上的是哪一版（`null` 是沒有） */
  async function rememberDownloaded(downloaded: string | null) {
    await store.set('downloadedVersion', downloaded)
    await ports.show({ released: storedText(await store.get('releasedVersion')), downloaded: downloaded ?? '' })
  }

  /**
   * 記下這次檢查過了，開場檢查隔多久看它。查不到發布的版本、或開場該在背景做的下載沒做成時不記：
   * 那不算檢查過，下次開場不等四小時就再試。
   */
  const rememberChecked = async () => store.set('checkedAt', await ports.now())

  /**
   * 看現在發布的是哪一版，和這一份比；看不到當作查不到。
   * 從 marketplace 裝的：先把 marketplace 拉到最新，讀它本機 clone 裡的 plugin.json（就是更新會裝的那一版），
   * 查到了就記下查到的版本；`changelog` 是 clone 裡、plugin.json 旁邊的那一份更新紀錄。
   * 從資料夾載入的：只能上網看發布 repo，沒有更新紀錄。
   */
  async function checkRelease(): Promise<{ found: Verdict; changelog?: string }> {
    let latest = ''
    let changelog: string | undefined
    try {
      if (install) {
        const ran = await ports.run(refreshCommand(install))
        if (ran.exitCode === 0) {
          const dir = marketplaceDir(await ports.home(), install.marketplace)
          const manifest = releasedManifest(dir, await ports.files.read(catalogPath(dir)), install.plugin)
          if (manifest !== undefined) latest = versionIn(await ports.files.read(manifest))
          if (manifest !== undefined && latest !== '' && latest !== current)
            changelog = await ports.files.read(changelogBeside(manifest))
        }
      } else {
        const reply = await ports.fetch(RELEASE_MANIFEST)
        if (reply.ok) latest = versionIn(reply.text)
      }
    } catch {}
    if (install && latest !== '') await rememberReleased(latest)
    return { found: verdict(current, latest, install), changelog }
  }

  /**
   * 把發布的那一版下載到磁碟上（跑著的這一份不變）；失敗時跳 toast 並回 false。
   * 更新不成（最常見的是 Claude Code 還沒把這一份記成已安裝）就改用安裝；還是不成才算失敗，講的是更新那一次的原因。
   * `quiet` 是在背景下載的那幾次：失敗不講，下次檢查再試。
   */
  async function download(to: Install, quiet = false): Promise<boolean> {
    const failed = (reason: string | number) => {
      if (!quiet) toast(`無法更新 cockpit：${reason}`)
      return false
    }
    try {
      const ran = await ports.run(updateCommand(to))
      if (ran.exitCode === 0) return true
      const installed = await ports.run(installCommand(to))
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
  async function settleSame() {
    if (install !== undefined) {
      const downloaded = storedText(await store.get('downloadedVersion'))
      if (shouldRestore(current, downloaded) && !(await download(install, true))) return
      await rememberChecked()
    }
    await rememberDownloaded(null)
  }

  async function reload() {
    try {
      await store.set('reloadingAt', await ports.now())
      const said = (await ports.reloadPlugins())?.trim().split('\n')[0]
      if (said) toast(said)
    } catch (err) {
      await store.set('reloadingAt', null)
      toast(`無法重新載入 mod：${reasonOf(err)}`)
    }
  }

  return {
    async open() {
      const [released, downloaded, seenVersion, reloadingAt] = await Promise.all([
        store.get('releasedVersion'),
        store.get('downloadedVersion'),
        store.get('seenVersion'),
        store.get('reloadingAt'),
      ])
      // 上次查到的發布版本：沒有重新檢查的這次開場，標示也照它留著；從資料夾載入的不標示
      await ports.show(
        install !== undefined
          ? { released: storedText(released), downloaded: storedText(downloaded) }
          : { released: '', downloaded: '' },
      )
      // 版本和上次開場時不一樣：講一聲換到哪一版（版本號變小是作者退版，說「退回」）
      const seen = typeof seenVersion === 'string' ? seenVersion : undefined
      const isNewVersion = versionChanged(seen, current)
      if (current !== '' && current !== seen) await store.set('seenVersion', current)
      if (isNewVersion && seen !== undefined) toast(wordingFor(seen, current).switched(current))
      // 剛按過「重新載入 mod」：這一份是重載後的，回報一聲（已經講過換版就不重複）
      if (typeof reloadingAt === 'number') {
        await store.set('reloadingAt', null)
        if (!isNewVersion && justReloaded(reloadingAt, await ports.now())) toast('cockpit 已重新載入')
      }
    },

    /**
     * 從 marketplace 裝的那一份，距離上次檢查滿四小時才去看發布的版本，「自動更新」開不開都看。
     * 不一樣而「自動更新」開著，或發布的版本比裝的舊（退版）：在背景下載，同一版只下載一次。
     * 每個發布的版本開場只提示一次：下載好了講已下載，沒下載（不必下載或下載失敗）講到 [設定] 按「檢查版本」。
     * 背景的下載失敗不算檢查過：不記檢查的時間，下次開場再試。
     * 發布的版本就是裝著的這一版：把之前下載、還沒換上的別的版本換回去（`settleSame`）。
     */
    async startupCheck() {
      try {
        const [checkedAt, now] = await Promise.all([store.get('checkedAt'), ports.now()])
        if (!shouldCheck(install, checkedAt, now)) return
        const { found } = await checkRelease()
        if (found.kind === 'same') return void (await settleSame())
        if (found.kind !== 'update') return
        const isWanted = shouldDownload(current, found.latest, facts.autoUpdate)
        let isDownloaded = false
        if (isWanted) {
          isDownloaded = (await store.get('downloadedVersion')) === found.latest || (await download(found.install, true))
          if (isDownloaded) await rememberDownloaded(found.latest)
        }
        if (isDownloaded || !isWanted) await rememberChecked()
        if (!shouldNotify(found.latest, await store.get('notifiedVersion'))) return
        await store.set('notifiedVersion', found.latest)
        const words = wordingFor(current, found.latest)
        toast(isDownloaded ? words.downloadedNotice(found.latest) : words.availableNotice(found.latest))
      } catch {}
    },

    /**
     * 和發布的版本不一樣就問要不要立即更新（退版時問要不要換上），要的話下載後重新載入 mod。手動檢查不受四小時的限制。
     * 升版時問句後面列出這幾版的更新紀錄；退版或讀不到更新紀錄時照樣問，只是不列。
     */
    async check() {
      const { found, changelog } = await checkRelease()
      if (found.kind === 'unknown') return void toast('查不到發布的版本，請確認網路後再試')
      if (found.kind === 'same') {
        await settleSame()
        return void toast(`cockpit ${current} 已經是發布的版本`)
      }
      if (found.kind === 'manual')
        return void toast(`發布的版本是 ${found.latest}；這一份是從資料夾載入的，請自行換成新版`)
      await rememberChecked()
      const words = wordingFor(current, found.latest)
      // 問過就算提示過這一版，之後開場不再為它提示
      await store.set('notifiedVersion', found.latest)
      let answer: string
      try {
        const question = withNotes(words.question(current, found.latest), notesBetween(changelog, current, found.latest))
        answer = await ports.ask(question, [words.accept, UPDATE_LATER])
      } catch {
        // 把詢問關掉就是先不要
        return
      }
      if (answer !== words.accept) return
      toast(words.switching(found.latest))
      if (!(await download(found.install))) return
      await rememberDownloaded(found.latest)
      await reload()
    },

    reload,
  }
}
