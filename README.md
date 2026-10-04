# [B.M] Google 相簿 工具

[![Manifest V3](https://img.shields.io/badge/Manifest-V3-blue)](https://developer.chrome.com/docs/extensions/mv3/)
[![Site](https://img.shields.io/badge/site-photos.google.com-4285F4)](https://photos.google.com)
[![GitHub](https://img.shields.io/badge/GitHub-bm--google--photos--tool-181717?logo=github)](https://github.com/BoringMan314/bm-google-photos-tool)
[![GitHub all releases](https://img.shields.io/github/downloads/BoringMan314/bm-google-photos-tool/total)](https://github.com/BoringMan314/bm-google-photos-tool/releases)

適用於 [Google 相簿](https://photos.google.com)（`photos.google.com`）的瀏覽器擴充功能：隱藏精彩集錦、篩選與選取占用容量的檔案，並提供移至垃圾桶與停止操作。

*隐藏精彩集锦，筛选、选择或删除占用容量的文件。*<br>
*ハイライトを非表示にし、容量を使うファイルの絞り込み・選択・削除を行えます。*<br>
*Hides highlights and filters, selects, or deletes files that use storage.*

> **聲明**：本專案為第三方輔助工具，與 Google 相簿 官方無關。使用請遵守該站服務條款與著作權規範。

---

![工具列設定面板示意](screenshot/screenshot_1280x800.png)

---

## 目錄

- [功能](#功能)
- [系統需求](#系統需求)
- [安裝方式](#安裝方式)
- [本機開發與測試](#本機開發與測試)
- [技術概要](#技術概要)
- [專案結構](#專案結構)
- [版本與多語系](#版本與多語系)
- [隱私說明](#隱私說明)
- [維護者：更新 GitHub 與 Chrome 線上應用程式商店](#維護者更新-github-與-chrome-線上應用程式商店)
- [授權](#授權)
- [問題與建議](#問題與建議)

---

## 功能

| 功能 | 說明 |
|------|------|
| **隱藏精彩集錦** | 隱藏時間軸上方卡片，不刪除檔案。 |
| **容量篩選** | 掃描並隱藏未占用容量的項目與空白日期列。 |
| **容量選取** | 掃描後勾選占用容量的檔案；期間會鎖定捲動。 |
| **移至垃圾桶** | 可選擇刪除占用容量的檔案，或目前頁面中的全部檔案；操作前有確認提示。 |
| **停止與進度** | 提供已掃描、已選取及已刪除數量，並可停止操作。 |

### 使用方式

1. 開啟 [Google 相簿](https://photos.google.com)，再點擊擴充功能圖示。
2. 先使用篩選或選取功能確認項目範圍。
3. 刪除會將檔案移至垃圾桶，確認範圍後再操作；需要時按「停止」。

---

## 系統需求

- **Chrome** 或 **Microsoft Edge**（Chromium）等支援 **Manifest V3** 的瀏覽器。
- 須登入 Google 相簿；操作範圍依目前頁面及可讀取的項目而定。

---

## 安裝方式

### 從原始碼載入（開發人員模式）

1. 點選本頁綠色 **Code** → **Download ZIP** 解壓，或執行 `git clone https://github.com/BoringMan314/bm-google-photos-tool.git` 複製本倉庫。
2. 以 **Chrome** 或 **Microsoft Edge** 開啟 `chrome://extensions`（在 Edge 為 `edge://extensions`）。
3. 開啟「**開發人員模式**」→「**載入未封裝項目**」→ 選取含 [`manifest.json`](manifest.json) 的**專案根目錄**（勿選子資料夾）。
4. 重新整理已開啟的目標網站分頁，再依「使用方式」操作。

---

## 本機開發與測試

修改腳本或樣式後，在 `chrome://extensions` 將本擴充**重新載入**，再重新整理網站分頁驗證。

先驗證精彩集錦開關、篩選、選取與停止。刪除測試請使用可丟棄的測試項目，確認只影響所選範圍。

---

## 技術概要

- [`content.js`](content.js)：頁面篩選、掃描、選取及進度顯示。
- [`page-bridge.js`](page-bridge.js)：於 MAIN world 與 Google 相簿同站內部 API 溝通。
- [`background.js`](background.js)：背景服務；[`popup.js`](popup.js) 提供操作入口。
- 權限為 `storage`、`activeTab`，網站存取範圍為 `https://photos.google.com/*`。

---

## 專案結構

| 路徑 | 說明 |
|------|------|
| [`manifest.json`](manifest.json) | Manifest V3 與權限設定 |
| [`background.js`](background.js) | 背景服務 |
| [`content.js`](content.js) | 頁面操作與進度 |
| [`content.css`](content.css) | 頁面提示樣式 |
| [`page-bridge.js`](page-bridge.js) | 同站 API 橋接 |
| [`popup.html`](popup.html) | 工具列操作面板 |
| [`popup.js`](popup.js) | 操作入口 |
| [`popup.css`](popup.css) | 面板樣式 |
| [`i18n.js`](i18n.js) | 功能介面字串 |
| [`_locales/`](_locales/) | 擴充功能名稱與說明 |
| [`icons/`](icons/) | 圖示 |
| [`screenshot/`](screenshot/) | 商店與說明截圖 |

---

## 版本與多語系

- **版本**：以 [`manifest.json`](manifest.json) 的 `version` 為準。
- **預設語系**：`zh_TW`（`default_locale`）。
- **內建語系**：`zh_TW`、`zh_CN`、`ja`、`en_US`（路徑為 `_locales/<code>/messages.json`）。

---

## 隱私說明

設定透過瀏覽器 `storage` 保存。掃描與刪除會使用目前登入狀態對 Google 相簿同站 API 發出請求；刪除是實際帳戶操作。網站內部 API 可能隨改版變動。

目前專案尚未提供獨立的隱私權政策檔。**上架提醒**：若上架 Chrome Web Store，須在開發人員後台完成隱私實踐聲明，並提供隱私權政策的公開 HTTPS 網址。

---

## 維護者：更新 GitHub 與 Chrome 線上應用程式商店

### 更新至 GitHub

**Bash / Git Bash / PowerShell：**

```powershell
git add README.md
git commit -m "docs: 更新內容說明與商店連結"
git push origin main
```

### 更新至 Chrome 線上應用程式商店

1. **確認資料**：確認程式來源、授權、商店項目及隱私權政策。
2. **遞增版本**：修改 `manifest.json` 中的 `version`。
3. **封裝套件**：打包 manifest 引用的腳本、頁面、樣式、語系與圖示；排除 `.git/`、本機參考資料、測試輸出、PSD 及個人資料。
4. **提交送審**：於 [Chrome Web Store 開發人員控制台](https://chrome.google.com/webstore/devconsole) 上傳，核對文案、截圖與隱私欄位後送審。

---

## 授權

目前專案未附 LICENSE，尚未明確宣告開源授權；不將本專案標示為 MIT。

---

## 問題與建議

歡迎透過 [GitHub Issues](https://github.com/BoringMan314/bm-google-photos-tool/issues) 回報錯誤或提出改善建議。回報時請提供瀏覽器版本、**介面語言**、使用的功能與重現步驟，截圖請遮蔽個人資料。
