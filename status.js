export class StatusTracker {
    constructor(now=()=>Date.now()){this.now=now;this.reset();}
    reset(){this.tasks=new Map();this.last={message:'Готово',kind:'idle'};}
    start(message){const id=Symbol();this.tasks.set(id,{message,started:this.now(),kind:'working'});return id;}
    update(id,message){const task=this.tasks.get(id);if(task)task.message=message;}
    notify(message,kind='success'){this.last={message,kind};}
    finish(id,message,kind='success'){
        if(!this.tasks.has(id))return;
        this.tasks.delete(id);this.notify(message,kind);
    }
    view(){
        const task=[...this.tasks.values()].at(-1);
        if(!task)return this.last;
        const elapsed=Math.max(0,Math.floor((this.now()-task.started)/1000));
        return {...task,message:`${task.message} · ${elapsed} с${elapsed>=30?' · ожидание продолжается':''}`,elapsed};
    }
}

export function formatTimestamp(value=new Date()){
    // Old logs sometimes have only a local clock time. Do not invent a date or timezone.
    if(typeof value==='string'&&!/^\d{4}-\d{2}-\d{2}T/.test(value))return value;
    const date=new Date(value);if(Number.isNaN(date.getTime()))return String(value);
    const pad=n=>String(n).padStart(2,'0'),offset=-date.getTimezoneOffset();
    return `${pad(date.getDate())}.${pad(date.getMonth()+1)}.${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())} UTC${offset>=0?'+':'-'}${pad(Math.floor(Math.abs(offset)/60))}:${pad(Math.abs(offset)%60)}`;
}
export function timestampFields(value=new Date().toISOString(),key='at'){
    return {[key]:formatTimestamp(value),...(/^\d{4}-\d{2}-\d{2}T/.test(value)?{[`${key}Utc`]:value}:{})};
}
