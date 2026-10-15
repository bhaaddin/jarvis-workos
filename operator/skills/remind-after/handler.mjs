export async function execute(input,context){return context.services.invoke('tasks.save',{action:'add',title:input.title,delayMinutes:input.minutes,notes:input.notes??''});}
