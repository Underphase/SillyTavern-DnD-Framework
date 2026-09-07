import {clone,uuid,pathValue} from './core.js';
import {OBJECT_FIELDS,normalizeCharacterData} from './character-data.js';

const attributes=['strength','dexterity','constitution','intelligence','wisdom','charisma'];
const roots=['skills','active_skills','buffs','debuffs','traits','equipment','notes'];
const fail=message=>{throw new Error(message);};
const integer=value=>Number.isSafeInteger(value)&&Math.abs(value)<=1000000;
export function initializeLocal(state){
    state.localChecks??=clone(state.receipts??[]);
    state.storage='local';
}
export function characterDefaults(){return {...Object.fromEntries(OBJECT_FIELDS.map(k=>[k,{}])),...Object.fromEntries(attributes.map(k=>[k,10])),description:'',background:'',tags:[],is_player:false,is_temporary:false,level:1,experience:0,experience_target:300,armor_class:10,max_hp:10,current_hp:10,temporary_hp:0,general_condition:'Healthy'};}
export function syncLocal(state,pending){
    if(state.localSyncId===pending.id)return;
    const characters=clone(state.characters);
    for(const change of pending.changes){
        let character=characters.find(c=>c.owner_id===change.owner_id);
        const data=normalizeCharacterData(change.data,character);
        if(!character){if(!data.name)fail('Новому персонажу нужно имя');character={...characterDefaults(),owner_id:change.owner_id,scope_id:state.scopeId,created_at:new Date().toISOString()};characters.push(character);}
        if(data.level>1&&!Object.hasOwn(data,'experience_target')&&!state.characters.some(c=>c.owner_id===change.owner_id))character.experience_target=0;
        Object.assign(character,data,{updated_at:new Date().toISOString()});
    }
    state.characters=characters;state.localSyncId=pending.id;
}

// Rejection sampling avoids modulo bias; never fall back to Math.random.
export function randomBelow(sides){
    const limit=Math.floor(4294967296/sides)*sides;
    let value;do{value=crypto.getRandomValues(new Uint32Array(1))[0];}while(value>=limit);
    return value%sides;
}
function stored(character,path){
    if(typeof path!=='string'||!roots.includes(path.split('.')[0]))fail('Недопустимый путь характеристики');
    const value=pathValue(character,path);if(value===undefined)fail(`Stored value not found: ${path}`);return value;
}
function parameters(state,input,event){
    const p={scope_id:state.scopeId,event_id:event,actor_id:null,target_id:null,formula:'1d20',difficulty:null,difficulty_path:null,difficulty_reason:'',comparison:'gte',mode:'normal',attribute:null,attribute_rule:'none',bonus_paths:[],resolution:'roll',passive_path:null,...input};
    // Scope and event are controlled by the extension, never by model arguments.
    p.scope_id=state.scopeId;p.event_id=event;
    const allowed=['scope_id','event_id','actor_id','target_id','formula','difficulty','difficulty_path','difficulty_reason','comparison','mode','attribute','attribute_rule','bonus_paths','resolution','passive_path','check_key','reason'];
    if(Object.keys(input).some(k=>!allowed.includes(k)))fail('Неизвестный параметр проверки');
    if(typeof p.check_key!=='string'||!p.check_key.trim()||p.check_key.length>150||typeof p.reason!=='string'||!p.reason.trim()||p.reason.length>2000)fail('Нужны check_key и причина проверки');
    if(typeof p.formula!=='string'||!/^([1-9]|[1-9][0-9]|100)d([2-9]|[1-9][0-9]{1,3}|10000)$/.test(p.formula))fail('Формула: от 1 до 100 кубиков, от 2 до 10000 граней');
    for(const [key,values] of Object.entries({comparison:['gte','lte'],mode:['normal','advantage','disadvantage'],attribute_rule:['none','raw','d20'],resolution:['roll','automatic','impossible']}))if(!values.includes(p[key]))fail(`Invalid ${key}`);
    if(p.attribute!==null&&!attributes.includes(p.attribute))fail('Неизвестная характеристика');
    if(!Array.isArray(p.bonus_paths)||p.bonus_paths.length>20||p.bonus_paths.some(v=>typeof v!=='string'||v.length>200)||new Set(p.bonus_paths).size!==p.bonus_paths.length)fail('Некорректные или повторные бонусы');
    if(p.difficulty!==null&&(!integer(p.difficulty)||typeof p.difficulty_reason!=='string'||!p.difficulty_reason.trim()))fail('Нужна целая сложность и её обоснование');
    if(p.difficulty_path&&(p.difficulty!==null||!p.target_id))fail('Для difficulty_path нужен target_id; не указывай одновременно difficulty');
    if(p.mode!=='normal'&&p.formula!=='1d20')fail('Преимущество и помеха доступны для 1d20');
    if((p.attribute||p.bonus_paths.length||p.passive_path)&&!p.actor_id)fail('Для бонусов нужен actor_id');
    if(p.attribute_rule!=='none'&&!p.attribute)fail('Нужна характеристика attribute');
    if(p.resolution==='automatic'&&!p.passive_path)fail('Автоматический успех требует сохранённого пассивного навыка');
    return p;
}
function identity(p){return JSON.stringify([p.scope_id,p.event_id,p.actor_id??null,p.check_key.trim().toLowerCase()]);}
export function resolveLocalCheck(state,input,event,rng=randomBelow){
    initializeLocal(state);
    // Look up before validating changed parameters: an established outcome cannot be replaced.
    if(typeof input.check_key==='string'){
        const key=identity({...input,scope_id:state.scopeId,event_id:event});
        const previous=state.localChecks.find(r=>identity(r.parameters)===key);
        if(previous)return clone(previous);
    }
    const p=parameters(state,input,event);
    const actor=p.actor_id?state.characters.find(c=>c.owner_id===p.actor_id):null;
    const target=p.target_id?state.characters.find(c=>c.owner_id===p.target_id):null;
    if(p.actor_id&&!actor||p.target_id&&!target)fail('Персонаж не найден в текущем чате');
    let difficulty=p.difficulty,modifier=0;const evidence={};
    if(p.difficulty_path){
        difficulty=['armor_class','level',...attributes].includes(p.difficulty_path)?target[p.difficulty_path]:stored(target,p.difficulty_path);
        if(!integer(difficulty))fail('Сохранённая сложность должна быть целым числом');
        evidence.difficulty={target_id:p.target_id,path:p.difficulty_path,value:difficulty};
    }
    if(p.attribute&&p.attribute_rule!=='none'){
        const score=actor[p.attribute];if(!integer(score))fail('Некорректное значение характеристики');
        modifier=p.attribute_rule==='raw'?score:Math.floor((score-10)/2);
        evidence[p.attribute]={score,rule:p.attribute_rule,bonus:modifier};
    }
    for(const path of p.bonus_paths){const value=stored(actor,path);if(!integer(value))fail('Бонус должен быть сохранённым целым числом');modifier+=value;evidence[path]=value;}
    let rolls=[],total=null,success;
    if(p.resolution==='automatic'){
        const passive=stored(actor,p.passive_path);
        if(passive?.automatic_success!==true||!Array.isArray(passive.actions)||!passive.actions.includes(p.check_key))fail('Пассивный навык не разрешает автоматический успех этого действия');
        evidence[p.passive_path]=clone(passive);success=true;
    }else if(p.resolution==='impossible')success=false;
    else{
        const [count,sides]=p.formula.split('d').map(Number);
        rolls=Array.from({length:p.mode==='normal'?1:2},()=>Array.from({length:count},()=>rng(sides)+1));
        const sums=rolls.map(r=>r.reduce((a,b)=>a+b,0));
        total=(p.mode==='disadvantage'?Math.min(...sums):Math.max(...sums))+modifier;
        success=difficulty===null?null:p.comparison==='gte'?total>=difficulty:total<=difficulty;
    }
    const receipt={id:uuid(),resolution:p.resolution,rolls,modifier,total,difficulty,success,evidence,parameters:p,random_source:'crypto.getRandomValues'};
    state.localChecks.push(clone(receipt)); // Full ledger; UI may show only the latest 100.
    return receipt;
}
