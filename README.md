# BottiZ 網站

靜態網站，部署於 GitHub Pages（推送 `main` 即上線）。頁面由零依賴的 Node 腳本生成，生成後的 HTML 一併提交。

## 修改內容

| 想改 | 去哪裡 |
| --- | --- |
| 標語、聯絡資料、導覽、頁尾、表單端點、私隱政策連結、分析 ID | `data/site.json` |
| 產品資料（卡片、詳情頁、規格、場地條件、規格表／影片連結） | `data/products.json` |
| 行業頁／關於／租買試／安全頁內容及 FAQ | `data/page-*.json` |
| 「落地六步」 | `data/process.json` |
| 表單欄位 | `data/forms.json` |
| 回本期估算的欄位與公式說明 | `data/roi.json`（計算在 `assets/js/roi.js`） |
| 下載檔案（勘察清單、通告範本） | `data/downloads.json` |
| 翻譯（簡體／英文） | `data/i18n/*.json`，以繁體原文作鍵 |

內容待補的項目記錄在內部文件 `docs/content-todo.md`（不提交、不部署）。網站上不會出現佔位字眼，`node check.mjs` 會檢查。

## 指令

```bash
node build.mjs                 # 生成所有頁面、sitemap.xml、robots.txt
node check.mjs [--todo]        # SEO／標題層級／圖片／連結／表單標籤審查
node scripts/i18n-missing.mjs  # 列出尚未翻譯的字串
node scripts/mock-form-server.mjs 8790   # 本機假表單端點（測試成功／失敗）
```

環境變數：`FORM_ENDPOINT`、`PRIVACY_URL`、`ANALYTICS_ID`、`OUT_DIR`（輸出到其他目錄作測試）。

## 結構

- `src/pages/*.html`：頁面（JSON front matter + 內容）
- `src/layouts`、`src/partials`：共用版面及元件（表單、區塊、六步、產品卡等）
- `assets/js`：`track.js`（事件，預設關閉分析）、`i18n.js`、`site.js`、`form.js`、`roi.js`
