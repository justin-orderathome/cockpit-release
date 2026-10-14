# cockpit

Claude Code 的右側面板：上方顯示用量、目前的模型與思考深度，下方用四個分頁放任務進度、常用 prompt、skill 清單與設定。

給 Justin 的同事用的內部工具。

## 安裝

需要 Windows、Claude Code 2.1.294 以上（用 `claude --version` 確認）與 `git`（用 `git --version` 確認；沒有的話在 PowerShell 執行 `winget install Git.Git`，裝好後重開 PowerShell）。cockpit 從公開的發布 repo `justin-orderathome/cockpit-release` 安裝。

1. 在 PowerShell 執行：

   ```powershell
   claude plugin marketplace add justin-orderathome/cockpit-release
   claude plugin install cockpit@orderathome
   ```

   第一行把發布 repo 加成名為 `orderathome` 的 marketplace，第二行從它安裝 cockpit。
2. 把所有 Claude Code 視窗關掉再開。右側會出現面板；切到 [設定] 捲到最下面，看得到 `cockpit` 與版本號就是裝好了。面板沒有自己出現時打 `/cockpit`。

第一行失敗時，先執行 `git ls-remote https://github.com/justin-orderathome/cockpit-release.git` 確認連得到發布 repo，把完整的錯誤訊息轉給作者。

**移除**：`claude plugin uninstall cockpit@orderathome`，要連 marketplace 一起拿掉再加 `claude plugin marketplace remove orderathome`。

## 其他

功能、操作、設定與更新的方式都在 [cockpit/README.md](cockpit/README.md)。
