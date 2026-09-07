import {english} from './locales.js';
let language='ru';
export function setLanguage(value){language=value==='en'?'en':'ru';}
// Only static source strings pass through this function. Never translate story or user data.
const escape=value=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const pattern=new RegExp('(?<![А-Яа-яЁё])('+Object.keys(english).sort((a,b)=>b.length-a.length).map(escape).join('|')+')(?![А-Яа-яЁё])','gu');
export function t(value){return language==='en'?String(value).replace(pattern,key=>english[key]):value;}
export function html(parts,...values){return parts.reduce((out,part,i)=>out+t(part)+(i<values.length?values[i]:''),'');}
