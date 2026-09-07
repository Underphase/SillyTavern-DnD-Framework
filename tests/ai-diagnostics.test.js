import test from 'node:test';
import assert from 'node:assert/strict';
import {askAI,cancelAIRequests,aiTimeoutSeconds} from '../client.js';
import {errorReport,supportReport} from '../diagnostics.js';
import {newState,validateDelta,applyDelta} from '../core.js';

const prefs={aiMode:'custom',aiUrl:'https://provider.test/v1',aiKey:'private-test-key',model:'test-model',maxTokens:4096,devMode:true};
const response=(content,extra={})=>new Response(JSON.stringify({choices:[{message:{content},finish_reason:'stop'}],...extra}));
test('malformed AI JSON includes the stage, model output and redacted causes',async t=>{
    t.mock.method(globalThis,'fetch',async()=>response('bad JSON private-test-key Bearer hidden-secret'));
    await assert.rejects(()=>askAI(prefs,'test',{}),error=>{
        const report=errorReport(error,prefs),text=JSON.stringify(report);
        assert.equal(report.diagnostics.stage,'model-json');assert.equal(report.diagnostics.category,'invalid-json');
        assert.ok(report.diagnostics.modelOutput.includes('bad JSON'));assert.ok(report.stack);
        assert.ok(!text.includes('private-test-key'));assert.ok(!text.includes('hidden-secret'));return true;
    });
});
test('schema validation retains the actual model output without mutating story state',async t=>{
    t.mock.method(globalThis,'fetch',async()=>response('{"facts":"not a list"}'));
    await assert.rejects(()=>askAI(prefs,'test',{}, {validate:validateDelta}),e=>e.diagnostics.stage==='validation'&&e.diagnostics.modelOutput.includes('not a list'));
});
test('HTTP, body interruptions and token truncation have distinct diagnostics',async t=>{
    t.mock.method(globalThis,'fetch',async()=>new Response('Rate limited',{status:429}));
    await assert.rejects(()=>askAI(prefs,'test',{}),e=>e.diagnostics.httpStatus===429&&e.diagnostics.category==='http');
    globalThis.fetch=async()=>({status:200,ok:true,headers:new Headers(),text:async()=>{throw new Error('Premature close');}});
    await assert.rejects(()=>askAI(prefs,'test',{}),e=>e.diagnostics.stage==='response-body'&&e.message==='Premature close');
    globalThis.fetch=async()=>response('',{choices:[{message:{content:'{'},finish_reason:'length'}],usage:{completion_tokens:4096}});
    await assert.rejects(()=>askAI(prefs,'test',{}),e=>e.diagnostics.finishReason==='length'&&e.diagnostics.usage.completion_tokens===4096);
});
test('processing signal does not disable the request timeout',async t=>{
    t.mock.timers.enable({apis:['setTimeout']});
    t.mock.method(globalThis,'fetch',async(url,{signal})=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true})));
    const promise=askAI(prefs,'test',{}, {signal:new AbortController().signal});
    const assertion=assert.rejects(promise,e=>e.diagnostics.category==='timeout');
    t.mock.timers.tick(300001);await assertion;
});
test('profile failures and dev-off reports omit response text and credentials',async()=>{
    const p={...prefs,aiMode:'profile',profileId:'test',devMode:false};
    await assert.rejects(()=>askAI(p,'test',{}, {profileRequest:async()=>({content:'private-test-key invalid json'})}),e=>{
        assert.equal(e.diagnostics.modelOutput,undefined);assert.equal(e.diagnostics.responseBody,undefined);
        const s=newState();s.activity=[{data:errorReport(e,p)}];
        assert.ok(!JSON.stringify(supportReport(s,p,true)).includes('private-test-key'));return true;
    });
});
test('partial party deltas preserve unchanged members and reject invalid fields',()=>{
    const s=newState();s.scene.party={name:'Moon',leader:'A',members:['A','B']};
    applyDelta(s,validateDelta({scene:{party:{leader:'B'}}}));
    assert.deepEqual(s.scene.party,{name:'Moon',leader:'B',members:['A','B']});
    assert.throws(()=>validateDelta({scene:{party:{members:'B'}}}));
    assert.throws(()=>validateDelta({scene:{party:{unknown:1}}}));
});

test('a slow request can pass 90 seconds and cancellation settles a non-cooperative profile',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 let resolveProfile;const p={...prefs,aiMode:'profile',profileId:'test'};
 const promise=askAI(p,'test',{}, {profileRequest:()=>new Promise(resolve=>resolveProfile=resolve)});
 t.mock.timers.tick(90001);resolveProfile({content:'{"ok":true}'});assert.deepEqual(await promise,{ok:true});
 const pending=askAI(p,'test',{}, {profileRequest:()=>new Promise(()=>{})});
 const assertion=assert.rejects(pending,e=>e.name==='AbortError');cancelAIRequests();await assertion;
 assert.equal(aiTimeoutSeconds({}),300);assert.equal(aiTimeoutSeconds({aiTimeoutSeconds:120}),120);assert.equal(aiTimeoutSeconds({aiTimeoutSeconds:9999}),900);
});
