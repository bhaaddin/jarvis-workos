import {spawn} from 'node:child_process';
import {OperatorError} from './errors.js';

export async function runProcess(executable:string,args:string[],options:{input?:string;signal:AbortSignal;cwd?:string;timeoutMs?:number;maximum?:number}):Promise<{stdout:string;stderr:string;code:number}> {
  options.signal.throwIfAborted();
  return new Promise((resolve,reject)=>{
    const child=spawn(executable,args,{stdio:['pipe','pipe','pipe'],windowsHide:true,shell:false,...(options.cwd?{cwd:options.cwd}:{})});
    const output:Buffer[]=[],errors:Buffer[]=[];let size=0,problem:Error|undefined;
    const stop=(error:Error)=>{problem??=error;child.kill();};
    const aborted=()=>stop(new OperatorError('CANCELLED','The task was cancelled.',409));
    const timer=setTimeout(()=>stop(new OperatorError('TASK_TIMEOUT','The task exceeded its execution deadline.',504)),options.timeoutMs??30000);
    options.signal.addEventListener('abort',aborted,{once:true});
    const receive=(buffers:Buffer[],chunk:Buffer)=>{
      size+=chunk.length;
      if(size>(options.maximum??256000))stop(new OperatorError('TASK_OUTPUT_LIMIT','The task exceeded its output limit.',413));
      else buffers.push(chunk);
    };
    child.stdout.on('data',(chunk:Buffer)=>receive(output,chunk));child.stderr.on('data',(chunk:Buffer)=>receive(errors,chunk));
    child.stdin.on('error',()=>{});
    child.on('error',()=>{problem=new OperatorError('EXECUTABLE_UNAVAILABLE','A required local executable could not start.',503);});
    child.on('close',code=>{
      clearTimeout(timer);options.signal.removeEventListener('abort',aborted);
      if(problem)reject(problem);else resolve({stdout:Buffer.concat(output).toString('utf8'),stderr:Buffer.concat(errors).toString('utf8'),code:code??1});
    });
    child.stdin.end(options.input??'');
  });
}
