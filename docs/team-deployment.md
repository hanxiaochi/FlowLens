# 团队协作部署与交付

团队协作服务把项目、成员权限和业务保存在服务器。设计工作台继续用于确认表式和规则，管理员将导出的整个应用包导入协作服务，再分配账号和项目角色。

## 本机试运行

安装 Node.js 24 LTS。协作服务只使用 Node 内置模块，解压源码即可运行。设计工作台仍按根目录 README 安装依赖。

PowerShell 中先读取管理员初始密码到环境变量，初始化后移除变量。密码至少 12 位，请使用自己的密码。

```powershell
$env:FLOWLENS_ADMIN_USER = 'admin'
$credential = Get-Credential -UserName admin -Message '设置 FlowLens 管理员初始密码'
$env:FLOWLENS_ADMIN_PASSWORD = $credential.GetNetworkCredential().Password
node scripts/team-admin.mjs init
Remove-Item Env:FLOWLENS_ADMIN_PASSWORD
npm run start:team
```

打开 http://127.0.0.1:4186/，登录并进入管理后台。

1. 从设计工作台导出整个应用，导入 JSON。
2. 创建成员账号，通过安全渠道交付初始密码。成员登录后可修改密码。
3. 按项目为成员勾选角色。管理员也需要项目角色才能办理业务。
4. 成员从项目待办办理。阶段切换后，服务端重新检查角色和记录修订。
5. 离职或停止试用时停用账号。停用立即撤销全部登录会话。

应用包导入为追加操作，重复模板、应用、项目或业务编号会被拒绝。更新已有应用时使用“发布已有应用的新表式”，修改过的模板需要更高版本号。服务器保留现有业务及其表式快照，新建业务使用新版本，新增项目可一同带入。先在恢复的试验实例确认新规则，再更新正式实例。导入前历史显示为“导入前记录”，服务器办理历史记录真实登录账号。

## 配置

| 变量 | 默认值 | 用途 |
| --- | --- | --- |
| `FLOWLENS_DATABASE` | `.local/team.sqlite` | SQLite 文件路径，需持久化 |
| `FLOWLENS_ORIGIN` | `http://127.0.0.1:4186` | 浏览器使用的完整源地址 |
| `HOST` | `127.0.0.1` | 监听地址，容器内部使用 `0.0.0.0` |
| `PORT` | `4186` | 服务监听端口 |

外部访问配置 HTTPS 源地址，由反向代理终止 TLS 并保留原 Host。会话 Cookie 使用 HttpOnly、SameSite=Strict，HTTPS 配置时启用 Secure。服务器拒绝不匹配的 Host、跨站 Origin 和缺少同源标记的写请求。`GET /health` 可用于进程健康检查。

1.4.1 起，登录限流按实际连接来源与账号组合累计失败尝试，15 分钟最多 20 次，同一来源合计最多 100 次。成功登录释放本次额度。默认代理部署下来源为网关，因此大量失败尝试仍可能影响同一网关下的用户。限制保存在进程内存，服务重启后重新计数。

## 容器部署示例

准备一台有 Docker Compose 的 Linux 主机，域名解析到该主机，并开放 80、443。本仓库提供单实例 Compose 和 Caddy 配置，实际主机上的构建、证书签发与容量需部署后验收。

```sh
export FLOWLENS_DOMAIN=flowlens.example.com
docker compose -f compose.team.yaml build
docker compose -f compose.team.yaml run --rm -e FLOWLENS_ADMIN_USER=admin -e FLOWLENS_ADMIN_PASSWORD app node scripts/team-admin.mjs init
docker compose -f compose.team.yaml up -d
```

初始化前将 `FLOWLENS_ADMIN_PASSWORD` 通过受保护的终端或密钥管理工具注入环境，完成后清除。禁止将实际密码写入 Compose、Git 或镜像。业务数据和网关证书使用具名卷。迁移主机时同时保存业务备份和网关配置。

## 备份与恢复

备份命令通过 SQLite 在线备份 API 获取一致性快照，可在服务运行期间执行。目标文件必须尚不存在。

```sh
node scripts/team-admin.mjs backup /secure-backups/flowlens-2026-11-02.sqlite
```

备份含账号密码哈希、业务内容及附件，应存放在受限目录并按项目要求做加密和异地保管。SQLite 本身未开启静态加密，磁盘加密由部署环境提供。

恢复前停止目标服务，使用新的数据库路径。

```sh
FLOWLENS_DATABASE=/data/restored.sqlite node scripts/team-admin.mjs restore /secure-backups/flowlens-2026-11-02.sqlite
FLOWLENS_DATABASE=/data/restored.sqlite npm run start:team
```

Windows 可通过 `$env:FLOWLENS_DATABASE` 设置路径。恢复命令拒绝覆盖已有数据库，检查 SQLite 完整性及版本，并清空旧会话。重新登录后核对账号权限、业务数量、附件和至少一次完整办理，再决定是否切换正式路径。

升级前备份并保留上一版程序。发生问题时将备份恢复到新路径，使用与备份匹配的程序启动。直接复制运行中的 `.sqlite` 文件可能漏掉 WAL 数据，应使用备份命令。

管理员忘记密码时，服务器操作员可用初始化时相同的环境变量指定账号和新密码，运行 `node scripts/team-admin.mjs reset-password`。此操作撤销该账号的旧会话并记录审计。

## 当前运行边界

- 单实例、小团队试运行。工作区采用事务化 JSON 存储，业务规模扩大时需迁移到分表存储并重新测量。
- 单工作区上限 32 MB，单个附件 10 MB，每份业务附件合计 30 MB。工作包结构上限沿用设计端校验。
- 项目成员可以读取该项目内业务和附件，只有当前阶段的授权角色可以修改对应字段。暂未提供项目内按记录保密。
- 同一账号获多个角色时可办理这些角色，职责分离需按项目要求分配独立账号。
- 备份恢复和审计用于追溯与运行维护，正式电子签章需另行集成。
- 生产试点前确认真实表式、办理规则、域名证书、容量、备份存放和恢复责任人。请记录真实环境的测量结果。

## 交付验收

2026-11-03 在 GitHub Actions 的 Windows 与 Ubuntu runner 上分别通过 70 项回归，并完成协作包和公开体验构建。Linux Docker 验证完成镜像构建、账号登录、应用导入、角色授权、业务写入、容器重启、请求重试、在线备份和恢复，恢复数据库的旧会话已清空。此记录覆盖单容器运行，Compose、Caddy 证书签发与目标服务器容量需在实际部署时验证。[验收运行记录](https://github.com/hanxiaochi/FlowLens/actions/runs/41478163175)

同日追加 Compose/Caddy 验收，使用仓库中的配置，在隔离的 Linux runner 上验证非 root 运行、Docker 健康状态、localhost 本地 CA 签发的 HTTPS、Secure Cookie、跨站请求拒绝和切换恢复数据库后重新登录。真实域名的公开证书签发和目标服务器容量需要现场验收。[Compose 运行记录](https://github.com/hanxiaochi/FlowLens/actions/runs/41479107669)

按 `docs/delivery-plan.md` 验证两个独立账号、越权拒绝、过期修订冲突、重复请求、重启恢复和备份还原。管理员从管理后台导出审计证据或查看最近记录，业务方核对指令、回复、复查归档是否符合实际职责。
