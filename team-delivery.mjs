export const deliveryChecks = {
  instance: [
    {id: 'https', title: '访问地址与 HTTPS', guidance: '记录验证地址、设备、证书及实际访问结果。'},
    {id: 'recovery', title: '备份与恢复演练', guidance: '记录备份依据、恢复实例、账号权限及附件核对结果。'},
    {id: 'offsite', title: '异地备份', guidance: '记录副本存放方式、执行频率、校验结果及责任人。'},
    {id: 'restart', title: '主机重启与服务恢复', guidance: '记录整机重启时间和恢复结果。'},
    {id: 'maintenance', title: '维护交接', guidance: '记录接手人、告警渠道、更新及回滚安排。'}
  ],
  project: [
    {id: 'forms', title: '表式与字段确认', guidance: '由业务负责人核对适用表式、字段含义和必填条件。'},
    {id: 'roles', title: '人员职责与权限', guidance: '记录实际人员、办理职责、离岗替补及越权检查。'},
    {id: 'workflow', title: '业务流程与例外', guidance: '记录完整办理、退回重提、失败处理及业务方确认结果。'}
  ]
};

export const deliveryStatusLabels = {pending: '待确认', passed: '已确认通过', blocked: '待解决', 'needs-review': '需要重新核验'};

export function projectRoleCoverage(projects, roleOptions, users, memberships) {
  const activeUsers = new Map(users.filter(user => !user.disabled).map(user => [user.id, user]));
  return projects.map(project => {
    const roles = (roleOptions[project.id] ?? []).map(role => {
      const memberIds = new Set(memberships.filter(member => member.projectId === project.id && member.roles.includes(role)).map(member => member.userId));
      return {role, members: [...memberIds].filter(id => activeUsers.has(id)).map(id => ({id, name: activeUsers.get(id).name}))};
    });
    return {projectId: project.id, name: project.name, roles, missingRoles: roles.filter(item => !item.members.length).map(item => item.role)};
  });
}
