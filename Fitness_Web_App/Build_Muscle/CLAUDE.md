# 增肌助手 — 子项目约定

本项目是「健身计划 App」的增肌助手 Web 版。父级项目约定见根目录 `CLAUDE.md`。

## 硬边界

- 所有功能文件在本目录内，不修改 `apk/` 等其他目录
- 纯前端，无构建工具，无框架
- 数据存储用 IndexedDB（`db.js` 封装）
- 入口：`index.html`，样式：`style.css`，逻辑：`app.js`，数据：`data.js`

## 部署

- **GitHub Pages 地址**: https://kein02.github.io/webpage-and-app/Build_Muscle/
- **未经你明确同意，不执行 git push / 不提交到 gh-pages 分支 / 不上线**
- 所有改动先在本目录验证，你确认后再上传

## 文档

- 大功能变更时更新本目录的 `README.md` 和 `介绍.md` 即可。
