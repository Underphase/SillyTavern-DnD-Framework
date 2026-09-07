import {CHARACTER_DATA_RULES} from './character-data.js';

export const PROCESSOR_EXAMPLES=[
    {event:'Mira is an established participant and their climbing skill is explicitly described as a +2 bonus. No new arrival or action occurs.',delta:{characters:[{data:{name:'Mira',skills:{climb:{bonus:2}}}}]}},
    {event:'Existing character ID demo-1 has 9 HP and takes 2 narrated damage. They are explicitly appointed party leader. Other party fields stay unchanged.',delta:{characters:[{owner_id:'demo-1',data:{current_hp:7}}],scene:{party:{leader:'Mira'}}}},
    {event:'demo-1 has skills {"sight":{"bonus":1},"climb":{"bonus":2}}. Only the sight bonus explicitly increases to 3. Return the complete skills object to keep climb.',delta:{characters:[{owner_id:'demo-1',data:{skills:{sight:{bonus:3},climb:{bonus:2}}}}]}},
    {event:'Only a plan to travel is discussed. Nothing new needs recording; existing facts already cover the plan.',delta:{}}
];

export function processorGuide(prompt){
    return `${prompt}\n${CHARACTER_DATA_RULES}\nAll character data is stored locally. ST owns biographies: do not duplicate personality, background, goals, relationships or memories into character fields. Do not emit is_player or is_temporary. Focus on gameplay stats, skills, inventory and effects; preserve legacy stored fields. Return only changed fields; scene.party can be a partial object. Preserve the story language. manualSetup contains user-confirmed starting values: never overwrite them with default level 1 or default stats merely because the story omits numbers. Change them only on established events. Tracker field instructions describe data updates only. Dice receipts are out-of-character adjudication, never character speech or memories about dice.\nFormatting examples only: fictional names, IDs and values below are NOT story facts. Use real IDs from characterIndex for existing characters; omit owner_id for new characters. Do not copy example data. Return one delta object, not an event/delta wrapper.\n${PROCESSOR_EXAMPLES.map(x=>`Example event: ${x.event}\nOutput: ${JSON.stringify(x.delta)}`).join('\n')}`;
}
