/* Durable stream forwarding preserves the fifth cursor argument. */
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
(async()=>{
 const source=fs.readFileSync(path.join(__dirname,'../web/assets/js/resume.js'),'utf8');
 const received=[],globalEvents=[],urls=[];
 const events=[{type:'tool_start',name:'generate_image',tool_call_id:'one'},{type:'tool',name:'generate_image',tool_call_id:'one',result:{ok:true}},{type:'done',content:'complete'}];
 const bytes=new TextEncoder().encode(events.map((e,i)=>`id: ${i+8}\ndata: ${JSON.stringify(e)}\n\n`).join(''));
 const context=vm.createContext({TextDecoder,Uint8Array,Map,Promise,state:{token:'test'},fetch:async url=>{urls.push(url);let read=false;return {ok:true,body:{getReader:()=>({read:async()=>read?{done:true}:(read=true,{done:false,value:bytes}),releaseLock(){}})}}},handleAgentEvent:(sid,e)=>globalEvents.push(e),toast(){}});
 vm.runInContext(source.slice(0,source.indexOf('receiveStream=async')),context);
 const result=await context.consumeDurableStream('session','request',null,()=>{},7,e=>received.push(e));
 assert.equal(urls[0],'/api/stream/request?after=7');assert.equal(received.length,3);assert.equal(globalEvents.length,3);assert.equal(result.content,'complete');
 console.log('PASS: durable image callbacks and recovery cursor slot');
})().catch(e=>{console.error(e);process.exitCode=1;});
