---
name: claude-code-executor-monorepo
description: "Monorepo execution skill for TypeScript/Node workspaces. Encodes pnpm workflow, workspace package boundaries, strict TypeScript patterns, shared wrapper imports, Express/API module patterns, database/cache usage, validation evidence, and OMC post-plan execution loops."
triggers:
  - /claude-code-executor-monorepo
  - "monorepo coding"
  - "typescript monorepo"
  - "node monorepo"
risk: unknown
source: project
date_added: '2026-05-16'
---

# claude-code-executor-monorepo

You are a TypeScript/Node.js developer working in a pnpm monorepo. Every line of code must respect the workspace's package boundaries, shared library contracts, strict TypeScript rules, and approved plan scope.

## Use this skill when

- Writing or editing TypeScript/JavaScript files inside monorepo `apps/` or `packages/`
- Adding new API routes, controllers, services, or package exports
- Adding packages or modifying existing workspace libraries
- Running package builds, type checks, tests, or monorepo task filters
- Interacting with shared database, cache, logging, configuration, or domain type packages
- Executing an approved OMC plan or post-approval handoff that targets TypeScript/Node monorepo code

## Do not use this skill when

- The task is outside a TypeScript/Node monorepo
- You are only reading code without intent to modify it or prepare implementation
- The task is purely data analysis with no code changes
- A language-specific executor is more appropriate for the target files

---

## Domain Skill Routing

Invoke the relevant domain skill before implementing when the current task matches one of these signals. Use the embedded checks below for routine work; use this table when the task enters a specialized domain.

| Domain | Detection Signal | Skill to Invoke | Invoke When |
|--------|------------------|-----------------|-------------|
| Node.js backend patterns | Express APIs, controllers, services, middleware, auth, HTTP server behavior | `/nodejs-backend-patterns` | Before adding or substantially changing backend service behavior |
| Node.js best practices | Runtime behavior, error handling, process lifecycle, async patterns, streams, package scripts | `/nodejs-best-practices` | The implementation touches Node runtime or platform-level behavior |
| Monorepo management | Workspace dependency graph, package boundaries, pnpm filters, Turbo/Nx, package exports | `/monorepo-management` | Package graph or task orchestration changes are non-trivial |
| Monorepo architecture | Shared package placement, cross-package coupling, module ownership, broad refactors | `/monorepo-architect` | Boundary or placement decisions are unclear |
| Next.js App Router | App Router files, Server Components, route handlers, layouts, metadata, caching | `/nextjs-app-router-patterns` | Touching Next.js app-router behavior |
| Native data fetching | Fetch API, React Query, SWR, caching, offline state, request lifecycle | `/native-data-fetching` | Client/server data fetching behavior is central |
| Test strategy and TDD | New behavior needing test-first design, disputed coverage, integration strategy | `/tdd` | Test design is non-trivial or the approved plan calls for TDD |
| Security review | Auth, parsing, file/network access, secrets, deserialization, injection-sensitive code | `/security-auditor` or Semgrep MCP | Security-sensitive changes need review or scanning |
| External library behavior | SDK/API/library usage is uncertain or version-sensitive | `/context7-auto-research` | Official docs are needed before implementing |

---

## OMC Post-Plan Execution Contract

When an approved OMC plan or `Post-Approval Handoff` exists, treat it as the source of truth. Do not re-plan, expand scope, or reinterpret requirements unless the plan conflicts with current code or a blocker appears.

1. Confirm the target files, constraints, assumptions, and validation steps from the approved plan.
2. Inspect only the files needed for the current execution step.
3. Reuse existing workspace packages, wrappers, exports, and project patterns before adding anything new.
4. Stop and escalate if the plan is missing, contradicted by code, requires credentials/secrets, changes security-sensitive behavior, or affects unrelated packages/apps.
5. Report changed files, validation evidence, unresolved blockers, and any assumptions needed to complete the handoff.

## Validation Feedback Loop

After implementation, hand the executor report to `/claude-code-validator-monorepo`. If validation returns `PASS`, stop. If it returns `PASS_WITH_FIXES` or `FAIL`, treat the validator findings as a constrained follow-up handoff: fix only the cited issues, preserve the approved plan scope, then request validation again. If validation returns `BLOCKED`, supply missing artifacts/evidence or return to `/claude-code-plan` or the user only when the blocker is plan-level.

---

## Embedded Execution Checks

Use these compact checks directly during implementation. Invoke full external skills only when the task exceeds these rules.

| Area | Embedded Check | Escalate When |
|------|----------------|---------------|
| Toolchain | Use the repository's package manager and filters; for pnpm monorepos use `pnpm`, never `npm` or `yarn`. Build a package before another package depends on it. | Invoke `/monorepo-management` for dependency graph, lockfile, package export, or task orchestration problems. |
| Strict TypeScript | Preserve strict settings, use `.js` extensions for local ESM imports when required, use `import type` for type-only imports, avoid bare `any`, and satisfy `noImplicitReturns`. | Invoke specialized TypeScript/architecture help when generic types, package exports, or cross-package types become complex. |
| Shared wrappers | Use workspace logging, database/cache, configuration, and domain type packages; do not bypass wrappers with direct third-party imports in business logic. | Escalate when wrapper coverage is missing or shared-core placement is unclear. |
| API modules | Match existing route/controller/service patterns, keep request handlers thin, and place business logic in services or shared packages as established. | Invoke `/nodejs-backend-patterns` for auth, middleware, lifecycle, streaming, or broader API design. |
| Behavioral tests | Add or update tests for changed behavior where the repo has a relevant test harness; avoid shallow tests that only assert no crash. | Invoke `/tdd` when test strategy is non-trivial or no suitable seam exists. |
| Pre-handoff self-check | Check for silent catches, unsafe fallbacks, resource leaks, hardcoded secrets/config, direct wrapper bypasses, and unrelated package changes. | Invoke `/adversarial-review`, `/security-auditor`, or Semgrep MCP for suspected logic/security bugs. |

---

## Critical Rules

### 1. Core Workspace Imports (MANDATORY — never reimplement)

Prefer established workspace packages over direct third-party usage in business logic. For `bemodest.me`, these wrappers handle Winston formatting, MongoDB/Redis connection pooling, Zod env validation, and CAIP-2 abstractions.

```typescript
// Logging — NEVER import winston or console.log directly in business logic
import { logger, createLogger } from '@bemodest/utils';

// Database/cache — NEVER import mongodb or ioredis directly in business logic
import {
  MongoDBClient,
  RedisClient,
  GenericRepository,
  getDBClient,
  getRedisClient,
  closeDBClient,
} from '@bemodest/database';

// Configuration — NEVER import zod directly for env validation
import { validateApiConfig, validateWebConfig } from '@bemodest/config';

// Types / Schemas — NEVER define ad-hoc schemas for shared domain objects
import { SystemConfigSchema, Caip2Schema, LabelSchema, EntitySchema } from '@bemodest/types';
```

**Forbidden direct imports in `bemodest.me` business logic:**
- `winston` (use `@bemodest/utils`)
- `mongodb`, `ioredis` (use `@bemodest/database`)
- `zod` for environment config (use `@bemodest/config`)

### 2. Environment & Workflow

- **Package manager:** `pnpm` for pnpm monorepos — never use `npm` or `yarn`
- **Install deps:** `pnpm add <package>` (use `-D` for dev deps)
- **Build a package:** `pnpm --filter <pkg> build` (must build before another package depends on it)
- **Dev watch:** `pnpm --filter <pkg> dev` when the package provides a watch script
- **Turbo/Nx:** respect the repository's task orchestrator and existing pipeline
- **No root test assumption:** inspect package scripts before running tests
- For `bemodest.me` API runtime, use `node --env-file=.env src/server.js` when manually starting the API

### 3. TypeScript Strict Patterns

For strict NodeNext/ESM TypeScript packages:

- Preserve `target`, `module`, and `moduleResolution` conventions in shared tsconfig files
- Use `.js` extensions on local imports when required by NodeNext ESM, e.g. `import { foo } from './bar.js'`
- Use `import type { Foo } from './foo.js'` for type-only imports
- Avoid bare `any`; use precise types or `unknown` with narrowing
- Ensure all code paths return when `noImplicitReturns` is enabled
- Handle `catch` variables as `unknown` when `useUnknownInCatchVariables` is enabled

For `bemodest.me`, `packages/tsconfig/base.json` enforces strict TypeScript settings including `strict`, `noImplicitAny`, `strictNullChecks`, `noImplicitReturns`, `noFallthroughCasesInSwitch`, and `useUnknownInCatchVariables`.

### 4. Database and Cache

Use workspace database/cache packages instead of direct clients in business logic.

```typescript
import { getDBClient, closeDBClient, getRedisClient } from '@bemodest/database';

const db = await getDBClient();
await db.createOne('collection', { field: 'value' });
const doc = await db.readOne('collection', { field: 'value' });
const docs = await db.readMany('collection', { field: 'value' }, { projection: { _id: 0 } });
await db.updateOne('collection', { _id: id }, { $set: { field: 'new' } });
await db.deleteOne('collection', { _id: id });

const redis = getRedisClient();
await redis.set('key', 'value');
const value = await redis.get('key');

await closeDBClient();
```

For `bemodest.me`:
- `getDBClient()` returns a singleton `MongoDBClient` with pooled connection
- Reads include `maxTimeMS=30000` by default through `MONGODB_MAX_TIME_MS`
- Shutdown should call `closeDBClient()` on `SIGTERM` / `SIGINT`
- `getRedisClient()` returns a singleton Redis client with capped exponential backoff

### 5. API Module Patterns

For Express-style APIs, new domain modules should follow the repository's existing route/controller/service split. For `bemodest.me`, new domain modules live in `apps/api/src/modules/<domain>/`:

```text
modules/<domain>/
  routes.js      — Express Router definitions
  controller.js  — Request handlers
  service.js     — Business logic
```

```typescript
// routes.js
import { Router } from 'express';
import * as controller from './controller.js';

const router = Router();
router.get('/api/things', controller.listThings);
router.post('/api/things', controller.createThing);
export default router;
```

```typescript
// controller.js
import { logger } from '@bemodest/utils';
import * as service from './service.js';

export const listThings = async (req, res) => {
  try {
    const data = await service.getThings();
    return res.status(200).json({ success: true, data });
  } catch (err) {
    logger.error('listThings error: {}', err instanceof Error ? err.message : String(err));
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};
```

### 6. Logging

Use the workspace logger in server-side business logic.

```typescript
import { logger } from '@bemodest/utils';

logger.info('Server started on port {}', port);
logger.error('DB connection failed: {}', err instanceof Error ? err.message : String(err));
```

For `bemodest.me`:
- `logger` is a Winston instance with JSON file output and colorized console output
- Use `createLogger(logDir, level)` for custom log directories
- Do not use bare `console.log` in server-side business logic

### 7. Configuration

Use workspace configuration helpers for typed environment access.

```typescript
import { validateApiConfig, validateWebConfig } from '@bemodest/config';

const apiConfig = validateApiConfig();
const webConfig = validateWebConfig();
```

For `bemodest.me`:
- Environment variables are loaded via `node --env-file=.env`
- `validateApiConfig()` / `validateWebConfig()` parse and validate `process.env`
- Never access `process.env` directly for typed config values in business logic

### 8. Testing

- Inspect package scripts before assuming test commands exist
- Add or update tests only where the repo has a relevant harness
- For `bemodest.me`, only `@bemodest/utils` has `vitest`
- For `bemodest.me`, run `pnpm --filter @bemodest/utils test` if the package test script exists
- For package changes, run the smallest relevant `pnpm --filter <pkg> build` before handoff

### 9. Code Style

- Respect existing patterns in the file being edited: imports, error handling, naming, formatting
- Do not introduce new conventions unless the file is empty or the approved plan explicitly refactors it
- Preserve ESM conventions when packages use `"type": "module"`
- Use workspace dependencies (`@scope/<pkg>`) instead of external duplicates
- Avoid speculative abstractions; prefer the smallest implementation that satisfies the approved plan

---

## Response Approach

1. **Confirm scope** — follow the approved plan or user request; state any assumption before relying on it.
2. **Inspect targeted files** — identify the involved app/package and workspace boundaries.
3. **Reuse workspace contracts** — use existing logging, DB/cache, config, type, API, and package patterns.
4. **Implement minimally** — keep changes inside scope and avoid unrelated apps/packages.
5. **Validate deliberately** — run the plan's checks or the smallest relevant `pnpm --filter <pkg> build`, test, or lint command available.
6. **Report evidence for validation** — list changed files, validation results, blockers, assumptions, deviations, and whether handoff criteria are satisfied.
7. **Update `prd.md`** only if the change affects documented behavior.

---

## Resources

Read only the resource needed for the current task.

| File | Description | When to Read |
|------|-------------|--------------|
| `resources/express-module-template.md` | Complete template for Express API modules | Adding or substantially changing API modules |
| `resources/mongodb-patterns.md` | CRUD patterns, singleton pooling, aggregation, error handling | Working with MongoDB or DB-backed services |
| `resources/typescript-strict-recipes.md` | Strict-mode TypeScript fixes and before/after examples | Fixing TypeScript errors or changing strict types |

## Example Interactions

- "Add a new API endpoint for alert rules" → Use module route/controller/service pattern, import `logger` from workspace utilities, use workspace DB client, validate shared schemas
- "Fix TS error in utils package" → Check `.js` extensions, `import type`, bare `any`, missing returns, and `unknown` catch variables
- "Add MongoDB query for wallet labels" → Use workspace DB client/read helpers, consider aggregation for counts
- "Implement logging for exchange operations" → Import workspace logger, use structured formatting, and choose appropriate levels
