import {CHARACTER_DATA_RULES} from './character-data.js';

export const PROCESSOR_EXAMPLES=[
    {event:'A new character is described as Mira, wearing a grey cloak and having a cautious personality. No arrival or action occurs.',delta:{characters:[{data:{name:'Mira',description:'Wears a grey cloak.',personality:{description:'Cautious.'}}}]}},
    {event:'Existing character ID demo-1 has 9 HP and takes 2 narrated damage. They are explicitly appointed party leader. Other party fields stay unchanged.',delta:{characters:[{owner_id:'demo-1',data:{current_hp:7}}],scene:{party:{leader:'Mira'}}}},
    {event:'demo-1 has skills {"sight":{"bonus":1},"climb":{"bonus":2}}. Only the sight bonus explicitly increases to 3. Return the complete skills object to keep climb.',delta:{characters:[{owner_id:'demo-1',data:{skills:{sight:{bonus:3},climb:{bonus:2}}}}]}},
    {event:'Only a plan to travel is discussed. Nothing new needs recording; existing facts already cover the plan.',delta:{}}
];

export function processorGuide(prompt){
    return `${prompt}\n${CHARACTER_DATA_RULES}\nAll character data is stored locally. Return only changed fields; scene.party can be a partial object. Preserve the story language.\nFormatting examples only: fictional names, IDs and values below are NOT story facts. Use real IDs from characterIndex for existing characters; omit owner_id for new characters. Do not copy example data. Return one delta object, not an event/delta wrapper.\n${PROCESSOR_EXAMPLES.map(x=>`Example event: ${x.event}\nOutput: ${JSON.stringify(x.delta)}`).join('\n')}`;
}
