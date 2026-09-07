import {test} from 'node:test';
import assert from 'node:assert/strict';
import {renderAbilities,abilityEntries} from '../abilities.js';
import {migrateDefaultPrompts,previousNarrator,previousProcessor} from '../prompt-migrations.js';
import {NARRATOR_PROMPT,PROCESSOR_PROMPT} from '../prompts.js';

test('skills and active abilities with matching keys remain separate',()=>{
    const html=renderAbilities({owner_id:'hero',skills:{sight:{name:'Взгляд',bonus:0,description:'Чувствует магию'}},active_skills:{sight:{name:'Взгляд',cost:2,cooldown:'Один ход'}}});
    assert.equal((html.match(/<h4>Взгляд<\/h4>/g)??[]).length,2);
    assert.match(html,/Bonus: 0/);assert.match(html,/Cost: 2/);assert.doesNotMatch(html,/<pre>/);
});
test('free-form lists, nested mechanics and long descriptions stay accessible and escaped',()=>{
    const description='Длинное описание. '.repeat(20);
    const html=renderAbilities({owner_id:'hero',skills:{items:[{name:'<script>bad</script>',description,custom:{'Особенность':['<img src=x>',0]}}]},active_skills:{description:'Пока неизвестны'}});
    assert.match(html,/&lt;script&gt;/);assert.match(html,/&lt;img src=x&gt;/);assert.match(html,/Details/);
    assert.ok(html.includes(description));assert.match(html,/Особенность/);assert.match(html,/Пока неизвестны/);
    assert.equal(abilityEntries(['Слух','Зрение']).entries.length,2);
});
test('only unchanged shipped prompts migrate; custom text and settings are preserved',()=>{
    const defaults={narratorPrompt:previousNarrator,processorPrompt:previousProcessor,model:'my-model'};
    assert.equal(migrateDefaultPrompts(defaults),true);
    assert.equal(defaults.narratorPrompt,NARRATOR_PROMPT);assert.equal(defaults.processorPrompt,PROCESSOR_PROMPT);assert.equal(defaults.model,'my-model');
    assert.equal(migrateDefaultPrompts(defaults),false);
    const custom={narratorPrompt:previousNarrator+'\nMy custom instruction.',processorPrompt:'Custom processor'};
    assert.equal(migrateDefaultPrompts(custom),false);assert.ok(custom.narratorPrompt.endsWith('My custom instruction.'));
});
