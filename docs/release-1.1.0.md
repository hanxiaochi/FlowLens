# FlowLens 1.1.0 · 让现成表格跑起流程

这次从真实工作中常见的一堆 Word 表格出发：让表格成为可填写、可交接、可追溯的业务记录。

**[直接试用，无需安装](https://hanxiaochi.github.io/FlowLens/)** · [操作说明](https://github.com/hanxiaochi/FlowLens/blob/v1.1.0/docs/forms-guide.md) · [试用反馈](https://github.com/hanxiaochi/FlowLens/issues/new?template=trial-feedback.yml)

## 新增

- 批量导入 DOCX、模板检索、合并单元格及原表结构填写。
- 字段按阶段分工，支持必填校验、审核、签发、签收和带理由退回。
- 同一记录保留模板快照、附件、关联单据与办理历史；支持工作包备份恢复、独立打印版 HTML。
- 无需安装的在线演示，内置原创虚构工程表单；保留交互实验室、系统设计和 3D 部署样例。

公开 demo 关闭 AI，不包含任何模型密钥或真实客户资料。本机版仍支持配置自己的模型服务。

## 下载

- `FlowLens-1.1.0-local.zip`：本机版，带运行依赖，需要 Node.js 22 或更新 LTS；解压后双击 `启动 FlowLens.cmd`。
- `FlowLens-1.1.0-demo.zip`：静态演示构建，供 HTTP 静态服务器托管；不要直接以 file:// 打开。
- `SHA256SUMS.txt`：下载文件校验值。

## 验证与边界

54 项自动测试通过。真实资料本地导入验证覆盖 340 个表号，并在复杂抽检表上走通办理过程；这不代表每份模板都已人工校对。公开样例不包含这些资料。

当前仍是本地推演，没有服务器账号、多人同步、正式电子签章或自动生产部署。Word 图片、浮动对象、特殊字体符号及打印分页需对照原件检查。在线演示发布于 GitHub Pages，访问速度受网络影响。

## English

Version 1.1 adds DOCX form import, stage-owned fields, review/return/receipt workflows, attachments, linked records, history, backup/restore, and printable HTML. Try the public demo without an API key. AI generation is disabled there; the local edition retains model configuration.

The demo uses fictional data and stores edits in your browser. This is not a production multiuser workflow service. All 54 automated tests pass. The existing bilingual videos cover version 1.0, not the new forms workspace.
