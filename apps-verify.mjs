import {readFile} from 'node:fs/promises';
import {validateWorkspace} from './forms-store.mjs';
import {verifyTemplate} from './forms-acceptance.mjs';

const workspace = validateWorkspace(JSON.parse(await readFile(new URL('./application.json', import.meta.url), 'utf8')));
const templates = workspace.templates.map(template => ({id: template.id, ...verifyTemplate(template)}));
const report = {scope: '应用结构与本地模板规则', applications: workspace.applications.length, projects: workspace.projects.length, records: workspace.cases.length, passed: templates.every(item => item.passed), templates};
console.log(JSON.stringify(report, null, 2));
if (!report.passed) process.exitCode = 1;
