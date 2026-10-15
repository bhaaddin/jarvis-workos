export async function execute(input,context){return context.services.invoke('mail.send',input);}
