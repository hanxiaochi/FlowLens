export const DEPLOYMENT_CHOICES=[
 ['audience','谁来使用',[['public','公开用户'],['internal','公司内部']]],
 ['scale','目前的阶段',[['small','起步验证'],['growing','持续增长']]],
 ['mobile','手机端方式',[['web','浏览器访问'],['native','原生 App']]],
 ['budget','投入方式',[['lean','尽量节省'],['balanced','稳定性优先']]],
 ['region','主要用户地域',[['unsure','还不确定'],['mainland','中国大陆'],['global','多个国家或地区']]],
 ['operations','谁来维护',[['beginner','暂无专职技术人员'],['team','有技术维护团队']]]
];
export function normalizeDeployment(value={}){return Object.fromEntries(DEPLOYMENT_CHOICES.map(([key,,options])=>[key,options.some(([v])=>v===value?.[key])?value[key]:options[0][0]]));}
export function deploymentPlan({audience='public',scale='small',mobile='web',budget='lean',region='unsure',operations='beginner'}={},model){
 const internal=audience==='internal',growing=scale==='growing';
 return {title:internal?'面向团队的受控访问方案':growing?'支持增长的分层托管方案':'小规模产品的托管起步方案',summary:internal?'先明确员工如何接入公司网络，再部署前端、业务服务与数据库。':growing?'前端、后端与数据库分开部署，增加流量分发和可观测性。':'前端使用托管平台，后端使用托管应用环境，数据库选择托管数据库，减少自行维护的环节。',steps:[{title:'用户怎么打开',text:internal?'通过企业域名和内网或受控 VPN 访问；手机也需要满足访问条件。':'注册域名，配置 DNS 与 HTTPS；用户在浏览器输入网址。'},{title:'页面放在哪里',text:internal?'前端托管在团队可达的环境中，明确域名与访问控制。':'将前端静态资源托管到支持 HTTPS 的站点平台；可用 CDN 加速资源分发。'},{title:'业务在哪里执行',text:growing?'使用托管容器或应用平台，配置健康检查与负载均衡，再通过实际压力测试决定是否扩容。':'使用托管应用服务运行后端 API，配置环境变量、健康检查与日志。不要把密钥写进前端。'},{title:'数据放在哪里',text:`${model.entities.map(e=>e.label).join('、')}需要持久存储。选择托管关系数据库，配置网络访问限制、自动备份与恢复演练。`},{title:'手机要做什么',text:mobile==='native'?'如果选择原生 App，需要另建客户端、处理安装分发与版本更新；后端 API 可以共享。':'先采用响应式 Web，让同一网址适配手机；PWA 离线能力和推送需另行设计。'},{title:'上线前还要验证',text:'真实登录和数据权限、错误恢复、日志监控、备份、域名证书、移动设备体验，以及业务验收。'}],decisions:[
 {title:'费用从哪里来',text:budget==='lean'?'先用单区域、小规格托管服务验证需求，配置消费提醒。免费额度可能有休眠、流量或存储限制；正式用户使用前要核对这些限制。':'优先预算数据库备份、恢复能力、监控与服务可用性，再按真实负载选择冗余规格。稳定性需要设计与验证，并非升级套餐就能保证。'},
 {title:'离用户近，为什么重要',text:region==='mainland'?'优先测试目标用户在中国大陆网络下的访问体验。使用大陆节点前，向服务商核实域名备案等适用要求；数据保存地域由业务需求决定。':region==='global'?'前端静态文件可以通过 CDN 就近分发；业务数据先明确主区域。CDN 不会自动让数据库在全球同步，多区域写入需要额外设计。':'先确定第一批用户在哪里，并测试移动网络延迟，再选择服务器区域。不要只看服务商机房离开发者近不近。'},
 {title:'谁负责让它一直运行',text:operations==='beginner'?'优先选托管前端、托管应用和托管数据库，减少服务器补丁与数据库维护工作；仍需明确谁处理告警、账单与数据恢复。':'可以比较托管服务和自管容器，明确系统更新、监控值班、数据库备份与故障恢复责任。自管节省的账单可能变成人力成本。'},
 {title:'当前方案的取舍',text:(growing&&budget==='lean'?'增长与低预算存在取舍：先测量瓶颈、设置限流，再决定扩容；不要直接承诺高并发。':'先完成一条用户路径的上线与恢复演练，再扩展系统规模。')+(mobile==='native'?' 原生 App 还需要安装分发、版本维护和额外客户端开发预算。':' 同一套响应式 Web 通常能先覆盖电脑与手机浏览器。')}
 ],limits:['这是根据用途推导的架构建议，不是厂商报价或容量保证。','选择云厂商前还需确认用户地域、数据合规、预算与团队维护能力。','具体规格与扩容阈值应通过负载测试决定。']};
}

export function deploymentRoute(options,requestNumber=0){const growing=options.scale==='growing',replica=growing&&requestNumber%2===1;return {serverNode:replica?'replica':'server',serverName:growing?(replica?'业务副本 B':'业务副本 A'):'业务服务器',explain:growing?'设计推演按顺序把请求交给两个业务副本；两者读取同一份数据库。':'当前请求由一台业务服务器处理。'};}
