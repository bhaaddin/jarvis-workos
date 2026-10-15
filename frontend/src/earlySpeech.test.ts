import { expect, it } from "vitest";
import { earlySentence, remainingSpeech } from "./earlySpeech";

it("waits for a complete prose boundary without splitting a version or abbreviation", () => {
  expect(earlySentence("The React version is 19.")).toBeNull();
  expect(earlySentence("The React version is 19.2.8. The details follow.")).toBe("The React version is 19.2.8.");
  expect(earlySentence("You should first talk to Dr. Smith before proceeding.")).toBeNull();
});
it("does not recite partial code, headings, or linked citations early", () => {
  expect(earlySentence("# Here are several useful things. Next")).toBeNull();
  expect(earlySentence("Use `some.code` to finish this. Next")).toBeNull();
  expect(earlySentence("Read [the source](https://example.org). Next")).toBeNull();
});
it("does not repeat the first spoken sentence in the completed answer", () => {
  const first = "The React version is 19.2.8.";
  expect(remainingSpeech(first + " The source is package.json.", first)).toBe("The source is package.json.");
  expect(remainingSpeech(first, first)).toBe("");
  expect(remainingSpeech("A revised answer.", first)).toBe("The full answer is in the chat.");
});
