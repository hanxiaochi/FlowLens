import test from 'node:test';import assert from 'node:assert/strict';import {createImageSelection} from './image-input.mjs';
const file=name=>({name,type:'image/png',size:30});
test('invalid and undecodable images clear the prior accepted image',async()=>{
 const selection=createImageSelection({read:async f=>f.name,decode:async data=>{if(data==='broken')throw Error('decode failed');},onChange:()=>{}});
 await selection.select(file('good'));assert.equal(selection.getState().data,'good');
 await selection.select({...file('bad'),type:'text/plain'});assert.equal(selection.getState().data,null);assert.equal(selection.getState().pending,false);assert.ok(selection.getState().error);
 await selection.select(file('broken'));assert.equal(selection.getState().data,null);assert.equal(selection.getState().error,'decode failed');
});
test('late reads cannot overwrite a newer selection or restore a removed image',async()=>{
 const resolvers=new Map(),selection=createImageSelection({read:f=>new Promise(resolve=>resolvers.set(f.name,resolve)),decode:async()=>{},onChange:()=>{}});
 const old=selection.select(file('old')),latest=selection.select(file('new'));resolvers.get('new')('new-data');await latest;resolvers.get('old')('old-data');await old;assert.equal(selection.getState().data,'new-data');
 const pending=selection.select(file('removed'));selection.clear();resolvers.get('removed')('removed-data');await pending;assert.deepEqual(selection.getState(),{pending:false,data:null,error:null});
});
