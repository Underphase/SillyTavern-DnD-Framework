import {test} from 'node:test';
import assert from 'node:assert/strict';
import {modelsEndpoint,normalizeModels,filterModels,listModels} from '../models.js';

test('discovers models from base and completion URLs, including OpenRouter',()=>{
    for(const address of ['https://openrouter.ai','https://openrouter.ai/api/v1/','https://openrouter.ai/api/v1/chat/completions'])assert.equal(modelsEndpoint(address),'https://openrouter.ai/api/v1/models');
    assert.equal(modelsEndpoint('http://localhost:1234/v1/chat/completions?x=1#test'),'http://localhost:1234/v1/models');
    assert.throws(()=>modelsEndpoint('file:///secrets'));
});
test('normalizes provider names, excludes bad records and searches locally',()=>{
    const models=normalizeModels({data:[{id:'provider/b',name:'Moon Model'},{id:'provider/a'},{id:'provider/b',name:'Moon Model'},{name:'Missing id'}]});
    assert.equal(models.length,2);
    assert.equal(filterModels(models,'MOON provider')[0].id,'provider/b');
    assert.equal(filterModels(models,'absent').length,0);
    assert.throws(()=>normalizeModels({error:'bad'}));
});
test('model discovery sends only a GET and the configured credential; errors are clear',async(t)=>{
    let request;
    t.mock.method(globalThis,'fetch',async(url,options)=>{request={url,options};return new Response(JSON.stringify({data:[{id:'test/model'}]}),{status:200});});
    assert.equal((await listModels('https://example.com/v1','key'))[0].id,'test/model');
    assert.equal(request.options.method,'GET');assert.equal(request.options.headers.Authorization,'Bearer key');assert.equal(request.options.body,undefined);
    globalThis.fetch=async()=>new Response('',{status:401});
    await assert.rejects(()=>listModels('https://example.com/v1','bad'),/401.*ключ/);
});
