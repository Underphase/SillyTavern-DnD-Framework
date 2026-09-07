import {t as tr,html,setLanguage} from './i18n.js';
import {escapeHtml as e,clone} from './core.js';

const labels={name:'Имя / название',level:'Уровень',experience:'Общий опыт',experience_target:'Опыт до следующего уровня',current_hp:'Здоровье сейчас',max_hp:'Максимум здоровья',temporary_hp:'Временное здоровье',armor_class:'Защита',strength:'Сила',dexterity:'Ловкость',constitution:'Телосложение',intelligence:'Интеллект',wisdom:'Мудрость',charisma:'Харизма',description:'Описание',background:'Предыстория',general_condition:'Общее состояние',personality:'Личность',goals:'Цели',race:'Раса',character_class:'Класс',skills:'Навыки',active_skills:'Активные способности',inventory:'Инвентарь',equipment:'Экипировка',spells:'Заклинания',spell_slots:'Ячейки заклинаний',traits:'Черты',relationships:'Отношения',memories:'Воспоминания',notes:'Заметки',tags:'Метки',buffs:'Усиления',debuffs:'Ослабления',current_state:'Текущее состояние',is_player:'Управляется пользователем',is_temporary:'Временный персонаж',bonus:'Бонус',cost:'Стоимость',cooldown:'Перезарядка',items:'Элементы',quantity:'Количество',passive:'Пассивный',automatic_success:'Автоматический успех',actions:'Разрешённые действия'};
export const labelFor=key=>(labels[key]?tr(labels[key]):key);
const types=()=>tr('<option value="text">Текст</option><option value="number">Число</option><option value="boolean">Да / нет</option><option value="object">Группа полей</option><option value="array">Список</option>');

export function valueEditor(value){
    const kind=Array.isArray(value)?'array':value&&typeof value==='object'?'object':typeof value==='boolean'?'boolean':typeof value==='number'?'number':value===null?'null':'text';
    if(kind==='object'||kind==='array')return html`<div class="rpg-value" data-kind="${kind}"><div class="rpg-value-rows">${Object.entries(value).map(([key,v])=>html`<div class="rpg-value-row" data-key="${e(key)}"><div class="rpg-section-heading"><strong>${e(kind==='array'?Number(key)+1:labelFor(key))}</strong><button data-action="value-remove" type="button" aria-label="Удалить поле">×</button></div>${valueEditor(v)}</div>`).join('')}</div><div class="rpg-value-add">${kind==='object'?tr('<input data-new-key placeholder="Название нового поля" aria-label="Название нового поля">'):''}<select data-new-type aria-label="Тип нового поля">${types()}</select><button type="button" data-action="value-add">＋ Добавить</button></div></div>`;
    return `<div class="rpg-value" data-kind="${kind}">${kind==='boolean'?html`<input type="checkbox" aria-label="Значение" ${value?'checked':''}>`:kind==='number'?html`<input type="number" step="any" aria-label="Значение" value="${e(value)}">`:kind==='null'?tr('<span class="rpg-muted">Не задано</span>'):html`<textarea aria-label="Значение" rows="2">${e(value)}</textarea>`}</div>`;
}
export function readValue(node){
    const kind=node.dataset.kind;
    if(kind==='object'||kind==='array'){
        const entries=[...node.querySelector(':scope > .rpg-value-rows').children].map(row=>[row.dataset.key,readValue(row.querySelector(':scope > .rpg-value'))]);
        return kind==='array'?entries.map(x=>x[1]):Object.fromEntries(entries);
    }
    if(kind==='boolean')return node.querySelector('input').checked;
    if(kind==='number'){const input=node.querySelector('input');if(input.value.trim()===''||!Number.isFinite(Number(input.value)))throw new Error(tr('Укажи корректное число'));return Number(input.value);}
    return kind==='null'?null:node.querySelector('textarea').value;
}
export function editValue(action,control){
    if(action==='value-remove'){control.closest('.rpg-value-row').remove();return;}
    const node=control.closest('.rpg-value'),data=readValue(node),type=node.querySelector(':scope > .rpg-value-add [data-new-type]').value;
    const value={text:'',number:0,boolean:false,object:{},array:[]}[type];
    if(Array.isArray(data))data.push(value);
    else{
        const key=node.querySelector(':scope > .rpg-value-add [data-new-key]').value.trim();
        if(!key||['__proto__','prototype','constructor'].includes(key)||Object.hasOwn(data,key))throw new Error(tr('Название поля должно быть непустым и уникальным'));
        data[key]=value;
    }
    node.outerHTML=valueEditor(data);
}

const groups=[['Основное',['name','level','experience','experience_target','race','character_class']],['Здоровье и характеристики',['current_hp','max_hp','temporary_hp','armor_class','general_condition','strength','dexterity','constitution','intelligence','wisdom','charisma']],['Навыки и вещи',['skills','active_skills','spells','spell_slots','inventory','equipment']],['Игровое состояние',['buffs','debuffs','current_state','notes','tags']]];
export function characterEditor(data){
    return html`<div class="rpg-sheet-editor">${groups.map(([title,keys],i)=>`<details class="rpg-editor-group" ${i===0?'open':''}><summary>${tr(title)}</summary><div class="rpg-editor-grid">${keys.filter(k=>Object.hasOwn(data,k)).map(k=>`<section class="rpg-edit-field" data-character-field="${k}"><label>${labelFor(k)}</label>${valueEditor(data[k])}</section>`).join('')}</div></details>`).join('')}<p class="rpg-muted">Опыт — накопленное значение. Порог следующего уровня задаётся по правилам мира (0 — не задан). Сохранение не повышает уровень автоматически.</p></div>`;
}
export function readCharacterEditor(container,original){
    const data=clone(original);
    for(const field of container.querySelectorAll('[data-character-field]'))data[field.dataset.characterField]=readValue(field.querySelector(':scope > .rpg-value'));
    return data;
}
