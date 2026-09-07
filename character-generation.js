import {normalizeCharacterData} from './character-data.js';
export const BIOGRAPHY_FIELDS=['description','background','personality','goals','traits','relationships','memories','is_player','is_temporary'];
export function gameplayData(data){return Object.fromEntries(Object.entries(data).filter(([key])=>!BIOGRAPHY_FIELDS.includes(key)&&!['id','owner_id','scope_id','created_at','updated_at'].includes(key)));}
const record=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
function mergeProposal(existing,patch){
    const result={...existing};
    for(const [key,value] of Object.entries(patch))Object.defineProperty(result,key,{value:record(value)?mergeProposal(record(existing?.[key])?existing[key]:{},value):value,enumerable:true,writable:true,configurable:true});
    return result;
}
export function characterProposal(result,original){
    if(!result||typeof result.data!=='object'||Array.isArray(result.data)||!result.data)throw new Error('Expected a character proposal: {data: {...}}');
    const patch=normalizeCharacterData(gameplayData(result.data),original);
    if(!Object.keys(patch).length)throw new Error('The model returned no gameplay fields');
    return mergeProposal(structuredClone(original),patch);
}
export function characterSource(context,state,source){
    if(source==='card'){
        const card=context.characters?.[context.characterId];
        if(!card)throw new Error('No single SillyTavern character is selected. Use story and note instead.');
        const data=card.data??card;
        return {name:card.name??data.name,description:(data.description??'').slice(0,16000),personality:(data.personality??'').slice(0,4000),scenario:(data.scenario??'').slice(0,4000)};
    }
    return {summary:state.summary,recent:context.chat.slice(-10).map(m=>({name:m.name,text:String(m.mes??'').slice(0,3000)}))};
}
