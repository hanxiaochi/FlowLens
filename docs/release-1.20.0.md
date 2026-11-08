# FlowLens 1.20.0 · 把现场讨论交给开发

这版把需求来源、业务确认、场景验证和开发交接接在一起。拿着客户的表格讨论时，可以记下每条规则的依据，试一遍单表或跨表操作，再把结果随应用交给开发。

## 本版内容

- 需求工作单记录现状、目标、范围、材料、负责人和部署条件。
- 客户原文可关联字段、表式或办理动作，确认记录保留当时定义。
- 单表及跨表场景保留输入、角色、操作与失败原因，定义变化后提示复核。
- 现场观察与待跟进事项随应用保存，开发交接包包含依据、历史和 API/SQL 草案。
- 团队发布显示证据变化，项目恢复保留历史并重新映射编号。
- 包含 1.19 候选版的资料核对清单及备份恢复加固。

## 验证与部署状态

1.20 候选阶段通过 183 项本地测试、Windows/Ubuntu CI、容器和 Compose 检查。实际下载团队包通过 24 项 HTTP/CLI 检查。浏览器已验证跨标签页冲突、草稿下载、窄屏操作、团队发布及恢复副本继续保存。实际云端候选使用 1.18 新备份核对 5 账号、2 项目、10 单据和 4 附件，并再次备份还原。

正式源码固定于 8bfc3e9003bb50097096dbafa425f68cb6be29a2，CI 42511037652 的 Windows、Ubuntu、容器及 Compose 检查全部通过。四类 ZIP 和 SHA256 已发布，GitHub 实际下载团队包再次通过 24 项运行检查。

正式云端已从 1.18 升级到 1.20，升级前备份已保留。五账号的可见数据与升级前逐项一致，10 份 Excel 台账字段及 10 份 HTML 核对报告编号匹配。容器 32 个运行文件与发行构建一致，备份独立恢复验证 2 项目、10 单据、4 附件，旧会话清空、旧实例请求拒绝。最终备份已下载到本机并核对 SHA256。公开 Demo 47 个文件与构建一致。

公网浏览器已完成专业监理账号登录、资料核对、按编号筛选、打开单据、返回保留筛选及下载完整清单。实际下载 HTML 与接口全项目报告一致，筛选一份时下载仍包含两份问题单据。操作后五账号数据与升级前一致。源码标签和附件保持固定，后续验收记录更新在主分支。

另将云端下载备份在本机 Windows 独立恢复，业务、账号、成员、审计、请求和附件表逐项一致。5 个账号可读取相应项目，旧会话清空，首次启动生成新实例编号，旧实例请求全部拒绝。此证据覆盖一次跨机器恢复，持续异地复制仍待落实。

## 仍需核对

打印样例已收到用户“看起来是正常的”的反馈，完整 PDF、页数及 57 份单据逐条核对尚未取得。Windows 自动化当前无法可靠确认打印界面状态。

确认人、观察人及业务结论由记录者填写。场景使用本地规则与虚构数据。实际监理表式、职责、真实用户试用、整机重启、运维接手和持续异地备份仍按交付清单推进。公开 AI 继续关闭。

## English

This release connects discovery worksheets, source-linked requirements, version-bound confirmation, scenario checks, field observations, and developer handoff. Project restoration retains historical evidence and assigns new identifiers. It also includes the project review and restore hardening introduced in the 1.19 candidates.

The 1.20 candidate passed 183 local tests, Windows/Ubuntu CI, container and Compose checks, and 24 checks against the downloaded team runtime. Browser tests covered conflicts, retained drafts, narrow screens, publication, and continued editing after project restoration. An isolated cloud candidate restored a fresh production backup and verified five accounts, two projects, ten records, and four attachments.

Release v1.20.0 is pinned to 8bfc3e9. CI 42511037652 passed on Windows, Ubuntu, containers, and Compose. Four archives and SHA256 checksums are published, and the downloaded team runtime passed 24 checks. Production is now on 1.20.0 with matching five-account state, ten Excel exports, ten HTML review reports, and verified backup restoration. The public demo matches all 47 deployed files. Production browser checks now cover member login, project review, filtering, record navigation, retained filters, and complete HTML downloads. Five-account state remained unchanged. A downloaded cloud backup was also restored in an isolated Windows runtime, with matching data and attachments, cleared sessions, and rejection of old-instance requests. Recurring off-host replication remains outstanding. Printed layout received preliminary user approval, while a complete PDF and record-by-record pagination review remain outstanding. Real business acceptance, operator handoff, host reboot, and sustained offsite backup validation are still tracked in the delivery checklist. Public AI remains disabled.
