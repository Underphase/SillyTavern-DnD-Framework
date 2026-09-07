import {normalizeCharacterData} from './character-data.js';
export const KEY = 'underphase_dnd';
export const CHARACTER_FIELDS = ['name','race','character_class','inventory','equipment','description','personality','background','goals','traits','relationships','current_state','memories','notes','tags','is_player','is_temporary','level','experience','armor_class','max_hp','current_hp','temporary_hp','strength','dexterity','constitution','intelligence','wisdom','charisma','general_condition','buffs','debuffs','active_skills','skills','spells','spell_slots'];
export const SECTIONS = {vitals:'Health and condition',progress:'Level and experience',attributes:'Attributes',skills:'Skills',inventory:'Inventory',equipment:'Equipment',spells:'Spells',effects:'Effects',biography:'Personality and history',scene:'Location, time and weather',party:'Party'};
export const clone = value => structuredClone(value);
export function uuid() {
    // randomUUID is unavailable on plain HTTP LAN origins; getRandomValues is available.
    if(crypto.randomUUID)return crypto.randomUUID();
    const bytes=crypto.getRandomValues(new Uint8Array(16));bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;
    const hex=Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
    return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}
export const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const safeObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export const pathValue = (object, path) => String(path ?? '').split('.').reduce((v,k) => ['__proto__','prototype','constructor'].includes(k) ? undefined : v?.[k], object);

export function parseJson(text) {
    const clean = String(text).trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    return JSON.parse(clean, (key,value) => {
        if (['__proto__','prototype','constructor'].includes(key)) throw new Error('Unsafe JSON key');
        return value;
    });
}

export function newState() {
    return {version:1, scopeId:uuid(), protagonist:null, characters:[],
        scene:{location:'Unknown',time:'Unknown',weather:'Unknown',party:{name:'',leader:'',members:[]}},
        summary:'', facts:{}, trackers:[], trackerValues:{}, previous:null, processed:[], pending:null,
        sections:Object.fromEntries(Object.keys(SECTIONS).map(k=>[k,true])), receipts:[], activity:[], turns:0};
}

export function snapshot(state) {
    return clone({characters:state.characters,scene:state.scene,summary:state.summary,trackerValues:state.trackerValues,turns:state.turns});
}

export function reconcileMessages(messages, previous) {
    const current = messages.filter(m=>!m.is_system && !m.extra?.tool_invocations).map(m=>({
        id:m.extra?.[KEY]?.id, role:m.is_user?'user':'assistant',name:m.name,text:String(m.mes ?? '')
    }));
    const old = new Map(previous.map(m=>[m.id,m]));
    const now = new Set(current.map(m=>m.id));
    const changes = current.flatMap(m=> {
        const prior = old.get(m.id);
        return prior?.text === m.text && prior?.name === m.name ? [] : [{kind:prior?'edited':'added',...m,...(prior?{previous:prior.text}:{})}];
    });
    for (const prior of previous) if (!now.has(prior.id)) changes.push({kind:'deleted',...prior});
    return {current,changes};
}

export function selectFacts(facts, query, budget=6000) {
    const terms = String(query).toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? [];
    const ranked = Object.values(facts).map((f,i)=>({f,score:(f.pinned?10000:0)+terms.reduce((s,t)=>s+(f.text.toLowerCase().includes(t)?10:0),0)+i/100000})).sort((a,b)=>b.score-a.score);
    let used=0;
    return ranked.filter(({f})=>{used+=f.text.length;return used<=budget;}).map(({f})=>f);
}

export function validateDelta(delta) {
    if (!safeObject(delta)) throw new Error('AI must return a JSON object');
    const allowed = ['summary','facts','forget','scene','characters','trackers'];
    if (Object.keys(delta).some(k=>!allowed.includes(k))) throw new Error('Unknown processor response fields');
    if (delta.summary !== undefined && (typeof delta.summary !== 'string' || delta.summary.length>12000)) throw new Error('Invalid summary: expected text up to 12000 characters');
    if (delta.facts !== undefined && (!Array.isArray(delta.facts) || delta.facts.length>150 || delta.facts.some(f=>!safeObject(f)||typeof f.id!=='string'||!f.id||typeof f.text!=='string'||f.text.length>4000))) throw new Error('Invalid facts: expected up to 150 objects with id and text (max 4000 characters each)');
    if (delta.forget !== undefined && (!Array.isArray(delta.forget)||delta.forget.some(id=>typeof id!=='string'))) throw new Error('Invalid forget list: expected string IDs');
    if (delta.scene !== undefined && (!safeObject(delta.scene)||Object.keys(delta.scene).some(k=>!['location','time','weather','party'].includes(k)))) throw new Error('Invalid scene: only location, time, weather and party are allowed');
    if (delta.scene) {
        for (const key of ['location','time','weather']) if (delta.scene[key]!==undefined && typeof delta.scene[key]!=='string') throw new Error('Scene location, time and weather must be text');
        const p=delta.scene.party;
        if(p!==undefined && (!safeObject(p)||Object.keys(p).some(k=>!['name','leader','members'].includes(k))||['name','leader'].some(k=>p[k]!==undefined&&typeof p[k]!=='string')||p.members!==undefined&&(!Array.isArray(p.members)||p.members.some(x=>typeof x!=='string')))) throw new Error('Invalid scene.party: expected name, leader and members');
    }
    if (delta.characters !== undefined && (!Array.isArray(delta.characters)||delta.characters.length>100)) throw new Error('Invalid characters: expected an array of up to 100 patches');
    for (const c of delta.characters ?? []) {
        if(!safeObject(c)||!safeObject(c.data)||Object.keys(c.data).some(k=>!CHARACTER_FIELDS.includes(k))) throw new Error('Unknown character field');
        if(c.owner_id!==undefined && typeof c.owner_id!=='string') throw new Error('Invalid character owner_id: expected a string');
        normalizeCharacterData(c.data);
    }
    if(delta.trackers!==undefined && !safeObject(delta.trackers)) throw new Error('Invalid trackers: expected an object keyed by tracker ID');
    return delta;
}

export function prepareChanges(delta, state) {
    const seen=new Set();
    return (delta.characters ?? []).map(c=> {
        const existing=c.owner_id?state.characters.find(x=>x.owner_id===c.owner_id):state.characters.find(x=>x.name===c.data.name);
        if(c.owner_id && !existing) throw new Error('AI referenced a character outside the current chat');
        if(!existing && !c.data.name) throw new Error('A new character needs a name');
        const identity=existing?.owner_id ?? c.data.name;
        if(seen.has(identity)) throw new Error('Duplicate character in one update');
        seen.add(identity);
        return {owner_id:existing?.owner_id ?? uuid(),data:normalizeCharacterData(c.data,existing),expected_updated_at:existing?.updated_at ?? null};
    });
}

export function applyDelta(state, delta) {
    if(delta.summary!==undefined) state.summary=delta.summary;
    if(delta.scene) state.scene={...state.scene,...delta.scene,...(delta.scene.party?{party:{...state.scene.party,...delta.scene.party}}:{})};
    for(const id of delta.forget ?? []) delete state.facts[id];
    for(const f of delta.facts ?? []) state.facts[f.id]={id:f.id,text:f.text,pinned:!!f.pinned};
    for(const [id,values] of Object.entries(delta.trackers ?? {})) {
        const definition=state.trackers.find(t=>t.id===id);
        if(!definition || !safeObject(values)) continue;
        state.trackerValues[id]??={};
        for(const field of definition.fields.filter(f=>f.source==='ai')) {
            if(Object.hasOwn(values,field.id)) state.trackerValues[id][field.id]=values[field.id];
        }
    }
}
