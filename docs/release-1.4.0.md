# FlowLens 1.4.0

这一版增加团队协作服务。确认好的表式可以交给不同账号办理，项目权限、表单状态、附件和审计记录落在服务器上。设计工作台继续负责表式、规则及原型讨论。

## 可以交付的内容

- Node.js 24 与 SQLite 的单实例协作服务，运行包使用 Node 内置模块。
- 账号登录、密码哈希、服务端会话、密码修改、账号停用及服务器操作员密码恢复。
- 项目角色授权与服务端逐次校验，普通成员只读取获授权项目，管理员办理业务也需项目角色。
- 原表填写、重复明细、附件、退回重提、多单据关联和实际操作者历史。
- 记录修订冲突保护和请求幂等。模板更新需更高版本，已有业务保留历史快照。
- 管理后台、最近审计记录导出、在线一致性备份与新路径恢复。
- 自托管运行包、Dockerfile/Compose/Caddy 部署示例、部署与恢复说明。

## 本轮验收

2026-11-02，Windows 与 Node.js 24.17.0。

| 检查 | 结果 |
| --- | --- |
| 自动回归 | 69/69 通过，包含原有设计端回归、项目权限、历史操作编号、模板更新、账号停用及会话撤销 |
| 浏览器正常入口 | 管理员导入应用、创建成员、分配角色，监理与施工两个独立账号完成指令、回复和归档 |
| 退回与恢复 | 回复不通过退回，备份到新数据库，重新登录后施工修改重提，再通过复查和归档 |
| 附件与打印 | 施工上传附件，监理可见；实际下载打印版含归档编号、实际账号及服务器记录标识 |
| 独立运行包 | 新目录无需 npm 依赖启动，7 项交付检查通过 |
| 并发 HTTP 写入 | 同一修订的两个请求只有一个提交，另一个返回 409；重试成功请求不会重复推进 |
| 手机宽度 | 390×844 视口首页无页面横向溢出 |
| 本机顺序写入测量 | 300 次新建事务，最终 301 份记录、约 1.46 MiB 工作区，P50 19.5 ms，P95 50.4 ms |

顺序写入测量在 Ryzen 7 9800X3D、31 GiB 可见内存的本机完成，测试进程 RSS 约 213 MiB，样例无附件。这组结果仅描述本机顺序事务，生产并发人数和低配置主机容量需另测。

本机未安装 Docker，因此容器镜像构建、外部域名证书与 Linux 主机运行尚未验收。已验证的是原生 Node 运行包与 SQLite 备份恢复。部署示例的 1 GiB 内存配置需要在目标主机复测。

## 使用与迁移

1. 安装 Node.js 24 LTS，下载 `FlowLens-1.4.0-team.zip`。
2. 按部署指南初始化管理员，运行 `npm start`。
3. 从设计工作台导出整个应用，在协作后台导入，创建账号并分配项目角色。
4. 业务记录在服务端保存。管理员可发布新版本表式，已创建业务沿用旧快照。
5. 备份后在独立路径恢复并检查业务，再安排升级或迁移。

[部署与恢复指南](team-deployment.md) · [成熟度推进计划](delivery-plan.md) · [在线设计体验](https://hanxiaochi.github.io/FlowLens/)

## 当前边界

公开在线体验仍为浏览器本地演示，AI 生成关闭。协作服务通过自托管提供。单实例工作区上限 32 MB，单附件 10 MB，每份业务附件合计 30 MB。项目内成员可读取该项目的记录和附件，记录级保密、实时推送、统一身份和正式签章需进一步实施。

真实客户试点尚待业务负责人确认表式与职责，并在目标部署环境验收。项目级角色、服务器审计和本机测试提供了试运行基础，成熟产品验收仍包括实际人员使用、异常恢复、容量和交付接手。

本版更新了双语 README、工作台截图和部署手册。README 的双语视频继续讲解 1.3 设计工作台，其范围已在页面标明。

## 下载文件

- `FlowLens-1.4.0-team.zip` 独立协作服务，Node.js 24+，无 npm 运行依赖。
- `FlowLens-1.4.0-source.zip` 全部源码。
- `FlowLens-1.4.0-local.zip` 带 Three.js/fflate 的本地设计工作台与协作源码。
- `FlowLens-1.4.0-public-demo.zip` 静态本地体验构建。
- `SHA256SUMS.txt` 发布文件校验值。

## English summary

FlowLens 1.4 adds a self-hosted team workspace with accounts, project roles, shared records, attachments, server-side workflow commands, revision conflicts, idempotent requests, audit history, template publication, and SQLite backup/restore tools.

69 automated tests passed. Browser acceptance used separate supervisor and contractor accounts across an instruction, a returned rectification reply, backup restoration, resubmission, and final archive. Seven additional checks passed against the standalone runtime, including concurrent HTTP writes and restoration.

Node.js 24 LTS is required. Docker, external TLS, Linux hosting, and real-customer capacity remain target-environment acceptance tasks. The public demo stays browser-local with AI disabled. The README videos cover the 1.3 design workspace.
