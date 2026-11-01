import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve,extname,sep} from 'node:path';
import {validateModel,validateData,initialData,MODEL_GUIDE} from './model.mjs';
export function createServer({generationTimeoutMs=120000}={}){
 let config={baseUrl:'https://api.openai.com/v1',model:'',apiKey:'',protocol:'responses'};
 let attemptSequence=0;
 let revision=0,verification={text:false,image:false,lastAttempt:null};
 const root=fileURLToPath(new URL('.',import.meta.url));
 const send=(res,status,value)=>{if(res.destroyed||res.writableEnded)return;res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
 const body=async req=>{let chunks=[],size=0;for await(const chunk of req){size+=chunk.length;if(size>9*1024*1024)throw Error('请求太大，图片请控制在 5 MB 以内');chunks.push(chunk);}return JSON.parse(Buffer.concat(chunks).toString()||'{}');};
 return http.createServer(async(req,res)=>{try{
 const host=req.headers.host;if(!/^(127\.0\.0\.1|localhost):\d+$/.test(host??''))return send(res,403,{error:'仅允许本机访问'});
 if(req.headers.origin&&req.headers.origin!==`http://${host}`)return send(res,403,{error:'不接受跨站请求'});
 const pathname=new URL(req.url,`http://${host}`).pathname;
 if(pathname.startsWith('/api/')){
 if(req.method==='GET'&&pathname==='/api/config')return send(res,200,{baseUrl:config.baseUrl,model:config.model,protocol:config.protocol,configured:!!config.apiKey&&!!config.model,verification});
 if(req.method!=='POST')return send(res,405,{error:'不支持此方法'});
 if(!req.headers['content-type']?.startsWith('application/json'))return send(res,415,{error:'需要 JSON 请求'});
 const input=await body(req);
 if(pathname==='/api/config'){
 if(input.clear){revision++;verification={text:false,image:false,lastAttempt:null};config.apiKey='';return send(res,200,{configured:false});}
 const url=new URL(input.baseUrl);if(url.username||url.password||url.search||url.hash)throw Error('接口地址不可包含凭据、查询或片段');
 if(url.protocol!=='https:'&&!(url.protocol==='http:'&&['localhost','127.0.0.1'].includes(url.hostname)))throw Error('远程接口必须使用 HTTPS，本机服务可用 HTTP');
 if(!['responses','chat'].includes(input.protocol))throw Error('接口协议无效');
 if(typeof input.model!=='string'||!input.model.trim())throw Error('请填写模型名称');
 if(config.baseUrl!==input.baseUrl.replace(/\/$/,'')&&!input.apiKey)throw Error('更换服务地址时请重新输入密钥');
 revision++;verification={text:false,image:false,lastAttempt:null};config={baseUrl:input.baseUrl.replace(/\/$/,''),model:input.model.trim(),protocol:input.protocol,apiKey:input.apiKey||config.apiKey};return send(res,200,{configured:!!config.apiKey});
 }
 if(pathname==='/api/generate'){
 if(!config.apiKey||!config.model)return send(res,409,{error:'请先在 AI 连接中配置模型服务。未调用任何模型。'});
 if(typeof input.prompt!=='string'||!input.prompt.trim()||input.prompt.length>16000)throw Error('请输入 1–16000 字的需求描述');
 if(input.image&&!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(input.image))throw Error('仅接受 PNG/JPEG/WebP 图片');
 const generationConfig={...config},generationRevision=revision,attempt=++attemptSequence;const recordAttempt=(status)=>{if(revision===generationRevision&&attempt===attemptSequence)verification.lastAttempt={status,kind:input.image?'image':'text',at:new Date().toISOString()};};
 const current=input.current?validateModel(input.current):null;
 recordAttempt('running');
 const instruction=MODEL_GUIDE+(current?'\nRevise this existing design without discarding unrelated features: '+JSON.stringify(current):'');
 const messages=generationConfig.protocol==='chat'?[{role:'system',content:instruction},{role:'user',content:[{type:'text',text:input.prompt},...(input.image?[{type:'image_url',image_url:{url:input.image}}]:[])]}]:[{role:'user',content:[{type:'input_text',text:input.prompt},...(input.image?[{type:'input_image',image_url:input.image}]:[])]}];
 const request=generationConfig.protocol==='chat'?{model:generationConfig.model,messages}:{model:generationConfig.model,instructions:instruction,input:messages};
 const controller=new AbortController();
 const disconnected=()=>{if(!res.writableEnded)controller.abort(new Error('client-disconnected'));};
 res.once('close',disconnected);
 const timeout=setTimeout(()=>controller.abort(new Error('generation-timeout')),generationTimeoutMs);
 let upstream,data;
 try{
  upstream=await fetch(generationConfig.baseUrl+(generationConfig.protocol==='chat'?'/chat/completions':'/responses'),{method:'POST',headers:{Authorization:`Bearer ${generationConfig.apiKey}`,'Content-Type':'application/json'},body:JSON.stringify(request),signal:controller.signal,redirect:'error'});
  if(!upstream.ok){await upstream.body?.cancel();recordAttempt('failed');return send(res,502,{error:`模型服务返回 HTTP ${upstream.status}。请检查模型权限、额度与接口协议。`});}
  data=await upstream.json();
 }catch(error){
  const cancelled=controller.signal.reason?.message==='client-disconnected';
  recordAttempt(cancelled?'cancelled':'failed');
  if(cancelled)return;
  return send(res,502,{error:controller.signal.aborted?'模型服务响应超时，请稍后重试。原项目已保留。':error instanceof SyntaxError?'模型服务返回的内容不是 JSON。':'模型服务连接失败，请检查地址、网络与服务状态。'});
 }finally{clearTimeout(timeout);res.removeListener('close',disconnected);}
 const output=generationConfig.protocol==='chat'?data.choices?.[0]?.message?.content:data.output?.flatMap(x=>x.content??[]).filter(x=>x.type==='output_text').map(x=>x.text).join('');
 if(typeof output!=='string'){recordAttempt('failed');return send(res,422,{error:'模型未返回可用文字，可能拒绝了请求或协议不兼容'});}
 let model;try{model=validateModel(JSON.parse(output.replace(/^\s*```(?:json)?\s*/,'').replace(/\s*```\s*$/,'')));validateData(model,initialData(model));}catch(e){recordAttempt('invalid-result');return send(res,422,{error:`生成结果未通过校验，原项目已保留：${e.message}`});}
 recordAttempt('succeeded');if(revision===generationRevision)verification[input.image?'image':'text']=true;
 model.source='AI 草案';model.assumptions=model.assumptions.map(a=>({...a,status:'pending'}));return send(res,200,{model});
 }return send(res,404,{error:'接口不存在'});
 }
 const local=pathname==='/forms-vendor/fflate.js'?'node_modules/fflate/esm/browser.js':pathname==='/'?'studio.html':pathname.startsWith('/vendor/')?'node_modules/three/'+pathname.slice(8):pathname.slice(1);
 const file=resolve(root,local);if(!file.startsWith(root.endsWith(sep)?root:root+sep))return send(res,403,{error:'禁止访问'});
 const allowed=['node_modules/fflate/esm/browser.js','forms.css','forms-print.mjs','forms-ui.js','forms-docx.mjs','forms-model.mjs','forms-store.mjs','image-input.mjs','studio.html','studio.js','studio.css','model.mjs','examples.mjs','scene.js','graph.js','export.mjs','deployment.mjs','layout.mjs','layout-ui.js','impact.mjs','layout.css','diagrams.mjs','diagrams-ui.js'];if(!allowed.includes(local)&&!local.startsWith('node_modules/three/build/')&&!local.startsWith('node_modules/three/examples/jsm/'))return send(res,404,{error:'不存在'});
 try{const data=await readFile(file);res.writeHead(200,{'Content-Type':extname(file)==='.html'?'text/html; charset=utf-8':extname(file)==='.css'?'text/css':'text/javascript','Cache-Control':'no-cache','X-Content-Type-Options':'nosniff'});res.end(data);}catch{return send(res,404,{error:'文件不存在'});}
 }catch(e){send(res,400,{error:e.message});}});
}
if(process.argv[1]===fileURLToPath(import.meta.url))createServer().listen(4173,'127.0.0.1',()=>console.log('FlowLens Studio http://127.0.0.1:4173'));


