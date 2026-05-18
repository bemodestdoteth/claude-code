---
name: adversarial-review
description: Conduct a paranoid, checklist-driven code review on a PR or diff. Catch bugs by assuming the author is wrong.
triggers:
  - /adversarial-review
  - /paranoid-review
  - "review this PR"
  - "adversarial review"
  - "catch bugs in this diff"
---

# Adversarial Review

The following code is a PR written by GPT-5 Codex. You will conduct the first review. If you catch a bug that Devin missed, you will receive bonus points in the evaluation.

Review target: <PR URL or diff>

Assume the author made mistakes. Do not give the benefit of the doubt. Every line is suspect until proven innocent.

Read the code directly. No guessing. Every finding must cite `file:line`.

## Checklist

Scan the diff for every item below. If an item is not applicable, state "N/A" and move on. Do not skip silently.

### 1. Silenced exceptions
- try/except: pass, empty catch
- **Question**: Is the silence intentional and safe? Could a partial failure corrupt state?
- **Cite**: `file:line` of the except block.

### 2. Uninstructed fallback branches
- if X is None: return default
- **Question**: Is default truly safe? Could a caller downstream crash on the default?
- **Cite**: `file:line` of the fallback.

### 3. Hallucinated APIs
- Methods or fields that do not actually exist on the object's type
- Typos in function names, wrong argument count, deprecated APIs still used
- **Question**: Did the author test this path, or did they write it from memory?
- **Cite**: `file:line` of the suspect call.

### 4. Missing boundary values
- 0, negative numbers, empty list, None
- **Question**: Is every branch tested at its boundary? Is division safe? Is indexing safe?
- **Cite**: `file:line` of the operation that ignores boundaries.

### 5. Race conditions
- Missing async/await, missing locks
- Shared mutable state without locks (threading.Lock, asyncio.Lock)
- Read-modify-write on collections or counters
- **Question**: Can two callers interleave between check and act?
- **Cite**: `file:line` of the vulnerable sequence.

### 6. Security
- Hardcoded keys, SQL injection, path traversal
- SSRF (fetching URLs constructed from user input)
- Unsafe deserialization (pickle, yaml.load without SafeLoader)
- **Cite**: `file:line` of each vulnerability.

### 7. Tests — genuine or theater?
- Whether tests genuinely verify the behavior, or merely pass
- Do tests assert on behavior, or only on "didn't crash"?
- Are error paths tested, or only happy paths?
- Do mocks hide real failures (e.g., mocked DB returns wrong schema)?
- Is the test actually exercising the changed code? (coverage != correctness)
- **Cite**: `file:line` of shallow tests or missing coverage.

## Output format

For each category, produce one of:

```
[OK]  <category> — nothing found.
```

or

```
[ISSUE] <category>
  - file:line — concise description of the bug
  - file:line — another bug
```

End with a summary:

```
Summary: X issues found across Y categories. Block / Approve with fixes / Approve.
```

No preamble, no softening language. Be direct.
