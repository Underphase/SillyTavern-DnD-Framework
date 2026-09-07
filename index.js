import {KEY,CHARACTER_FIELDS,clone,uuid,newState,snapshot,reconcileMessages,selectFacts,parseJson,validateDelta,prepareChanges,applyDelta} from './core.js';
import {NARRATOR_PROMPT,PROCESSOR_PROMPT,BUILDER_PROMPT} from './prompts.js';
import {backend,askAI} from './client.js';
import {FrameworkUI} from './ui.js';
import {CHARACTER_DATA_RULES,normalizePendingChanges} from './character-data.js';

const ctx=()=>SillyTavern.getContext();
const defaults={enabled:true,backendUrl:'http://127.0.0.1:8001',backendKey:'',aiMode:'custom',aiUrl:'',aiKey:'',model:'',profileId:'',maxTokens:4096,memoryBudget:6000,eventBudget:24000,opacity:0.96,devMode:false,narratorPrompt:NARRATOR_PROMPT,processorPrompt:PROCESSOR_PROMPT,builderPrompt:BUILDER_PROMPT};
let active=null,activeChat=null,controller=null,timer=null,running=null,rerun=false,generating=false,ui,copiedCandidate=null;
const settings=()=>ctx().extensionSettings[KEY];
function saveSettings(){ctx().saveSettingsDebounced();inject();}
function same(state){return state===active && (ctx().getCurrentChatId?.()??ctx().chatId)===activeChat;}
async function save(state=active){if(!state||!same(state))return;ctx().chatMetadata[KEY]=state;await ctx().saveMetadata();inject();}
function log(title,data){if(!active||!settings().devMode)return;active.activity.push({at:new Date().toLocaleTimeString(),title,data});active.activity=active.activity.slice(-100);ctx().saveMetadataDebounced?.();}
function ensureMessageIds(){let changed=false;for(const m of ctx().chat){m.extra??={};if(!m.extra[KEY]?.id){m.extra[KEY]={id:uuid()};changed=true;}}if(changed)ctx().saveChat();}
function currentMessages(){ensureMessageIds();return reconcileMessages(ctx().chat,[]).current;}
function prepared(){return settings().aiMode==='profile'?!!settings().profileId:!!(settings().aiUrl&&settings().model);}

function compactCharacters(state){return state.characters.map(c=>({owner_id:c.owner_id,name:c.name,level:c.level,hp:[c.current_hp,c.max_hp],condition:c.general_condition}));}
function relevantCharacters(state,query){
    const text=query.toLowerCase();
    const candidates=state.characters.filter(c=>c.owner_id===state.protagonist?.id||text.includes(c.name.toLowerCase()));
    return (candidates.length?candidates:state.characters.slice(0,3)).map(c=>Object.fromEntries(Object.entries(c).filter(([key,value])=>!['created_at','updated_at','id','scope_id'].includes(key)&&value!==''&&!(value&&typeof value==='object'&&Object.keys(value).length===0))));
}
function inject(){
    const context=ctx();
    if(!active||!settings()?.enabled){context.setExtensionPrompt(KEY,'',1,0,false,0);return;}
    const query=context.chat.slice(-3).map(m=>m.mes).join('\n');
    const focus=active.protagonist?`Single protagonist: ${active.protagonist.name}. The user is the protagonist ONLY if explicitly selected.`:'Ensemble narration. The user is not the default protagonist.';
    const material={scope:active.scopeId,focus,scene:active.scene,summary:active.summary,characters:compactCharacters(active),facts:selectFacts(active.facts,query,settings().memoryBudget)};
    const prompt=`${settings().narratorPrompt}\n${JSON.stringify(material)}\n${context.isToolCallingSupported?.()?'Use rpg_check for unresolved checks.':'Tool calling is unavailable. Do not fabricate dice results; leave uncertain checks unresolved until tools are enabled.'}`;
    context.setExtensionPrompt(KEY,prompt,1,0,false,0);
}

async function refreshCharacters(state=active){
    if(!state)return;
    const before=state.characters,characters=[];
    for(let offset=0;;offset+=100){const page=await backend(settings(),`/characters?scope_id=${encodeURIComponent(state.scopeId)}&offset=${offset}&limit=100`);characters.push(...page);if(page.length<100)break;}
    if(!same(state)||state.characters!==before)return;
    state.characters=characters;await save(state);ui?.refresh();
}

async function activate(){
    controller?.abort();clearTimeout(timer);generating=false;
    const context=ctx(),chatId=context.getCurrentChatId?.()??context.chatId;
    const changed=activeChat!==chatId;activeChat=chatId;active=null;
    if(changed)ui?.resetForChat();
    if(!chatId){inject();ui?.refresh();return;}
    let state=context.chatMetadata[KEY];
    // Copied metadata in a new/forked chat must not share the backend scope.
    if(!state||state.chatBinding!==chatId){
        copiedCandidate=state?{state,from:state.chatBinding,to:chatId}:null;
        state=newState();state.chatBinding=chatId;
        if(settings().template){state.sections={...state.sections,...clone(settings().template.sections)};state.trackers=clone(settings().template.trackers);}
        context.chatMetadata[KEY]=state;
    }
    active=state;ensureMessageIds();await save(state);ui?.refresh();
    refreshCharacters(state).catch(error=>{if(same(state))ui?.error(error);});
    schedule();
}

function schedule(){
    clearTimeout(timer);
    if(!active||!settings().enabled||!prepared())return;
    timer=setTimeout(()=>process().catch(error=>ui.error(error)),700);
}

async function completePending(state){
    const pending=state.pending;if(!pending)return;
    if(normalizePendingChanges(pending,state.characters)){
        log('Исправлен формат данных персонажа','Текст и списки приведены к формату API без повторного запроса ИИ.');
        await save(state);
    }
    if(pending.changes.length){
        const characters=await backend(settings(),'/characters/sync',{method:'POST',body:{scope_id:state.scopeId,request_id:pending.id,changes:pending.changes}});
        if(!same(state))return;
        state.characters=characters;
    }
    if(!same(state))return;
    state.previous=pending.previous;
    applyDelta(state,pending.delta);state.processed=pending.processed;
    state.turns=state.processed.filter(m=>m.role==='assistant').length;
    state.pending=null;await save(state);
}

async function process(){
    if(running){rerun=true;return running;}
    if(!active)return;
    if(!settings().enabled)throw new Error('Обработка выключена в настройках');
    if(!prepared())throw new Error('Настрой отдельную ИИ во вкладке «Настройки»');
    if(generating){rerun=true;return;}
    const state=active;
    running=(async()=>{
        ui.busy(true);controller=new AbortController();
        try {
            await completePending(state);if(!same(state))return;
            await refreshCharacters(state);if(!same(state))return;
            while(same(state)){
                ensureMessageIds();
                const {current,changes}=reconcileMessages(ctx().chat,state.processed);
                if(!changes.length)break;
                const batch=[];let size=0;
                for(const change of changes){const length=JSON.stringify(change).length;if(batch.length && size+length>settings().eventBudget)break;batch.push(change);size+=length;}
                // Preserve entire events; budget is soft for an unusually long single message.
                const transcript=JSON.stringify(current);
                ui.status(`Обновляю память · ${batch.length} событий…`);
                const aiTrackers=state.trackers.filter(t=>t.fields.some(f=>f.source==='ai')).map(t=>({id:t.id,prompt:t.prompt,fields:t.fields.filter(f=>f.source==='ai').map(({id,label,type,max})=>({id,label,type,max})),current:state.trackerValues[t.id]??{}}));
                const input={events:batch,recent:current.slice(-2),summary:state.summary,
                    facts:selectFacts(state.facts,JSON.stringify(batch),settings().memoryBudget*2),
                    characters:relevantCharacters(state,JSON.stringify(batch)),characterIndex:compactCharacters(state),characterFields:CHARACTER_FIELDS,scene:state.scene,trackers:aiTrackers,
                    receipts:state.receipts.slice(-10)};
                const delta=validateDelta(await askAI(settings(),`${settings().processorPrompt}\n${CHARACTER_DATA_RULES}`,input,{signal:controller.signal,onUsage:usage=>log('Обработка состояния',usage)}));
                if(!same(state)||controller.signal.aborted)return;
                if(JSON.stringify(currentMessages())!==transcript){log('Изменения во время обработки','Устаревший ответ ИИ отброшен');continue;}
                const next=new Map(state.processed.map(m=>[m.id,m]));
                for(const change of batch){if(change.kind==='deleted')next.delete(change.id);else{const {kind,previous,...message}=change;next.set(change.id,message);}}
                const processed=current.filter(m=>next.has(m.id)).map(m=>next.get(m.id));
                // Keep unapplied deletions in the snapshot until their own batch is processed.
                for(const old of next.values())if(!processed.some(m=>m.id===old.id))processed.push(old);
                state.pending={id:uuid(),changes:prepareChanges(delta,state),delta,processed,previous:snapshot(state)};
                await save(state);await completePending(state);ui.refresh();
            }
            if(same(state))ui.status('Память и треккеры обновлены');
        }catch(error){
            if(error.name!=='AbortError'){
                if(error.status===409 && same(state)){state.pending=null;await save(state);await refreshCharacters(state);}
                throw error;
            }
        }finally{controller=null;ui.busy(false);running=null;if(rerun){rerun=false;schedule();}}
    })();
    return running;
}

function eventIdentity(){ensureMessageIds();const messages=ctx().chat.filter(m=>m.is_user&&!m.is_system);return messages.at(-1)?.extra?.[KEY]?.id??`opening-${active.scopeId}`;}
function registerTools(){
    const context=ctx();
    context.registerFunctionTool({name:'rpg_check',displayName:'Проверка RPG',description:'Resolve a check or roll on the RPG backend. Never invent results. Reuse check_key for the same action and target. Supply difficulty justification before rolling. Stored passives may resolve covered actions automatically.',
        parameters:{type:'object',properties:{check_key:{type:'string',description:'Stable action + target key; never change to retry'},reason:{type:'string'},actor_id:{type:'string',description:'owner_id from RPG context; omit for a world event'},formula:{type:'string',description:'NdS, e.g. 1d20, 1d100, 2d6; no arithmetic'},target_id:{type:'string',description:'Stored target character owner_id'},difficulty_path:{type:'string',description:'Backend reads target difficulty: armor_class or notes.checks.lock.dc; omit difficulty when using this'},difficulty:{type:'integer'},difficulty_reason:{type:'string'},comparison:{type:'string',enum:['gte','lte']},mode:{type:'string',enum:['normal','advantage','disadvantage']},attribute:{type:'string',enum:['strength','dexterity','constitution','intelligence','wisdom','charisma']},attribute_rule:{type:'string',enum:['none','raw','d20']},bonus_paths:{type:'array',items:{type:'string'},description:'Stored integer paths such as skills.lockpick.bonus; no invented bonuses'},resolution:{type:'string',enum:['roll','automatic','impossible']},passive_path:{type:'string',description:'Stored passive object with automatic_success and actions covering check_key'}},required:['check_key','reason','formula'],additionalProperties:false},
        shouldRegister:()=>!!active&&settings().enabled,stealth:false,
        formatMessage:args=>`${args.formula}: ${args.reason}`,
        action:async args=>{
            const state=active;if(!state)throw new Error('Нет активного чата');
            let result;
            try{result=await backend(settings(),'/checks',{method:'POST',body:{...args,scope_id:state.scopeId,event_id:eventIdentity()}});}
            catch(error){if(error.status===409 && error.receipt)result=error.receipt;else throw error;}
            if(same(state)){if(!state.receipts.some(r=>r.id===result.id))state.receipts.push(result);state.receipts=state.receipts.slice(-100);await save(state);ui.refresh();}
            return JSON.stringify(result);
        }});
    context.registerFunctionTool({name:'rpg_recall',displayName:'Память истории',description:'Retrieve durable story facts or a full RPG character when compact context is insufficient.',parameters:{type:'object',properties:{query:{type:'string'},actor_id:{type:'string'}},required:['query'],additionalProperties:false},shouldRegister:()=>!!active&&settings().enabled,stealth:false,formatMessage:()=> 'Вспоминаю историю…',action:async({query,actor_id})=>{
        if(!active)throw new Error('Нет активного чата');
        return JSON.stringify({facts:selectFacts(active.facts,query,12000),...(actor_id?{character:active.characters.find(c=>c.owner_id===actor_id)??null}:{})});
    }});
}

async function saveCharacter(id,data){
    const state=active;if(running||state.pending)throw new Error('Дождись завершения синхронизации перед ручным редактированием');
    const delta=validateDelta({characters:[{...(id?{owner_id:id}:{}),data}]});
    state.pending={id:uuid(),delta,changes:prepareChanges(delta,state),processed:clone(state.processed),previous:snapshot(state)};
    await save(state);await completePending(state);
}

async function init(){
    const context=ctx();context.extensionSettings[KEY]={...defaults,...context.extensionSettings[KEY]};
    ui=new FrameworkUI({state:()=>active,settings,save,saveSettings,parse:parseJson,log,process,refreshCharacters,
        toolsSupported:()=>context.isToolCallingSupported?.()??false,
        profiles:()=>ctx().extensionSettings.connectionManager?.profiles??[],userName:()=>ctx().name1,
        resetPrompts:()=>{Object.assign(settings(),{narratorPrompt:NARRATOR_PROMPT,processorPrompt:PROCESSOR_PROMPT,builderPrompt:BUILDER_PROMPT});saveSettings();},
        testBackend:async()=>{const result=await backend(settings(),'/characters?scope_id=connection-test&limit=1');log('Подключение RPG API',{httpStatus:200,pageOrigin:globalThis.location?.origin});return result;},
        testAI:()=>askAI(settings(),'Return only JSON: {"ok":true}',{test:true}),
        suggestFocus:()=>askAI(settings(),'Suggest ONE protagonist for this story. The user is not the default hero. Return JSON {"name":"...","reason":"..."}.',{summary:active.summary,characters:compactCharacters(active),recent:ctx().chat.slice(-6).map(m=>({name:m.name,text:m.mes}))}),
        buildTracker:request=>askAI(settings(),settings().builderPrompt,{request},{onUsage:u=>log('Конструктор',u)}),
        saveCharacter,
        importCharacter:async id=>{const state=active;const c=await backend(settings(),`/characters/${encodeURIComponent(id.trim())}`);if(!same(state))return;await saveCharacter(null,Object.fromEntries(CHARACTER_FIELDS.map(k=>[k,c[k]])));},
        saveMemory:async(summary,facts)=>{const delta=validateDelta({summary,facts});active.facts={};applyDelta(active,delta);await save();},
        refreshReceipts:async()=>{const state=active;const receipts=await backend(settings(),`/checks?scope_id=${encodeURIComponent(state.scopeId)}&limit=100`);if(same(state)){state.receipts=receipts.reverse();await save(state);}}
    });
    registerTools();
    const events=context.eventTypes,source=context.eventSource;
    source.on(events.CHAT_CHANGED,()=>activate().catch(error=>ui.error(error)));
    if(events.CHAT_RENAMED)source.on(events.CHAT_RENAMED,async({oldFileName,newFileName})=>{
        if(copiedCandidate?.from===oldFileName && copiedCandidate.to===newFileName && activeChat===newFileName){
            controller?.abort();active=copiedCandidate.state;active.chatBinding=newFileName;copiedCandidate=null;await save();ui.refresh();schedule();
        }
    });
    for(const key of ['MESSAGE_RECEIVED','MESSAGE_EDITED','MESSAGE_UPDATED','MESSAGE_SWIPED','MESSAGE_DELETED'])if(events[key])source.on(events[key],()=>{inject();schedule();});
    source.on(events.GENERATION_STARTED,(type,options,dryRun)=>{if(dryRun||type==='quiet')return;generating=true;inject();});
    for(const key of ['GENERATION_ENDED','GENERATION_STOPPED'])if(events[key])source.on(events[key],()=>{generating=false;schedule();});
    const entry=document.createElement('div');entry.className='extension_container';const launch=document.createElement('button');launch.className='menu_button';launch.textContent='☾ D&D Framework · Настройки';launch.addEventListener('click',()=>{ui.tab='settings';ui.open();});entry.append(launch);document.querySelector('#extensions_settings2, #extensions_settings')?.append(entry);
    await activate();
}

if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>init().catch(console.error),{once:true});else init().catch(console.error);
