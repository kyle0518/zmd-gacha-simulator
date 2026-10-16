# ZMD 抽卡模擬器

明日方舟：終末地（Arknights: Endfield）特許尋訪抽卡模擬器，純靜態網頁，無需建置。

## 執行

```bash
python3 -m http.server 8000
```

然後在瀏覽器開啟 http://localhost:8000

## 功能

- 特許尋訪卡池切換（現行「萬物更新」至常駐「基礎尋訪」）
- 保底模型：六星基礎率 0.8%、65 抽後軟保底、80 抽硬保底（特許池共用）、
  10 抽五星保底、UP 六星 50% 與 120 抽必得、每 240 抽信物
- 拉桿動畫（可跳過；支援鍵盤 Enter 與點擊遮罩取消）、十連立繪條
- 花費統計（嵌晶玉 / 源石 / 約略台幣）、六星統計、抽取紀錄
- 花費、保底與紀錄會存於瀏覽器 `localStorage`，重新整理不遺失

## 資料

卡池與立繪設定在 `config.json`：新增卡池只要在 `pools` 最前方加一筆
（`featured6`、`extraUnits` 為 UP 與兩名歪出限定六星、`infoHtml` 填結束日期），
並在 `unitImages` 補上立繪網址即可。

## 測試

```bash
node --test tests/gacha.test.js
```
