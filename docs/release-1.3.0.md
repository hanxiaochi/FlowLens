# FlowLens 1.3.0

这一版把几张有关联的业务表组织到一个应用里。打开项目工作台，就能看到有哪些事要办、哪些单据已完成，以及下一张表从哪里发起。

## 本次更新

- 应用和项目工作台，可以选入模板，按项目查看业务，按角色筛选待办。
- 指令、整改回复、复查归档三张独立样例单据，自动带入项目资料和上游内容，保存来源及修订。
- 可增删的检查明细，支持列类型、阶段必填、数值合计，以及打印和工作包恢复。
- 自然语言规则草案，先预览再确认。支持必填、办理角色、条件退回的明确句式。
- 整个应用导出与恢复。交付 ZIP 包含当前及历史表式版本的 OpenAPI、SQL、业务说明和独立 Node.js 验证器。
- 中英文 README、截图、三分钟新版旁白视频、字幕和文字稿。

## 验收记录

2026-11-02 完成本地验收。

| 检查 | 结果 |
| --- | --- |
| 自动回归 | 67/67 通过，包含旧工作包、条件退回、明细、保存失败、重复操作和类型化 SQL |
| 三单据业务 | 指令提交签发 → 回复退回 → 恢复工作包 → 重提通过 → 复查归档已走通 |
| 数据与版本 | 两项目资料带入、按项目显示、重复发起打开已有记录、规则确认及旧表式快照验证通过 |
| 实际下载交付包 | 3 模板、2 项目、4 记录，独立验证器 38 项检查通过，包含回复单 v1 与 v2 契约 |
| 窄屏 | 390×844 视口工作台无页面横向溢出 |
| 3D | 复查归档记录上下文可进入部署世界并运行模拟 |
| 视频 | 中文 3:02，英文 3:00，1080p，完整音视频解码通过 |

视频采用实际操作的分步页面画面，配合合成语音、字幕和章节。英文视频展示中文界面。

## 使用范围

应用保存在当前浏览器。角色切换用于业务推演，正式项目还需服务器身份、项目权限、共享数据库、事务、附件存储及恢复演练。公开演示的 AI 生成关闭。本地规则助手采用受支持句式，任意自然语言的自动理解仍需后续扩展。

关系目前支持无环上下游，并从已完成单据发起。同一来源与关系复用已有下游，字段在创建时带入。历史实例继续使用创建时的表式和规则。应用包恢复会替换工作区，恢复前自动下载备份。

## 下载

- `FlowLens-1.3.0-source.zip` 源码，开发时执行 `npm ci`。
- `FlowLens-1.3.0-local.zip` 带运行依赖，安装 Node.js 22+ 后双击启动或执行 `npm start`。
- `FlowLens-1.3.0-public-demo.zip` 静态演示构建。
- `FlowLens-1.3-guide.zh-CN.mp4` / `.en.mp4` 中英视频，另附 SRT 字幕。
- `SHA256SUMS.txt` 下载校验值。

[打开在线 Demo](https://hanxiaochi.github.io/FlowLens/) · [中文指南](forms-guide.md) · [English README](../README.en.md)

## English summary

FlowLens 1.3 brings related forms into a project-based application. It adds cross-form field mapping, repeating detail rows, role-filtered work queues, confirmed rule drafts, and restorable application handoffs with versioned contracts. The three-document example covers instruction, rectification reply, and review archive.

67 automated tests and 38 checks on an actually downloaded handoff passed. This release runs in browser-local storage. Production deployment requires authenticated users, project permissions, shared persistence, and tested operational recovery. Both narrated walkthroughs use step-by-step captures of the Chinese interface.
