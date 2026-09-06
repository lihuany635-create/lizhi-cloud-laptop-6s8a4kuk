// Uses only the frontend publishable key. No existing rows are modified/deleted.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
const source=await readFile(new URL('../cloud-chat.js',import.meta.url),'utf8');
const api=source.match(/const CHAT_API = '([^']+)'/)[1];
const key=source.match(/const CHAT_PUBLIC_KEY = '([^']+)'/)[1];
const id=randomUUID();
async function request(path, method='GET', body) {
  return fetch(api+path,{method,headers:{apikey:key,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
}
const path='/lizhi_cloud_messages?id=eq.'+id;
assert.deepEqual(await (await request(path+'&select=id')).json(),[]);
const row={id,device_id:randomUUID(),device_name:'permission-test',content:'must not insert'};
for(const [method,body] of [['POST',row],['PATCH',{content:'must not update'}],['DELETE',undefined]]) {
  const response=await request(path,method,body);
  assert([401,403].includes(response.status),method+' unexpectedly permitted: '+response.status);
}
const invalid=await request('/rpc/lizhi_send_message','POST',{p_id:id,p_device_id:row.device_id,p_device_name:'test',p_content:''});
assert.equal(invalid.status,400);
assert.equal((await invalid.json()).message,'invalid_message');
assert.deepEqual(await (await request(path+'&select=id')).json(),[]);
console.log('PASS: anonymous read, direct INSERT/UPDATE/DELETE denied, invalid RPC rejected; no rows changed');
