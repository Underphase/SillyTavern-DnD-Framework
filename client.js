import {parseJson} from './core.js';
import {sanitize} from './diagnostics.js';

export async function backend(settings,path,{method='GET',body,signal}={}) {
    let base;
    try { base=new URL(settings.backendUrl.trim()); }
    catch { throw new Error('RPG API needs an address such as http://127.0.0.1:8001. Enter the key in RPG API key.'); }
    if(!['http:','https:'].includes(base.protocol)||base.username||base.password||base.search||base.hash) throw new Error('RPG API address must use HTTP(S) with no credentials, query or fragment.');
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
            'Start the backend. Open its address in a browser on the same device.',
            `Add the ST page origin to backend CORS_ORIGINS: ${diagnostics.pageOrigin}. Restart the backend after editing .env.`,
            'On a phone, 127.0.0.1 and localhost refer to the phone. A PC backend needs the PC address, a network listener and firewall access.',
            ...(globalThis.location?.protocol==='https:'&&base.protocol==='http:'?['ST uses HTTPS but the backend uses HTTP. Mixed content may be blocked; use an HTTPS backend address.']:[]),
            'Browsers do not expose the exact network failure cause to JavaScript. Check CORS, connectivity and TLS; invalid keys usually return HTTP 401.'
        ]};
        throw error;
    }
    if(!response.ok) {
        const details=await response.text();
        const safeDetails=settings.backendKey?details.split(settings.backendKey).join('[REDACTED]'):details;
        const error=new Error(response.status===401?'RPG API 401: key rejected. Enter the backend API_KEY and restart the backend after changing .env.':`RPG API ${response.status}: ${safeDetails.slice(0,1200)}`);
        error.diagnostics={...diagnostics,category:'http',httpStatus:response.status,elapsedMs:Math.round(performance.now()-started)};
        try{error.receipt=JSON.parse(details)?.detail?.receipt;}catch{/* plain-text error */}
        error.status=response.status; throw error;
    }
    try {return await response.json();}
    catch {
        const error=new Error('RPG API returned non-JSON data. Use the backend address, not SillyTavern or /docs.');
        error.diagnostics={...diagnostics,category:'invalid-response',httpStatus:response.status,contentType:response.headers.get('content-type')};
        throw error;
    }
}

export async function askAI(settings,system,input,{signal,onUsage,validate=value=>value,profileRequest}={}) {
    const messages=[{role:'system',content:system},{role:'user',content:JSON.stringify(input)}];
    const started=performance.now(),requestId=globalThis.crypto.randomUUID?.()??String(Date.now());
    const diagnostics={requestId,service:'AI',stage:'configuration',mode:settings.aiMode,model:settings.aiMode==='profile'?'selected ST profile':settings.model,maxTokens:settings.maxTokens,inputCharacters:JSON.stringify(messages).length,pageOrigin:globalThis.location?.origin};
    const controller=new AbortController();let timedOut=false;
    const abort=()=>controller.abort(signal.reason);
    if(signal?.aborted)abort();else signal?.addEventListener('abort',abort,{once:true});
    const timeout=setTimeout(()=>{timedOut=true;controller.abort(new DOMException('AI request exceeded 90 seconds','TimeoutError'));},90000);
    let content,usage;
    try{
        diagnostics.stage='request';let result;
        if(settings.aiMode==='profile') {
            if(!settings.profileId)throw new Error('Select an AI connection profile in Settings.');
            let send=profileRequest;
            if(!send){const {ConnectionManagerRequestService:service}=await import('../../shared.js');send=service.sendRequest.bind(service);}
            result=await send(settings.profileId,messages,settings.maxTokens,{stream:false,signal:controller.signal,extractData:true});
            content=result.content;usage=result.usage;
        }else{
            if(!settings.aiUrl||!settings.model)throw new Error('Set the AI endpoint and model in Settings.');
            const base=new URL(settings.aiUrl.trim());
            if(!['https:','http:'].includes(base.protocol)||base.username||base.password||base.search||base.hash)throw new Error('Use an HTTP(S) AI endpoint without credentials or query parameters.');
            const url=base.href.replace(/\/$/,'');diagnostics.endpoint=url.endsWith('/chat/completions')?url:`${url}/chat/completions`;
            const response=await fetch(diagnostics.endpoint,{method:'POST',signal:controller.signal,headers:{'Content-Type':'application/json',...(settings.aiKey?{Authorization:`Bearer ${settings.aiKey}`}:{})},body:JSON.stringify({model:settings.model,messages,temperature:0.2,max_tokens:settings.maxTokens,stream:false})});
            diagnostics.httpStatus=response.status;diagnostics.contentType=response.headers.get('content-type');diagnostics.stage='response-body';
            const body=await response.text();
            if(settings.devMode){diagnostics.responseBody=body.slice(0,24000);diagnostics.responseBodyTruncated=body.length>24000;}
            if(!response.ok)throw new Error(`AI HTTP ${response.status}: ${body.slice(0,600)}`);
            diagnostics.stage='provider-json';result=JSON.parse(body);
            if(result.error)throw new Error(`AI provider error: ${JSON.stringify(result.error).slice(0,600)}`);
            content=result.choices?.[0]?.message?.content;usage=result.usage;
        }
        if(controller.signal.aborted)throw controller.signal.reason;
        diagnostics.finishReason=result.choices?.[0]?.finish_reason??result.finish_reason??null;
        diagnostics.usage=usage??null;
        if(settings.devMode&&typeof content==='string'){diagnostics.modelOutput=content.slice(0,24000);diagnostics.modelOutputTruncated=content.length>24000;}
        if(diagnostics.finishReason==='length')throw new Error('AI output was truncated. Increase Max output tokens or reduce the event batch.');
        if(typeof content!=='string')throw new Error('AI returned no text JSON. Check the model and output token budget.');
        diagnostics.outputCharacters=content.length;
        onUsage?.({requestId,ms:Math.round(performance.now()-started),usage:usage??null,inputCharacters:diagnostics.inputCharacters,outputCharacters:content.length});
        diagnostics.stage='model-json';const parsed=parseJson(content);
        diagnostics.stage='validation';return validate(parsed);
    }catch(error){
        if(signal?.aborted)throw error;
        diagnostics.elapsedMs=Math.round(performance.now()-started);
        diagnostics.category=timedOut?'timeout':diagnostics.httpStatus>=400?'http':diagnostics.stage==='model-json'?'invalid-json':diagnostics.stage==='validation'?'validation':diagnostics.stage==='provider-json'?'invalid-response':'request-failed';
        const wrapped=new Error(timedOut?'AI request timed out after 90 seconds.':sanitize(error.message??String(error),settings),{cause:error});
        wrapped.diagnostics=sanitize(diagnostics,settings);throw wrapped;
    }finally{clearTimeout(timeout);signal?.removeEventListener('abort',abort);}
}
