# 研序 · 个人科研工作台

面向个人理工科科研的本地网页应用。集中管理文献、PDF 阅读与批注、Markdown 笔记、科研工具、课题、任务和实验记录。

## 启动

需要 **Node.js 24 或更新版本**。本项目已在 Windows、Node.js 24.14 环境完成构建和测试。

双击项目中的 **启动科研工作台.cmd**，等待构建完成后访问：

**http://127.0.0.1:4317**

也可以在 PowerShell 中运行：

```powershell
cd D:\_项目开发\yanke
npm.cmd install --cache .cache/npm
npm.cmd run build
npm.cmd start
```

依赖已安装并构建后，日常只需要 `npm.cmd start`。启动终端中的 `Ctrl+C` 会停止服务；关闭浏览器不会删除资料。

开发模式使用 `npm.cmd run dev`，页面支持热更新。修改后端会重启服务。

Node.js 可能打印 SQLite 实验性 API 提示，这是当前运行时的提示，不影响已验证的本地存储功能。

## 推荐的第一次使用流程

1. 在“项目任务”中新建课题。
2. 从“文献库”导入 PDF、BibTeX 或 RIS；也可以先添加文献信息，再进入阅读页添加 PDF。
3. 打开论文，选择文字后点击“保存高亮”，可同时填写批注；目录、文内搜索、缩放、旋转和页码跳转都在阅读区顶部。
4. 新建阅读笔记，关联课题；Markdown 内容自动保存，切换到“预览”查看排版。“插入页码”创建可返回 PDF 对应页的引用。
5. 在课题中关联论文、笔记与常用工具，并创建待办任务和带日期的实验记录。
6. 在顶部输入关键词并按 Enter，检索论文元数据、PDF 正文、笔记、批注和课题任务。

首页汇总真实资料与任务，首次启动为空白工作空间；应用不会自动放入演示数据。

## 导入和手动刷新

- **直接导入**：支持多选 `.pdf`、`.bib`、`.ris`、`.md`，单文件上限 256 MB。损坏或不支持的资料会显示失败原因，其余条目继续处理。
- **本地目录 / Obsidian**：在“设置与数据 → 添加来源”中粘贴资源管理器地址栏的完整目录路径。仅扫描该目录及其子目录，跳过隐藏目录、符号链接和目录外关联文件。
- **Markdown 来源**：导入正文与个人补充内容分别保存。来源刷新更新正文，保留你在工作台内写下的思考；支持 `[[内部链接]]`、行内标签及常见 `title` / `tags: [a, b]` 前言字段。不是完整的 Obsidian 插件或复杂 YAML 兼容层。
- **Zotero**：配置数字用户 ID 和只读 API Key 后，点击“刷新”。使用 Zotero Web API v3；支持分页获取元数据、下载有访问权限的 PDF。云端未同步的本地链接附件和 WebDAV 附件需手动导入。本地应用不读取或改写 Zotero 的数据库。
- **去重**：来源 ID 相同则更新；跨来源优先按 DOI 识别。没有 DOI 的同名同年文献会生成候选，须在导入报告中确认合并。
- **来源缺失**：外部文件或 Zotero 条目移除后标记来源缺失，已经导入的资料、笔记和批注仍保留。
- **重试**：导入报告保存失败原因并支持重试整个批次，已导入部分会通过来源 ID、DOI 或文件哈希识别。来自备份的历史导入记录需要重新选择原文件。

## 数据保存与备份

默认保存到项目的 `data/`：

| 内容                                   | 位置                   |
| -------------------------------------- | ---------------------- |
| 文献、笔记、批注、关系、任务、检索索引 | `data/research.sqlite` |
| 复制的 PDF 与关联附件                  | `data/files/`          |
| 用于重试的原始导入文件                 | `data/staging/`        |
| Zotero API Key（仅由后端读取）         | `data/secrets.json`    |

应用导入时复制附件，不修改原文件。笔记和批注记录在本地数据库内，**不写回原 PDF、Zotero 或 Obsidian**。阅读位置、缩放和旋转也会保存。

“设置与数据”支持完整 ZIP 备份与恢复，包含记录、正文索引及有效附件，不包含 API Key 或可重试的暂存原文件。恢复前请先备份当前工作台；恢复完成后可能需要重新填写 Zotero API Key。

ZIP 备份适用于附件与记录总计不超过 500 MB 的资料库；恢复解压上限为 512 MB。更大的资料库可在停止服务后复制整个 `data/` 目录，恢复时同样在停服状态下放回。完整目录备份包含 `secrets.json`，请自行保管。

还可单独导出 Markdown 笔记、BibTeX 文献库、JSON 工具列表。工具列表 JSON 可导回工作台。

可通过环境变量自定义数据目录和端口：

```powershell
$env:RESEARCH_DATA_DIR = 'D:\科研资料\研序数据'
$env:PORT = '4317'
npm.cmd start
```

## 边界与离线使用

服务只监听 `127.0.0.1`，无账号与多人协作。依赖、PDF 字体、文字层和阅读组件都在本机；已导入资料的阅读、笔记、工具管理、任务与检索可离线使用。联网仅用于用户主动刷新 Zotero 或打开外部学术网址。

扫描版 PDF 可显示并记录页码笔记；正文搜索和文字高亮要求 PDF 有可提取文本。首版没有 OCR、AI、在线论文聚合检索、双向同步或结构化实验数据版本管理。

## 验证与开发接口

```powershell
npm.cmd test
npm.cmd run build
```

测试使用 `.cache/tests/` 中的独立临时数据库，不改动正式资料。浏览器验收数据另存于 `.cache/qa-data/`。

前端采用 React + TypeScript + Vite；后端采用 Fastify + Node.js 内置 SQLite，PDF.js 负责 PDF 解析与渲染。数据库迁移版本记录在 `migrations` 表。

| 接口                                    | 用途                                        |
| --------------------------------------- | ------------------------------------------- |
| `GET /api/state`                        | 获取工作台资源；来源只返回密钥配置状态      |
| `GET/POST /api/records/:kind`           | 读取 / 创建资源                             |
| `PATCH/DELETE /api/records/:kind/:id`   | 修改 / 删除资源                             |
| `POST /api/import`                      | multipart 导入，返回后台任务记录            |
| `POST /api/sources/:id/refresh`         | 手动刷新资料来源                            |
| `POST /api/imports/:id/retry`           | 重试导入任务                                |
| `POST /api/papers/merge`                | 确认重复候选合并                            |
| `GET /api/search?q=…`                   | 全局检索，返回关联文献与页码                |
| `GET /api/attachments/:id/file`         | 读取附件，支持 PDF Range 请求               |
| `POST /api/experiments/:id/attachments` | 添加实验附件                                |
| `GET /api/backup`、`POST /api/restore`  | 完整 ZIP 备份 / 恢复                        |
| `GET /api/export/:format`               | 导出 `papers.bib`、`notes.md`、`tools.json` |
| `POST /api/tools/import`                | 导入工具 JSON 数组                          |

运行时校验资源类型、必要字段、关联对象、批注坐标与页码，以及本机 Host / Origin。Markdown 不执行原始 HTML，也不自动加载外部图片。

参考：[Zotero Web API v3](https://www.zotero.org/support/dev/web_api/v3/)、[PDF.js](https://mozilla.github.io/pdf.js/)、[SQLite FTS5](https://www.sqlite.org/fts5.html)。
