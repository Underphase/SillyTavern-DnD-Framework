import {escapeHtml as e,pathValue,safeObject} from './core.js';

export const TRACKER_CSS = `:root{color-scheme:dark;font-family:system-ui,sans-serif;color:#eae6ff;background:#111429}body{margin:0;padding:18px}h2,h3,p{margin:0 0 12px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:12px}.widget{padding:12px;background:#aaa0ff0c;border:1px solid #b9a3ff24;border-radius:14px;margin:8px 0}.label{font-size:12px;color:#aaa4ca;margin-bottom:8px}.value{font-size:20px;font-weight:600}progress{width:100%;height:10px;accent-color:#ad8dff}ul{padding-left:20px}.coin{color:#edcb85}.gem{color:#b6a4ff}.muted{color:#8d88aa;font-size:12px}`;
export const SAMPLE_TRACKER = {id:'moon_resonance',name:'Moon resonance',prompt:'Track lunar energy. Casting reduces charge; resting under moonlight restores it. Only change on events. gems is the moonstone count.',html:'<h2>☾ Moon resonance</h2><p class="muted">Power of the night sky</p>{{charge}}<div class="grid">{{gems}}{{oath}}</div>',css:'h2{color:#c7afff}',fields:[{id:'charge',label:'Energy',type:'meter',value:68,max:100,source:'ai'},{id:'gems',label:'Moonstones',type:'gems',value:3,source:'ai'},{id:'oath',label:'Oath',type:'text',value:'Protect the observatory',source:'ai'}]};

export function validateTracker(t) {
    if(!safeObject(t)||!/^[a-z][a-z0-9_-]{0,63}$/.test(t.id)||typeof t.name!=='string'||!t.name.trim()||t.name.length>100) throw new Error('Tracker needs a name and an ID using Latin letters, numbers, _ or -');
    if(typeof t.prompt!=='string'||t.prompt.length>6000||typeof t.html!=='string'||t.html.length>30000||typeof t.css!=='string'||t.css.length>30000) throw new Error('Check the tracker prompt, HTML and CSS');
    if(!Array.isArray(t.fields)||!t.fields.length||t.fields.length>40) throw new Error('Provide 1–40 fields');
    const ids=new Set();
    for(const f of t.fields) {
        if(!safeObject(f)||!/^[a-z][a-z0-9_]{0,63}$/.test(f.id)||ids.has(f.id)) throw new Error('Field IDs must be unique');
        ids.add(f.id);
        if(typeof f.label!=='string'||!['text','number','meter','inventory','coins','gems','boolean'].includes(f.type)||!['ai','scene','character','turns','clock'].includes(f.source)) throw new Error('Invalid field type or source');
        if(f.type==='meter' && (!Number.isFinite(f.max)||f.max<=0)) throw new Error('Meter maximum must be greater than zero');
    }
    return t;
}

export function widget(field,value) {
    let body;
    const numeric=Number(value);
    if(field.type==='meter') body=`<div class="value">${e(Number.isFinite(numeric)?numeric:0)} / ${e(field.max)}</div><progress max="${e(field.max)}" value="${Math.min(field.max,Math.max(0,numeric||0))}"></progress>`;
    else if(field.type==='inventory') body=`<ul>${(Array.isArray(value)?value:Object.entries(safeObject(value)?value:{}).map(([k,v])=>`${k}: ${typeof v==='object'?JSON.stringify(v):v}`)).map(v=>`<li>${e(typeof v==='object'?JSON.stringify(v):v)}</li>`).join('')||'<li>Empty</li>'}</ul>`;
    else body=`<div class="value ${field.type==='coins'?'coin':field.type==='gems'?'gem':''}">${field.type==='coins'?'◉ ':field.type==='gems'?'◆ ':''}${e(field.type==='boolean'?(value?'Yes':'No'):typeof value==='object'?JSON.stringify(value):value??'—')}</div>`;
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
