import {readFile} from 'node:fs/promises';
import {verifyTemplate} from './forms-acceptance.mjs';
const {template}=JSON.parse(await readFile(new URL('./definition.json',import.meta.url),'utf8'));
const report=verifyTemplate(template);console.log(JSON.stringify(report,null,2));if(!report.passed)process.exitCode=1;
