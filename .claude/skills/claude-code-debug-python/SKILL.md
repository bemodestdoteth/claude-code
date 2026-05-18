---
name: claude-code-debug-python
description: "Debug skill for committed my_exchanges code. Routes to /diagnose when an error is known, or /adversarial-review + /diagnose when a file is merely suspicious. After root cause is identified, hands confirmed fixes to /claude-code-executor-python and validates with /claude-code-validator-python."
triggers:
  - /claude-code-debug-python
  - "debug this"
  - "fix this bug"
  - "ci failure"
  - "production bug"
  - "suspicious file"
  - "single file bug"
risk: unknown
source: project
date_added: '2026-05-08'
---

# claude-code-debug-python

Fast debugging for **committed** code in `my_exchanges/`.

## When to use this skill

- CI test failure on committed code
- Production bug in committed code
- Sanity check on a single file that explicitly has a bug

## When NOT to use this skill

- **Uncommitted executor output** — use `/claude-code-validator-python` instead (it runs plan fidelity, adversarial review, test quality, architecture fit, and diagnose as needed)
- Pure lint/syntax fixes — pre-commit already handles this
- Code outside `my_exchanges/`

---

## Router Logic

The skill branches based on what the user provides:

### Branch A: Specific error known (CI failure, production traceback, failing test)

Skip adversarial review. The bug is already confirmed.

1. **Invoke the `diagnose` skill explicitly.**
   Use the `Skill` tool with `skill: "diagnose"`.
2. Follow its root-cause loop:
   - Build deterministic feedback loop (failing test, curl, CLI invocation)
   - Reproduce the exact symptom
   - Generate 3–5 ranked, falsifiable hypotheses
   - Instrument with `[DEBUG-XXXX]` tagged logs; one variable at a time
   - Fix with a regression test when a correct seam exists
   - Clean up debug instrumentation and capture the post-mortem lesson
3. Once root cause is confirmed, **produce a root-cause-first diagnosis packet** and executor fix brief (see Root-Cause-First Diagnosis Packet and Executor Handoff below), then stop diagnosing.
4. **Invoke `/claude-code-executor-python`** with the fix brief as the approved plan.
5. **Invoke `/claude-code-validator-python`** after the executor reports done. Loop until validator returns `PASS` or a `BLOCKED` blocker is identified.
6. Cleanup is the executor's responsibility: it removes all `[DEBUG-XXXX]` logs before reporting done.

### Branch B: No specific error — "this file looks suspicious"

The bug is not confirmed yet.

1. **Invoke the `adversarial-review` skill explicitly.**
   Use the `Skill` tool with `skill: "adversarial-review"`.
2. Scan the file for:
   - Silenced exceptions: broad `except Exception` / `BaseException`, empty catches, `pass`, or `return None` / `return []` / `return {}` / `return 0` without explicit safe handling
   - Uninstructed fallbacks: `if x is None: return default`, `except: return default`, defaults indistinguishable from normal cases, or fallback behavior the user did not request
   - Hallucinated APIs: external library methods, fields, keyword arguments, and return types not verified against the installed version or official docs; mark uncertain items as `확인 필요`
   - Missing boundary values (0, negative, empty list, None)
   - Race conditions (missing async/await, shared mutable state)
   - Security issues (hardcoded keys, SSRF, unsafe deserialization)
3. If the review finds a **real bug**, switch to Branch A (invoke `diagnose`, then executor handoff).
4. If the review finds **nothing**, stop. Do not run `diagnose` on a clean file.

### Branch C: Single-file sanity check with a suspected bug pattern

Same as Branch B, but scoped to one file.

1. Run `/adversarial-review` on that single file only.
2. If issues found, switch to Branch A (invoke `diagnose`, then executor handoff).
3. If clean, stop.

---

## Root-Cause-First Diagnosis Packet

Before producing an executor handoff, capture the diagnosis in this order. Patch proposals come last.

- **Symptom**: one-line description of what happened.
- **Expected vs actual**: the intended behavior and the observed behavior.
- **Repro**: exact failing test, command, trace replay, or manual steps.
- **Evidence collected**: error message, stack trace, timestamped logs, relevant DB row, transaction ID, or captured artifact when available.
- **Files read**: `file:line-range` entries already inspected.
- **Root cause**: one sentence in the form "X caused Y, which invalidated Z."
- **Code path**: traced call path with `file:line` citations.
- **Similar-pattern search**: grep/search results for the same failure mode, with `file:line`; write `none found` only after searching.
- **Fix options**: at least two options with tradeoffs, including which one is recommended and why.

If any item cannot be confirmed, write `확인 필요` and state the exact missing evidence. Do not fill gaps with guesses.

---

## Executor Handoff

After root cause is confirmed (end of Branch A diagnose phase), produce a concise fix brief before invoking `/claude-code-executor-python`. The brief must include:

- **Root cause**: `file:line` — concise description
- **Repro**: the failing test name or exact invocation
- **Fix scope**: what to change and where (one or more `file:line` entries)
- **Regression test**: whether a new test is needed and why
- **Rejected fixes**: symptom-covering patches that were considered and why they are not sufficient

Then invoke `/claude-code-executor-python` with this brief as the source of truth. The executor applies `/claude-code-executor-python` domain rules (core-library imports, Pydantic strict config, mypy, exception hierarchy) — do not duplicate those rules here.

After the executor reports done, invoke `/claude-code-validator-python`. If validator returns `PASS_WITH_FIXES` or `FAIL`, hand findings back to the executor. Repeat until `PASS` or a plan/user blocker appears.

---

## Postmortem Memory Candidate

When a confirmed root cause matches a recurring AI-generated bug pattern, include a proposed memory entry after validation. Do not write persistent memory unless the user or active workflow explicitly asks for it.

```markdown
## <bug pattern name>

Symptom: <externally visible failure>
Cause: <root cause, with file:line>
Fix: <confirmed fix scope>
Lesson: <what should prevent this next time>
Similar-risk areas:
- <file:line>
```

Use this for swallowed exceptions, unsafe fallbacks, hallucinated APIs, missing boundary handling, race/resource bugs, or shallow tests that would not catch the original defect.

---

## Output Format

```
Branch: <A / B / C>
Phase 1: <feedback loop built / adversarial review complete>
Phase 2: <reproduced / no issues found>
Phase 3: <hypotheses listed (Branch A only)>
Phase 4: <root cause confirmed at file:line (Branch A only)>

Diagnosis Packet:
  Symptom: <one-line failure>
  Expected vs actual: <expected> / <actual>
  Evidence: <error, stack trace, logs, DB row, transaction ID, or artifact>
  Files read: <file:line-range entries>
  Root cause: <X caused Y, which invalidated Z>
  Code path: <file:line trace>
  Similar-pattern search: <file:line results or none found>
  Fix options: <at least two options with tradeoffs>

Executor Handoff:
  Root cause: <file:line — description>
  Repro: <failing test or invocation>
  Fix scope: <file:line entries>
  Regression test: <required / not required — reason>
  Rejected fixes: <symptom-covering patches not chosen>

Validation Result: <PASS / PASS_WITH_FIXES / FAIL / BLOCKED>

Postmortem Memory Candidate:
  <required when a recurring AI-generated bug pattern was confirmed; otherwise "not needed — reason">

Summary: <Bug fixed / No bug found / Escalated to user>
```

---

## Critical Rules

- **Never use this for uncommitted executor output.** Redirect to `/claude-code-validator-python`.
- **Do not run adversarial review if a specific error is already known.** It wastes time.
- **Do not run diagnose if adversarial review finds nothing.** It wastes time.
- **Stop diagnosing once root cause is confirmed.** Produce the fix brief and hand off.
- **Never self-implement the fix.** Route all confirmed fixes to `/claude-code-executor-python`.
- **Always validate executor output.** Invoke `/claude-code-validator-python` before declaring done.
- **Every finding must cite `file:line`.**
