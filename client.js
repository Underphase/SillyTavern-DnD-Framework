import {parseJson} from './core.js';
import {sanitize} from './diagnostics.js';

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
        const error=new Error(timedOut?`RPG API timed out after 30 seconds (${base.origin}).`:`The browser received no response from RPG API (${base.origin}). Check the endpoint, network and CORS; see Dev for details.`);
        error.diagnostics={...diagnostics,category:timedOut?'timeout':'network',httpStatus:null,elapsedMs:Math.round(performance.now()-started),browserError:cause.name,hints:[
            'Backend должен быть запущен. Открой адрес backend в браузере на том же устройстве.',
            `Add the ST page origin to backend CORS_ORIGINS: ${diagnostics.pageOrigin}. Restart the backend after editing .env.`,
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

const activeRequests=new Set();
export function cancelAIRequests(){for(const controller of activeRequests)controller.abort(new DOMException('Request cancelled','AbortError'));}
export function aiTimeoutSeconds(settings){return Math.max(30,Math.min(900,Number(settings.aiTimeoutSeconds)||300));}

export function abortable(promise,signal){
    return new Promise((resolve,reject)=>{
        const abort=()=>reject(signal.reason??new DOMException('Cancelled','AbortError'));
        if(signal.aborted)abort();else signal.addEventListener('abort',abort,{once:true});
        Promise.resolve(promise).then(resolve,reject).finally(()=>signal.removeEventListener('abort',abort));
    });
}

export async function askAI(settings,system,input,{signal,onUsage,onStage,validate=value=>value,profileRequest}={}) {
    const messages=[{role:'system',content:system},{role:'user',content:JSON.stringify(input)}];
    const started=performance.now(),requestId=globalThis.crypto.randomUUID?.()??String(Date.now());
    const diagnostics={requestId,service:'AI',stage:'configuration',mode:settings.aiMode,model:settings.aiMode==='profile'?'selected ST profile':settings.model,maxTokens:settings.maxTokens,inputCharacters:JSON.stringify(messages).length,pageOrigin:globalThis.location?.origin};
    const stage=value=>{diagnostics.stage=value;onStage?.(value);};
    const controller=new AbortController();let timedOut=false;activeRequests.add(controller);
    const timeoutSeconds=aiTimeoutSeconds(settings);diagnostics.timeoutSeconds=timeoutSeconds;
    const abort=()=>controller.abort(signal.reason);
    if(signal?.aborted)abort();else signal?.addEventListener('abort',abort,{once:true});
    const timeout=setTimeout(()=>{timedOut=true;controller.abort(new DOMException(`AI request exceeded ${timeoutSeconds} seconds`,'TimeoutError'));},timeoutSeconds*1000);
    let content,usage;
    try{
        stage('request');let result;
        if(settings.aiMode==='profile') {
            if(!settings.profileId)throw new Error('Выбери профиль подключения ИИ в настройках.');
            let send=profileRequest;
            if(!send){const {ConnectionManagerRequestService:service}=await import('../../shared.js');send=service.sendRequest.bind(service);}
            result=await abortable(send(settings.profileId,messages,settings.maxTokens,{stream:false,signal:controller.signal,extractData:true}),controller.signal);
            content=result.content;usage=result.usage;
        }else{
            if(!settings.aiUrl||!settings.model)throw new Error('Укажи адрес ИИ и модель в настройках.');
            const base=new URL(settings.aiUrl.trim());
            if(!['https:','http:'].includes(base.protocol)||base.username||base.password||base.search||base.hash)throw new Error('Адрес ИИ должен быть HTTP(S), без логина, пароля и параметров запроса.');
            const url=base.href.replace(/\/$/,'');diagnostics.endpoint=url.endsWith('/chat/completions')?url:`${url}/chat/completions`;
            const response=await fetch(diagnostics.endpoint,{method:'POST',signal:controller.signal,headers:{'Content-Type':'application/json',...(settings.aiKey?{Authorization:`Bearer ${settings.aiKey}`}:{})},body:JSON.stringify({model:settings.model,messages,temperature:0.2,max_tokens:settings.maxTokens,stream:false})});
            diagnostics.httpStatus=response.status;diagnostics.contentType=response.headers.get('content-type');stage('response-body');
            const body=await response.text();
            if(settings.devMode){diagnostics.responseBody=body.slice(0,24000);diagnostics.responseBodyTruncated=body.length>24000;}
            if(!response.ok)throw new Error(`AI HTTP ${response.status}: ${body.slice(0,600)}`);
            stage('provider-json');result=JSON.parse(body);
            if(result.error)throw new Error(`Ошибка провайдера ИИ: ${JSON.stringify(result.error).slice(0,600)}`);
            content=result.choices?.[0]?.message?.content;usage=result.usage;
        }
        if(controller.signal.aborted)throw controller.signal.reason;
        diagnostics.finishReason=result.choices?.[0]?.finish_reason??result.finish_reason??null;
        diagnostics.usage=usage??null;
        if(settings.devMode&&typeof content==='string'){diagnostics.modelOutput=content.slice(0,24000);diagnostics.modelOutputTruncated=content.length>24000;}
        if(diagnostics.finishReason==='length')throw new Error('Ответ ИИ обрезан: увеличь лимит выходных токенов');
        if(typeof content!=='string')throw new Error('ИИ не вернула текстовый JSON. Проверь модель и лимит выходных токенов.');
        diagnostics.outputCharacters=content.length;
        onUsage?.({requestId,ms:Math.round(performance.now()-started),usage:usage??null,inputCharacters:diagnostics.inputCharacters,outputCharacters:content.length});
        stage('model-json');const parsed=parseJson(content);
        stage('validation');return validate(parsed);
    }catch(error){
        if(signal?.aborted||(controller.signal.aborted&&!timedOut))throw controller.signal.reason??error;
        diagnostics.elapsedMs=Math.round(performance.now()-started);
        diagnostics.category=timedOut?'timeout':diagnostics.httpStatus>=400?'http':diagnostics.stage==='model-json'?'invalid-json':diagnostics.stage==='validation'?'validation':diagnostics.stage==='provider-json'?'invalid-response':'request-failed';
        const wrapped=new Error(timedOut?`AI did not respond within ${timeoutSeconds} seconds.`:sanitize(error.message??String(error),settings),{cause:error});
        wrapped.diagnostics=sanitize(diagnostics,settings);throw wrapped;
    }finally{activeRequests.delete(controller);clearTimeout(timeout);signal?.removeEventListener('abort',abort);}
}
