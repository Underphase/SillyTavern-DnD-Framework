import {timestampFields} from './status.js';
export const VERSION='0.3.0';

export function sanitize(value,settings={}){
    const secrets=[settings.aiKey,settings.backendKey].filter(v=>typeof v==='string'&&v.length);
    const clean=text=>{
        let result=String(text);
        for(const key of secrets)result=result.split(key).join('[REDACTED]');
        return result.replace(/Bearer\s+[^\s"',}]+/gi,'Bearer [REDACTED]').replace(/sk-[\w-]+/g,'[REDACTED]')
            .replace(/([?&](?:key|api_key|token|access_token)=)[^&#\s"']*/gi,'$1[REDACTED]');
    };
    const seen=new WeakSet();
    const visit=(v,depth=0)=>{
        if(typeof v==='string')return clean(v);
        if(!v||typeof v!=='object')return v;
        if(depth>15||seen.has(v))return '[omitted]';seen.add(v);
        if(Array.isArray(v))return v.map(x=>visit(x,depth+1));
        return Object.fromEntries(Object.entries(v).map(([k,x])=>[k,/^(authorization|api[_-]?key|aiKey|backendKey|password|secret|access[_-]?token)$/i.test(k)?'[REDACTED]':visit(x,depth+1)]));
    };
    return visit(value);
}

export function errorReport(error,settings={}){
    const cause=(e,depth=0)=>e&&depth<5?{name:e.name,message:e.message,stack:e.stack,cause:cause(e.cause,depth+1)}:null;
    return sanitize({...timestampFields(),version:VERSION,name:error?.name??'Error',message:error?.message??String(error),stack:error?.stack??null,cause:cause(error?.cause),diagnostics:error?.diagnostics??null},settings);
}

export function supportReport(state,settings,toolsSupported,currentStatus=null){
    return sanitize({version:VERSION,...timestampFields(undefined,'exportedAt'),environment:{timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone,pageOrigin:globalThis.location?.origin,userAgent:globalThis.navigator?.userAgent,toolsSupported},configuration:{aiMode:settings.aiMode,model:settings.aiMode==='profile'?'selected ST profile':settings.model,maxTokens:settings.maxTokens,eventBudget:settings.eventBudget,memoryBudget:settings.memoryBudget,devMode:settings.devMode},currentStatus,state:{storage:state.storage,characters:state.characters.length,processedMessages:state.processed.length,pending:state.pending?{id:state.pending.id,changes:state.pending.changes.length}:null},activity:state.activity.map(a=>({...a,...timestampFields(a.at),data:a.data?.at?{...a.data,...timestampFields(a.data.atUtc??a.data.at)}:a.data}))},settings);
}
