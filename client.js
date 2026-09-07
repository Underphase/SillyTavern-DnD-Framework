import {parseJson} from './core.js';

export async function backend(settings,path,{method='GET',body,signal}={}) {
    const base=new URL(settings.backendUrl);
    if(!['http:','https:'].includes(base.protocol)) throw new Error('Адрес API должен начинаться с http:// или https://');
    const response=await fetch(`${base.href.replace(/\/$/,'')}${path}`,{method,signal:signal ?? AbortSignal.timeout(30000),headers:{'Content-Type':'application/json',...(settings.backendKey?{Authorization:`Bearer ${settings.backendKey}`}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{})});
    if(!response.ok) {
        const details=await response.text();
        const error=new Error(`RPG API ${response.status}: ${details.slice(0,1200)}`);
        try{error.receipt=JSON.parse(details)?.detail?.receipt;}catch{/* plain-text error */}
        error.status=response.status; throw error;
    }
    return response.json();
}

export async function askAI(settings,system,input,{signal,onUsage}={}) {
    const messages=[{role:'system',content:system},{role:'user',content:JSON.stringify(input)}];
    const started=performance.now();
    let content,usage;
    if(settings.aiMode==='profile') {
        if(!settings.profileId) throw new Error('Выбери профиль подключения для отдельной ИИ');
        const {ConnectionManagerRequestService}=await import('../../shared.js');
        const result=await ConnectionManagerRequestService.sendRequest(settings.profileId,messages,settings.maxTokens,{stream:false,signal,extractData:true});
        content=result.content;usage=result.usage;
    } else {
        if(!settings.aiUrl||!settings.model) throw new Error('Укажи адрес и модель отдельной ИИ в настройках');
        const url=settings.aiUrl.replace(/\/$/,'');
        const response=await fetch(url.endsWith('/chat/completions')?url:`${url}/chat/completions`,{
            method:'POST',signal:signal ?? AbortSignal.timeout(90000),headers:{'Content-Type':'application/json',...(settings.aiKey?{Authorization:`Bearer ${settings.aiKey}`}:{})},
            body:JSON.stringify({model:settings.model,messages,temperature:0.2,max_tokens:settings.maxTokens,stream:false})});
        if(!response.ok) throw new Error(`ИИ ${response.status}: ${(await response.text()).slice(0,600)}`);
        const result=await response.json(); content=result.choices?.[0]?.message?.content; usage=result.usage;
        if(result.choices?.[0]?.finish_reason==='length') throw new Error('Ответ ИИ обрезан: увеличь лимит выходных токенов');
    }
    if(typeof content!=='string') throw new Error('ИИ не вернула текстовый JSON');
    onUsage?.({ms:Math.round(performance.now()-started),usage:usage??null,inputCharacters:JSON.stringify(messages).length,outputCharacters:content.length});
    return parseJson(content);
}
