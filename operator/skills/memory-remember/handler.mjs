export async function execute(input, context) {
  return context.services.invoke('memory.put', input);
}
