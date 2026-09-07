import {parseJson} from './core.js';

export async function backend(settings,path,{method='GET',body,signal}={}) {
    let base;
    try { base=new URL(settings.backendUrl.trim()); }
    catch { throw new Error('В поле «RPG API» нужен адрес, например http://127.0.0.1:8001. Ключ вставляется в отдельное поле «Ключ RPG API».'); }
    if(!['http:','https:'].includes(base.protocol)||base.username||base.password||base.search||base.hash) throw new Error('Адрес RPG API должен быть HTTP(S), без ключа, логина, параметров и #.');
    const url=`${base.href.replace(/\/$/,'')}${path}`;
    const started=performance.now();
    const diagnostics={service:'RPG API',method,url:url.split('?')[0],pageOrigin:globalThis.location?.origin??'unknown',keyConfigured:!!settings.backendKey?.trim()};
    let response;
    try {
        response=await fetch(url,{method,signal:signal ?? AbortSignal.timeout(30000),headers:{Accept:'application/json',...(body!==undefined?{'Content-Type':'application/json'}:{}),...(settings.backendKey?.trim()?{Authorization:`Bearer ${settings.backendKey.trim()}`}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{})});
    } catch(cause) {
        if(cause.name==='AbortError')throw cause;
        const timedOut=cause.name==='TimeoutError';
        const error=new Error(timedOut?`RPG API не ответил за 30 секунд (${base.origin}).`:`Браузер не получил ответ от RPG API (${base.origin}). Проверь адрес, доступность backend и CORS; подробности — в Dev.`);
        error.diagnostics={...diagnostics,category:timedOut?'timeout':'network',httpStatus:null,elapsedMs:Math.round(performance.now()-started),browserError:cause.name,hints:[
            'Backend должен быть запущен. Открой адрес backend в браузере на том же устройстве.',
            `Добавь origin страницы ST в CORS_ORIGINS backend: ${diagnostics.pageOrigin}. После изменения .env перезапусти backend.`,
            'На телефоне 127.0.0.1 и localhost указывают на телефон. Для backend на ПК нужен IP компьютера, сетевой интерфейс и доступ через брандмауэр.',
            ...(globalThis.location?.protocol==='https:'&&base.protocol==='http:'?['Страница ST использует HTTPS, а backend — HTTP. Браузер может блокировать смешанный контент; используй совместимый HTTPS-адрес backend.']:[]),
            'Браузер не раскрывает JavaScript точную причину сетевого отказа. Это может быть CORS, соединение, TLS или блокировка браузером; неверный ключ обычно возвращает HTTP 401.'
        ]};
        throw error;
    }
    if(!response.ok) {
        const details=await response.text();
        const safeDetails=settings.backendKey?details.split(settings.backendKey).join('[скрыто]'):details;
        const error=new Error(response.status===401?'RPG API 401: ключ не принят. Вставь значение API_KEY из .env в поле «Ключ RPG API» и перезапусти backend после изменения .env.':`RPG API ${response.status}: ${safeDetails.slice(0,1200)}`);
        error.diagnostics={...diagnostics,category:'http',httpStatus:response.status,elapsedMs:Math.round(performance.now()-started)};
        try{error.receipt=JSON.parse(details)?.detail?.receipt;}catch{/* plain-text error */}
        error.status=response.status; throw error;
    }
    try {return await response.json();}
    catch {
        const error=new Error('Адрес RPG API вернул не JSON. Проверь, что указан backend, а не адрес SillyTavern или страница /docs.');
        error.diagnostics={...diagnostics,category:'invalid-response',httpStatus:response.status,contentType:response.headers.get('content-type')};
        throw error;
    }
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
