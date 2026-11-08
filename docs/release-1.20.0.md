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

正式包构建、跨平台 CI、实际下载及公网升级结果将在完成后补充。本文件当前为正式发行准备记录。

## 仍需核对

打印样例已收到用户“看起来是正常的”的反馈，完整 PDF、页数及 57 份单据逐条核对尚未取得。Windows 自动化当前无法可靠确认打印界面状态。

确认人、观察人及业务结论由记录者填写。场景使用本地规则与虚构数据。实际监理表式、职责、真实用户试用、整机重启、运维接手和持续异地备份仍按交付清单推进。公开 AI 继续关闭。

## English

This release connects discovery worksheets, source-linked requirements, version-bound confirmation, scenario checks, field observations, and developer handoff. Project restoration retains historical evidence and assigns new identifiers. It also includes the project review and restore hardening introduced in the 1.19 candidates.

The 1.20 candidate passed 183 local tests, Windows/Ubuntu CI, container and Compose checks, and 24 checks against the downloaded team runtime. Browser tests covered conflicts, retained drafts, narrow screens, publication, and continued editing after project restoration. An isolated cloud candidate restored a fresh production backup and verified five accounts, two projects, ten records, and four attachments.

Final release artifacts and deployment verification are being prepared. Printed layout received preliminary user approval, while a complete PDF and record-by-record pagination review remain outstanding. Real business acceptance, operator handoff, host reboot, and sustained offsite backup validation are still tracked in the delivery checklist. Public AI remains disabled.
