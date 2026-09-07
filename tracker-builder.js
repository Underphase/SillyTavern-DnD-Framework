import {t as tr,html,setLanguage} from './i18n.js';
import {escapeHtml as e,clone} from './core.js';
import {valueEditor,readValue} from './form-editor.js';
const options=(values,current)=>values.map(([v,label])=>`<option value="${v}" ${v===current?'selected':''}>${label}</option>`).join('');
export function trackerFieldsEditor(fields){return fields.map((f,i)=>html`<section class="rpg-tracker-field" data-field-index="${i}"><div class="rpg-section-heading"><strong>Показатель ${i+1}</strong><button type="button" data-action="remove-tracker-field" data-index="${i}">Удалить</button></div><div class="rpg-editor-grid"><label>Название<input data-field="label" value="${e(f.label)}"></label><label>ID для привязки<input data-field="id" value="${e(f.id)}"></label><label>Вид<select data-field="type">${options([['text',tr('Текст')],['number',tr('Число')],['meter',tr('Шкала')],['inventory',tr('Список вещей')],['coins',tr('Монеты')],['gems',tr('Самоцветы')],['boolean',tr('Да / нет')]],f.type)}</select></label><label>Откуда брать значение<select data-field="source">${options([['ai',tr('Из событий — ИИ')],['character',tr('Из персонажа')],['scene',tr('Из сцены')],['turns',tr('Счётчик ответов')],['clock',tr('Часы устройства')]],f.source)}</select></label><label data-meter-settings ${f.type!=='meter'?'hidden':''}>Максимум шкалы<input data-field="max" type="number" min="1" value="${e(f.max??100)}"></label><label data-path-settings ${!['character','scene'].includes(f.source)?'hidden':''}>Путь к данным (для персонажа/сцены)<input data-field="path" value="${e(f.path??'')}" placeholder="current_hp"></label></div><label>Пример для предпросмотра</label>${valueEditor(f.value??'')}<label>Правило обновления<textarea data-field="instruction" placeholder="Когда и как меняется этот показатель">${e(f.instruction??'')}</textarea></label></section>`).join('');}
export function readTrackerFields(root,original){return [...root.querySelectorAll('.rpg-tracker-field')].map(node=>{
    const result=clone(original[Number(node.dataset.fieldIndex)]??{});
    for(const k of ['id','label','type','source','path','instruction'])result[k]=node.querySelector(`[data-field="${k}"]`).value;
    result.max=Number(node.querySelector('[data-field="max"]').value);
    result.value=readValue(node.querySelector(':scope > .rpg-value'));
    if(['number','meter','coins','gems'].includes(result.type)){if(!Number.isFinite(Number(result.value)))throw new Error(tr('Пример числового показателя должен быть числом'));result.value=Number(result.value);}
    if(result.type==='inventory'&&!Array.isArray(result.value)&&typeof result.value==='string')result.value=result.value.split('\n').filter(Boolean);
    if(result.type==='boolean'&&typeof result.value!=='boolean'){if(!['true','false','yes','no','да','нет'].includes(String(result.value).toLowerCase()))throw new Error(tr('Пример: true / false или да / нет'));result.value=['true','yes','да'].includes(String(result.value).toLowerCase());}
    return result;
});}
export function autoTrackerHtml(name,fields){return `<h2>${e(name)}</h2><div class="grid">${fields.map(f=>`{{${f.id}}}`).join('')}</div>`;}

export const sampleForType=type=>type==='inventory'?[tr('Предмет')]:type==='boolean'?false:['number','meter','coins','gems'].includes(type)?50:tr('Текст');
export function trackerTemplate(type='meter'){
    const name={meter:tr('Шкала'),number:tr('Счётчик'),inventory:tr('Список вещей'),coins:tr('Монеты'),gems:tr('Самоцветы'),boolean:tr('Состояние'),text:tr('Заметка')}[type]??tr('Треккер');
    const fields=[{id:'value',label:name,type,max:100,value:sampleForType(type),source:'ai',instruction:''}];
    return {id:`tracker_${Date.now()}`,name,prompt:tr('Меняй значение только по подтверждённым событиям истории.'),fields,html:autoTrackerHtml(name,fields),css:''};
}
