import {t as tr,html,setLanguage} from './i18n.js';
import {escapeHtml as e,safeObject} from './core.js';

const labels={bonus:'Бонус',level:'Уровень',rank:'Ранг',cost:'Стоимость',cooldown:'Перезарядка',duration:'Длительность',range:'Дальность',uses:'Использования',charges:'Заряды',max:'Максимум',current:'Сейчас',effect:'Эффект',effects:'Эффекты',requirements:'Требования',condition:'Условие',conditions:'Условия',automatic_success:'Гарантированный успех',actions:'Действия',passive:'Пассивный',type:'Тип',status:'Состояние',description:'Описание',items:'Список'};
const title=key=>(labels[key]?tr(labels[key]):null)??String(key).replace(/[_-]+/g,' ');
const text=value=>value===null||value===undefined?'—':typeof value==='boolean'?(value?tr('Да'):tr('Нет')):String(value);

function valueView(value){
    if(Array.isArray(value))return `<ul>${value.map(v=>`<li>${valueView(v)}</li>`).join('')}</ul>`;
    if(safeObject(value))return `<dl>${Object.entries(value).map(([k,v])=>`<div><dt>${e(title(k))}</dt><dd>${valueView(v)}</dd></div>`).join('')}</dl>`;
    return e(text(value));
}

export function abilityEntries(source){
    if(!source)return {intro:'',entries:[]};
    if(typeof source==='string')return {intro:source,entries:[]};
    if(Array.isArray(source))return {intro:'',entries:source.map((value,index)=>({key:`item-${index}`,value}))};
    if(!safeObject(source))return {intro:text(source),entries:[]};
    if(typeof source.name==='string')return {intro:'',entries:[{key:'named',value:source}]};
    const intro=typeof source.description==='string'?source.description:'';
    return {intro,entries:Object.entries(source).flatMap(([key,value])=>{
        if(key==='description'&&intro)return [];
        if(key==='items'&&Array.isArray(value))return value.map((item,index)=>({key:`item-${index}`,value:item}));
        return [{key,value}];
    })};
}

function abilityCard(entry,group,key){
    const data=safeObject(entry.value)?entry.value:{};
    const name=data.name??(entry.key.startsWith('item-')?(typeof entry.value==='string'?entry.value:tr('Способность')):title(entry.key));
    const description=typeof data.description==='string'?data.description:typeof entry.value==='string'&&!entry.key.startsWith('item-')?entry.value:'';
    const badges=[];
    if(data.passive===true||data.type==='passive')badges.push(tr('Пассивный'));
    for(const field of ['bonus','level','rank','cost','cooldown','uses','charges']){
        const value=data[field];
        if(value!==null&&value!==undefined&&typeof value!=='object')badges.push(`${title(field)}: ${field==='bonus'&&typeof value==='number'&&value>0?'+':''}${text(value)}`);
    }
    const omitted=new Set(['name',...(typeof data.description==='string'?['description']:[]),...['bonus','level','rank','cost','cooldown','uses','charges'].filter(k=>data[k]!==null&&typeof data[k]!=='object'),...(data.passive===true?['passive']:[]),...(data.type==='passive'?['type']:[])]);
    const extra=Object.fromEntries(Object.entries(data).filter(([k])=>!omitted.has(k)));
    const nonObject=Array.isArray(entry.value)||typeof entry.value==='number'||typeof entry.value==='boolean';
    const long=description.length>180;
    return `<article class="rpg-ability"><div class="rpg-ability-heading"><span class="rpg-ability-icon" aria-hidden="true">${group==='active'?'✧':'✦'}</span><h4>${e(name)}</h4></div>${badges.length?`<div class="rpg-ability-badges">${badges.map(b=>`<span>${e(b)}</span>`).join('')}</div>`:''}${description?`<p class="rpg-ability-description">${e(long?description.slice(0,180)+'…':description)}</p>`:''}${nonObject?`<div class="rpg-ability-value">${valueView(entry.value)}</div>`:''}${long||Object.keys(extra).length?html`<details class="rpg-ability-more" data-rpg-disclosure="${e(key)}"><summary>Подробнее</summary>${long?`<p>${e(description)}</p>`:''}${valueView(extra)}</details>`:''}</article>`;
}

export function renderAbilities(character,scope=''){
    const groups=[['skills',tr('Навыки'),'skill'],['active_skills',tr('Активные способности'),'active']].map(([field,label,type])=>({field,label,type,...abilityEntries(character[field])}));
    const count=groups.reduce((sum,g)=>sum+g.entries.length,0);
    const key=`${scope}:${character.owner_id}:abilities`;
    const body=groups.filter(g=>g.intro||g.entries.length).map(g=>`<section class="rpg-ability-group"><div class="rpg-ability-group-title">${g.label}</div>${g.intro?`<p class="rpg-ability-intro">${e(g.intro)}</p>`:''}<div class="rpg-ability-list">${g.entries.map(entry=>abilityCard(entry,g.type,`${key}:${g.field}:${entry.key}`)).join('')}</div></section>`).join('');
    return html`<details class="rpg-details rpg-abilities" data-rpg-disclosure="${e(key)}"><summary>Навыки и способности${count?` <span class="rpg-ability-count">${count}</span>`:''}</summary>${body||tr('<p class="rpg-muted rpg-ability-empty">Пока нет записанных способностей.</p>')}</details>`;
}
