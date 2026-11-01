export const seed=()=>({employees:[{id:1,name:'林晓',phone:'13800000001',department:'产品部'},{id:2,name:'陈晨',phone:'13800000002',department:'研发部'}],requests:[]});
export function createRun(db,action,input,context={}){
 const steps=[];let stopped=false;
 const add=(node,title,explanation,data={},effect=null)=>{if(!stopped)steps.push({node,title,explanation,data,effect});};
 const fail=(node,title,explanation)=>{add(node,title,explanation,{result:'失败'});stopped=true;};
 add('device','你点击了按钮','浏览器收集表单内容。此时数据库还没有变化。',input);
 if(action==='employee'&&(!input.name?.trim()||!/^1\d{10}$/.test(input.phone)))fail('device','表单需要修改','请填写姓名和 11 位、以 1 开头的手机号。');
 if(action==='leave'&&(!input.employee?.trim()||!Number.isFinite(input.days)||input.days<=0))fail('device','请假信息不完整','请填写申请人和大于 0 的请假天数。');
 add('network','请求通过网络发出','浏览器把本次操作发送到服务器。演示中的网络不会连接真实业务系统。',{method:'POST',path:action==='employee'?'/api/employees':action==='leave'?'/api/leave-requests':'/api/leave-requests/decision'});
 if(context.offline)fail('network','网络连接失败','请求没有到达服务器，数据库保持不变。');
 add('server','服务器检查你的身份','服务器重新检查权限，不能仅凭页面上是否显示按钮来决定。',{role:context.role});
 if(action==='employee'&&context.role!=='管理员')fail('server','你没有新增员工的权限','只有管理员可以新增员工，数据库没有写入。');
 if(action==='approve'&&!['主管','负责人'].includes(context.role))fail('server','你没有审批权限','请切换到当前流程需要的审批角色。');
 let effect;
 if(action==='employee'){
 add('database','检查手机号是否已存在','服务端查询员工数据，防止同一个手机号重复登记。',{phone:input.phone});
 if(db.employees.some(e=>e.phone===input.phone))fail('database','手机号已存在','重复检查未通过，没有新增员工。');
 const row={id:Math.max(0,...db.employees.map(e=>e.id))+1,name:input.name.trim(),phone:input.phone,department:input.department||'产品部'};
 effect=()=>db.employees.push(row);add('server','员工资料可以保存','必填信息、权限和重复检查已通过。',row);
 } else if(action==='leave'){
 const threshold=context.threshold??3;
 const row={id:Math.max(0,...db.requests.map(e=>e.id))+1,employee:input.employee,days:input.days,needsDirector:input.days>threshold,status:'待主管审批'};
 add('server','选择审批路线',row.needsDirector?`超过 ${threshold} 天：主管通过后，还需负责人审批。`:`不超过 ${threshold} 天：主管通过即可完成。`,{threshold,needsDirector:row.needsDirector});effect=()=>db.requests.push(row);
 } else if(action==='approve'){
 const row=db.requests.find(e=>e.id===input.id);
 if(!row)fail('server','没有找到申请','申请不存在，不能审批。');
 else if(!((row.status==='待主管审批'&&context.role==='主管')||(row.status==='待负责人审批'&&context.role==='负责人')))fail('server','当前角色不能处理这个阶段','已完成的申请不能重复审批；待审批申请需要对应角色处理。');
 else {const status=input.reject?'已拒绝':row.status==='待主管审批'&&row.needsDirector?'待负责人审批':'已批准';add('server','计算下一步状态',`申请从“${row.status}”变为“${status}”。`,{before:row.status,after:status});effect=()=>{row.status=status;};}
 } else fail('server','不支持的操作','没有执行任何数据修改。');
 add('database','写入模拟数据库','执行到这一步才修改数据。右侧会展示修改前后的差异。',{},effect);
 add('server','返回处理结果','服务器告诉浏览器操作成功。',{result:'成功'});
 add('device','页面显示最新结果','页面刷新列表，用户看见这次操作的结果。');
 return {steps,index:-1,done:false,failed:stopped};
}
export function advance(run,db){if(run.done)return null;const step=run.steps[++run.index];const before=structuredClone(db);step.effect?.();const after=structuredClone(db);run.done=run.index===run.steps.length-1;return {...step,before,after};}
