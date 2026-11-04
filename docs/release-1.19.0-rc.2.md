# FlowLens 1.19.0-rc.2 · 恢复失败时不留下半成品

此候选版包含 rc.1 的资料核对功能，并修复只读备份来源的恢复问题。正式云端和公开演示站仍为 1.18.0；打印分页与正式升级验收尚未完成。

## 恢复流程的变化

CLI 先在目标目录下建立受限暂存副本，完成完整性检查、附件校验和旧会话撤销，最后才生成目标数据库。不会覆盖已有目标。来源有非空 WAL 或事务日志时会拒绝，要求先用 backup 命令生成独立备份。

只读来源不再需要手工复制到可写目录。需要额外暂存空间及支持硬链接的目标文件系统；推荐至少预留备份大小的三倍空间。磁盘不足和普通异常会清理本次暂存目录。进程强杀或断电可能留下隐藏暂存目录，需要维护人员确认后处理，不能把这些文件当作正式数据库启动。

## 验收记录

- 158 项本地测试通过，包括两个真实恢复进程竞争同一目标，仅一个成功；发布前强杀后无目标、可重试。
- 云端隔离容器将原备份只读挂载，修复后的 CLI 恢复成功；5 个账号、2 个项目、10 份单据、4 个附件及二次备份还原一致。
- 1 MiB 临时磁盘实际触发 ENOSPC，目标未生成、暂存目录已清理。
- 提交 db0f432 的 Windows、Ubuntu、容器 CI 41765530343 全部通过；GitHub 协作包重新下载 SHA256 一致，24 项独立运行检查通过。上述云端检查使用候选镜像加当前恢复脚本，并非正式服务升级。

## English

This candidate keeps the project review features from rc.1 and hardens database restore. Read-only snapshots are copied into a private staging directory. Validation and session cleanup finish before an atomic, no-overwrite publication creates the destination.

158 local tests passed, including competing CLI processes and interruption before publication. An isolated cloud check restored a read-only mounted backup, and an actual ENOSPC test left no destination or temporary files. Hard links and additional staging space are required. A killed process can leave a private staging directory for manual inspection.

Windows, Ubuntu, and container CI 41765530343 passed. The published team ZIP was downloaded again, matched its SHA256, and passed 24 independent runtime checks. Printed pagination and stable cloud deployment remain pending. The production service remains on 1.18.0.

[恢复部署说明](team-deployment.md) · [资料核对使用说明](project-review-guide.md) · [Review guide](project-review-guide.en.md)
