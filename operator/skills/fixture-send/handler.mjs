export async function execute(input, context) {
  return context.services.invoke('fixture.send', input);
}
