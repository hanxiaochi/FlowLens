import {applicationHandoff, applicationHandoffText} from './apps-handoff.mjs';
import {applicationScenarioText, applicationScenarioStatus, applicationScenarioStatusLabels} from './apps-scenarios.mjs';
import {zipSync, strToU8} from './forms-vendor/fflate.js';
import {applicationPackage, discoveryText} from './apps-model.mjs';
import {formOpenApi, formSql, formBrief} from './forms-system.mjs';
import {requirementsText} from './apps-requirements.mjs';

export async function applicationDelivery(workspace, appId) {
  const pack = applicationPackage(workspace, appId);
  const handoff = applicationHandoff(pack.applications[0], pack.templates);
  const files = {'application.json': strToU8(JSON.stringify(pack, null, 2))};
  files['handoff.json'] = strToU8(JSON.stringify(handoff, null, 2));
  files['handoff.txt'] = strToU8(applicationHandoffText(handoff));
  files['discovery.txt'] = strToU8(discoveryText(pack.applications[0]));
  files['requirements.txt'] = strToU8(requirementsText(pack.applications[0], pack.templates));
  files['cross-form-scenarios.txt'] = strToU8((pack.applications[0].scenarioRuns ?? []).map(run => applicationScenarioStatusLabels[applicationScenarioStatus(pack.applications[0], pack.templates, run)] + '\n' + applicationScenarioText(run.report)).join('\n\n') || '尚无已保存跨表场景');
  const definitions = new Map([...pack.templates,...pack.cases.map(record=>record.template)].map(template=>[template.id+'@'+template.version,template]));
  for (const template of definitions.values()) {
    const prefix = 'contracts/' + encodeURIComponent(template.id) + '-v' + template.version;
    files[prefix + '.openapi.json'] = strToU8(JSON.stringify(formOpenApi(template), null, 2));
    files[prefix + '.sql'] = strToU8(formSql(template));
    files[prefix + '.md'] = strToU8(formBrief(template));
  }
  files['README.md'] = strToU8(`# ${pack.applications[0].name}\n\n在 FlowLens 中通过“恢复工作包”导入 application.json，可继续办理其中的项目与业务。恢复前会下载当前工作区备份。\n\n在 Node.js 22+ 下运行 node verify-app.mjs，验证应用结构、各模板的本地规则和独立虚构项目中的跨表场景。\n\n先阅读 handoff.txt，核对需求来源、当前确认状态、过期证据及跟进事项。handoff.json 提供同一索引的结构化数据。\n\ncontracts 目录保存接口及数据库草案。项目、关联映射、来源修订与业务快照在 application.json 中。\n\n生产接入仍需实现服务器身份、项目权限、事务、附件服务和备份恢复。自然语言助手支持的句式见产品说明。\n`);
  const runtime = ['apps-scenarios.mjs', 'apps-model.mjs', 'apps-requirements.mjs', 'forms-store.mjs', 'forms-model.mjs', 'forms-rules.mjs', 'forms-schema.mjs', 'forms-acceptance.mjs', 'apps-verify.mjs'];
  for (const name of runtime) {
    const response = await fetch(new URL(name, import.meta.url));
    if (!response.ok) throw Error('交付运行器读取失败，请重试');
    files[name === 'apps-verify.mjs' ? 'verify-app.mjs' : name] = strToU8(await response.text());
  }
  return zipSync(files);
}
