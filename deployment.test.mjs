import test from 'node:test';import assert from 'node:assert/strict';
import {normalizeDeployment,deploymentPlan,deploymentRoute} from './deployment.mjs';import {example} from './examples.mjs';
test('deployment advice explains budget, region, maintenance and native app tradeoffs',()=>{
 const options=normalizeDeployment({scale:'growing',mobile:'native',budget:'lean',region:'global',operations:'team'}),plan=deploymentPlan(options,example());
 assert.match(plan.decisions[0].text,/消费提醒/);assert.match(plan.decisions[1].text,/不会自动让数据库/);assert.match(plan.decisions[2].text,/自管/);assert.match(plan.decisions[3].text,/增长与低预算/);assert.match(plan.decisions[3].text,/客户端开发预算/);
 const mainland=deploymentPlan({region:'mainland',budget:'balanced'},example());assert.match(mainland.decisions[1].text,/备案/);assert.match(mainland.decisions[0].text,/恢复能力/);
});
test('deployment options survive project JSON roundtrip and old or invalid choices receive defaults',()=>{
 const selected=normalizeDeployment({region:'global',operations:'team',budget:'balanced'});assert.deepEqual(normalizeDeployment(JSON.parse(JSON.stringify(selected))),selected);
 assert.equal(normalizeDeployment({region:'invalid'}).region,'unsure');assert.equal(normalizeDeployment(null).operations,'beginner');assert.equal(normalizeDeployment({mobile:'native'}).mobile,'native');
});

test('growth routes alternate business instances while starter always uses one',()=>{
 assert.deepEqual([0,1,2,3].map(i=>deploymentRoute({scale:'growing'},i).serverNode),['server','replica','server','replica']);
 assert.deepEqual([0,1,2].map(i=>deploymentRoute({scale:'small'},i).serverNode),['server','server','server']);
 assert.match(deploymentRoute({scale:'growing'},1).explain,/同一份数据库/);
});
