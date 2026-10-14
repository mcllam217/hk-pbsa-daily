# 香港學生公寓／PBSA 日報

四段式資料站（繁體中文／香港）：每日新聞、供求分析、市場成交、改建後項目資料。

- **公開網站（唯一發布）**：https://mcllam217.github.io/hk-pbsa-daily/
- **倉庫**：https://github.com/mcllam217/hk-pbsa-daily
- Cloudflare Pages／Netlify／here.now 等舊發布路徑已退役，請只維護本 GitHub Pages 倉庫。

## 頁面結構

1. **每日重點相關新聞** — `data/news.json`（近兩星期；每則有來源名稱＋日期）
2. **供求分析** — `data/supply_demand.json`（需求／供應／管道；每項數字有來源；單一來源標「單一來源」）
3. **市場成交表** — `data/deals.json`（只列銷售成交；缺欄顯示「未披露」；待核實線索另列）
4. **改建後項目資料（財務評估）** — 來自成交的 `rent_roll`／`room_types`／床位（只列有來源租金）

## 每日自動更新

`.github/workflows/daily.yml` 每個香港時間 08:15 同 20:15 跑一次：

- 只追加 `data/news.json` 同相關線索
- **唔會改** `data/deals.json` 嘅金額、床數、呎價
- 有新標題先 commit

成交表同供求數字仍人手核實後先改 JSON。

## 第一次要開 Pages（只需一次）

https://github.com/mcllam217/hk-pbsa-daily/settings/pages  
Build and deployment → Source 選 **GitHub Actions**，儲存。

之後每次 push，同每日 08:15、20:15（香港時間）都會更新  
https://mcllam217.github.io/hk-pbsa-daily/
