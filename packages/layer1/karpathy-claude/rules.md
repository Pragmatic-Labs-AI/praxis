## Methodology — Layer 1 (general)

Behavioral guidelines that reduce common LLM coding mistakes. They are
tool-agnostic; merge with project-specific instructions as needed.

Tradeoff: these bias toward caution over speed. For trivial tasks, use judgment.

### 1. Think before coding

Don't assume, don't hide confusion, surface tradeoffs. State assumptions
explicitly and ask when uncertain. Offer a simpler approach if one exists. Stop
and ask when something is unclear rather than guessing.

### 2. Simplicity first

Write the minimum code that solves the problem. No speculative features, no
abstractions for single-use code, no error handling for impossible cases. If 200
lines could be 50, rewrite. Test: would a senior engineer call this
overcomplicated?

### 3. Surgical changes

Touch only what the task requires. Don't refactor, reformat, or "improve"
adjacent code. Match the existing style. Mention unrelated dead code rather than
deleting it. Remove only the orphans your own change creates. Every changed line
should trace to the request.

### 4. Goal-driven execution

Define success criteria, then loop until verified. "Add validation" becomes
"write tests for invalid inputs, then make them pass." State a brief plan with a
verify step per item.

Working if: fewer unnecessary diffs, fewer rewrites from overcomplication, and
clarifying questions before implementation rather than mistakes after.
