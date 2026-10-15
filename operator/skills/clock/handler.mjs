export async function execute(input, context) {
  return context.services.invoke('core.clock', input);
}
