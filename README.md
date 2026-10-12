# 香港學生公寓／PBSA 日報

第二個網站，同 [Netlify 版](https://hk-pbsa-daily.netlify.app/) 用同一套版面。頁面只讀 `data/*.json`，唔使為改消息而重建 Netlify。

- 網站：https://mcllam217.github.io/hk-pbsa-daily/
- 倉庫：https://github.com/mcllam217/hk-pbsa-daily

## 每日自動更新

`.github/workflows/daily.yml` 每個香港時間 08:15 同 20:15 跑一次：

- 只追加 `data/news.json` 同「今日要留意」一條【自動】線索
- **唔會改** `data/deals.json` 嘅金額、床數、呎價
- 有新標題先 commit；公開 repo 的 Actions 分鐘數免費，唔受 Netlify credits 限制

成交表仍然人手核實後先改 JSON。

## 第一次要開 Pages（只需一次）

倉庫權限開唔到 Pages 網站本身。請在 GitHub 打開  
https://github.com/mcllam217/hk-pbsa-daily/settings/pages  
Build and deployment → Source 選 **GitHub Actions**，儲存。

之後每次 push，同每日 08:15、20:15（香港時間）都會自動更新  
https://mcllam217.github.io/hk-pbsa-daily/
