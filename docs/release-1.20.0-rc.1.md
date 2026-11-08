# FlowLens 1.20.0-rc.1 · 从现场讨论到开发交接

这次把需求工作单、原文依据、确认历史、场景验证和开发交接连在了一起。拿着客户的表格讨论时，可以记下规则从哪里来，再用样例或自己的输入试一遍，带着结果交给开发。

## 可以体验什么

- 在应用首页填写需求工作单，把原文关联到表式、字段或办理动作。
- 保存业务确认和现场观察，规则变化后查看需要复核的记录。
- 运行单表与跨表场景，检查角色、必填、退回、资料带入和重复请求，并保留实际输入及失败原因。
- 打开开发交接，核对待补资料、证据状态和合同文件位置，下载带有完整历史及本地运行器的应用 ZIP。
- 在团队发布预览中查看确认、观察和场景的状态变化。已有历史受到发布校验保护。

## 本轮验证

183 项本地测试通过。独立构建的团队运行目录完成 24 项检查，包含账号权限、并发写入、重试、发布、项目资料包、备份还原、恢复后会话撤销和原请求拒绝。浏览器已执行跨表历史的团队发布，数据库核对原单据及历史一致。项目归档恢复回归确认历史原快照保留、副本提示重新运行，备份重新打开仍能读取。

提交 818982030a494c2b6eab3bca14e916f81a08754e 的 CI 42509633797 已通过 Windows、Ubuntu、容器与 Compose 检查。四类发行 ZIP 已上传并核对 SHA256，团队包从 GitHub 重新下载后通过 24 项 HTTP/CLI 检查。附件固定于该提交，主分支继续补充验收记录。

## 使用范围

设计工作台中的需求记录随应用共享。确认人和观察结论由记录者填写。单表场景运行本地规则，跨表场景使用独立虚构项目；真实业务含义、生产权限及部署仍需目标环境验收。

每条需求最多保存 50 次确认、20 次单表运行、50 次观察。每个应用最多保存 10 次跨表运行，单份跨表报告最多 200 万字符。定义变化会保留旧证据并提示复核。正式云端及在线演示当前仍为 1.18.0，公开 AI 关闭。

真实业务负责人、试用成员、维护交接、异地备份与完整打印证据继续见 [交付清单](delivery-readiness-2026-11-04.md)。本候选同时包含 1.19 的资料核对与恢复加固改动。

## English

This candidate connects discovery worksheets, customer source text, version-bound reviews, field observations, scenario checks, and developer handoff. Teams can inspect publication impact and retain their evidence when definitions change.

All 183 local tests and 24 checks against the built team runtime passed. Browser publication and archive-restoration checks retained existing records and historical snapshots. Windows, Ubuntu, container, and Compose CI passed for commit 8189820. All four release archives were uploaded with verified SHA256 digests. The team archive downloaded from GitHub passed 24 HTTP/CLI checks. Archives remain pinned to that commit while the main branch carries subsequent acceptance notes.

Reviewers and observations are recorded manually. Scenario results cover local rules and fictional projects. Production authorization, deployment, business-owner acceptance, and real-user trials require their own evidence. Production and the public demo remain on 1.18.0 with public AI disabled.
