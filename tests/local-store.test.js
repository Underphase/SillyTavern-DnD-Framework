import test from 'node:test';
import assert from 'node:assert/strict';
import {newState} from '../core.js';
import {initializeLocal,syncLocal,resolveLocalCheck} from '../local-store.js';

const input={check_key:'open:door',reason:'Вскрыть замок',formula:'1d20',actor_id:'hero',difficulty:15,difficulty_reason:'Сложный замок'};
function setup(){const s=newState();syncLocal(s,{id:'create',changes:[{owner_id:'hero',data:{name:'Луна',dexterity:16,skills:{lock:{bonus:2},divine:{automatic_success:true,actions:['open:door']}}}}]});return s;}
test('local sync preserves cached characters and applies an atomic, idempotent batch',()=>{
    const s=setup();initializeLocal(s);assert.equal(s.characters[0].name,'Луна');
    assert.throws(()=>syncLocal(s,{id:'invalid',changes:[{owner_id:'hero',data:{name:'Изменено'}},{owner_id:'other',data:{level:2}}]}));
    assert.equal(s.characters[0].name,'Луна');
    const p={id:'update',changes:[{owner_id:'hero',data:{personality:'Спокойна',experience:42}}]};syncLocal(s,p);
    const saved=JSON.stringify(s);syncLocal(s,p);assert.equal(JSON.stringify(s),saved);
    assert.equal(s.characters[0].personality.description,'Спокойна');
});
test('roll uses stored modifiers, target DC, advantage and survives serialization without reroll',()=>{
    const s=setup();s.characters.push({owner_id:'door',armor_class:15});let calls=0;
    const args={...input,difficulty:null,target_id:'door',difficulty_path:'armor_class',attribute:'dexterity',attribute_rule:'d20',bonus_paths:['skills.lock.bonus'],mode:'advantage'};
    const r=resolveLocalCheck(s,args,'turn',()=>[3,9][calls++]);
    assert.equal(r.total,15);assert.equal(r.success,true);assert.equal(r.modifier,5);assert.deepEqual(r.rolls,[[4],[10]]);
    const restored=JSON.parse(JSON.stringify(s));
    assert.deepEqual(resolveLocalCheck(restored,{...args,difficulty:-100,formula:'bad'},'turn',()=>assert.fail('reroll')),r);
    assert.equal(calls,2);
    assert.equal(resolveLocalCheck(restored,input,'next-turn',()=>0).total,1);
});
test('invalid requests never consume random numbers; passives cover only explicit actions',()=>{
    const s=setup();const rng=()=>assert.fail('unexpected RNG');
    for(const args of [{actor_id:'outside'},{formula:'101d20'},{formula:'1d1'},{difficulty_reason:''},{bonus_paths:['skills.lock.bonus','skills.lock.bonus']},{difficulty_path:'armor_class'},{bonus_paths:['__proto__.x']},{attribute:'luck'},{resolution:'automatic',passive_path:'skills.lock'}])assert.throws(()=>resolveLocalCheck(s,{...input,...args},'turn',rng));
    assert.equal(s.localChecks.length,0);
    assert.equal(resolveLocalCheck(s,{...input,resolution:'automatic',passive_path:'skills.divine'},'turn',rng).success,true);
    assert.throws(()=>resolveLocalCheck(s,{...input,check_key:'open:other',resolution:'automatic',passive_path:'skills.divine'},'turn',rng));
    assert.equal(resolveLocalCheck(s,{...input,resolution:'impossible'},'other-turn',rng).success,false);
});
test('ledger keeps checks beyond UI history and adopts cached API receipts',()=>{
    const s=setup();const old=resolveLocalCheck(s,input,'first',()=>0);
    s.receipts=[old];delete s.localChecks;initializeLocal(s);
    for(let i=0;i<105;i++)resolveLocalCheck(s,input,`turn-${i}`,()=>1);
    assert.deepEqual(resolveLocalCheck(s,input,'first',()=>assert.fail('reroll')),old);
    assert.equal(s.localChecks.length,106);
    const fresh=setup();assert.equal(resolveLocalCheck(fresh,input,'first',()=>19).total,20);
});
