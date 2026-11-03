import {mkdir, readFile, writeFile, copyFile} from 'node:fs/promises';
import {resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(process.argv[2] || resolve(root, 'dist-team'));
const files = ['team-server.mjs', 'team-store.mjs', 'team-read-model.mjs', 'team-attachments.mjs', 'team-project-export.mjs', 'team-project-check.mjs', 'team-project-restore.mjs', 'team-vendor/fflate.mjs', 'team-vendor/FFLATE-LICENSE.txt', 'team-ui.js', 'team-http.mjs', 'team-recovery.mjs', 'team-drafts.mjs', 'team-delivery.mjs', 'team.html', 'team.css', 'forms-store.mjs', 'forms-model.mjs', 'forms-schema.mjs', 'forms-rules.mjs', 'forms-print.mjs', 'forms.css', 'forms-detail-ui.js', 'apps-model.mjs', 'scripts/team-admin.mjs', 'docs/team-deployment.md', 'Dockerfile.team', 'compose.team.yaml', 'deploy/Caddyfile', '.dockerignore'];
for (const file of files) {
  await mkdir(dirname(resolve(output, file)), {recursive: true});
  await copyFile(resolve(root, file), resolve(output, file));
}
const source = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
await writeFile(resolve(output, 'package.json'), JSON.stringify({name: 'flowlens-team', version: source.version, private: true, type: 'module', engines: {node: '>=24'}, scripts: {start: 'node team-server.mjs', 'start:team': 'node team-server.mjs'}}, null, 2));
await writeFile(resolve(output, 'README.md'), '# FlowLens 团队协作\n\n安装 Node.js 24 LTS，按 docs/team-deployment.md 初始化管理员，再执行 npm start。\n\n包内只有运行源码和部署说明。账号、数据库、业务附件在部署后创建。协作运行不需要安装 npm 依赖。\n\n首次使用请从设计工作台导出应用包，再在管理后台导入并分配项目角色。\n');
console.log('Team runtime built from allowlisted files at ' + output);
