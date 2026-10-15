/** Keep automatic voice turns short without replacing the full chat answer. */
export function spokenExcerpt(answer: string): string {
  const plain = answer
    .replace(/```[\s\S]*?(?:```|$)/g, " The code is available in the chat. ")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}(?:#{1,6}\s+|[-*+]\s+|>\s*)/gm, "")
    .replace(/[*`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!plain) return "The answer is available in the chat.";
  const words = plain.split(" ");
  const selected: string[] = [];
  let size = 0;
  for (const word of words) {
    if (selected.length >= 90 || size + word.length + 1 > 700) break;
    selected.push(word);
    size += word.length + 1;
  }
  if (selected.length === words.length) return plain;
  if (!selected.length) return "This answer contains a long technical detail. Please read it in the chat.";
  return "Here is the start of my answer. " + selected.join(" ").replace(/[,;:]$/, "") +
    "… The full answer is in the chat.";
}
