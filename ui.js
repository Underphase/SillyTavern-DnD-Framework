import {t as tr,html,setLanguage} from './i18n.js';
import {characterEditor,readCharacterEditor,editValue,valueEditor} from './form-editor.js';
import {characterDefaults} from './local-store.js';
import {trackerFieldsEditor,readTrackerFields,autoTrackerHtml,trackerTemplate,sampleForType} from './tracker-builder.js';
import {StatusTracker,formatTimestamp} from './status.js';
import {errorReport} from './diagnostics.js';
import {renderAbilities} from './abilities.js';
import {escapeHtml as e,clone,SECTIONS} from './core.js';
import {SAMPLE_TRACKER,renderTracker,validateTracker} from './trackers.js';
import {listModels,filterModels} from './models.js';

const button=(action,label,extra='')=>`<button type="button" data-action="${action}" ${extra}>${label}</button>`;
const field=(name,label,value,type='text',extra='')=>`<label class="rpg-field"><span>${label}</span><input name="${name}" type="${type}" value="${e(value)}" ${extra}></label>`;
const area=(name,label,value,extra='')=>`<label class="rpg-field"><span>${label}</span><textarea name="${name}" ${extra}>${e(value)}</textarea></label>`;
const json=value=>JSON.stringify(value,null,2);
const empty=(title,text)=>`<div class="rpg-empty"><span>☾</span><h3>${title}</h3><p>${text}</p></div>`;
const details=(label,value)=>`<details class="rpg-details"><summary>${e(label)}</summary><pre>${e(typeof value==='string'?value:json(value))}</pre></details>`;

export class FrameworkUI {
    constructor(actions) {
        this.actions=actions;setLanguage(actions.settings().language);this.statusTracker=new StatusTracker();this.reportedErrors=new WeakSet();this.tab='story';this.draft=trackerTemplate();this.draftOriginal=null;
        this.models=[];this.modelSource='';this.modelRequest=null;
        this.orb=document.createElement('button');this.orb.id='rpg-moon';this.orb.type='button';this.orb.title=tr('D&D Framework — открыть / перетащить');this.orb.setAttribute('aria-label',tr('Открыть D&D Framework'));this.orb.innerHTML='<span>☾</span><i></i>';
        this.dialog=document.createElement('dialog');this.dialog.id='rpg-framework';
        document.body.append(this.orb,this.dialog);
        this.orb.addEventListener('click',()=>{if(!this.dragged)this.open();});
        setInterval(()=>this.paintStatus(),1000);
        let origin;
        this.orb.addEventListener('pointerdown',event=>{origin={x:event.clientX,y:event.clientY,left:this.orb.offsetLeft,top:this.orb.offsetTop};this.dragged=false;this.orb.setPointerCapture(event.pointerId);});
        this.orb.addEventListener('pointermove',event=>{
            if(!origin)return;
            if(Math.hypot(event.clientX-origin.x,event.clientY-origin.y)>6)this.dragged=true;
            if(this.dragged)this.position(origin.left+event.clientX-origin.x,origin.top+event.clientY-origin.y);
        });
        this.orb.addEventListener('pointerup',()=>{if(this.dragged){this.actions.settings().orb={x:this.orb.offsetLeft/innerWidth,y:this.orb.offsetTop/innerHeight};this.actions.saveSettings();}origin=null;});
        this.orb.addEventListener('pointercancel',()=>{origin=null;});
        window.addEventListener('resize',()=>this.restorePosition());this.restorePosition();
        this.dialog.addEventListener('click',event=>{if(event.target===this.dialog){const b=this.dialog.getBoundingClientRect();if(event.clientX<b.left||event.clientX>b.right||event.clientY<b.top||event.clientY>b.bottom)this.dialog.close();}});
        this.dialog.addEventListener('click',event=>{
            const control=event.target.closest('[data-action]');
            if(control)this.runAction(control).catch(error=>this.error(error));
        });
        this.dialog.addEventListener('change',event=>{
            if(event.target.name==='modelList' && event.target.value){
                this.dialog.querySelector('[name="model"]').value=event.target.value;
                this.status(tr('Модель выбрана. Нажми «Сохранить настройки».'));
            }
            if(event.target.name==='aiMode')this.updateModelPicker();
            if(event.target.name==='opacity'){this.dialog.style.setProperty('--rpg-opacity',event.target.value);}
            if(event.target.matches('[data-field="type"]')){
                const row=event.target.closest('.rpg-tracker-field');row.querySelector(':scope > .rpg-value').outerHTML=valueEditor(sampleForType(event.target.value));row.querySelector('[data-meter-settings]').hidden=event.target.value!=='meter';
            }
            if(event.target.matches('[data-field="source"]'))event.target.closest('.rpg-tracker-field').querySelector('[data-path-settings]').hidden=!['character','scene'].includes(event.target.value);
            if(event.target.closest('[data-workshop]')){try{this.readDraft();this.preview();}catch(error){this.status(error.message,true);}}
        });
        this.dialog.addEventListener('input',event=>{
            if(event.target.name==='modelSearch'||event.target.name==='model')this.updateModelPicker();
            if(['aiUrl','aiKey'].includes(event.target.name)){
                this.modelRequest?.abort();this.modelRequest=null;this.models=[];this.modelSource='';this.updateModelPicker();
            }
        });
        setInterval(()=>{
            if(!this.dialog.open||this.tab!=='story'||document.hidden)return;
            const state=this.actions.state();
            for(const frame of this.dialog.querySelectorAll('iframe[data-tracker]')){
                const tracker=state?.trackers.find(t=>t.id===frame.dataset.tracker);
                if(tracker?.fields.some(f=>f.source==='clock'))frame.srcdoc=renderTracker(tracker,state);
            }
        },30000);
    }
    resetForChat(){this.autoLayout=true;this.builderRequest='';this.characterDraft=null;this.draft=trackerTemplate();this.draftOriginal=null;this.editingId=null;this.editingSetup=false;this.tab='story';this.lastStatus=null;this.statusTracker.reset();this.paintStatus();}
    position(x,y){this.orb.style.left=`${Math.max(8,Math.min(innerWidth-64,x))}px`;this.orb.style.top=`${Math.max(8,Math.min(innerHeight-64,y))}px`;}
    restorePosition(){const p=this.actions.settings().orb??{x:0.9,y:0.78};this.position(p.x*innerWidth,p.y*innerHeight);}
    open(){if(!this.dialog.open){this.render();this.dialog.showModal();}}
    status(message,kind='success'){this.statusTracker.notify(message,kind===true?'error':kind===false?'success':kind);this.paintStatus();}
    startTask(message){const id=this.statusTracker.start(message);this.paintStatus();return id;}
    updateTask(id,message){this.statusTracker.update(id,message);this.paintStatus();}
    finishTask(id,message,kind='success'){this.statusTracker.finish(id,message,kind);this.paintStatus();}
    paintStatus(){
        const view=this.statusTracker.view(),node=this.dialog.querySelector('.rpg-status');
        if(node){node.textContent=view.message;node.dataset.kind=view.kind;}
        this.orb.dataset.status=view.kind;
        this.orb.classList.toggle('rpg-error',view.kind==='error');
        this.orb.classList.toggle('rpg-busy',this.statusTracker.tasks.size>0);
        this.dialog.classList.toggle('rpg-working',this.statusTracker.tasks.size>0);
    }
    error(error){
        if(error&&typeof error==='object'){if(this.reportedErrors.has(error))return;this.reportedErrors.add(error);}
        const report=errorReport(error,this.actions.settings());this.status(report.message,'error');this.actions.log?.('Error',report);if(this.tab==='developer')this.refresh();
    }
    async runAction(control){
        const action=control.dataset.action;
        const labels={'suggest-focus':tr('Выбор главного героя'),'generate-tracker':tr('Создание треккера'),'test-ai':tr('Проверка подключения ИИ'),'test-backend':tr('Проверка старого API'),'import-character':tr('Импорт персонажа'),'generate-character':tr('Генерация персонажа'),'load-models':tr('Загрузка моделей'),'openrouter-models':tr('Загрузка моделей'),'save-character':tr('Сохранение персонажа'),'save-memory':tr('Сохранение памяти')};
        if(!labels[action])return this.handle(action,control);
        if(control.disabled)return;control.disabled=true;
        const previous=this.statusTracker.last,task=this.startTask(labels[action]);
        try{await this.handle(action,control);this.finishTask(task,this.statusTracker.last===previous?html`${labels[action]} — готово`:this.statusTracker.last.message,this.statusTracker.last===previous?'success':this.statusTracker.last.kind);}
        catch(error){if(!this.statusTracker.tasks.has(task))return;if(error.name==='AbortError'){this.finishTask(task,tr('Запрос отменён'),'warning');return;}this.finishTask(task,error.message,'error');throw error;}finally{control.disabled=false;}
    }
    refresh(){if(this.dialog.open && !['workshop','settings','prompts'].includes(this.tab) && !this.dialog.querySelector('.rpg-character-editor:not([hidden])') && !this.dialog.contains(document.activeElement?.closest('textarea,input,select')))this.render();}
    render(){
        const openDetails=new Set([...this.dialog.querySelectorAll('details[data-rpg-disclosure][open]')].map(node=>node.dataset.rpgDisclosure));
        this.modelRequest?.abort();this.modelRequest=null;
        const s=this.actions.state(),prefs=this.actions.settings();setLanguage(prefs.language);
        this.dialog.style.setProperty('--rpg-opacity',prefs.opacity);
        const tabs={story:tr('История'),characters:tr('Персонажи'),workshop:tr('Мастерская'),memory:tr('Память'),journal:tr('Кубики'),settings:tr('Настройки'),prompts:tr('Промпты'),...(prefs.devMode?{developer:'Dev'}:{})};
        this.dialog.innerHTML=html`<div class="rpg-shell"><header class="rpg-header"><div class="rpg-brand"><span>☾</span><div><small>UNDERPHASE / D&D FRAMEWORK</small><h2>Лунная хроника</h2></div></div><div class="rpg-header-actions">${button('cancel-ai',tr('Отменить запрос'))}${button('process',tr('↻ Обновить'),tr('title="Обработать новые события"'))}${button('close','✕',tr('aria-label="Закрыть"'))}</div></header><nav class="rpg-tabs" aria-label="Разделы">${Object.entries(tabs).map(([key,label])=>button('tab',label,`data-tab="${key}" class="${this.tab===key?'active':''}"`)).join('')}</nav><main class="rpg-body">${!s?empty(tr('Открой чат'),tr('Каждая история получает собственные память, героев и треккеры.')):this.content(s,prefs)}</main><footer><span class="rpg-status" role="status">${e(this.statusTracker.view().message)}</span><span class="rpg-signature">☾ ${s?html`${s.characters.length} персонажей · ${s.turns} ответов`:tr('Новая история')}</span></footer></div>`;
        this.paintStatus();
        for(const node of this.dialog.querySelectorAll('details[data-rpg-disclosure]'))node.open=openDetails.has(node.dataset.rpgDisclosure);
        if(s && this.tab==='workshop')this.preview();
        if(s && this.tab==='settings')this.updateModelPicker();
        if(s && this.tab==='story')for(const frame of this.dialog.querySelectorAll('iframe[data-tracker]')){const t=s.trackers.find(x=>x.id===frame.dataset.tracker);frame.srcdoc=renderTracker(t,s);}
    }
    content(s,p){
        if(this.tab==='story')return this.story(s);
        if(this.tab==='characters')return this.characters(s);
        if(this.tab==='workshop')return this.workshop(s);
        if(this.tab==='memory')return this.memory(s);
        if(this.tab==='journal')return this.journal(s);
        if(this.tab==='prompts')return this.promptsView(p);
        if(this.tab==='settings')return this.settingsView(s,p);
        return html`<h3>Диагностика</h3><div class="rpg-toolbar">${button('copy-report',tr('Копировать отчёт'))}${button('download-report',tr('Скачать отчёт'))}</div><p class="rpg-muted">Ключи скрыты. Отчёт Dev может содержать фрагменты истории — проверь его перед отправкой.</p><textarea class="rpg-code" id="rpg-report-fallback" aria-label="Отчёт об ошибках" hidden readonly></textarea><p class="rpg-muted">Расход токенов показывается, если его вернул провайдер. Символы — не токены.</p>${s.activity.slice(-60).reverse().map(a=>details(`${formatTimestamp(a.at)} · ${a.title}`,a.data)).join('')||empty(tr('Журнал пуст'),tr('Здесь появятся время запросов, расход токенов и ошибки.'))} ${button('clear-log',tr('Очистить журнал'))}`;
    }
    story(s){
        const focus=s.protagonist?.name??tr('Ансамбль персонажей');
        return html`${s.setup==='pending'?html`<section class="rpg-setup-card"><h3>Перед началом истории</h3><p>Хочешь заранее задать персонажа, уровень, опыт и навыки? Эти данные будут доступны ИИ с самого начала. Выбор главного героя — отдельно.</p>${button('setup-character',tr('Настроить персонажа'),'class="rpg-primary"')} ${button('skip-setup',tr('Пропустить'))}</section>`:''}<section class="rpg-hero"><div><div class="rpg-eyebrow">В ЦЕНТРЕ ИСТОРИИ</div><h1>${e(focus)}</h1><p>${s.protagonist?tr('Фокус на герое. Сцена развивается постепенно, с сохранением ролей участников.'):tr('Никто не назначен главным героем. Фокус разделён между участниками текущей сцены.')}</p></div><span class="rpg-crescent">☾</span></section><div class="rpg-toolbar">${button('focus',tr('✦ Выбрать главного героя'))}${button('suggest-focus',tr('Предложение ИИ'))}${button('tab',tr('＋ Создать треккер'),'data-tab="workshop"')}</div>
        <div class="rpg-focus-picker" hidden>${field('focusName',tr('Имя главного героя'),s.protagonist?.name??'')}<select name="focusId" aria-label="Персонаж"><option value="custom">Имя вручную / бот</option><option value="user">Пользователь</option>${s.characters.map(c=>`<option value="${e(c.owner_id)}">${e(c.name)}</option>`).join('')}</select>${button('save-focus',tr('Выбрать'))}${button('ensemble',tr('Режим ансамбля'))}</div>
        ${s.sections.scene?`<div class="rpg-scene-grid">${[['⌖',tr('Локация'),s.scene.location],['◷',tr('Время'),s.scene.time],['☁',tr('Погода'),s.scene.weather]].map(([icon,label,value])=>`<article class="rpg-scene"><span>${icon}</span><small>${label}</small><strong>${e(value)}</strong></article>`).join('')}</div>`:''}
        ${s.summary?html`<article class="rpg-card"><div class="rpg-eyebrow">СЕЙЧАС</div><p>${e(s.summary)}</p></article>`:''}
        ${s.sections.party && s.scene.party?.name?`<article class="rpg-card"><h3>${e(s.scene.party.name)}</h3><div class="rpg-chips">${s.scene.party.members.map(n=>`<span>${s.scene.party.leader===n?'👑 ':''}${e(n)}</span>`).join('')}</div></article>`:''}
        ${s.characters.length?`<div class="rpg-character-grid">${s.characters.map(c=>this.character(c,s,true)).join('')}</div>`:empty(tr('История ещё не записана'),tr('Настрой отдельную ИИ. Персонажи появятся после обработки сообщений.'))}
        ${s.trackers.map(t=>`<section class="rpg-custom"><div class="rpg-section-heading"><h3>${e(t.name)}</h3>${button('edit-tracker',tr('Изменить'),`data-id="${e(t.id)}"`)}</div><iframe sandbox="" referrerpolicy="no-referrer" title="${e(t.name)}" data-tracker="${e(t.id)}"></iframe></section>`).join('')}`;
    }
    character(c,s,compact=false){
        const on=s.sections,hero=s.protagonist?.id===c.owner_id||s.protagonist?.name===c.name;
        const percent=Math.max(0,Math.min(100,c.max_hp>0?c.current_hp/c.max_hp*100:0));
        const previous=s.previous?.characters?.find(x=>x.owner_id===c.owner_id);
        return `<article class="rpg-card rpg-character"><div class="rpg-section-heading"><div><div class="rpg-eyebrow">${hero?tr('✦ ГЛАВНЫЙ ГЕРОЙ'):tr('ПЕРСОНАЖ')}</div><h3>${s.scene.party?.leader===c.name?'👑 ':''}${e(c.name)}</h3></div>${button('edit-character','✎',html`data-id="${e(c.owner_id)}" aria-label="Редактировать ${e(c.name)}"`)}</div>
        ${on.progress?html`<div class="rpg-chips"><span>Уровень ${e(c.level)}</span><span>${e(c.experience)} / ${c.experience_target>0?e(c.experience_target):'—'} XP</span></div>${c.experience_target>0?html`<progress class="rpg-xp" aria-label="Опыт до следующего уровня" max="${e(c.experience_target)}" value="${Math.min(c.experience_target,Math.max(0,c.experience))}"></progress><small class="rpg-muted">Осталось ${Math.max(0,c.experience_target-c.experience)} XP</small>`:tr('<small class="rpg-muted">Порог опыта можно задать в редакторе.</small>')}`:''}
        ${on.vitals?html`<div class="rpg-hp"><div><span>Здоровье</span><strong>${e(c.current_hp)} / ${e(c.max_hp)} ${c.temporary_hp?`(+${e(c.temporary_hp)})`:''}</strong></div><progress max="100" value="${percent}"></progress><small>${e(c.general_condition)} · Защита ${e(c.armor_class)}${previous && previous.current_hp!==c.current_hp?html` · было ${e(previous.current_hp)} HP`:''}</small></div>`:''}
        ${on.attributes?`<div class="rpg-attributes">${[['strength',tr('СИЛ')],['dexterity',tr('ЛОВ')],['constitution',tr('ТЕЛ')],['intelligence',tr('ИНТ')],['wisdom',tr('МДР')],['charisma',tr('ХАР')]].map(([key,label])=>`<div><small>${label}</small><strong>${e(c[key])}</strong></div>`).join('')}</div>`:''}
        ${on.skills?renderAbilities(c,s.scopeId):''}${on.inventory?details(tr('Инвентарь'),c.inventory):''}${on.equipment?details(tr('Экипировка'),c.equipment):''}${on.spells?details(tr('Заклинания и ячейки'),{spells:c.spells,slots:c.spell_slots}):''}${on.effects?details(tr('Эффекты'),{buffs:c.buffs,debuffs:c.debuffs}):''}</article>`;
    }
    characters(s){return html`<div class="rpg-section-heading"><div><h3>Персонажи</h3><p class="rpg-muted">Персонажи сохраняются в текущем чате SillyTavern.</p></div><div>${button('new-character',tr('＋ Персонаж'))} ${button('refresh-characters',tr('↻ Обновить список'))}</div></div><div class="rpg-character-editor" hidden></div><div class="rpg-character-grid">${s.characters.map(c=>this.character(c,s)).join('')}</div><details class="rpg-details"><summary>Импортировать персонажа из старого API</summary><p>Создаёт отдельную копию в этом чате.</p>${field('importId',tr('owner_id существующего персонажа'),'')}${button('import-character',tr('Импортировать копию'))}</details>`;}
    workshop(s){const t=this.draft;return html`<div class="rpg-section-heading"><div><h3>Свой треккер</h3><p class="rpg-muted">Назови показатель, выбери его вид и опиши правило обновления. Код писать не нужно.</p></div>${button('new-tracker',tr('Новый'))}</div><div class="rpg-workshop-grid"><div data-workshop><div class="rpg-toolbar">${[['meter',tr('Шкала')],['number',tr('Счётчик')],['inventory',tr('Список')],['text',tr('Заметка')]].map(([type,label])=>button('tracker-preset',label,`data-type="${type}"`)).join('')}</div>${area('builderRequest',tr('Что нужно отслеживать?'),this.builderRequest??'',tr('placeholder="Например: доверие спутника от 0 до 100, меняется после поступков"'))}${button('generate-tracker',tr('✦ Создать с ИИ'),'class="rpg-primary"')}${field('trackerName',tr('Название'),t.name)}${area('trackerPrompt',tr('Общее правило для ИИ'),t.prompt)}<div id="rpg-tracker-field-list">${trackerFieldsEditor(t.fields)}</div>${button('add-tracker-field',tr('＋ Добавить показатель'))}<label class="rpg-check"><input type="checkbox" name="autoLayout" ${this.autoLayout!==false?'checked':''}> Автоматическое оформление</label><details class="rpg-details"><summary>Дополнительно: HTML, CSS и ID</summary>${field('trackerId','ID',t.id)}${area('trackerHtml',tr('HTML · {{id}} вставляет показатель'),t.html,'class="rpg-code"')}${area('trackerCss','CSS',t.css,'class="rpg-code"')}<p class="rpg-muted">Для собственного HTML отключи автоматическое оформление.</p></details><div class="rpg-toolbar">${button('preview',tr('Обновить пример'))}${button('save-tracker',tr('Сохранить'),'class="rpg-primary"')}${button('cancel-tracker',tr('Отмена'))}</div></div><aside class="rpg-preview"><div class="rpg-eyebrow">ПРИМЕР · ВЫМЫШЛЕННЫЕ ДАННЫЕ</div><iframe sandbox="" referrerpolicy="no-referrer" title="Предпросмотр треккера" id="rpg-tracker-preview"></iframe><div class="rpg-muted" id="rpg-widget-keys"></div></aside></div>${s.trackers.length?html`<h3>Сохранённые треккеры</h3>${s.trackers.map(t=>`<div class="rpg-saved-tracker"><span>${e(t.name)}</span><div>${button('edit-tracker',tr('Изменить'),`data-id="${e(t.id)}"`)} ${button('delete-tracker',tr('Удалить'),`data-id="${e(t.id)}"`)}</div></div>`).join('')}`:''}`;}
    openCharacter(data,id=null,setup=false,revision){
        this.generationNote='';this.generationSource='story';this.editSession=Symbol();this.editingId=id;this.editingRevision=revision;this.editingSetup=setup;this.characterDraft=data;this.rawCharacter=false;this.tab='characters';this.render();this.renderCharacterEditor();
    }
    renderCharacterEditor(){
        const editor=this.dialog.querySelector('.rpg-character-editor');editor.hidden=false;
        editor.innerHTML=html`<h3>${this.editingSetup?tr('Персонаж перед началом игры'):tr('Карточка персонажа')}</h3><details class="rpg-details"><summary>✦ Генерация игровых параметров</summary><p>Выбери источник и укажи имя в форме. Результат появится в редакторе для проверки; сохранение — отдельно.</p><label class="rpg-field"><span>Источник</span><select name="generationSource"><option value="story" ${this.generationSource==='story'?'selected':''}>История и примечание</option><option value="card" ${this.generationSource==='card'?'selected':''}>Карточка выбранного бота ST</option></select></label>${area('generationNote',tr('Примечание'),this.generationNote??'')}${button('generate-character',tr('Сгенерировать параметры'),'class="rpg-primary"')}</details>${this.rawCharacter?area('characterJson',tr('JSON — дополнительный режим'),json(this.characterDraft),'class="rpg-code"'):characterEditor(this.characterDraft)}${this.editingSetup?tr('<label class="rpg-check"><input name="setupFocus" type="checkbox"> Сделать главным героем</label>'):''}<div class="rpg-toolbar">${button('save-character',tr('Сохранить персонажа'),'class="rpg-primary"')}${button('toggle-character-json',this.rawCharacter?tr('Обычная форма'):tr('JSON — дополнительно'))}${button('tab',tr('Отмена'),'data-tab="story"')}</div>`;
    }
    readCharacter(){return this.rawCharacter?this.actions.parse(this.value('characterJson')):readCharacterEditor(this.dialog.querySelector('.rpg-character-editor'),this.characterDraft);}

    memory(s){return html`<h3>Память текущего чата</h3><p class="rpg-muted">Здесь хранятся факты. Рассказчик получает сводку и подходящие факты, остальные может найти через инструмент памяти.</p>${area('summary',tr('Текущая сводка'),s.summary)}${area('facts',tr('Факты (JSON: id, text, pinned)'),json(Object.values(s.facts)),'class="rpg-code"')}${button('save-memory',tr('Сохранить память'),'class="rpg-primary"')}${s.previous?details(tr('Предыдущее состояние'),s.previous):''}${s.pending?html`<div class="rpg-card"><h3>Есть незавершённое обновление</h3><p>Изменения сохранены в чате. Повтори обработку для завершения.</p>${button('process',tr('Повторить'))}</div>`:''}`;}
    journal(s){return html`<div class="rpg-section-heading"><div><h3>Кубики и проверки</h3><p class="rpg-muted">Кубики бросает расширение. ИИ получает сохранённый результат.</p></div>${button('refresh-receipts',tr('↻ Журнал'))}</div>${s.receipts.length?s.receipts.slice().reverse().map(r=>`<article class="rpg-card"><div class="rpg-section-heading"><strong>${e(r.parameters.reason)}</strong><span class="rpg-result">${e(r.total??(r.success?tr('Успех'):tr('Невозможно')))}</span></div><p class="rpg-muted">${e(r.parameters.formula)} · ${e(r.parameters.mode)}${(r.difficulty??r.parameters.difficulty)!=null?html` · сложность ${e(r.difficulty??r.parameters.difficulty)}`:''}</p>${details(tr('Основания и результат'),r)}</article>`).join(''):empty(tr('Кубики ещё не брошены'),tr('Во время ответа ИИ может вызвать проверку и продолжить сцену после результата.'))}`;}
    settingsView(s,p){const profiles=this.actions.profiles();return html`<div class="rpg-settings-grid"><section><h3>Подключения</h3><label class="rpg-check"><input name="enabled" type="checkbox" ${p.enabled?'checked':''}> Автоматическая обработка и инструменты</label><p class="rpg-muted">Локальное хранение в чате. Backend и платный хостинг не нужны.</p><details class="rpg-details"><summary>Необязательно: импорт из старого RPG API</summary><p class="rpg-muted">Только для импорта старых персонажей. Для обычной игры подключение не нужно.</p>${field('backendUrl','RPG API',p.backendUrl,'url')}${field('backendKey',tr('Ключ RPG API'),p.backendKey,'password','autocomplete="off"')}${button('test-backend',tr('Проверить API'))}</details><h3>Отдельная ИИ</h3><label class="rpg-field"><span>Способ подключения</span><select name="aiMode"><option value="custom" ${p.aiMode==='custom'?'selected':''}>OpenAI-совместимый API</option><option value="profile" ${p.aiMode==='profile'?'selected':''}>Профиль SillyTavern</option></select></label><label class="rpg-field"><span>Профиль</span><select name="profileId"><option value="">Выбери профиль</option>${profiles.map(x=>`<option value="${e(x.id)}" ${x.id===p.profileId?'selected':''}>${e(x.name)}</option>`).join('')}</select></label>${field('aiUrl',tr('Адрес ИИ (до /v1 или /chat/completions)'),p.aiUrl,'url')}${field('aiKey',tr('Ключ ИИ'),p.aiKey,'password','autocomplete="off"')}${this.modelPicker()}${field('model',tr('Выбранная модель / ручной ввод'),p.model)}${field('maxTokens',tr('Максимум выходных токенов'),p.maxTokens,'number','min="256" max="32000"')}${field('aiTimeoutSeconds',tr('Ожидание ответа ИИ (секунды)'),p.aiTimeoutSeconds??300,'number','min="30" max="900"')}${button('test-ai',tr('Проверить ИИ'))}<p class="rpg-muted">Ключи хранятся в настройках. Если провайдер запрещает браузерные запросы, используй профиль SillyTavern.</p></section><section><h3>Внешний вид</h3><label class="rpg-field"><span>Язык / Language</span><select name="language"><option value="ru" ${p.language!=='en'?'selected':''}>Русский</option><option value="en" ${p.language==='en'?'selected':''}>English</option></select></label>${field('opacity',tr('Непрозрачность окна'),p.opacity,'range','min="0.55" max="1" step="0.05"')}<h3>Секции этого чата</h3>${Object.entries(SECTIONS).filter(([key])=>key!=='biography').map(([k,label])=>`<label class="rpg-check"><input name="section_${k}" type="checkbox" ${s.sections[k]?'checked':''}> ${tr(label)}</label>`).join('')}<h3>Контекст и диагностика</h3>${field('memoryBudget',tr('Бюджет фактов в контексте (символы)'),p.memoryBudget,'number','min="1000" max="30000"')}${field('eventBudget',tr('Пакет новых событий (символы)'),p.eventBudget,'number','min="8000" max="100000"')}<label class="rpg-check"><input name="devMode" type="checkbox" ${p.devMode?'checked':''}> Dev mode</label><p class="rpg-muted">Инструменты рассказчика: ${this.actions.toolsSupported()?tr('доступны'):tr('не доступны — включи Function calling в настройках ответа ST и выбери совместимую модель')}.</p></section></div><div class="rpg-toolbar">${button('save-settings',tr('Сохранить настройки'),'class="rpg-primary"')}${button('save-template',tr('Сделать секции и треккеры шаблоном новых чатов'))}</div>`;}
    promptsView(p){return html`<h3>Промпты расширения</h3><p>Повествование, темп и кубики передаются рассказчику. Остальные промпты использует отдельная ИИ. Технические схемы и проверка результатов остаются обязательными.</p>${[['narratorPrompt',tr('Повествование и кубики')],['scenePrompt',tr('Темп сцены и управление персонажами')],['dicePrompt',tr('Скрытые проверки и кубики')],['processorPrompt',tr('Обработчик памяти и персонажей')],['builderPrompt',tr('Создание интерфейсов')],['characterPrompt',tr('Генерация персонажа')],['focusPrompt',tr('Предложение ИИ')]].map(([key,label])=>area(key,label,p[key]??'')).join('')}<div class="rpg-toolbar">${button('save-prompts',tr('Сохранить промпты'),'class="rpg-primary"')}${button('reset-prompts',tr('Восстановить промпты'))}</div>${details(tr('Обработчик памяти и персонажей')+' · system',this.actions.effectiveProcessor?.()??'')}`;}
    modelPicker(){
        return html`<div class="rpg-model-picker"><div class="rpg-toolbar">${button('load-models',tr('↻ Загрузить модели'))}${button('openrouter-models','OpenRouter')}</div>${field('modelSearch',tr('Поиск по названию или ID'),'','search',tr('placeholder="Например: claude, gemini, deepseek, :free" autocomplete="off"'))}<label class="rpg-field"><span>Доступные модели</span><select name="modelList" size="7" aria-describedby="rpg-model-count"></select></label><p id="rpg-model-count" class="rpg-muted" role="status"></p></div>`;
    }
    modelConnection(){return `${this.value('aiUrl').trim()}\n${this.value('aiKey').trim()}`;}
    updateModelPicker(message){
        const list=this.dialog.querySelector('[name="modelList"]');if(!list)return;
        const profile=this.value('aiMode')==='profile';
        for(const name of ['modelSearch','modelList','model'])this.dialog.querySelector(`[name="${name}"]`).disabled=profile;
        this.dialog.querySelector('[data-action="load-models"]').disabled=profile||!!this.modelRequest;
        this.dialog.querySelector('[data-action="openrouter-models"]').disabled=profile;
        const sourceMatches=this.modelSource===this.modelConnection();
        const models=filterModels(sourceMatches?this.models:[],this.value('modelSearch'));
        list.replaceChildren(...models.map(model=>new Option(model.name===model.id?model.id:`${model.name} — ${model.id}`,model.id)));
        list.value=this.value('model');
        this.dialog.querySelector('#rpg-model-count').textContent=profile?tr('Модель задаётся в выбранном профиле SillyTavern.'):message??(this.modelRequest?tr('Загружаю список…'):sourceMatches?html`${models.length} из ${this.models.length} моделей${models.length?'':tr(' · ничего не найдено')}`:tr('Укажи адрес ИИ и нажми «Загрузить модели».'));
    }
    async loadModels(){
        if(this.value('aiMode')==='profile')return;
        if(!this.value('aiUrl').trim())throw new Error(tr('Укажи адрес ИИ или нажми OpenRouter'));
        this.modelRequest?.abort();
        const request=new AbortController();this.modelRequest=request;
        const source=this.modelConnection(),list=this.dialog.querySelector('[name="modelList"]');
        const timeout=setTimeout(()=>request.abort(new Error(tr('Список моделей не ответил за 20 секунд'))),20000);
        this.updateModelPicker();
        try{
            const models=await listModels(this.value('aiUrl'),this.value('aiKey'),{signal:request.signal});
            if(this.modelRequest!==request||!list.isConnected||source!==this.modelConnection())return;
            this.models=models;this.modelSource=source;
        }catch(error){
            if(this.modelRequest!==request||!list.isConnected)return;
            this.models=[];this.modelSource='';
            this.modelRequest=null;
            this.error(error);
            this.updateModelPicker(error.message==='Failed to fetch'?tr('Не удалось загрузить модели: проверь адрес, сеть и разрешение CORS у провайдера.'):error.message);
            return;
        }finally{clearTimeout(timeout);if(this.modelRequest===request)this.modelRequest=null;}
        if(list.isConnected)this.updateModelPicker();
    }
    value(name){return this.dialog.querySelector(`[name="${name}"]`)?.value??'';}
    readDraft(){
        this.builderRequest=this.value('builderRequest');this.autoLayout=this.dialog.querySelector('[name="autoLayout"]').checked;
        const fields=readTrackerFields(this.dialog,this.draft.fields),name=this.value('trackerName');
        this.draft={id:this.value('trackerId'),name,prompt:this.value('trackerPrompt'),html:this.autoLayout?autoTrackerHtml(name,fields):this.value('trackerHtml'),css:this.value('trackerCss'),fields};
        return validateTracker(this.draft);
    }

    preview(){const frame=this.dialog.querySelector('#rpg-tracker-preview');if(frame){frame.srcdoc=renderTracker(this.draft,this.actions.state(),true);this.dialog.querySelector('#rpg-widget-keys').textContent=this.draft.fields.map(f=>`{{${f.id}}}`).join(' · ');}}
    async handle(action,control){
        const s=this.actions.state();
        if(action==='cancel-ai'){this.actions.cancelAI();this.status(tr('Запрос отменён'),'warning');return;}
        if(action==='close'){this.dialog.close();return;}
        if(action==='tab'){this.tab=control.dataset.tab;this.render();return;}
        if(!s)throw new Error(tr('Сначала открой чат'));
        if(action==='value-add'||action==='value-remove'){editValue(action,control);if(this.tab==='workshop'){this.readDraft();this.preview();}return;}
        if(action==='setup-character'){this.openCharacter({...characterDefaults(),name:this.actions.initialName()},null,true);return;}
        if(action==='skip-setup'){await this.actions.skipSetup();this.render();return;}
        if(action==='toggle-character-json'){this.characterDraft=this.readCharacter();this.rawCharacter=!this.rawCharacter;this.renderCharacterEditor();return;}
        if(action==='tracker-preset'){this.draft=trackerTemplate(control.dataset.type);this.draftOriginal=null;this.autoLayout=true;this.render();return;}
        if(action==='add-tracker-field'||action==='remove-tracker-field'){
            this.readDraft();
            if(action==='remove-tracker-field'&&this.draft.fields.length===1)throw new Error(tr('Оставь хотя бы один показатель'));
            if(action==='remove-tracker-field')this.draft.fields.splice(Number(control.dataset.index),1);
            else{let n=1;while(this.draft.fields.some(f=>f.id===`field_${n}`))n++;this.draft.fields.push({id:`field_${n}`,label:tr('Новый показатель'),type:'meter',max:100,value:50,source:'ai',instruction:''});}
            this.render();return;
        }
        if(action==='load-models'){await this.loadModels();return;}
        if(action==='openrouter-models'){
            this.dialog.querySelector('[name="aiUrl"]').value='https://openrouter.ai/api/v1';
            this.dialog.querySelector('[name="modelSearch"]').value='';
            await this.loadModels();return;
        }
        if(action==='focus'){this.dialog.querySelector('.rpg-focus-picker').hidden=false;return;}
        if(action==='save-focus'){
            const id=this.value('focusId'),c=s.characters.find(c=>c.owner_id===id);
            const name=c?.name||(id==='user'?this.actions.userName():this.value('focusName').trim());
            if(!name)throw new Error(tr('Укажи имя главного героя'));
            s.protagonist={id:c?.owner_id??id,name};await this.actions.save();this.render();return;
        }
        if(action==='ensemble'){s.protagonist=null;await this.actions.save();this.render();return;}
        if(action==='suggest-focus'){
            this.status(tr('ИИ выбирает кандидата…'));const result=await this.actions.suggestFocus();
            if(s!==this.actions.state())return;
            this.dialog.querySelector('.rpg-focus-picker').hidden=false;this.dialog.querySelector('[name="focusName"]').value=result.name;
            this.dialog.querySelector('[name="focusId"]').value=s.characters.find(c=>c.name===result.name)?.owner_id??'custom';
            this.status(html`Предложение: ${result.name}. ${result.reason??''} Нажми «Выбрать» для подтверждения.`,'warning');return;
        }
        if(action==='new-tracker'){this.autoLayout=true;this.draft=trackerTemplate();this.draft.id=`tracker_${Date.now()}`;this.draftOriginal=null;this.tab='workshop';this.render();return;}
        if(action==='edit-tracker'){this.autoLayout=false;this.draft=clone(s.trackers.find(t=>t.id===control.dataset.id));this.draftOriginal=this.draft.id;this.tab='workshop';this.render();return;}
        if(action==='preview'){this.readDraft();this.preview();this.status(tr('Пример обновлён'));return;}
        if(action==='generate-tracker'){
            const request=this.value('builderRequest'),originalDraft=this.draft;if(!request.trim())throw new Error(tr('Опиши нужную механику'));this.status(tr('Создаю интерфейс…'));
            const draft=validateTracker(await this.actions.buildTracker(request));if(s!==this.actions.state()||this.tab!=='workshop'||originalDraft!==this.draft||this.value('builderRequest')!==request)return;
            this.draft=draft;this.autoLayout=false;this.draftOriginal=null;this.render();this.status(tr('Проверь пример и правила. Сохранение — только по кнопке.'),'warning');return;
        }
        if(action==='save-tracker'){
            const draft=this.readDraft();if(s.trackers.some(t=>t.id===draft.id&&t.id!==this.draftOriginal))throw new Error(tr('Этот ID уже занят'));
            const index=s.trackers.findIndex(t=>t.id===this.draftOriginal);if(index>=0)s.trackers[index]=clone(draft);else s.trackers.push(clone(draft));
            if(this.draftOriginal&&this.draftOriginal!==draft.id){s.trackerValues[draft.id]=s.trackerValues[this.draftOriginal]??{};delete s.trackerValues[this.draftOriginal];}
            this.draftOriginal=draft.id;await this.actions.save();this.status(tr('Треккер сохранён. Примерные значения не записываются в историю.'));return;
        }
        if(action==='cancel-tracker'){this.draft=trackerTemplate();this.draftOriginal=null;this.tab='story';this.render();return;}
        if(action==='delete-tracker'){s.trackers=s.trackers.filter(t=>t.id!==control.dataset.id);delete s.trackerValues[control.dataset.id];await this.actions.save();this.render();return;}
        if(action==='new-character'||action==='edit-character'){
            const c=s.characters.find(c=>c.owner_id===control.dataset.id);
            const data=c?{...characterDefaults(),experience_target:0,...Object.fromEntries(Object.entries(c).filter(([k])=>!['id','owner_id','scope_id','created_at','updated_at'].includes(k)))}:{...characterDefaults(),name:tr('Новый персонаж')};
            this.openCharacter(data,c?.owner_id??null,false,c?.updated_at);return;
        }
        if(action==='generate-character'){
            const data=this.readCharacter(),session=this.editSession;
            this.generationNote=this.value('generationNote');this.generationSource=this.value('generationSource');
            const focus=!!this.dialog.querySelector('[name="setupFocus"]')?.checked;
            const draft=await this.actions.generateCharacter({data,note:this.generationNote,source:this.generationSource,isNew:!this.editingId});
            if(s!==this.actions.state()||session!==this.editSession||this.tab!=='characters')return;
            if(JSON.stringify(this.readCharacter())!==JSON.stringify(data))throw new Error(tr('Форма изменилась во время генерации. Твои правки сохранены в форме; повтори запрос при необходимости.'));
            this.characterDraft=draft;this.rawCharacter=false;this.renderCharacterEditor();
            const checkbox=this.dialog.querySelector('[name="setupFocus"]');if(checkbox)checkbox.checked=focus;
            this.status(tr('Проверь параметры и нажми «Сохранить персонажа».'),'warning');return;
        }
        if(action==='save-character'){
            const data=this.readCharacter();
            if(this.editingSetup)await this.actions.finishSetup(data,!!this.dialog.querySelector('[name="setupFocus"]')?.checked);
            else await this.actions.saveCharacter(this.editingId,data,this.editingRevision);
            this.editingSetup=false;this.status(tr('Персонаж сохранён'));this.render();return;
        }
        if(action==='import-character'){await this.actions.importCharacter(this.value('importId'));this.render();return;}
        if(action==='save-memory'){await this.actions.saveMemory(this.value('summary'),this.actions.parse(this.value('facts')));this.status(tr('Память сохранена'));return;}
        if(action==='save-settings'||action==='test-ai'||action==='test-backend'){
            const p=this.actions.settings();for(const key of ['backendUrl','backendKey','aiMode','profileId','aiUrl','aiKey','model','language'])p[key]=this.value(key);
            for(const [key,min,max] of [['aiTimeoutSeconds',30,900],['opacity',0.55,1],['maxTokens',256,32000],['memoryBudget',1000,30000],['eventBudget',8000,100000]])p[key]=Math.max(min,Math.min(max,Number(this.value(key))||min));
            for(const key of ['enabled','devMode'])p[key]=this.dialog.querySelector(`[name="${key}"]`).checked;
            for(const key of Object.keys(SECTIONS).filter(key=>key!=='biography'))s.sections[key]=this.dialog.querySelector(`[name="section_${key}"]`).checked;
            setLanguage(p.language);this.actions.saveSettings();await this.actions.save();
            if(action==='test-ai')await this.actions.testAI();if(action==='test-backend')await this.actions.testBackend();
            if(s!==this.actions.state())return;
            this.status(action==='save-settings'?tr('Настройки сохранены'):tr('Соединение работает'));if(action==='save-settings')this.render();return;
        }
        if(action==='save-prompts'){for(const key of ['narratorPrompt','scenePrompt','dicePrompt','processorPrompt','builderPrompt','characterPrompt','focusPrompt'])this.actions.settings()[key]=this.value(key);this.actions.saveSettings();this.status(tr('Промпты сохранены'));return;}
        if(action==='reset-prompts'){this.actions.resetPrompts();this.render();return;}
        if(action==='save-template'){this.actions.settings().template={sections:clone(s.sections),trackers:clone(s.trackers)};this.actions.saveSettings();this.status(tr('Шаблон сохранён для новых чатов'));return;}
        if(action==='copy-report'||action==='download-report'){
            const text=json(this.actions.supportReport());
            if(action==='download-report'){
                const url=URL.createObjectURL(new Blob([text],{type:'application/json'}));
                const a=document.createElement('a');a.href=url;a.download='dnd-framework-report.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
                this.status(tr('Отчёт скачан'));return;
            }
            try{await navigator.clipboard.writeText(text);this.status(tr('Отчёт скопирован'));}
            catch{const field=this.dialog.querySelector('#rpg-report-fallback');field.hidden=false;field.value=text;field.focus();field.select();this.status(tr('Буфер обмена недоступен. Выдели и скопируй отчёт ниже.'),'warning');}
            return;
        }
        if(action==='clear-log'){s.activity=[];await this.actions.save();this.render();return;}
        if(action==='process')await this.actions.process();
        if(action==='refresh-characters')await this.actions.refreshCharacters();
        if(action==='refresh-receipts')await this.actions.refreshReceipts();
        this.refresh();
    }
}
