import test from 'node:test';
import assert from 'node:assert/strict';
import {StatusTracker,formatTimestamp,timestampFields} from '../status.js';
import {normalizeCharacterData} from '../character-data.js';
import {supportReport} from '../diagnostics.js';
import {newState} from '../core.js';

test('active stages keep elapsed time and ignore incidental success notifications',()=>{
    let now=0;const s=new StatusTracker(()=>now),task=s.start('Waiting for AI');
    now=31000;s.notify('Settings saved');assert.equal(s.view().kind,'working');assert.match(s.view().message,/31 с.*ожидание продолжается/);
    s.update(task,'Saving');assert.equal(s.view().elapsed,31);
    s.finish(task,'Saved');assert.equal(s.view().kind,'success');assert.equal(s.view().message,'Saved');
    s.finish(task,'Cancelled','warning');assert.equal(s.view().message,'Saved');
});
test('errors, cancellation and chat changes leave no stale working status',()=>{
    const s=new StatusTracker(),a=s.start('Memory'),b=s.start('Models');
    s.finish(b,'Done');assert.equal(s.view().kind,'working');
    s.finish(a,'Invalid data','error');assert.equal(s.view().kind,'error');
    const stale=s.start('Old chat');s.reset();s.finish(stale,'Old error','error');assert.equal(s.view().kind,'idle');
    const task=s.start('Memory');s.finish(task,'Cancelled','warning');assert.equal(s.view().kind,'warning');
});
test('timestamps are readable local 24-hour times with timezone and retained UTC',()=>{
    const utc='2026-09-07T10:43:18.012Z',d=new Date(utc);
    const text=formatTimestamp(utc);
    assert.match(text,/^07\.09\.2026 \d{2}:43:18 UTC[+-]\d{2}:\d{2}$/);
    assert.ok(text.includes(String(d.getHours()).padStart(2,'0')+':43:18'));
    assert.equal(timestampFields(utc).atUtc,utc);assert.equal(formatTimestamp('15:25:09'),'15:25:09');
    const s=newState();s.activity=[{at:utc,title:'Error',data:{at:utc,message:'Test'}}];
    const report=supportReport(s,{},true);assert.equal(report.activity[0].at,text);assert.equal(report.activity[0].data.atUtc,utc);assert.ok(report.environment.timeZone);
});
test('description wrappers from the report unwrap losslessly, without discarding extra data',()=>{
    assert.deepEqual(normalizeCharacterData({description:{description:'Original text'},background:{description:'History'}}),{description:'Original text',background:'History'});
    assert.throws(()=>normalizeCharacterData({description:{description:'Text',other:'Preserve me'}}));
});
