import test from 'node:test';
import assert from 'node:assert/strict';
import {newState,validateDelta,prepareChanges} from '../core.js';
import {syncLocal} from '../local-store.js';
import {trackerTemplate} from '../tracker-builder.js';
import {validateTracker,renderTracker} from '../trackers.js';

test('custom XP thresholds and starting levels survive the normal processor pipeline',()=>{
    const state=newState();
    const changes=prepareChanges(validateDelta({characters:[{data:{name:'Рин',level:8,experience:1200,experience_target:2000}}]}),state);
    syncLocal(state,{id:'setup',changes});
    assert.equal(state.characters[0].level,8);assert.equal(state.characters[0].experience_target,2000);
    assert.throws(()=>validateDelta({characters:[{data:{experience_target:-1}}]}));
    syncLocal(state,{id:'high-level',changes:[{owner_id:'other',data:{name:'Другой',level:40}}]});
    assert.equal(state.characters[1].experience_target,0);
    assert.equal(state.characters[0].experience,1200);
});
test('simple tracker templates are valid and previews never become live state',()=>{
    for(const type of ['meter','number','inventory','coins','gems','boolean','text']){
        const tracker=validateTracker(trackerTemplate(type)),state=newState();
        const before=JSON.stringify(state);
        assert.ok(renderTracker(tracker,state,true).includes('widget'));
        assert.equal(JSON.stringify(state),before);
        assert.equal(tracker.fields.length,1);
    }
});
