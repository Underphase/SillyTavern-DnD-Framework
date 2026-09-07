// Adapt common model output shapes without inferring game mechanics or dropping text.
export const OBJECT_FIELDS = ['race','character_class','inventory','equipment','personality','goals','traits','relationships','current_state','memories','notes','buffs','debuffs','active_skills','skills','spells','spell_slots'];
const INTEGER_FIELDS = ['level','experience','armor_class','max_hp','current_hp','temporary_hp','strength','dexterity','constitution','intelligence','wisdom','charisma'];
const TEXT_FIELDS = {name:100,description:Infinity,background:Infinity,general_condition:50};
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);

export const CHARACTER_DATA_RULES = `Character API format: race, character_class, inventory, equipment, personality, goals, traits, relationships, current_state, memories, notes, buffs, debuffs, active_skills, skills, spells and spell_slots must be JSON objects, not strings or arrays. For narrative text use {"description":"original text"}; for race/class names use {"name":"..."}; lists may use {"items":[...]}. Preserve existing nested keys when updating. name, description, background and general_condition are strings (name <=100, general_condition <=50 characters). tags is an array of strings. Level, experience, HP, armor_class and the six attributes are integers; experience >=0. is_player and is_temporary are booleans. Omit unknown/unchanged values; null does not clear fields.`;

export function normalizeCharacterData(data, existing = {}) {
    if(!object(data))throw new Error('Данные персонажа должны быть JSON-объектом');
    const result = {};
    for(const [field, original] of Object.entries(data)) {
        let value = original;
        if(value === null || value === undefined)continue; // Matches API PATCH semantics.
        if(OBJECT_FIELDS.includes(field)) {
            const preserved = object(existing[field]) ? existing[field] : {};
            if(typeof value === 'string') {
                const key = ['race','character_class'].includes(field) ? 'name' : 'description';
                value = {...preserved,[key]:value};
            } else if(Array.isArray(value)) {
                value = {...preserved,items:value};
            } else if(!object(value))throw new Error(`Поле персонажа «${field}»: нужен объект, текст или список, а не ${typeof value}`);
        } else if(INTEGER_FIELDS.includes(field)) {
            if(typeof value==='string' && /^-?\d+$/.test(value.trim()))value=Number(value);
            if(!Number.isSafeInteger(value)||value < -2147483648||value > 2147483647||(field==='experience'&&value<0))throw new Error(`Поле персонажа «${field}»: нужно целое число${field==='experience'?' не меньше нуля':''}`);
        } else if(['is_player','is_temporary'].includes(field)) {
            if(value==='true')value=true;
            if(value==='false')value=false;
            if(typeof value!=='boolean')throw new Error(`Поле персонажа «${field}»: нужно true или false`);
        } else if(field==='tags') {
            if(typeof value==='string')value=[value];
            if(!Array.isArray(value)||value.some(tag=>typeof tag!=='string'))throw new Error('Поле tags: нужен список строк');
        } else if(Object.hasOwn(TEXT_FIELDS,field)) {
            if(typeof value!=='string'||value.length>TEXT_FIELDS[field]||(field==='name'&&!value.length))throw new Error(`Поле персонажа «${field}»: нужен текст${Number.isFinite(TEXT_FIELDS[field])?` длиной до ${TEXT_FIELDS[field]} символов`:''}`);
        } else throw new Error(`Неизвестное поле персонажа: ${field}`);
        result[field]=value;
    }
    return result;
}

export function normalizePendingChanges(pending, characters) {
    // Keep request/character IDs: an invalid 422 batch was never committed, while
    // valid retries must retain their idempotency identity after a lost response.
    const changes=pending.changes.map(change=>({...change,data:normalizeCharacterData(change.data,characters.find(c=>c.owner_id===change.owner_id))}));
    if(JSON.stringify(changes)===JSON.stringify(pending.changes))return false;
    pending.changes=changes;
    return true;
}
