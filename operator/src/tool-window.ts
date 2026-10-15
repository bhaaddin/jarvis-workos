import type {AgentMessage,ObjectValue} from './contracts.js';
import {assert} from './errors.js';

const groups:Record<string,string[]>={
  documents:['jarvis_files','jarvis_document_read','jarvis_document_create','jarvis_table_query','jarvis_observation_read','jarvis_action_result','jarvis_action_status'],
  projects:['jarvis_projects','jarvis_github','jarvis_skill_search','jarvis_observation_read'],
  web:['jarvis_web','jarvis_browser_task','jarvis_observation_read','jarvis_action_result','jarvis_action_status'],
  tasks:['jarvis_tasks','jarvis_task_save','jarvis_remind_after','jarvis_memory_remember','jarvis_action_status'],
  mail:['jarvis_mail','jarvis_send_email','jarvis_mail_attachment','jarvis_files','jarvis_document_read','jarvis_document_create','jarvis_action_result','jarvis_action_status'],
  clinic:['jarvis_sportmedical','jarvis_observation_read'],computer:['jarvis_computer'],
  code:['jarvis_run_code','jarvis_code','jarvis_code_read','jarvis_action_result','jarvis_action_status','jarvis_document_create'],
  czech:['jarvis_ares','jarvis_cnb','jarvis_czech_calc','jarvis_owner_todo'],
  transit:['jarvis_transit'],
  finance:['jarvis_finance','jarvis_observation_read','jarvis_action_result','jarvis_action_status'],
};
export const selectTools:ObjectValue={type:'function',function:{name:'jarvis_select_tools',
  description:'Load tool schemas for the job, without performing any action. documents: find/read/analyze/export files and tables; projects: current source/Git/GitHub; web: browse/search/forms; tasks: reminders/tasks/remember; mail: inbox/attachments/send; clinic: read-only Medical records; computer: actual PC inspection; code: project code read/edit/run/scan; czech: ARES/CNB/Czech math/owner checklist; transit: public-transport routing; finance: connected paper/research data. Use all when uncertain. Calculator/clock/basic memory are already available. Select relevant domains together, then use their tools.',
  parameters:{type:'object',properties:{domains:{type:'array',minItems:1,maxItems:9,uniqueItems:true,items:{enum:[...Object.keys(groups),'all']}}},required:['domains'],additionalProperties:false}}};

export class ToolWindow{
  private readonly selected=new Set(['jarvis_calculate','jarvis_clock','jarvis_memory_search','jarvis_capabilities']);
  constructor(history:AgentMessage[]){for(const message of history)for(const call of message.tool_calls??[])this.selected.add(call.function.name);}
  include(name:string):void{this.selected.add(name);}
  get medical():boolean{return this.selected.has('jarvis_projects')||this.selected.has('jarvis_sportmedical');}
  schemas(available:ObjectValue[]):ObjectValue[]{return available.filter(tool=>this.selected.has(String((tool.function as ObjectValue).name)));}
  select(input:ObjectValue,available:ObjectValue[]):ObjectValue{
    assert(Object.keys(input).every(key=>key==='domains')&&Array.isArray(input.domains)&&input.domains.length>0&&input.domains.length<=9
      &&input.domains.every(domain=>typeof domain==='string'&&(domain==='all'||Object.hasOwn(groups,domain))),'TOOL_SELECTION_INVALID','Select one or more of the advertised tool domains.');
    const permitted=new Set(available.map(tool=>String((tool.function as ObjectValue).name)));
    const added:string[]=[];
    for(const domain of input.domains as string[])for(const name of domain==='all'?[...permitted]:groups[domain]!){if(permitted.has(name)){this.selected.add(name);added.push(name);}}
    return {ok:true,availableTools:[...new Set(added)],note:'These tool schemas are now available. Continue the requested work; selecting a domain did not execute it.'};
  }
}
