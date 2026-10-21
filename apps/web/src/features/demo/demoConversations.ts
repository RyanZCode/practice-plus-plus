import type { StoredTutorMessage } from "../tutor/tutorConversationStorage";

export const demoCoachConversation: StoredTutorMessage[] = [
  {
    role: "user",
    content:
      "I can solve some problems on my own, but I still need hints on others. What should I focus on today?",
    complete: true,
    label: "General coaching",
  },
  {
    role: "assistant",
    content:
      "Start with **the review due today**, then try your fresh assignment independently.\n\nFor the review, explain your approach before coding. If you get stuck, ask for the smallest useful hint and record the help you used.\n\nYour pattern samples are still small, so treat them as early evidence rather than a firm rating.",
    complete: true,
    label: "General coaching",
  },
  {
    role: "user",
    content: "What should I write down after I finish?",
    complete: true,
    label: "General coaching",
  },
  {
    role: "assistant",
    content:
      "Record whether you solved independently, used help, or gave up. A short note about **where you got stuck and what helped** is useful too.\n\nConfirm the outcome so your next review and practice evidence reflect what happened.",
    complete: true,
    label: "General coaching",
  },
];

export function demoTutorConversation(slug: string): StoredTutorMessage[] {
  const [question, reply] =
    slug === "valid-parentheses"
      ? [
          "Does every opening bracket need a matching closing bracket?",
          "Yes. Every opening bracket needs a closing bracket of the same type, and the pairs must be correctly nested.\n\nFor example, **([])** is valid, while **([)]** is not. This clarifies the requirements without suggesting an algorithm.",
        ]
      : slug === "group-anagrams"
        ? [
            "Do I need to return the groups in a particular order?",
            "You can return the groups in any order. Each group should contain words that are anagrams of one another.\n\nFocus on which words belong together first; the output order does not need to match the example.",
          ]
        : [
            "Can we clarify the requirements before discussing a solution?",
            "Yes. Start with the input, the required output, and the constraints in the LeetCode statement.\n\nPoint out the part you find ambiguous, and we can work through a small example before discussing an approach.",
          ];
  return [
    { role: "user", content: question, complete: true, label: "Clarification" },
    { role: "assistant", content: reply, complete: true, label: "Clarification" },
  ];
}
