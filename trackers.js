import {escapeHtml as e,pathValue,safeObject} from './core.js';

export const TRACKER_CSS = `:root{color-scheme:dark;font-family:system-ui,sans-serif;color:#eae6ff;background:#111429}body{margin:0;padding:18px}h2,h3,p{margin:0 0 12px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:12px}.widget{padding:12px;background:#aaa0ff0c;border:1px solid #b9a3ff24;border-radius:14px;margin:8px 0}.label{font-size:12px;color:#aaa4ca;margin-bottom:8px}.value{font-size:20px;font-weight:600}progress{width:100%;height:10px;accent-color:#ad8dff}ul{padding-left:20px}.coin{color:#edcb85}.gem{color:#b6a4ff}.muted{color:#8d88aa;font-size:12px}`;
export const SAMPLE_TRACKER = {id:'moon_resonance',name:'Лунный резонанс',prompt:'Следи за лунной энергией персонажа. Трата заклинаний уменьшает charge; отдых под луной восстанавливает. Не меняй без события. gems — количество лунных камней.',html:'<h2>☾ Лунный резонанс</h2><p class="muted">Сила ночного неба</p>{{charge}}<div class="grid">{{gems}}{{oath}}</div>',css:'h2{color:#c7afff}',fields:[{id:'charge',label:'Энергия',type:'meter',value:68,max:100,source:'ai'},{id:'gems',label:'Лунные камни',type:'gems',value:3,source:'ai'},{id:'oath',label:'Клятва',type:'text',value:'Защитить обсерваторию',source:'ai'}]};

export function validateTracker(t) {
    if(!safeObject(t)||!/^[a-z][a-z0-9_-]{0,63}$/.test(t.id)||typeof t.name!=='string'||!t.name.trim()||t.name.length>100) throw new Error('Треккеру нужны имя и ID: латиница, цифры, _ или -');
    if(typeof t.prompt!=='string'||t.prompt.length>6000||typeof t.html!=='string'||t.html.length>30000||typeof t.css!=='string'||t.css.length>30000) throw new Error('Проверь промпт, HTML и CSS треккера');
    if(!Array.isArray(t.fields)||!t.fields.length||t.fields.length>40) throw new Error('Нужно от 1 до 40 полей');
    const ids=new Set();
    for(const f of t.fields) {
        if(!safeObject(f)||!/^[a-z][a-z0-9_]{0,63}$/.test(f.id)||ids.has(f.id)) throw new Error('ID полей должны быть уникальными');
        ids.add(f.id);
        if(typeof f.label!=='string'||!['text','number','meter','inventory','coins','gems','boolean'].includes(f.type)||!['ai','scene','character','turns','clock'].includes(f.source)) throw new Error('Некорректный тип или источник поля');
        if(f.instruction!==undefined&&(typeof f.instruction!=='string'||f.instruction.length>1500))throw new Error('Правило показателя: до 1500 символов');
        if(f.type==='meter' && (!Number.isFinite(f.max)||f.max<=0)) throw new Error('Максимум шкалы должен быть больше нуля');
    }
    return t;
}

export function widget(field,value) {
    let body;
    const numeric=Number(value);
    if(field.type==='meter') body=`<div class="value">${e(Number.isFinite(numeric)?numeric:0)} / ${e(field.max)}</div><progress max="${e(field.max)}" value="${Math.min(field.max,Math.max(0,numeric||0))}"></progress>`;
    else if(field.type==='inventory') body=`<ul>${(Array.isArray(value)?value:Object.entries(safeObject(value)?value:{}).map(([k,v])=>`${k}: ${typeof v==='object'?JSON.stringify(v):v}`)).map(v=>`<li>${e(typeof v==='object'?JSON.stringify(v):v)}</li>`).join('')||'<li>Пусто</li>'}</ul>`;
    else body=`<div class="value ${field.type==='coins'?'coin':field.type==='gems'?'gem':''}">${field.type==='coins'?'◉ ':field.type==='gems'?'◆ ':''}${e(field.type==='boolean'?(value?'Да':'Нет'):typeof value==='object'?JSON.stringify(value):value??'—')}</div>`;
    return `<div class="widget"><div class="label">${e(field.label)}</div>${body}</div>`;
}

export function renderTracker(t,state,preview=false) {
    const hero=state.characters?.find(c=>c.owner_id===state.protagonist?.id) ?? state.characters?.[0];
    const fragments={};
    for(const f of t.fields) {
        let value=preview?f.value:state.trackerValues?.[t.id]?.[f.id];
        if(!preview) {
            if(f.source==='character') value=pathValue(hero,f.path);
            if(f.source==='scene') value=pathValue(state.scene,f.path);
            if(f.source==='turns') value=state.turns;
            if(f.source==='clock') value=new Date().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});
        }
        fragments[f.id]=widget(f,value ?? (preview?f.value:'—'));
    }
    // Untrusted HTML/CSS never enters the host DOM. CSP also blocks remote fetches.
    const policy="default-src 'none'; style-src 'unsafe-inline'; img-src 'none'; font-src 'none'; base-uri 'none'; form-action 'none'";
    const html=t.html.replace(/\{\{([a-z][a-z0-9_]*)\}\}/g,(_,id)=>fragments[id]??'');
    const css=t.css.replace(/<\/style/gi,'');
    return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${policy}"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${TRACKER_CSS}\n${css}</style></head><body>${html}</body></html>`;
}
