import test from 'node:test';
import assert from 'node:assert/strict';
import {characterProposal,characterSource} from '../character-generation.js';
import {characterDefaults} from '../local-store.js';
import {setLanguage,t,html} from '../i18n.js';
import {characterEditor} from '../form-editor.js';
test('character proposals validate stats and preserve legacy biography and existing abilities',()=>{
 const original={...characterDefaults(),name:'Mira',level:8,personality:{description:'Legacy'},skills:{sight:{bonus:3}}};
 const result=characterProposal({data:{level:'12',personality:'ignored',is_player:true,skills:{climb:{bonus:5}}}},original);
 assert.equal(result.level,12);assert.deepEqual(result.personality,original.personality);assert.equal(result.is_player,original.is_player);
 assert.equal(result.skills.sight.bonus,3);assert.equal(result.skills.climb.bonus,5);assert.equal(original.level,8);
 assert.throws(()=>characterProposal({data:{level:'high'}},original));assert.throws(()=>characterProposal({data:{owner_id:'hijack'}},original));
 assert.throws(()=>characterProposal({data:{unknown_field:1}},original));
});
test('source selection does not mix an unrelated bot into story-only generation',()=>{
 const context={characters:[{name:'Bot',data:{description:'Bot history'}}],characterId:0,chat:[{name:'Mira',mes:'Story'}]};
 assert.equal(characterSource(context,{summary:'Summary'},'card').description,'Bot history');
 assert.equal(characterSource(context,{summary:'Summary'},'story').description,undefined);
 assert.throws(()=>characterSource({characters:[],chat:[]},{},'card'));
});
test('language switches dynamically without translating interpolated user data',()=>{
 setLanguage('en');assert.equal(t('Настройки'),'Settings');assert.equal(html`<p>Навыки ${'Навыки'}</p>`,'<p>Skills Навыки</p>');
 const form=characterEditor({...characterDefaults(),name:'Лунная хроника'});assert.ok(form.includes('>Level<'));assert.ok(form.includes('Лунная хроника'));
 assert.ok(!form.includes('data-character-field="personality"'));assert.ok(!form.includes('data-character-field="is_player"'));
 setLanguage('ru');assert.ok(characterEditor(characterDefaults()).includes('>Уровень<'));
});
