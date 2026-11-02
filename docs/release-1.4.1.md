# FlowLens 1.4.1

## 修复团队登录误限流

1.4.0 将同一来源的所有登录累计到 15 分钟额度内。通过反向代理访问时，正常成员可能共同耗尽额度。

本版让成功登录释放额度。失败尝试按来源与账号组合限制为 20 次，同一来源累计限制为 100 次，时间窗口为 15 分钟。验证密码前预占额度，防止并发请求越过限制。服务端使用实际连接来源，默认 Caddy 部署下来源为网关。

## 部署验收

Windows 与 Ubuntu 各通过 70 项测试，Linux 容器及 Compose 作业通过。验收代码提交为 `59760c1`。[完整运行记录](https://github.com/hanxiaochi/FlowLens/actions/runs/41479752796)

- 自动回归覆盖超过 20 次正常登录、并发失败请求、账号大小写、同源其他账号登录以及更换账号名的失败尝试。
- 独立交付包验证启动、备份、恢复、损坏备份拒绝、已有数据库保护和旧会话撤销。
- Linux 容器验证业务写入、重启和恢复。
- Compose 验证原有部署配置、非 root 运行、Docker 健康检查、Caddy HTTPS、Secure Cookie、跨站请求拒绝，以及恢复后通过 HTTPS 重新登录。

Compose 验收使用 GitHub Linux runner 和 Caddy 为 localhost 签发的本地证书，客户端仅信任该测试 CA。真实域名的公开证书签发、用户服务器容量及业务试点仍待目标环境验收。

## 升级

先用现有备份命令保存数据库。停止协作服务，将程序换为本版协作包，保留原数据库路径与源地址配置，再启动并验证登录。数据库结构沿用 1.4.0。

下载文件包括独立协作包 `FlowLens-1.4.1-team.zip`、源码包、带运行依赖的本地设计包，以及公开静态体验包。校验值见 `SHA256SUMS.txt`。

README 视频继续展示 1.3 设计工作台，本次修复的登录及部署行为由自动验收记录说明。

## English

This patch fixes successful team logins consuming a shared reverse proxy's login allowance. Failed attempts are limited to 20 per source/account pair and 100 per source within 15 minutes. Capacity is reserved before password verification, including concurrent requests, and successful authentication releases its reservation.

Deployment checks cover standalone delivery, Linux containers, and the supplied Compose/Caddy stack. The Compose test verifies HTTPS with Caddy's localhost CA, secure cookies, cross-origin rejection, backup restoration, and signing in to the restored service. Public certificate issuance, customer-host capacity, and business pilot acceptance still require the target environment.

Back up the database, stop the service, replace the program, and restart with the same database and origin configuration. The database format is compatible with 1.4.0. README walkthroughs continue to cover the 1.3 design workspace.
