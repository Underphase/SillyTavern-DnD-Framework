import {test} from 'node:test';
import assert from 'node:assert/strict';
import {newState,parseJson,reconcileMessages,selectFacts,validateDelta,prepareChanges,applyDelta,KEY} from '../core.js';
import {validateTracker,renderTracker,SAMPLE_TRACKER} from '../trackers.js';

test('new chats do not share scopes, characters or tracker values',()=>{
    const a=newState(),b=newState();a.characters.push({name:'A'});a.trackerValues.x=1;
    assert.notEqual(a.scopeId,b.scopeId);assert.equal(b.characters.length,0);assert.equal(b.trackerValues.x,undefined);assert.equal(b.protagonist,null);
});
test('edits, swipes and deletions are explicit correction events',()=>{
    const previous=[{id:'a',text:'Opened door',name:'Narrator',role:'assistant'},{id:'b',text:'Reward',name:'Narrator',role:'assistant'}];
    const {changes}=reconcileMessages([{mes:'Door stayed shut',name:'Narrator',extra:{[KEY]:{id:'a'}}}],previous);
    assert.equal(changes[0].kind,'edited');assert.equal(changes[0].previous,'Opened door');assert.equal(changes[1].kind,'deleted');
});
test('JSON rejects prototype injection and malformed responses',()=>{
    assert.throws(()=>parseJson('{"__proto__":{"polluted":true}}'));
    assert.deepEqual(parseJson('```json\n{"ok":true}\n```'),{ok:true});
    assert.throws(()=>validateDelta({characters:[{data:{scope_id:'other'}}]}));
});
test('AI cannot mutate characters outside the chat or duplicate creates',()=>{
    const s=newState();assert.throws(()=>prepareChanges({characters:[{owner_id:'foreign',data:{name:'X'}}]},s));
    assert.throws(()=>prepareChanges({characters:[{data:{name:'X'}},{data:{name:'X'}}]},s));
    const changes=prepareChanges({characters:[{data:{name:'X'}}]},s);assert.ok(changes[0].owner_id);
});
test('facts retain omitted memories and replace corrected stable IDs',()=>{
    const s=newState();s.facts.old={id:'old',text:'Keep me'};applyDelta(s,{facts:[{id:'new',text:'First'}]});applyDelta(s,{facts:[{id:'new',text:'Corrected'}]});
    assert.equal(s.facts.old.text,'Keep me');assert.equal(s.facts.new.text,'Corrected');
    applyDelta(s,{forget:['new']});assert.equal(s.facts.new,undefined);
});
test('retrieval prioritizes pinned and matching facts within budget',()=>{
    const facts={a:{id:'a',text:'Other'},b:{id:'b',text:'The moon temple'},c:{id:'c',text:'Promise',pinned:true}};
    assert.deepEqual(selectFacts(facts,'moon',24).map(f=>f.id),['c','b']);
});
test('AI only updates declared AI fields; local sources are protected',()=>{
    const s=newState();s.trackers=[{id:'t',fields:[{id:'a',source:'ai'},{id:'b',source:'clock'}]}];applyDelta(s,{trackers:{t:{a:5,b:'hacked'},foreign:{x:1}}});
    assert.deepEqual(s.trackerValues,{t:{a:5}});
});
test('tracker preview uses samples, live view uses bound data, values are escaped',()=>{
    const t=structuredClone(SAMPLE_TRACKER);validateTracker(t);const s=newState();
    assert.match(renderTracker(t,s,true),/68 \/ 100/);assert.doesNotMatch(renderTracker(t,s),/68 \/ 100/);
    s.trackerValues[t.id]={oath:'<script>alert(1)</script>'};assert.match(renderTracker(t,s),/&lt;script&gt;/);
    assert.match(renderTracker(t,s),/default-src 'none'/);
});
test('invalid fields and duplicate tracker IDs fail validation',()=>{
    const t=structuredClone(SAMPLE_TRACKER);t.fields.push(t.fields[0]);assert.throws(()=>validateTracker(t));
});
