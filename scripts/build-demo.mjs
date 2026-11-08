import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const out=resolve(root,'dist');await mkdir(out,{recursive:true});
const files=['studio.js','studio.css','layout.css','forms.css','model.mjs','examples.mjs','scene.js','graph.js','export.mjs','deployment.mjs','layout.mjs','layout-ui.js','impact.mjs','diagrams.mjs','diagrams-ui.js','image-input.mjs','forms-ui.js','forms-docx.mjs','forms-model.mjs','forms-rules.mjs','forms-detail-ui.js','apps-scenarios.mjs', 'apps-model.mjs', 'apps-requirements.mjs','apps-ui.js','apps-delivery.js','apps-verify.mjs','apps-demo.mjs','forms-schema.mjs','forms-system.mjs','forms-delivery-ui.js','forms-acceptance.mjs','forms-verify.mjs','forms-store.mjs','forms-print.mjs','forms-demo.mjs'];
const write=async(name,text)=>{await mkdir(dirname(resolve(out,name)),{recursive:true});await writeFile(resolve(out,name),text);};
for(const name of files){let text=await readFile(resolve(root,name),'utf8');if(name==='forms-ui.js')text=text.replace("from '/forms-vendor/fflate.js'","from './forms-vendor/fflate.js'");await write(name,text);}
let html=await readFile(resolve(root,'studio.html'),'utf8');
html=html.replace('<head>','<head><meta name="flowlens-demo" content="public-offline"><meta name="description" content="从业务表单到审批流程，亲手体验一个系统如何工作。无需 API Key。">').replaceAll('href="/','href="./').replaceAll('src="/','src="./').replaceAll('"/vendor/','"./vendor/');
html=html.replace('所有业务运行均为可验证的本地模拟。','公开演示 · AI 已关闭 · 数据保存在当前浏览器，请导出备份。');
await write('index.html',html);await write('.nojekyll','');
const vendorFiles=['build/three.module.js','build/three.core.js','examples/jsm/controls/OrbitControls.js','examples/jsm/geometries/RoundedBoxGeometry.js','examples/jsm/environments/RoomEnvironment.js'];
for(const name of vendorFiles){await mkdir(dirname(resolve(out,'vendor',name)),{recursive:true});await copyFile(resolve(root,'node_modules/three',name),resolve(out,'vendor',name));}
await write('forms-vendor/fflate.js',await readFile(resolve(root,'node_modules/fflate/esm/browser.js'),'utf8'));
await write('THIRD_PARTY_NOTICES.md',await readFile(resolve(root,'THIRD_PARTY_NOTICES.md'),'utf8'));
await write('vendor/THREE-LICENSE.txt',await readFile(resolve(root,'node_modules/three/LICENSE'),'utf8'));
await write('forms-vendor/FFLATE-LICENSE.txt',await readFile(resolve(root,'node_modules/fflate/LICENSE'),'utf8'));
console.log('Public demo built in dist. No server, credentials, customer documents, or model endpoint included.');
