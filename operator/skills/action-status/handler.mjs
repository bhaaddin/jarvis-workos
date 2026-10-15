export async function execute(input, context) {
  return context.services.invoke('actions.status', input);
}
