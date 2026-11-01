import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {createServer} from './server.mjs';
const listen=s=>new Promise(r=>s.listen(0,'127.0.0.1',r));
const close=s=>new Promise(r=>{s.close(r);s.closeAllConnections();});
async function fixture(t,timeout=1000){
 let received,disconnected;
 const arrival=new Promise(r=>received=r),departure=new Promise(r=>disconnected=r);
 const mock=http.createServer(async(req,res)=>{for await(const c of req){}res.on('close',disconnected);res.writeHead(200,{'Content-Type':'application/json'});res.write('{');received();});
 const app=createServer({generationTimeoutMs:timeout});await listen(mock);await listen(app);
 t.after(async()=>{await close(app);await close(mock);});
 const base=`http://127.0.0.1:${app.address().port}`;
 const post=(path,data,signal)=>fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data),signal});
 await post('/api/config',{baseUrl:`http://127.0.0.1:${mock.address().port}`,model:'test-only',protocol:'chat',apiKey:'mock-only'});
 return {post,arrival,departure,state:async()=>(await(await fetch(base+'/api/config')).json()).verification};
}
test('generation timeout covers a stalled response body and closes upstream',async t=>{
 const f=await fixture(t,80);const response=await f.post('/api/generate',{prompt:'test'});
 assert.equal(response.status,502);assert.match((await response.json()).error,/超时/);
 await f.departure;assert.equal((await f.state()).lastAttempt.status,'failed');
});
test('client cancellation closes upstream and never records generation success',async t=>{
 const f=await fixture(t);const controller=new AbortController();
 const request=f.post('/api/generate',{prompt:'test'},controller.signal);
 const rejection=assert.rejects(request,{name:'AbortError'});
 await f.arrival;controller.abort();await rejection;await f.departure;
 const state=await f.state();assert.equal(state.lastAttempt.status,'cancelled');assert.equal(state.text,false);
});
