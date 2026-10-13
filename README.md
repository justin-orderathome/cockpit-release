# cockpit

Claude Code 的右側面板：上方顯示用量、目前的模型與思考深度，下方用四個分頁放任務進度、常用 prompt、skill 清單與設定。

給 Justin 的同事用的內部工具。需要 Windows、Claude Code 2.1.294 以上與 `git`。

## 安裝

開 Claude Code，把下面整段貼進去送出，照它最後說的把所有 Claude Code 關掉再開。第一次安裝與從舊的資料夾搬過來都用這一段。

```text
請幫我在這台 Windows 電腦上安裝 cockpit（Claude Code 的右側面板）。原本是用資料夾載入的話，一併搬到新的安裝方式。照下面七步依序做，每一步的「確認」成立才做下一步。

每一步只有三種結果：
- 完成：「確認」成立，做下一步。
- 略過：這一步要處理的東西本來就不存在（例如沒有舊資料夾）。記下略過與原因，做下一步。
- 停下來：指令失敗、檔案讀不懂，或「確認」不成立。後面的步驟都不做，告訴我停在第幾步、看到的完整訊息、到目前為止改了哪些檔，以及最後「退路」那一段。

「設定檔」指 %USERPROFILE%\.claude\settings.json。只改下面寫到的鍵，其餘內容與排版原樣保留：用編輯檔案的工具改那幾行，不用 PowerShell 把整份 JSON 讀進來再寫回去（會弄亂排版與中文）。

第 1 步　確認這台機器裝得起來（只查，不改任何東西）
  執行 git --version
    找不到 git：停下來。請我先裝 Git for Windows（在 PowerShell 執行 winget install Git.Git），裝好後把 Claude Code 全部關掉再開，把這段文字重貼一次。
  執行 git ls-remote https://github.com/justin-orderathome/cockpit-release.git
    失敗：停下來。把完整的錯誤訊息給我，請我轉給 Justin。
  確認：兩個指令都成功，第二個至少印出一行 commit。

第 2 步　備份設定檔
  把設定檔複製成同一個資料夾裡的 settings.backup-cockpit-<年月日-時分秒>.json。
  設定檔不存在：略過（第 3 步會建立一份新的）。
  確認：備份檔存在，大小與設定檔相同。記下備份檔的完整路徑。

第 3 步　改設定檔的三處
  (a) env 裡的 CLAUDE_CODE_PLUGIN_DIRS
      它的值是用 ; 隔開的一個或多個資料夾。逐一讀 <資料夾>\.claude-plugin\plugin.json，name 是 cockpit 的那一個就是「舊資料夾」：記下它的完整路徑，把它從值裡拿掉，其餘的資料夾照原樣留著。值裡只有它一個時，把 CLAUDE_CODE_PLUGIN_DIRS 這一行整個拿掉。
      沒有這個鍵，或沒有任何一個資料夾符合：略過，並記下「沒有舊資料夾」。路徑裡有 cockpit 字樣卻不符合的，原樣留著，最後告訴我。
  (b) extraKnownMarketplaces 裡的 orderathome，內容是：
          "orderathome": {
            "source": { "source": "github", "repo": "justin-orderathome/cockpit-release" }
          }
      extraKnownMarketplaces 已經存在時，把這一筆加進現有的那一段。orderathome 這一筆已經存在時，把它改成和上面一樣；裡面有 "autoUpdate" 就把那一行拿掉。
  (c) enabledPlugins 裡加上 "cockpit@orderathome": true
      enabledPlugins 已經存在時，把這一筆加進現有的那一段。
  確認：設定檔解析得過（是合法的 JSON）；extraKnownMarketplaces 與 enabledPlugins 在最外層各只出現一次；重讀檔案，(a)(b)(c) 的值都和上面寫的一樣；和備份比，只有這三處不同。
  解析不過：把備份複製回設定檔，然後停下來。

第 4 步　把原本在 [設定] 改過的值帶過來
  把設定檔裡 pluginConfigs["cockpit@inline"] 的內容原樣複製一份，放在 pluginConfigs["cockpit@orderathome"]。原本那一筆留著。
  沒有 pluginConfigs["cockpit@inline"]，或 pluginConfigs["cockpit@orderathome"] 已經存在：略過，已經存在的那一筆不動。
  確認：設定檔解析得過，兩筆的內容相同。

第 5 步　把翻譯與用法的快取帶過來
  來源：%USERPROFILE%\.claude\plugins\store\cockpit_inline-e1f824f0cbe5.json
  目的：%USERPROFILE%\.claude\plugins\store\cockpit_orderathome-7aade36bdd60.json
  把來源複製成目的。來源留著。
  來源不存在，或目的已經存在：略過，已經存在的目的檔不動。
  確認：目的檔存在，大小與來源相同。

第 6 步　刪掉舊資料夾
  第 3 步記下「沒有舊資料夾」：略過。
  刪之前重讀一次 <舊資料夾>\.claude-plugin\plugin.json：檔案存在而且 name 是 cockpit 才把整個舊資料夾刪掉。不是的話留著，最後告訴我它的路徑與沒刪的原因。
  刪不掉（檔案被占用）：留著，最後請我把 Claude Code 全部關掉之後自己刪，然後照常做第 7 步。
  確認：舊資料夾已經不存在，或已記下留著的原因。

第 7 步　告訴我改了什麼
  先查系統層級的環境變數（只查不改），在 PowerShell 執行：
    [Environment]::GetEnvironmentVariable('CLAUDE_CODE_PLUGIN_DIRS','User')
    [Environment]::GetEnvironmentVariable('CLAUDE_CODE_PLUGIN_DIRS','Machine')
  有值的話在清單裡寫出來，並提醒我：裡面如果有舊的 cockpit 資料夾要自己拿掉，不拿掉的話跑的仍是舊的那一份，而且不會有任何提示。
  然後列一份清單，七步每一步各一行，寫完成、略過（原因）或沒做（原因），並包含：
    - 備份檔的完整路徑
    - 設定檔裡每一個改過的鍵，改之前與改之後的值
    - 快取檔有沒有複製
    - 舊資料夾的路徑，刪了還是留著
  最後請我做這件事：把所有 Claude Code 視窗關掉再開。第一次開啟會自己下載安裝，大約一分鐘內右側出現面板；切到 [設定] 捲到最下面，看得到 cockpit 與版本號就是裝好了。面板沒有自己出現時打 /cockpit。

退路（任何一步停下來，或重開之後面板不正常時告訴我）
  把第 2 步的備份檔複製回 %USERPROFILE%\.claude\settings.json（第 2 步略過的話，把第 3 步新建的設定檔刪掉），再向 Justin 要一份 cockpit 的 zip。
```

不想讓 Claude Code 替你改設定檔的話，[cockpit/README.md](cockpit/README.md) 的「安裝」一節有手動的步驟。

## 其他

功能、操作、設定與更新的方式都在 [cockpit/README.md](cockpit/README.md)。
