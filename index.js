import {t as tr,html,setLanguage} from './i18n.js';
import {characterProposal,characterSource,gameplayData} from './character-generation.js';
import {processorGuide} from './processor-guide.js';
import {sanitize,errorReport,supportReport} from './diagnostics.js';
import {initializeLocal,syncLocal,resolveLocalCheck,characterDefaults} from './local-store.js';
import {migrateDefaultPrompts} from './prompt-migrations.js';
import {KEY,CHARACTER_FIELDS,clone,uuid,newState,snapshot,reconcileMessages,selectFacts,parseJson,validateDelta,prepareChanges,applyDelta} from './core.js';
import {NARRATOR_PROMPT,PROCESSOR_PROMPT,BUILDER_PROMPT,SCENE_PROMPT,DICE_PROMPT,CHARACTER_PROMPT,FOCUS_PROMPT} from './prompts.js';
import {backend,askAI,cancelAIRequests} from './client.js';
import {FrameworkUI} from './ui.js';
import {normalizePendingChanges} from './character-data.js';

const ctx=()=>SillyTavern.getContext();
const defaults={language:'ru',aiTimeoutSeconds:300,characterPrompt:CHARACTER_PROMPT,focusPrompt:FOCUS_PROMPT,enabled:true,backendUrl:'http://127.0.0.1:8001',backendKey:'',aiMode:'custom',aiUrl:'',aiKey:'',model:'',profileId:'',maxTokens:4096,memoryBudget:6000,eventBudget:24000,opacity:0.96,devMode:false,narratorPrompt:NARRATOR_PROMPT,scenePrompt:SCENE_PROMPT,dicePrompt:DICE_PROMPT,processorPrompt:PROCESSOR_PROMPT,builderPrompt:BUILDER_PROMPT};
let active=null,activeChat=null,controller=null,timer=null,running=null,rerun=false,generating=false,ui,copiedCandidate=null;
const settings=()=>ctx().extensionSettings[KEY];
function saveSettings(){ctx().saveSettingsDebounced();inject();}
function same(state){return state===active && (ctx().getCurrentChatId?.()??ctx().chatId)===activeChat;}
async function save(state=active){if(!state||!same(state))return;ctx().chatMetadata[KEY]=state;await ctx().saveMetadata();inject();}
function log(title,data,state=active){
    if(!state||(!settings().devMode&&title!=='Error'))return;
    state.activity.push({at:new Date().toISOString(),title,data:sanitize(data,settings())});
    state.activity=state.activity.slice(settings().devMode?-60:-10);
    if(same(state))ctx().saveMetadataDebounced?.();
}

function ensureMessageIds(){let changed=false;for(const m of ctx().chat){m.extra??={};if(!m.extra[KEY]?.id){m.extra[KEY]={id:uuid()};changed=true;}}if(changed)ctx().saveChat();}
function currentMessages(){ensureMessageIds();return reconcileMessages(ctx().chat,[]).current;}
function prepared(){return settings().aiMode==='profile'?!!settings().profileId:!!(settings().aiUrl&&settings().model);}

function compactCharacters(state){return state.characters.map(c=>({owner_id:c.owner_id,name:c.name,level:c.level,experience:c.experience,experience_target:c.experience_target,hp:[c.current_hp,c.max_hp],condition:c.general_condition}));}
function relevantCharacters(state,query){
    const text=query.toLowerCase();
    const candidates=state.characters.filter(c=>c.owner_id===state.protagonist?.id||text.includes(c.name.toLowerCase()));
    return (candidates.length?candidates:state.characters.slice(0,3)).map(c=>Object.fromEntries(Object.entries(c).filter(([key,value])=>!['created_at','updated_at','id','scope_id'].includes(key)&&value!==''&&!(value&&typeof value==='object'&&Object.keys(value).length===0))));
}
function inject(){
    const context=ctx();
    if(!active||!settings()?.enabled){context.setExtensionPrompt(KEY,'',1,0,false,0);return;}
    const query=context.chat.slice(-3).map(m=>m.mes).join('\n');
    const focus=active.protagonist?`Narrative focus: ${active.protagonist.name}. Focus does not change character ownership, presence or scene pacing.`:'No selected protagonist. Share focus among established scene participants; preserve their assigned control.';
    const material={scope:active.scopeId,focus,scene:active.scene,summary:active.summary,knownCharacters:compactCharacters(active),facts:selectFacts(active.facts,query,settings().memoryBudget)};
    const prompt=`${settings().narratorPrompt}\nStorage and checks run locally in this extension. References to RPG backend/API in these instructions mean the local character store and rpg_check tool; no external RPG server is needed.\n${settings().scenePrompt}\n${settings().dicePrompt}\nKnown characters below are a registry, not a list of current scene participants or permission to control them.\n${JSON.stringify(material)}\n${context.isToolCallingSupported?.()?'Use rpg_check for unresolved checks.':'Tool calling is unavailable. Do not fabricate dice results; leave uncertain checks unresolved until tools are enabled.'}`;
    context.setExtensionPrompt(KEY,prompt,1,0,false,0);
}

async function refreshCharacters(state=active){
    if(!state)return;
    initializeLocal(state);await save(state);ui?.refresh();
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
        state=newState();state.chatBinding=chatId;state.setup=context.chat.length<=1?'pending':'skipped';
        if(settings().template){state.sections={...state.sections,...clone(settings().template.sections)};state.trackers=clone(settings().template.trackers);}
        context.chatMetadata[KEY]=state;
    }
    initializeLocal(state);active=state;ensureMessageIds();await save(state);ui?.refresh();
    refreshCharacters(state).catch(error=>{if(same(state))ui?.error(error);});
    if(state.setup==='pending')ui?.open();
    schedule();
}

function schedule(){
    clearTimeout(timer);
    if(!active||active.setup==='pending'||!settings().enabled||!prepared())return;
    timer=setTimeout(()=>process().catch(error=>ui.error(error)),700);
}

async function completePending(state){
    const pending=state.pending;if(!pending)return;
    if(normalizePendingChanges(pending,state.characters)){
        log(tr('Исправлен формат данных персонажа'),tr('Текст и списки приведены к формату персонажа без повторного запроса ИИ.'));
        await save(state);
    }
    if(pending.changes.length){
        syncLocal(state,pending);
        if(!same(state))return;
    }
    if(!same(state))return;
    state.previous=pending.previous;
    applyDelta(state,pending.delta);state.processed=pending.processed;
    state.turns=state.processed.filter(m=>m.role==='assistant').length;
    state.pending=null;await save(state);
}

function stateSetupPending(){if(active?.setup!=='pending')return false;ui.open();ui.status(tr('Настрой персонажа или выбери «Пропустить»'),'warning');return true;}
async function process(){
    if(running){rerun=true;return running;}
    if(!active)return;
    if(!settings().enabled)throw new Error(tr('Обработка выключена в настройках'));
    if(stateSetupPending())return;
    if(!prepared())throw new Error(tr('Настрой отдельную ИИ во вкладке «Настройки»'));
    if(generating){rerun=true;ui.status(tr('Ожидание завершения ответа рассказчика'),'warning');return;}
    const state=active;
    running=(async()=>{
        const task=ui.startTask(tr('Подготовка обновления памяти'));controller=new AbortController();
        try {
            ui.updateTask(task,tr('Применение сохранённых изменений'));
            await completePending(state);if(!same(state))return;
            await refreshCharacters(state);if(!same(state))return;
            while(same(state)){
                if(generating){rerun=true;ui.finishTask(task,tr('Ожидание завершения ответа рассказчика'),'warning');return;}
                ensureMessageIds();
                const {current,changes}=reconcileMessages(ctx().chat,state.processed);
                if(!changes.length)break;
                const batch=[];let size=0;
                for(const change of changes){const length=JSON.stringify(change).length;if(batch.length && size+length>settings().eventBudget)break;batch.push(change);size+=length;}
                // Preserve entire events; budget is soft for an unusually long single message.
                const transcript=JSON.stringify(current);
                ui.updateTask(task,html`Подготовка событий: ${batch.length}`);
                const aiTrackers=state.trackers.filter(t=>t.fields.some(f=>f.source==='ai')).map(t=>({id:t.id,prompt:t.prompt,fields:t.fields.filter(f=>f.source==='ai').map(({id,label,type,max,instruction})=>({id,label,type,max,instruction})),current:state.trackerValues[t.id]??{}}));
                const input={events:batch,recent:current.slice(-2),summary:state.summary,
                    facts:selectFacts(state.facts,JSON.stringify(batch),settings().memoryBudget*2),
                    characters:relevantCharacters(state,JSON.stringify(batch)),characterIndex:compactCharacters(state),characterFields:CHARACTER_FIELDS,scene:state.scene,trackers:aiTrackers,manualSetup:state.manualSetup??[],
                    receipts:state.receipts.slice(-10)};
                const delta=await askAI(settings(),processorGuide(settings().processorPrompt),input,{signal:controller.signal,onStage:stage=>ui.updateTask(task,({request:tr('Ожидание ответа ИИ'),'response-body':tr('Чтение ответа ИИ'),'provider-json':tr('Разбор ответа провайдера'),'model-json':tr('Разбор изменений памяти'),validation:tr('Проверка изменений памяти')})[stage]??stage),onUsage:usage=>log(tr('Обработка состояния'),usage,state),validate:value=>{validateDelta(value);prepareChanges(value,state);return value;}});
                if(!same(state)||controller.signal.aborted)return;
                if(JSON.stringify(currentMessages())!==transcript){log(tr('Изменения во время обработки'),tr('Устаревший ответ ИИ отброшен'));continue;}
                const next=new Map(state.processed.map(m=>[m.id,m]));
                for(const change of batch){if(change.kind==='deleted')next.delete(change.id);else{const {kind,previous,...message}=change;next.set(change.id,message);}}
                const processed=current.filter(m=>next.has(m.id)).map(m=>next.get(m.id));
                // Keep unapplied deletions in the snapshot until their own batch is processed.
                for(const old of next.values())if(!processed.some(m=>m.id===old.id))processed.push(old);
                state.pending={id:uuid(),changes:prepareChanges(delta,state),delta,processed,previous:snapshot(state)};
                ui.updateTask(task,tr('Сохранение памяти и персонажей'));await save(state);await completePending(state);ui.refresh();
            }
            if(same(state))ui.finishTask(task,tr('Память и треккеры обновлены'),'success');
        }catch(error){
            if(error.name!=='AbortError'){
                if(same(state)){rerun=false;ui.finishTask(task,error.message,'error');}
                error.diagnostics={...error.diagnostics,operation:'memory-update',pendingId:state.pending?.id??null,processedMessages:state.processed.length,characterCount:state.characters.length};
                if(!same(state)){log('Error',errorReport(error,settings()),state);return;}
                throw error;
            }
        }finally{controller=null;ui.finishTask(task,tr('Обновление памяти отменено'),'warning');running=null;if(rerun){rerun=false;schedule();}}
    })();
    return running;
}

function eventIdentity(){ensureMessageIds();const messages=ctx().chat.filter(m=>m.is_user&&!m.is_system);return messages.at(-1)?.extra?.[KEY]?.id??`opening-${active.scopeId}`;}
function registerTools(){
    const context=ctx();
    const register=tool=>{
        const action=tool.action;
        context.registerFunctionTool({...tool,action:async args=>{
            const state=active;
            try{return await action(args);}catch(error){
                error.diagnostics={...error.diagnostics,operation:tool.name};
                log('Error',errorReport(error,settings()),state);
                if(same(state))ui.status(error.message,true);
                throw error;
            }
        }});
    };
    register({name:'rpg_check',displayName:tr('Проверка RPG'),description:'Out-of-character adjudication, invisible to characters. Resolve a check or roll using the extension’s local rules engine. Never invent results. Reuse check_key for the same action and target. Supply difficulty justification before rolling. Stored passives may resolve covered actions automatically.',
        parameters:{type:'object',properties:{check_key:{type:'string',description:'Stable action + target key; never change to retry'},reason:{type:'string'},actor_id:{type:'string',description:'owner_id from RPG context; omit for a world event'},formula:{type:'string',description:'NdS, e.g. 1d20, 1d100, 2d6; no arithmetic'},target_id:{type:'string',description:'Stored target character owner_id'},difficulty_path:{type:'string',description:'Code reads stored target difficulty: armor_class or notes.checks.lock.dc; omit difficulty when using this'},difficulty:{type:'integer'},difficulty_reason:{type:'string'},comparison:{type:'string',enum:['gte','lte']},mode:{type:'string',enum:['normal','advantage','disadvantage']},attribute:{type:'string',enum:['strength','dexterity','constitution','intelligence','wisdom','charisma']},attribute_rule:{type:'string',enum:['none','raw','d20']},bonus_paths:{type:'array',items:{type:'string'},description:'Stored integer paths such as skills.lockpick.bonus; no invented bonuses'},resolution:{type:'string',enum:['roll','automatic','impossible']},passive_path:{type:'string',description:'Stored passive object with automatic_success and actions covering check_key'}},required:['check_key','reason','formula'],additionalProperties:false},
        shouldRegister:()=>!!active&&settings().enabled,stealth:false,
        formatMessage:args=>`${args.formula}: ${args.reason}`,
        action:async args=>{
            const state=active;if(!state)throw new Error(tr('Нет активного чата'));
            const result=resolveLocalCheck(state,args,eventIdentity());
            if(same(state)){if(!state.receipts.some(r=>r.id===result.id))state.receipts.push(result);state.receipts=state.receipts.slice(-100);await save(state);ui.refresh();}
            return JSON.stringify(result);
        }});
    register({name:'rpg_recall',displayName:tr('Память истории'),description:'Retrieve durable story facts or a full RPG character when compact context is insufficient.',parameters:{type:'object',properties:{query:{type:'string'},actor_id:{type:'string'}},required:['query'],additionalProperties:false},shouldRegister:()=>!!active&&settings().enabled,stealth:false,formatMessage:()=> tr('Вспоминаю историю…'),action:async({query,actor_id})=>{
        if(!active)throw new Error(tr('Нет активного чата'));
        return JSON.stringify({facts:selectFacts(active.facts,query,12000),...(actor_id?{character:active.characters.find(c=>c.owner_id===actor_id)??null}:{})});
    }});
}

async function saveCharacter(id,data,expectedUpdatedAt){
    const state=active;if(running||state.pending)throw new Error(tr('Дождись завершения синхронизации перед ручным редактированием'));
    if(id&&expectedUpdatedAt!==undefined&&state.characters.find(c=>c.owner_id===id)?.updated_at!==expectedUpdatedAt)throw new Error(tr('Персонаж изменился во время редактирования. Скопируй правки и открой актуальную карточку, чтобы не потерять новые данные.'));
    const delta=validateDelta({characters:[{...(id?{owner_id:id}:{}),data}]});
    state.pending={id:uuid(),delta,changes:prepareChanges(delta,state),processed:clone(state.processed),previous:snapshot(state)};
    await save(state);await completePending(state);
}

async function init(){
    const context=ctx();context.extensionSettings[KEY]={...defaults,...context.extensionSettings[KEY]};
    if(migrateDefaultPrompts(context.extensionSettings[KEY]))context.saveSettingsDebounced();
    ui=new FrameworkUI({state:()=>active,settings,save,saveSettings,parse:parseJson,log,process,refreshCharacters,
        supportReport:()=>supportReport(active,settings(),context.isToolCallingSupported?.()??false,ui?.statusTracker.view()),
        toolsSupported:()=>context.isToolCallingSupported?.()??false,
        profiles:()=>ctx().extensionSettings.connectionManager?.profiles??[],userName:()=>ctx().name1,
        effectiveProcessor:()=>processorGuide(settings().processorPrompt),
        resetPrompts:()=>{Object.assign(settings(),{narratorPrompt:NARRATOR_PROMPT,scenePrompt:SCENE_PROMPT,dicePrompt:DICE_PROMPT,processorPrompt:PROCESSOR_PROMPT,builderPrompt:BUILDER_PROMPT,characterPrompt:CHARACTER_PROMPT,focusPrompt:FOCUS_PROMPT});saveSettings();},
        testBackend:async()=>{const result=await backend(settings(),'/characters?scope_id=connection-test&limit=1');log(tr('Подключение RPG API'),{httpStatus:200,pageOrigin:globalThis.location?.origin});return result;},
        testAI:()=>askAI(settings(),'Return only JSON: {"ok":true}',{test:true}),
        suggestFocus:()=>askAI(settings(),settings().focusPrompt,{summary:active.summary,characters:compactCharacters(active),recent:ctx().chat.slice(-6).map(m=>({name:m.name,text:m.mes}))}),
        buildTracker:request=>askAI(settings(),`${settings().builderPrompt}\nUse ${settings().language==='en'?'English':'Russian'} interface labels unless the user requests another language. Each field may include instruction: a concise rule for updating that field. Sample values are fictional preview data only.`,{request},{onUsage:u=>log(tr('Конструктор'),u)}),
        cancelAI:()=>{rerun=false;controller?.abort();cancelAIRequests();},
        generateCharacter:({note,source,data,isNew})=>askAI(settings(),settings().characterPrompt,{subject:data.name,allowedFields:Object.keys(gameplayData(characterDefaults())),language:settings().language,source:characterSource(ctx(),active,source),note:note.slice(0,12000),existing:isNew?Object.fromEntries(Object.entries(gameplayData(data)).filter(([key,value])=>key==='name'||JSON.stringify(value)!==JSON.stringify(characterDefaults()[key]))):gameplayData(data)},{onUsage:u=>log('Character generation',u),validate:result=>characterProposal(result,data)}),
        saveCharacter,
        skipSetup:async()=>{active.setup='skipped';await save();schedule();},
        finishSetup:async(data,focus)=>{const state=active;await saveCharacter(null,data);if(!same(state))return;const c=state.characters.find(c=>c.name===data.name);state.manualSetup=[{owner_id:c.owner_id,level:c.level,experience:c.experience,experience_target:c.experience_target}];state.setup='done';if(focus)state.protagonist={id:c.owner_id,name:c.name};await save();schedule();},
        initialName:()=>ctx().name1??'',
        importCharacter:async id=>{const state=active;const c=await backend(settings(),`/characters/${encodeURIComponent(id.trim())}`);if(!same(state))return;await saveCharacter(null,Object.fromEntries(CHARACTER_FIELDS.map(k=>[k,c[k]])));},
        saveMemory:async(summary,facts)=>{const delta=validateDelta({summary,facts});active.facts={};applyDelta(active,delta);await save();},
        refreshReceipts:async()=>{const state=active;state.receipts=clone(state.localChecks.slice(-100));await save(state);}
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
    const entry=document.createElement('div');entry.className='extension_container';const launch=document.createElement('button');launch.className='menu_button';launch.textContent=tr('☾ D&D Framework · Настройки');launch.addEventListener('click',()=>{ui.tab='settings';ui.open();});entry.append(launch);document.querySelector('#extensions_settings2, #extensions_settings')?.append(entry);
    await activate();
}

if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>init().catch(console.error),{once:true});else init().catch(console.error);
