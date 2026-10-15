import { expect, it } from "vitest";
import { spokenExcerpt } from "./spokenText";

it("keeps short answers, uncertainty, paths, and exact version numbers", () => {
  expect(spokenExcerpt("I found **React ^19.2.8** in `frontend/package.json`. I have not changed it."))
    .toBe("I found React ^19.2.8 in frontend/package.json. I have not changed it.");
});
it("labels bounded automatic speech as an excerpt and leaves the full answer intact", () => {
  const answer = "I can read the connected project. " + "Additional detail. ".repeat(200);
  const result = spokenExcerpt(answer);
  expect(result).toMatch(/^Here is the start of my answer\./);
  expect(result).toContain("I can read the connected project.");
  expect(result).toMatch(/The full answer is in the chat\.$/);
  expect(result.length).toBeLessThan(800);
  expect(answer.length).toBeGreaterThan(3000);
});
it("does not recite fenced code or let a single huge token bypass the limit", () => {
  expect(spokenExcerpt("See this:\n```ts\nconst secret = 'not spoken';\n```"))
    .toBe("See this: The code is available in the chat.");
  expect(spokenExcerpt("x".repeat(12000))).toContain("Please read it in the chat.");
});
