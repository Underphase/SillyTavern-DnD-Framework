// Run with PLAYWRIGHT_MODULE pointing to an installed playwright module.
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import {sampleCharacter} from './sample.js';

const root=resolve(import.meta.dirname,'..');
const server=createServer(async(req,res)=>{
    try{const path=resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));if(!path.startsWith(root))throw Error();const content=await readFile(path);res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css'})[extname(path)]??'text/plain');res.end(content);}catch{res.writeHead(404);res.end('Not found');}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const browser=await chromium.launch({headless:true,...(process.env.BROWSER_CHANNEL?{channel:process.env.BROWSER_CHANNEL}:{})});
const page=await browser.newPage({viewport:{width:1440,height:1100}});
const errors=[];page.on('pageerror',error=>errors.push(error.message));
let records=[sampleCharacter()],aiCalls=0,resolveAI,invalidAI=false,delayAI=false,apiOffline=false,apiRequests=0;
await page.route('**/api/**',async route=>{
    apiRequests++;
    if(apiOffline)return route.abort('connectionfailed');
    const request=route.request(),url=new URL(request.url());
    if(url.pathname==='/api/characters/sync'){
        const body=request.postDataJSON();
        if(body.changes.some(c=>['personality','goals'].some(k=>typeof c.data[k]==='string')))return route.fulfill({status:422,json:{detail:'Expected an object'}});
        for(const change of body.changes){const existing=records.find(c=>c.owner_id===change.owner_id);if(existing)Object.assign(existing,change.data);else records.push({...sampleCharacter(),...change.data,owner_id:change.owner_id,scope_id:body.scope_id});}
        return route.fulfill({json:records.filter(c=>c.scope_id===body.scope_id)});
    }
    if(url.pathname==='/api/characters')return route.fulfill({json:records.filter(c=>c.scope_id===url.searchParams.get('scope_id'))});
    if(url.pathname==='/api/checks'&&request.method()==='GET')return route.fulfill({json:[]});
    return route.fulfill({status:404,json:{detail:'Not found'}});
});
let modelRequests=0,modelsFail=false;
await page.route('https://openrouter.ai/api/v1/models',route=>{
    modelRequests++;
    if(modelsFail)return route.fulfill({status:401,json:{error:'Unauthorized'}});
    return route.fulfill({json:{data:Array.from({length:120},(_,i)=>({id:`test/model-${i}`,name:`Moon Model ${i}`}))}});
});
await page.route('**/mock/v1/chat/completions',async route=>{
    aiCalls++;
    if(invalidAI)return route.fulfill({json:{choices:[{message:{content:'bad JSON private-ui-key'},finish_reason:'stop'}]}});
    if(delayAI)await new Promise(r=>resolveAI=r);
    const delta={summary:'Селена нашла ключ.',facts:[{id:'key',text:'Селена нашла серебряный ключ.'}],characters:[{owner_id:'selena',data:{experience:8500}}],scene:{weather:'Ясно'}};
    await route.fulfill({json:{choices:[{message:{content:JSON.stringify(delta)},finish_reason:'stop'}],usage:{prompt_tokens:420,completion_tokens:80,total_tokens:500}}}).catch(()=>{});
});
try{
    const base=`http://127.0.0.1:${server.address().port}`;
    await page.goto(`${base}/tests/fixture.html`);
    await page.locator('#rpg-moon').click();
    await page.getByRole('heading',{name:'Селена Нокс',exact:true,level:1}).waitFor();
    await mkdir(resolve(root,'test-results'),{recursive:true});
    await page.screenshot({path:resolve(root,'test-results/desktop.png')});
    assert.equal(await page.evaluate(()=>fixture.context.extensionSettings.underphase_dnd.narratorPrompt.includes("without waiting for the user's action")),false);
    assert.ok(await page.evaluate(()=>fixture.prompts.underphase_dnd.includes('not an entrance into the scene')));
    await page.locator('.rpg-abilities > summary').click();
    assert.equal(await page.locator('.rpg-ability').count(),3);
    await page.locator('.rpg-ability-more > summary').click();
    await page.locator('.rpg-abilities').scrollIntoViewIfNeeded();
    await page.screenshot({path:resolve(root,'test-results/skills-desktop.png')});
    assert.equal(await page.locator('.rpg-abilities pre').count(),0);
    await page.setViewportSize({width:390,height:844});
    await page.locator('.rpg-abilities').scrollIntoViewIfNeeded();
    await page.screenshot({path:resolve(root,'test-results/skills-mobile.png')});
    assert.equal(await page.locator('.rpg-body').evaluate(el=>el.scrollWidth>el.clientWidth+1),false);
    await page.setViewportSize({width:1440,height:1100});
    // Overlay always opens in the viewport center after dragging the launcher.
    await page.getByRole('button',{name:'Close',exact:true}).click();
    const orb=await page.locator('#rpg-moon').boundingBox();await page.mouse.move(orb.x+20,orb.y+20);await page.mouse.down();await page.mouse.move(150,180,{steps:8});await page.mouse.up();
    assert.equal(await page.locator('#rpg-framework').evaluate(el=>el.open),false);
    await page.locator('#rpg-moon').click();
    const dialog=await page.locator('#rpg-framework').boundingBox();assert.ok(Math.abs(dialog.x+dialog.width/2-720)<2);
    await page.getByRole('button',{name:'Settings',exact:true}).click();
    await page.getByRole('button',{name:'OpenRouter',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('[name="modelList"]').options.length===120);
    await page.locator('[name="modelSearch"]').fill('MODEL 119');
    assert.equal(await page.locator('[name="modelList"] option').count(),1);
    await page.locator('[name="modelList"]').selectOption('test/model-119');
    assert.equal(await page.locator('[name="model"]').inputValue(),'test/model-119');
    await page.locator('[name="modelSearch"]').fill('not-a-model');
    assert.equal(await page.locator('[name="modelList"] option').count(),0);
    assert.equal(await page.locator('[name="model"]').inputValue(),'test/model-119');
    await page.locator('[name="modelSearch"]').fill('');
    assert.equal(modelRequests,1);
    await page.setViewportSize({width:390,height:844});
    await page.locator('[name="modelList"]').scrollIntoViewIfNeeded();
    await page.screenshot({path:resolve(root,'test-results/model-picker-mobile.png')});
    assert.equal(await page.locator('.rpg-body').evaluate(el=>el.scrollWidth>el.clientWidth+1),false);
    await page.setViewportSize({width:1440,height:1100});
    modelsFail=true;
    await page.getByRole('button',{name:'Load models',exact:false}).click();
    await page.waitForFunction(()=>document.querySelector('#rpg-model-count').textContent.includes('401'));
    assert.equal(await page.locator('[name="model"]').inputValue(),'test/model-119');
    await page.locator('[name="aiMode"]').selectOption('profile');
    assert.equal(await page.locator('[name="modelList"]').isDisabled(),true);
    await page.locator('[name="aiMode"]').selectOption('custom');
    await page.getByRole('button',{name:'Save settings',exact:true}).click();
    assert.equal(await page.evaluate(()=>fixture.context.extensionSettings.underphase_dnd.model),'test/model-119');
    // Restore the test processor endpoint and leave it unconfigured until the auto-update test.
    await page.locator('[name="aiUrl"]').fill(`${base}/mock/v1`);
    await page.locator('[name="model"]').fill('');
    await page.locator('[name="devMode"]').check();
    await page.locator('[name="section_inventory"]').uncheck();
    await page.getByRole('button',{name:'Save settings',exact:true}).click();
    apiOffline=true;
    await page.getByText('Optional: import from the old RPG API',{exact:true}).click();
    await page.getByRole('button',{name:'Test API',exact:true}).click();
    await page.waitForFunction(()=>fixture.context.chatMetadata.underphase_dnd.activity.some(e=>e.data?.diagnostics?.category==='network'));
    await page.getByRole('button',{name:'Dev',exact:true}).click();
    assert.match(await page.locator('.rpg-body').textContent(),/pageOrigin/);
    assert.match(await page.locator('.rpg-body').textContent(),/CORS_ORIGINS/);
    // Keep the RPG API offline for all gameplay checks.
    const explicitApiRequests=apiRequests;
    await page.getByRole('button',{name:'Story',exact:true}).click();
    assert.equal(await page.locator('summary').filter({hasText:'Inventory'}).count(),0);
    await page.getByRole('button',{name:'Workshop',exact:true}).click();
    await page.locator('[name="trackerId"]').fill('test_moon');
    await page.locator('[name="trackerHtml"]').fill('<h2>Лунный резонанс</h2>{{charge}}<script>parent.hacked=true</script>');
    await page.getByRole('button',{name:'Refresh preview',exact:true}).click();
    assert.equal(await page.evaluate(()=>window.hacked),undefined);
    await page.screenshot({path:resolve(root,'test-results/workshop.png')});
    await page.getByRole('button',{name:'Save',exact:true}).click();
    assert.equal(await page.evaluate(()=>fixture.context.chatMetadata.underphase_dnd.trackers.length),1);
    assert.deepEqual(await page.evaluate(()=>fixture.context.chatMetadata.underphase_dnd.trackerValues),{});
    await page.getByRole('button',{name:'Story',exact:true}).click();
    await page.setViewportSize({width:390,height:844});
    await page.screenshot({path:resolve(root,'test-results/mobile.png')});
    assert.equal(await page.locator('.rpg-body').evaluate(el=>el.scrollWidth>el.clientWidth+1),false);
    await page.getByRole('button',{name:'Select protagonist',exact:false}).click();
    await page.locator('[name="focusName"]').fill('Каэль');
    await page.locator('[name="focusId"]').selectOption('custom');
    await page.getByRole('button',{name:'Select',exact:true}).click();
    assert.equal(await page.evaluate(()=>fixture.context.chatMetadata.underphase_dnd.protagonist.name),'Каэль');
    // Automatically process a completed response once, retain state across unchanged events.
    await page.evaluate(()=>{fixture.context.extensionSettings.underphase_dnd.model='test-model';fixture.context.eventSource.emit('GENERATION_ENDED');});
    await page.waitForFunction(()=>fixture.context.chatMetadata.underphase_dnd.summary==='Селена нашла ключ.');
    assert.equal(aiCalls,1);
    assert.equal(await page.evaluate(()=>fixture.context.chatMetadata.underphase_dnd.characters[0].experience),8500);
    await page.evaluate(()=>fixture.context.eventSource.emit('GENERATION_ENDED'));
    await page.waitForTimeout(1100);assert.equal(aiCalls,1);
    // Recover a batch saved by an older extension after the exact dict_type failure.
    await page.evaluate(()=>{
        const s=fixture.context.chatMetadata.underphase_dnd;
        s.pending={id:'legacy-rejected-batch',changes:[{owner_id:'selena',data:{personality:'Спокойна',goals:'Найти союзников'},expected_updated_at:null}],delta:{summary:'Обновление восстановлено'},processed:structuredClone(s.processed),previous:null};
    });
    await page.getByRole('button',{name:'↻ Update',exact:true}).click();
    await page.waitForFunction(()=>fixture.context.chatMetadata.underphase_dnd.pending===null);
    assert.equal(await page.evaluate(()=>fixture.context.chatMetadata.underphase_dnd.characters[0].personality.description),'Спокойна');
    assert.equal(await page.evaluate(()=>fixture.context.chatMetadata.underphase_dnd.characters[0].goals.description),'Найти союзников');
    assert.equal(aiCalls,1);
    // Native tool works with the backend offline, preserves the result, and rejects rerolls.
    const localRoll=await page.evaluate(async()=>JSON.parse(await fixture.tools.rpg_check.action({check_key:'test:door',reason:'Открыть дверь',formula:'1d20',actor_id:'selena',difficulty:12,difficulty_reason:'Замок'})));
    assert.equal(localRoll.random_source,'crypto.getRandomValues');
    assert.ok(localRoll.total>=1&&localRoll.total<=20);
    const repeated=await page.evaluate(async()=>JSON.parse(await fixture.tools.rpg_check.action({check_key:'test:door',reason:'Повтор',formula:'1d100',actor_id:'selena',difficulty:1,difficulty_reason:'Легко'})));
    assert.deepEqual(repeated,localRoll);
    assert.equal(apiRequests,explicitApiRequests);
    // Re-open the same saved chat, retaining migrated characters and the full ledger.
    await page.evaluate(async()=>{fixture.context.chatMetadata=JSON.parse(JSON.stringify(fixture.context.chatMetadata));await fixture.context.eventSource.emit('CHAT_CHANGED');});
    assert.equal(await page.evaluate(()=>fixture.context.chatMetadata.underphase_dnd.characters[0].experience),8500);
    assert.equal(await page.evaluate(()=>fixture.context.chatMetadata.underphase_dnd.localChecks[0].id),localRoll.id);
    await page.getByRole('button',{name:'Characters',exact:true}).click();
    await page.getByRole('button',{name:'＋ Character',exact:true}).click();
    await page.locator('[name="characterJson"]').fill(JSON.stringify({name:'Местный спутник',skills:{watch:{bonus:2}}}));
    await page.getByRole('button',{name:'Save character',exact:true}).click();
    await page.waitForFunction(()=>fixture.context.chatMetadata.underphase_dnd.characters.length===2);
    const recalled=await page.evaluate(async()=>{const c=fixture.context.chatMetadata.underphase_dnd.characters[1];return JSON.parse(await fixture.tools.rpg_recall.action({query:c.name,actor_id:c.owner_id}));});
    assert.equal(recalled.character.name,'Местный спутник');
    assert.equal(recalled.character.strength,10);
    assert.equal(apiRequests,explicitApiRequests);
    // Memory errors retain old state and export usable, redacted diagnostics on mobile.
    invalidAI=true;
    await page.evaluate(()=>{fixture.context.extensionSettings.underphase_dnd.aiKey='private-ui-key';fixture.context.chat[0].mes='Trigger a malformed response';fixture.context.eventSource.emit('MESSAGE_EDITED');});
    await page.waitForFunction(()=>fixture.context.chatMetadata.underphase_dnd.activity.some(x=>x.data?.diagnostics?.stage==='model-json'));
    assert.equal(await page.evaluate(()=>fixture.context.chatMetadata.underphase_dnd.characters[0].experience),8500);
    assert.equal(await page.evaluate(()=>fixture.context.chatMetadata.underphase_dnd.pending),null);
    await page.getByRole('button',{name:'Dev',exact:true}).click();
    await page.evaluate(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async()=>{throw new Error('Not allowed');}}}));
    await page.getByRole('button',{name:'Copy error report',exact:true}).click();
    const report=await page.locator('#rpg-report-fallback').inputValue();
    assert.ok(report.includes('model-json'));assert.ok(report.includes('bad JSON'));assert.ok(!report.includes('private-ui-key'));
    const downloadEvent=page.waitForEvent('download');
    await page.getByRole('button',{name:'Download report',exact:true}).click();
    const download=await downloadEvent;
    const downloaded=JSON.parse(await readFile(await download.path(),'utf8'));
    assert.equal(downloaded.version,'0.2.1');
    assert.ok(downloaded.activity.some(x=>x.data?.diagnostics?.operation==='memory-update'));
    await page.screenshot({path:resolve(root,'test-results/dev-mobile.png')});
    assert.equal(await page.locator('.rpg-body').evaluate(el=>el.scrollWidth>el.clientWidth+1),false);
    invalidAI=false;
    // A delayed completion must not leak into a new chat.
    delayAI=true;
    await page.evaluate(()=>{fixture.context.chat[0].mes='Новое действие';fixture.context.eventSource.emit('MESSAGE_EDITED');});
    await page.waitForFunction(()=>document.querySelector('#rpg-moon').classList.contains('rpg-busy'));
    while(!resolveAI)await new Promise(r=>setTimeout(r,20));
    await page.evaluate(()=>fixture.switchChat('story-b'));
    resolveAI();
    await page.waitForTimeout(1200);
    const fresh=await page.evaluate(()=>fixture.context.chatMetadata.underphase_dnd);
    assert.equal(fresh.protagonist,null);assert.equal(fresh.characters.length,0);assert.equal(fresh.trackers.length,0);assert.equal(fresh.summary,'');assert.notEqual(fresh.scopeId,'fixture');
    assert.deepEqual(errors,[]);
    console.log('Browser checks passed: desktop/mobile, centered overlay, drag, section toggles, sandbox, tracker save, focus, automatic processing, no duplicate processing, chat-switch isolation.');
}finally{await browser.close();server.close();}
