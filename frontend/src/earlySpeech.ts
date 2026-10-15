import { spokenExcerpt } from "./spokenText";

/** Conservative boundary: never start with a heading, code, URL, or partial number. */
export function earlySentence(text: string): string | null {
  const match = /^\s*([^\n]{25,260}?[.!?])(?=\s)/.exec(text);
  if (!match || /[`#\[\]<>]|https?:|^\s*[-*\d]+[.)]?\s/.test(match[1])) return null;
  if (/^\s*(?:let me|i['’]ll|i will|checking|working on)\b/i.test(match[1])) return null;
  if (/\b(?:Mr|Mrs|Ms|Dr|vs|etc|e\.g|i\.e)\.$/i.test(match[1])) return null;
  return spokenExcerpt(match[1]);
}

export function remainingSpeech(answer: string, first: string): string {
  const spoken = spokenExcerpt(answer).replace(/^Here is the start of my answer\. /, "");
  return spoken.startsWith(first) ? spoken.slice(first.length).trim() : "The full answer is in the chat.";
}
