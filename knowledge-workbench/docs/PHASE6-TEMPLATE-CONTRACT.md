# Phase 6 — Template Definition V1

Template Engine 僅管理 `fields` 的輸入、正規化與驗證。`draftId`、`id`、`schemaVersion`、`draftRevision`、`revision`、`title`、`folderPath`、`tags`、`relations`、`links`、`attachments`、`createdAt`、`updatedAt`、`deletedAt`、`backupStatus`、`templateId`、`templateVersion` 均屬系統核心，模板不可定義同名欄位。資料夾選擇始終先於模板選擇。

## 定義與版本

每份 Template Definition 含 `templateId`、正整數 `templateVersion`、`name`、`description`、`status` (`active`/`archived`)、`sections`、`fields`。`sections[].fieldKeys` 決定顯示順序，欄位 key 不可重複且只能出現在一個 section。Registry 依 `templateId + templateVersion` 精確保存多版本；新增草稿只列出 active 模板；既有草稿固定使用其保存版本，絕不自動升級。

可用 type：`text`、`textarea`、`markdown`、`number`、`date`、`select`、`checkbox`、`url`、`multiselect`。`markdown` 在此只做文字輸入與本機保存，不產出 Obsidian 檔案。`image`、`attachment`、`note-link`、`relation-list` 為預留 type，只顯示未啟用提示並保留原值；未知 type 的模板定義會被拒絕。

空數字與空日期、單選保存為 `null`；checkbox 保存布林值；多選保存字串陣列。未知 fields key 保留，不因模板移除欄位而刪除。已不在 options 中的舊選項仍顯示且保存，準備送出時要求重新確認。URL 非空時必須能解析。required 只阻止「準備送出」，不阻止自動儲存未完成草稿；錯誤顯示在欄位旁。

## 舊草稿與失效模板

舊草稿缺少模板識別時，runtime 使用 `general-note` v1；若缺少 `fields.body` 而有舊 `content`，畫面使用 `content` 作為 fallback。開啟／載入不批次改寫 IndexedDB。使用者真正修改並成功儲存後，才將適配資料寫入 `templateId`、`templateVersion`、`fields`，原 `content` 仍保留。若找不到草稿指定的模板版本，畫面顯示原始 fields 的唯讀安全檢視；可修改核心欄位，但不能準備送出，亦不會清空 fields。

## 儲存邊界

沿用 IndexedDB `lizhi-knowledge-workbench` version 1 與既有 stores。Outbox 仍只是本機佇列，現在包含 `templateId`、`templateVersion`、`payloadRevision`；沒有 GitHub、Bridge 或 Obsidian 寫入。內建 `general-note` v1 僅用於基礎驗收與舊資料相容，正式「問題／解法」模板留給 Phase 7。
