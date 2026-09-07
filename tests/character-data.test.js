import {test} from 'node:test';
import assert from 'node:assert/strict';
import {OBJECT_FIELDS,normalizeCharacterData,normalizePendingChanges} from '../character-data.js';
import {validateDelta,prepareChanges,newState} from '../core.js';

test('narrative strings retain their full text and existing structured traits',()=>{
    const data={personality:'Спокоен, избегает общения.',goals:'Выжить и найти союзников.'};
    const state=newState();state.characters=[{owner_id:'hero',name:'Герой',personality:{traits:['наблюдательный']},updated_at:'2026-01-01'}];
    const delta=validateDelta({characters:[{owner_id:'hero',data}]});
    const [change]=prepareChanges(delta,state);
    assert.deepEqual(change.data.personality,{traits:['наблюдательный'],description:data.personality});
    assert.deepEqual(change.data.goals,{description:data.goals});
    assert.equal(data.personality,'Спокоен, избегает общения.');
});
test('all object fields accept text, arrays or existing objects without guessed mechanics',()=>{
    for(const field of OBJECT_FIELDS){
        assert.equal(typeof normalizeCharacterData({[field]:'Свободный текст'})[field],'object');
        assert.deepEqual(normalizeCharacterData({[field]:['A',{name:'B'}]})[field],{items:['A',{name:'B'}]});
        assert.deepEqual(normalizeCharacterData({[field]:{custom:{power:1000}}})[field],{custom:{power:1000}});
    }
    assert.deepEqual(normalizeCharacterData({race:'Полуэльф'}),{race:{name:'Полуэльф'}});
});
test('normalization is idempotent, preserves zero values and rejects ambiguous numbers',()=>{
    const normalized=normalizeCharacterData({level:'12',current_hp:0,is_player:'false',tags:'мечтатель',notes:null});
    assert.deepEqual(normalized,{level:12,current_hp:0,is_player:false,tags:['мечтатель']});
    assert.deepEqual(normalizeCharacterData(normalized),normalized);
    for(const patch of [{level:'12 or 13'},{experience:-1},{current_hp:true},{skills:42},{tags:[{}]},{general_condition:'x'.repeat(51)}])assert.throws(()=>normalizeCharacterData(patch));
});
test('legacy rejected pending batches are repaired without changing IDs or progress',()=>{
    const pending={id:'stable-request',processed:[{id:'message'}],changes:[{owner_id:'stable-hero',expected_updated_at:null,data:{personality:'Спокоен',goals:'Найти ключ'}}]};
    assert.equal(normalizePendingChanges(pending,[]),true);
    assert.equal(pending.id,'stable-request');assert.equal(pending.changes[0].owner_id,'stable-hero');assert.deepEqual(pending.processed,[{id:'message'}]);
    assert.deepEqual(pending.changes[0].data,{personality:{description:'Спокоен'},goals:{description:'Найти ключ'}});
    assert.equal(normalizePendingChanges(pending,[]),false);
});
