import test from 'node:test';
import assert from 'node:assert/strict';
import {PROCESSOR_EXAMPLES,processorGuide} from '../processor-guide.js';
import {newState,validateDelta,prepareChanges,applyDelta} from '../core.js';
import {syncLocal} from '../local-store.js';

test('shipped examples work through the real update pipeline and preserve omitted data',()=>{
    const state=newState();
    const apply=index=>{
        const delta=structuredClone(PROCESSOR_EXAMPLES[index].delta);
        const changes=prepareChanges(validateDelta(delta),state);
        // Examples must already have correct types; do not rely on coercion.
        changes.forEach((c,i)=>assert.deepEqual(c.data,delta.characters[i].data));
        syncLocal(state,{id:`example-${index}`,changes});applyDelta(state,delta);
    };
    apply(0);assert.equal(state.characters.length,1);assert.equal(state.scene.location,'Unknown');
    const c=state.characters[0];c.owner_id='demo-1';c.current_hp=9;
    state.scene.party={name:'Moon',leader:'Other',members:['Other','Mira']};
    apply(1);assert.equal(state.characters[0].current_hp,7);assert.deepEqual(state.scene.party,{name:'Moon',leader:'Mira',members:['Other','Mira']});
    state.characters[0].skills={sight:{bonus:1},climb:{bonus:2}};
    apply(2);assert.deepEqual(state.characters[0].skills,{sight:{bonus:3},climb:{bonus:2}});
    const before=JSON.stringify(state.characters);apply(3);assert.equal(JSON.stringify(state.characters),before);
    assert.ok(processorGuide('Custom processor instruction').startsWith('Custom processor instruction\n'));
});
