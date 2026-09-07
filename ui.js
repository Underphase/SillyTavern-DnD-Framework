import {errorReport} from './diagnostics.js';
import {renderAbilities} from './abilities.js';
import {escapeHtml as e,clone,SECTIONS} from './core.js';
import {SAMPLE_TRACKER,renderTracker,validateTracker} from './trackers.js';
import {listModels,filterModels} from './models.js';

const button=(action,label,extra='')=>`<button type="button" data-action="${action}" ${extra}>${label}</button>`;
const field=(name,label,value,type='text',extra='')=>`<label class="rpg-field"><span>${label}</span><input name="${name}" type="${type}" value="${e(value)}" ${extra}></label>`;
const area=(name,label,value,extra='')=>`<label class="rpg-field"><span>${label}</span><textarea name="${name}" ${extra}>${e(value)}</textarea></label>`;
const json=value=>JSON.stringify(value,null,2);
const empty=(title,text)=>`<div class="rpg-empty"><span>☾</span><h3>${title}</h3><p>${text}</p></div>`;
const details=(label,value)=>`<details class="rpg-details"><summary>${e(label)}</summary><pre>${e(typeof value==='string'?value:json(value))}</pre></details>`;

export class FrameworkUI {
    constructor(actions) {
        this.actions=actions;this.tab='story';this.draft=clone(SAMPLE_TRACKER);this.draftOriginal=null;
        this.models=[];this.modelSource='';this.modelRequest=null;
        this.orb=document.createElement('button');this.orb.id='rpg-moon';this.orb.type='button';this.orb.title='D&D Framework — open / drag';this.orb.setAttribute('aria-label','Open D&D Framework');this.orb.innerHTML='<span>☾</span><i></i>';
        this.dialog=document.createElement('dialog');this.dialog.id='rpg-framework';
        document.body.append(this.orb,this.dialog);
        this.orb.addEventListener('click',()=>{if(!this.dragged)this.open();});
        let origin;
        this.orb.addEventListener('pointerdown',event=>{origin={x:event.clientX,y:event.clientY,left:this.orb.offsetLeft,top:this.orb.offsetTop};this.dragged=false;this.orb.setPointerCapture(event.pointerId);});
        this.orb.addEventListener('pointermove',event=>{
            if(!origin)return;
            if(Math.hypot(event.clientX-origin.x,event.clientY-origin.y)>6)this.dragged=true;
            if(this.dragged)this.position(origin.left+event.clientX-origin.x,origin.top+event.clientY-origin.y);
        });
        this.orb.addEventListener('pointerup',()=>{if(this.dragged){this.actions.settings().orb={x:this.orb.offsetLeft/innerWidth,y:this.orb.offsetTop/innerHeight};this.actions.saveSettings();}origin=null;});
        this.orb.addEventListener('pointercancel',()=>{origin=null;});
        window.addEventListener('resize',()=>this.restorePosition());this.restorePosition();
        this.dialog.addEventListener('click',event=>{if(event.target===this.dialog){const b=this.dialog.getBoundingClientRect();if(event.clientX<b.left||event.clientX>b.right||event.clientY<b.top||event.clientY>b.bottom)this.dialog.close();}});
        this.dialog.addEventListener('click',event=>{
            const control=event.target.closest('[data-action]');
            if(control) this.handle(control.dataset.action,control).catch(error=>this.error(error));
        });
        this.dialog.addEventListener('change',event=>{
            if(event.target.name==='modelList' && event.target.value){
                this.dialog.querySelector('[name="model"]').value=event.target.value;
                this.status('Model selected. Click Save settings.');
            }
            if(event.target.name==='aiMode')this.updateModelPicker();
            if(event.target.name==='opacity'){this.dialog.style.setProperty('--rpg-opacity',event.target.value);}
            if(event.target.closest('[data-workshop]')){try{this.readDraft();this.preview();}catch(error){this.status(error.message,true);}}
        });
        this.dialog.addEventListener('input',event=>{
            if(event.target.name==='modelSearch'||event.target.name==='model')this.updateModelPicker();
            if(['aiUrl','aiKey'].includes(event.target.name)){
                this.modelRequest?.abort();this.modelRequest=null;this.models=[];this.modelSource='';this.updateModelPicker();
            }
        });
        setInterval(()=>{
            if(!this.dialog.open||this.tab!=='story'||document.hidden)return;
            const state=this.actions.state();
            for(const frame of this.dialog.querySelectorAll('iframe[data-tracker]')){
                const tracker=state?.trackers.find(t=>t.id===frame.dataset.tracker);
                if(tracker?.fields.some(f=>f.source==='clock'))frame.srcdoc=renderTracker(tracker,state);
            }
        },30000);
    }
    resetForChat(){this.draft=clone(SAMPLE_TRACKER);this.draftOriginal=null;this.editingId=null;this.tab='story';this.lastStatus=null;}
    position(x,y){this.orb.style.left=`${Math.max(8,Math.min(innerWidth-64,x))}px`;this.orb.style.top=`${Math.max(8,Math.min(innerHeight-64,y))}px`;}
    restorePosition(){const p=this.actions.settings().orb??{x:0.9,y:0.78};this.position(p.x*innerWidth,p.y*innerHeight);}
    open(){if(!this.dialog.open){this.render();this.dialog.showModal();}}
    status(message,error=false){this.lastStatus={message,error};const node=this.dialog.querySelector('.rpg-status');if(node){node.textContent=message;node.classList.toggle('error',error);}this.orb.classList.toggle('rpg-error',error);}
    error(error){const report=errorReport(error,this.actions.settings());this.status(report.message,true);this.actions.log?.('Error',report);if(this.tab==='developer')this.refresh();}
    busy(value){this.orb.classList.toggle('rpg-busy',value);this.dialog.classList.toggle('rpg-working',value);}
    refresh(){if(this.dialog.open && !['workshop','settings'].includes(this.tab) && !this.dialog.contains(document.activeElement?.closest('textarea,input,select')))this.render();}
    render(){
        const openDetails=new Set([...this.dialog.querySelectorAll('details[data-rpg-disclosure][open]')].map(node=>node.dataset.rpgDisclosure));
        this.modelRequest?.abort();this.modelRequest=null;
        const s=this.actions.state(),prefs=this.actions.settings();
        this.dialog.style.setProperty('--rpg-opacity',prefs.opacity);
        const tabs={story:'Story',characters:'Characters',workshop:'Workshop',memory:'Memory',journal:'Dice',settings:'Settings',...(prefs.devMode?{developer:'Dev'}:{})};
        this.dialog.innerHTML=`<div class="rpg-shell"><header class="rpg-header"><div class="rpg-brand"><span>☾</span><div><small>UNDERPHASE / D&D FRAMEWORK</small><h2>Moonlit chronicle</h2></div></div><div class="rpg-header-actions">${button('process','↻ Update','title="Process new events"')}${button('close','✕','aria-label="Close"')}</div></header><nav class="rpg-tabs" aria-label="Sections">${Object.entries(tabs).map(([key,label])=>button('tab',label,`data-tab="${key}" class="${this.tab===key?'active':''}"`)).join('')}</nav><main class="rpg-body">${!s?empty('Open a chat','Each story has its own memory, characters and trackers.'):this.content(s,prefs)}</main><footer><span class="rpg-status" role="status">${e(this.lastStatus?.message??'Your story. Its rules.')}</span><span class="rpg-signature">☾ ${s?`${s.characters.length} characters · ${s.turns} responses`:'New story'}</span></footer></div>`;
        for(const node of this.dialog.querySelectorAll('details[data-rpg-disclosure]'))node.open=openDetails.has(node.dataset.rpgDisclosure);
        if(s && this.tab==='workshop')this.preview();
        if(s && this.tab==='settings')this.updateModelPicker();
        if(s && this.tab==='story')for(const frame of this.dialog.querySelectorAll('iframe[data-tracker]')){const t=s.trackers.find(x=>x.id===frame.dataset.tracker);frame.srcdoc=renderTracker(t,s);}
    }
    content(s,p){
        if(this.tab==='story')return this.story(s);
        if(this.tab==='characters')return this.characters(s);
        if(this.tab==='workshop')return this.workshop(s);
        if(this.tab==='memory')return this.memory(s);
        if(this.tab==='journal')return this.journal(s);
        if(this.tab==='settings')return this.settingsView(s,p);
        return `<h3>Diagnostics</h3><div class="rpg-toolbar">${button('copy-report','Copy error report')}${button('download-report','Download report')}</div><p class="rpg-muted">Reports hide configured keys. Dev mode includes AI response excerpts, which may contain story text. Review before sharing.</p><textarea class="rpg-code" id="rpg-report-fallback" aria-label="Error report" hidden readonly></textarea><p class="rpg-muted">Token usage is shown only when reported by the provider. Characters are not tokens.</p>${s.activity.slice(-60).reverse().map(a=>details(`${a.at} · ${a.title}`,a.data)).join('')||empty('No log entries','Request timing, token usage and errors appear here.')} ${button('clear-log','Clear log')}`;
    }
    story(s){
        const focus=s.protagonist?.name??'Ensemble cast';
        return `<section class="rpg-hero"><div><div class="rpg-eyebrow">STORY FOCUS</div><h1>${e(focus)}</h1><p>${s.protagonist?'Focus on the protagonist. Scenes unfold gradually while respecting character control.':'No protagonist selected. Focus is shared among the current scene participants.'}</p></div><span class="rpg-crescent">☾</span></section><div class="rpg-toolbar">${button('focus','✦ Select protagonist')}${button('suggest-focus','AI suggestion')}${button('tab','＋ Create tracker','data-tab="workshop"')}</div>
        <div class="rpg-focus-picker" hidden>${field('focusName','Protagonist name',s.protagonist?.name??'')}<select name="focusId" aria-label="Character"><option value="custom">Custom name / bot</option><option value="user">User</option>${s.characters.map(c=>`<option value="${e(c.owner_id)}">${e(c.name)}</option>`).join('')}</select>${button('save-focus','Select')}${button('ensemble','Ensemble mode')}</div>
        ${s.sections.scene?`<div class="rpg-scene-grid">${[['⌖','Location',s.scene.location],['◷','Time',s.scene.time],['☁','Weather',s.scene.weather]].map(([icon,label,value])=>`<article class="rpg-scene"><span>${icon}</span><small>${label}</small><strong>${e(value)}</strong></article>`).join('')}</div>`:''}
        ${s.summary?`<article class="rpg-card"><div class="rpg-eyebrow">NOW</div><p>${e(s.summary)}</p></article>`:''}
        ${s.sections.party && s.scene.party?.name?`<article class="rpg-card"><h3>${e(s.scene.party.name)}</h3><div class="rpg-chips">${s.scene.party.members.map(n=>`<span>${s.scene.party.leader===n?'👑 ':''}${e(n)}</span>`).join('')}</div></article>`:''}
        ${s.characters.length?`<div class="rpg-character-grid">${s.characters.map(c=>this.character(c,s,true)).join('')}</div>`:empty('No story state yet','Configure the processing AI. Characters appear after messages are processed.')}
        ${s.trackers.map(t=>`<section class="rpg-custom"><div class="rpg-section-heading"><h3>${e(t.name)}</h3>${button('edit-tracker','Edit',`data-id="${e(t.id)}"`)}</div><iframe sandbox="" referrerpolicy="no-referrer" title="${e(t.name)}" data-tracker="${e(t.id)}"></iframe></section>`).join('')}`;
    }
    character(c,s,compact=false){
        const on=s.sections,hero=s.protagonist?.id===c.owner_id||s.protagonist?.name===c.name;
        const percent=Math.max(0,Math.min(100,c.max_hp>0?c.current_hp/c.max_hp*100:0));
        const previous=s.previous?.characters?.find(x=>x.owner_id===c.owner_id);
        return `<article class="rpg-card rpg-character"><div class="rpg-section-heading"><div><div class="rpg-eyebrow">${hero?'✦ PROTAGONIST':'CHARACTER'}</div><h3>${s.scene.party?.leader===c.name?'👑 ':''}${e(c.name)}</h3></div>${button('edit-character','✎',`data-id="${e(c.owner_id)}" aria-label="Edit ${e(c.name)}"`)}</div>
        ${on.progress?`<div class="rpg-chips"><span>Level ${e(c.level)}</span><span>${e(c.experience)} XP</span></div>`:''}
        ${on.vitals?`<div class="rpg-hp"><div><span>Health</span><strong>${e(c.current_hp)} / ${e(c.max_hp)} ${c.temporary_hp?`(+${e(c.temporary_hp)})`:''}</strong></div><progress max="100" value="${percent}"></progress><small>${e(c.general_condition)} · Defense ${e(c.armor_class)}${previous && previous.current_hp!==c.current_hp?` · previously ${e(previous.current_hp)} HP`:''}</small></div>`:''}
        ${on.attributes?`<div class="rpg-attributes">${[['strength','STR'],['dexterity','DEX'],['constitution','CON'],['intelligence','INT'],['wisdom','WIS'],['charisma','CHA']].map(([key,label])=>`<div><small>${label}</small><strong>${e(c[key])}</strong></div>`).join('')}</div>`:''}
        ${on.skills?renderAbilities(c,s.scopeId):''}${on.inventory?details('Inventory',c.inventory):''}${on.equipment?details('Equipment',c.equipment):''}${on.spells?details('Spells and slots',{spells:c.spells,slots:c.spell_slots}):''}${on.effects?details('Effects',{buffs:c.buffs,debuffs:c.debuffs}):''}${on.biography && !compact?details('Personality and history',{description:c.description,personality:c.personality,background:c.background,goals:c.goals,traits:c.traits,relationships:c.relationships,memories:c.memories,notes:c.notes}):''}</article>`;
    }
    characters(s){return `<div class="rpg-section-heading"><div><h3>Characters in this story</h3><p class="rpg-muted">Characters are saved in the current SillyTavern chat.</p></div><div>${button('new-character','＋ Character')} ${button('refresh-characters','↻ Refresh list')}</div></div><div class="rpg-character-editor" hidden></div><div class="rpg-character-grid">${s.characters.map(c=>this.character(c,s)).join('')}</div><details class="rpg-details"><summary>Import an existing character from the API</summary><p>Creates a separate copy in the current chat.</p>${field('importId','Existing character owner_id','')}${button('import-character','Import copy')}</details>`;}
    workshop(s){const t=this.draft;return `<div class="rpg-section-heading"><div><div class="rpg-eyebrow">WORKSHOP</div><h3>An interface for your world</h3><p class="rpg-muted">Built-in widgets, custom HTML and CSS. The preview uses sample data.</p></div>${button('new-tracker','New')}</div><div class="rpg-workshop-grid"><div data-workshop>${area('builderRequest','Describe the mechanic you want','', 'placeholder="Example: three guild reputations, trust meters and rewards"')}${button('generate-tracker','✦ Create with AI','class="rpg-primary"')}<div class="rpg-inline">${field('trackerId','ID',t.id)}${field('trackerName','Name',t.name)}</div>${area('trackerPrompt','AI update rules',t.prompt)}${area('trackerHtml','HTML · insert widgets with {{id}}',t.html,'class="rpg-code"')}${area('trackerCss','CSS overrides for the lunar theme',t.css,'class="rpg-code"')}${area('trackerFields','Fields and sample values (JSON)',json(t.fields),'class="rpg-code rpg-fields-json"')}<p class="rpg-muted">Widgets: text, number, meter, inventory, coins, gems, boolean.<br>Sources: ai, character, scene, turns, clock. The last four need no extra AI request; set path for character and scene.</p><div class="rpg-toolbar">${button('preview','Refresh preview')}${button('save-tracker','Save','class="rpg-primary"')}${button('cancel-tracker','Cancel')}</div></div><aside class="rpg-preview"><div class="rpg-eyebrow">PREVIEW · SAMPLE DATA</div><iframe sandbox="" referrerpolicy="no-referrer" title="Tracker preview" id="rpg-tracker-preview"></iframe><div class="rpg-muted" id="rpg-widget-keys"></div></aside></div>${s.trackers.length?`<h3>Saved interfaces</h3>${s.trackers.map(t=>`<div class="rpg-saved-tracker"><span>${e(t.name)}</span><div>${button('edit-tracker','Edit',`data-id="${e(t.id)}"`)} ${button('delete-tracker','Delete',`data-id="${e(t.id)}"`)}</div></div>`).join('')}`:''}`;}
    memory(s){return `<h3>Current chat memory</h3><p class="rpg-muted">All facts are stored here. The narrator receives a summary and relevant facts; other details are available through recall.</p>${area('summary','Current summary',s.summary)}${area('facts','Facts (JSON: id, text, pinned)',json(Object.values(s.facts)),'class="rpg-code"')}${button('save-memory','Save memory','class="rpg-primary"')}${s.previous?details('Previous state',s.previous):''}${s.pending?`<div class="rpg-card"><h3>Pending memory update</h3><p>The pending update is saved in this chat. Retry processing to finish it.</p>${button('process','Retry')}</div>`:''}`;}
    journal(s){return `<div class="rpg-section-heading"><div><h3>Dice and checks</h3><p class="rpg-muted">The extension rolls the dice. The AI receives the saved result.</p></div>${button('refresh-receipts','↻ Log')}</div>${s.receipts.length?s.receipts.slice().reverse().map(r=>`<article class="rpg-card"><div class="rpg-section-heading"><strong>${e(r.parameters.reason)}</strong><span class="rpg-result">${e(r.total??(r.success?'Success':'Impossible'))}</span></div><p class="rpg-muted">${e(r.parameters.formula)} · ${e(r.parameters.mode)}${(r.difficulty??r.parameters.difficulty)!=null?` · difficulty ${e(r.difficulty??r.parameters.difficulty)}`:''}</p>${details('Evidence and result',r)}</article>`).join(''):empty('No rolls yet','During its response, the AI can call a check and continue the scene after the result.')}`;}
    settingsView(s,p){const profiles=this.actions.profiles();return `<div class="rpg-settings-grid"><section><h3>Connections</h3><label class="rpg-check"><input name="enabled" type="checkbox" ${p.enabled?'checked':''}> Automatic processing and tools</label><p class="rpg-muted">Local mode: characters, memory and dice are saved with the chat. No RPG backend or hosting subscription needed.</p><details class="rpg-details"><summary>Optional: import from the old RPG API</summary><p class="rpg-muted">Only for manual character imports. Normal gameplay does not use this connection.</p>${field('backendUrl','RPG API',p.backendUrl,'url')}${field('backendKey','RPG API key',p.backendKey,'password','autocomplete="off"')}${button('test-backend','Test API')}</details><h3>Processing AI</h3><label class="rpg-field"><span>Connection method</span><select name="aiMode"><option value="custom" ${p.aiMode==='custom'?'selected':''}>OpenAI-compatible API</option><option value="profile" ${p.aiMode==='profile'?'selected':''}>SillyTavern profile</option></select></label><label class="rpg-field"><span>Profile</span><select name="profileId"><option value="">Select a profile</option>${profiles.map(x=>`<option value="${e(x.id)}" ${x.id===p.profileId?'selected':''}>${e(x.name)}</option>`).join('')}</select></label>${field('aiUrl','AI endpoint (ending in /v1 or /chat/completions)',p.aiUrl,'url')}${field('aiKey','AI key',p.aiKey,'password','autocomplete="off"')}${this.modelPicker()}${field('model','Selected model / manual entry',p.model)}${field('maxTokens','Max output tokens',p.maxTokens,'number','min="256" max="32000"')}${button('test-ai','Test AI')}<p class="rpg-muted">Keys belong to extension settings, not chat memory. Use an ST profile for providers that block browser CORS requests.</p></section><section><h3>Appearance</h3>${field('opacity','Window opacity',p.opacity,'range','min="0.55" max="1" step="0.05"')}<h3>Sections for this chat</h3>${Object.entries(SECTIONS).map(([k,label])=>`<label class="rpg-check"><input name="section_${k}" type="checkbox" ${s.sections[k]?'checked':''}> ${label}</label>`).join('')}<h3>Context and diagnostics</h3>${field('memoryBudget','Context facts budget (characters)',p.memoryBudget,'number','min="1000" max="30000"')}${field('eventBudget','Event batch budget (characters)',p.eventBudget,'number','min="8000" max="100000"')}<label class="rpg-check"><input name="devMode" type="checkbox" ${p.devMode?'checked':''}> Dev mode</label><p class="rpg-muted">Narrator tools: ${this.actions.toolsSupported()?'available':'unavailable — enable Function calling in ST and select a compatible model'}.</p></section></div><details class="rpg-details"><summary>Edit built-in prompts</summary>${area('narratorPrompt','Narration and dice',p.narratorPrompt)}${area('scenePrompt','Scene pacing and character control',p.scenePrompt)}${area('processorPrompt','Memory and character processor',p.processorPrompt)}${area('builderPrompt','Interface builder',p.builderPrompt)}${button('reset-prompts','Reset prompts')}</details><div class="rpg-toolbar">${button('save-settings','Save settings','class="rpg-primary"')}${button('save-template','Use sections and trackers as the new-chat template')}</div>`;}
    modelPicker(){
        return `<div class="rpg-model-picker"><div class="rpg-toolbar">${button('load-models','↻ Load models')}${button('openrouter-models','OpenRouter')}</div>${field('modelSearch','Search by name or ID','','search','placeholder="Example: claude, gemini, deepseek, :free" autocomplete="off"')}<label class="rpg-field"><span>Available models</span><select name="modelList" size="7" aria-describedby="rpg-model-count"></select></label><p id="rpg-model-count" class="rpg-muted" role="status"></p></div>`;
    }
    modelConnection(){return `${this.value('aiUrl').trim()}\n${this.value('aiKey').trim()}`;}
    updateModelPicker(message){
        const list=this.dialog.querySelector('[name="modelList"]');if(!list)return;
        const profile=this.value('aiMode')==='profile';
        for(const name of ['modelSearch','modelList','model'])this.dialog.querySelector(`[name="${name}"]`).disabled=profile;
        this.dialog.querySelector('[data-action="load-models"]').disabled=profile||!!this.modelRequest;
        this.dialog.querySelector('[data-action="openrouter-models"]').disabled=profile;
        const sourceMatches=this.modelSource===this.modelConnection();
        const models=filterModels(sourceMatches?this.models:[],this.value('modelSearch'));
        list.replaceChildren(...models.map(model=>new Option(model.name===model.id?model.id:`${model.name} — ${model.id}`,model.id)));
        list.value=this.value('model');
        this.dialog.querySelector('#rpg-model-count').textContent=profile?'The model is set by the selected SillyTavern profile.':message??(this.modelRequest?'Loading models…':sourceMatches?`${models.length} of ${this.models.length} models${models.length?'':' · no matches'}`:'Enter the AI endpoint and click Load models.');
    }
    async loadModels(){
        if(this.value('aiMode')==='profile')return;
        if(!this.value('aiUrl').trim())throw new Error('Enter an AI endpoint or click OpenRouter');
        this.modelRequest?.abort();
        const request=new AbortController();this.modelRequest=request;
        const source=this.modelConnection(),list=this.dialog.querySelector('[name="modelList"]');
        const timeout=setTimeout(()=>request.abort(new Error('Model list request timed out after 20 seconds')),20000);
        this.updateModelPicker();
        try{
            const models=await listModels(this.value('aiUrl'),this.value('aiKey'),{signal:request.signal});
            if(this.modelRequest!==request||!list.isConnected||source!==this.modelConnection())return;
            this.models=models;this.modelSource=source;
        }catch(error){
            if(this.modelRequest!==request||!list.isConnected)return;
            this.models=[];this.modelSource='';
            this.modelRequest=null;
            this.error(error);
            this.updateModelPicker(error.message==='Failed to fetch'?'Could not load models: check the endpoint, connection and provider CORS support.':error.message);
            return;
        }finally{clearTimeout(timeout);if(this.modelRequest===request)this.modelRequest=null;}
        if(list.isConnected)this.updateModelPicker();
    }
    value(name){return this.dialog.querySelector(`[name="${name}"]`)?.value??'';}
    readDraft(){this.draft={id:this.value('trackerId'),name:this.value('trackerName'),prompt:this.value('trackerPrompt'),html:this.value('trackerHtml'),css:this.value('trackerCss'),fields:this.actions.parse(this.value('trackerFields'))};return validateTracker(this.draft);}
    preview(){const frame=this.dialog.querySelector('#rpg-tracker-preview');if(frame){frame.srcdoc=renderTracker(this.draft,this.actions.state(),true);this.dialog.querySelector('#rpg-widget-keys').textContent=this.draft.fields.map(f=>`{{${f.id}}}`).join(' · ');}}
    async handle(action,control){
        const s=this.actions.state();
        if(action==='close'){this.dialog.close();return;}
        if(action==='tab'){this.tab=control.dataset.tab;this.render();return;}
        if(!s)throw new Error('Open a chat first');
        if(action==='load-models'){await this.loadModels();return;}
        if(action==='openrouter-models'){
            this.dialog.querySelector('[name="aiUrl"]').value='https://openrouter.ai/api/v1';
            this.dialog.querySelector('[name="modelSearch"]').value='';
            await this.loadModels();return;
        }
        if(action==='focus'){this.dialog.querySelector('.rpg-focus-picker').hidden=false;return;}
        if(action==='save-focus'){
            const id=this.value('focusId'),c=s.characters.find(c=>c.owner_id===id);
            const name=c?.name||(id==='user'?this.actions.userName():this.value('focusName').trim());
            if(!name)throw new Error('Enter a protagonist name');
            s.protagonist={id:c?.owner_id??id,name};await this.actions.save();this.render();return;
        }
        if(action==='ensemble'){s.protagonist=null;await this.actions.save();this.render();return;}
        if(action==='suggest-focus'){
            this.status('AI is suggesting a protagonist…');const result=await this.actions.suggestFocus();
            if(s!==this.actions.state())return;
            this.dialog.querySelector('.rpg-focus-picker').hidden=false;this.dialog.querySelector('[name="focusName"]').value=result.name;
            this.dialog.querySelector('[name="focusId"]').value=s.characters.find(c=>c.name===result.name)?.owner_id??'custom';
            this.status(`Suggestion: ${result.name}. ${result.reason??''} Click Select to confirm.`);return;
        }
        if(action==='new-tracker'){this.draft=clone(SAMPLE_TRACKER);this.draft.id=`tracker_${Date.now()}`;this.draftOriginal=null;this.tab='workshop';this.render();return;}
        if(action==='edit-tracker'){this.draft=clone(s.trackers.find(t=>t.id===control.dataset.id));this.draftOriginal=this.draft.id;this.tab='workshop';this.render();return;}
        if(action==='preview'){this.readDraft();this.preview();this.status('Preview updated');return;}
        if(action==='generate-tracker'){
            const request=this.value('builderRequest');if(!request.trim())throw new Error('Describe the mechanic you want');this.status('Creating interface…');
            const draft=validateTracker(await this.actions.buildTracker(request));if(s!==this.actions.state())return;
            this.draft=draft;this.draftOriginal=null;this.render();this.status('Review the preview and rules. Click Save to apply them.');return;
        }
        if(action==='save-tracker'){
            const draft=this.readDraft();if(s.trackers.some(t=>t.id===draft.id&&t.id!==this.draftOriginal))throw new Error('This ID is already in use');
            const index=s.trackers.findIndex(t=>t.id===this.draftOriginal);if(index>=0)s.trackers[index]=clone(draft);else s.trackers.push(clone(draft));
            if(this.draftOriginal&&this.draftOriginal!==draft.id){s.trackerValues[draft.id]=s.trackerValues[this.draftOriginal]??{};delete s.trackerValues[this.draftOriginal];}
            this.draftOriginal=draft.id;await this.actions.save();this.status('Tracker saved. Sample values are not written to story state.');return;
        }
        if(action==='cancel-tracker'){this.draft=clone(SAMPLE_TRACKER);this.draftOriginal=null;this.tab='story';this.render();return;}
        if(action==='delete-tracker'){s.trackers=s.trackers.filter(t=>t.id!==control.dataset.id);delete s.trackerValues[control.dataset.id];await this.actions.save();this.render();return;}
        if(action==='new-character'||action==='edit-character'){
            this.tab='characters';this.render();const c=s.characters.find(c=>c.owner_id===control.dataset.id);
            this.editingId=c?.owner_id??null;
            const data=c?Object.fromEntries(Object.entries(c).filter(([k])=>!['id','owner_id','scope_id','created_at','updated_at'].includes(k))):{name:'New character',is_player:false,is_temporary:false};
            const editor=this.dialog.querySelector('.rpg-character-editor');editor.hidden=false;editor.innerHTML=`${area('characterJson','Character data (JSON)',json(data),'class="rpg-code"')}${button('save-character','Save character','class="rpg-primary"')} ${button('tab','Cancel','data-tab="characters"')}`;return;
        }
        if(action==='save-character'){await this.actions.saveCharacter(this.editingId,this.actions.parse(this.value('characterJson')));this.render();return;}
        if(action==='import-character'){await this.actions.importCharacter(this.value('importId'));this.render();return;}
        if(action==='save-memory'){await this.actions.saveMemory(this.value('summary'),this.actions.parse(this.value('facts')));this.status('Memory saved');return;}
        if(action==='save-settings'||action==='test-ai'||action==='test-backend'){
            const p=this.actions.settings();for(const key of ['backendUrl','backendKey','aiMode','profileId','aiUrl','aiKey','model','narratorPrompt','scenePrompt','processorPrompt','builderPrompt'])p[key]=this.value(key);
            for(const [key,min,max] of [['opacity',0.55,1],['maxTokens',256,32000],['memoryBudget',1000,30000],['eventBudget',8000,100000]])p[key]=Math.max(min,Math.min(max,Number(this.value(key))||min));
            for(const key of ['enabled','devMode'])p[key]=this.dialog.querySelector(`[name="${key}"]`).checked;
            for(const key of Object.keys(SECTIONS))s.sections[key]=this.dialog.querySelector(`[name="section_${key}"]`).checked;
            this.actions.saveSettings();await this.actions.save();
            if(action==='test-ai')await this.actions.testAI();if(action==='test-backend')await this.actions.testBackend();
            this.status(action==='save-settings'?'Settings saved':'Connection works');if(action==='save-settings')this.render();return;
        }
        if(action==='reset-prompts'){this.actions.resetPrompts();this.render();return;}
        if(action==='save-template'){this.actions.settings().template={sections:clone(s.sections),trackers:clone(s.trackers)};this.actions.saveSettings();this.status('Template saved for new chats');return;}
        if(action==='copy-report'||action==='download-report'){
            const text=json(this.actions.supportReport());
            if(action==='download-report'){
                const url=URL.createObjectURL(new Blob([text],{type:'application/json'}));
                const a=document.createElement('a');a.href=url;a.download='dnd-framework-report.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
                this.status('Report downloaded');return;
            }
            try{await navigator.clipboard.writeText(text);this.status('Report copied');}
            catch{const field=this.dialog.querySelector('#rpg-report-fallback');field.hidden=false;field.value=text;field.focus();field.select();this.status('Clipboard unavailable. Select and copy the report below.');}
            return;
        }
        if(action==='clear-log'){s.activity=[];await this.actions.save();this.render();return;}
        if(action==='process')await this.actions.process();
        if(action==='refresh-characters')await this.actions.refreshCharacters();
        if(action==='refresh-receipts')await this.actions.refreshReceipts();
        this.refresh();
    }
}
