# 本地推送到 GitHub 指南

## 基本概念

本地开发 → `git add` → `git commit` → `git push` 到 GitHub

---

## 第一步：写代码

在本地编辑文件，比如修改 `index.html`。

---

## 第二步：查看改了什么

```bash
git status
```

会列出所有被修改、新增或删除的文件。

---

## 第三步：选择要提交的文件

```bash
# 方式1：只提交特定文件
git add index.html

# 方式2：提交所有改动
git add -A
```

> `git add` 就是把文件放入"暂存区"，告诉 Git 你想把这些改动打包成一个提交。

---

## 第四步：写提交信息

```bash
git commit -m "描述你做了什么"
```

提交信息要简洁明了，比如：
- `feat: 添加动作详情页面`
- `fix: 修复导航栏样式`
- `chore: 移动文件到健身app文件夹`

---

## 第五步：推送到 GitHub

```bash
git push origin main
```

> 第一次推送可能需要输入 GitHub 用户名和密码（或 Personal Access Token）。

---

## 常用命令速查

| 命令 | 作用 |
|------|------|
| `git status` | 查看哪些文件改了 |
| `git add <文件>` | 把文件加入暂存区 |
| `git add -A` | 把所有改动加入暂存区 |
| `git commit -m "信息"` | 提交暂存区的改动 |
| `git push origin main` | 推送到 GitHub |
| `git pull origin main` | 从 GitHub 拉取最新代码 |

---

## 日常开发流程（记住这个顺序）

```
写代码 → git status → git add -A → git commit -m "xxx" → git push
```

每次推送前先用 `git pull` 拉取最新的，避免冲突：

```bash
git pull origin main
git push origin main
```
