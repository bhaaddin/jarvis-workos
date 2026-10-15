export async function execute(input, context) { return context.services.invoke('code.read', {...input, operation: 'read'}); }
