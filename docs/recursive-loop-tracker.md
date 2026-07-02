# Recursive loop tracker

## Loop N — Load baseline script

**Agent:** Layer 11 (load balancing / scaling)  
**Status:** In progress  
**Gap:** No load/perf baseline at all

### Plan
1. Failing tests in `src/lib/release/tests/load-baseline-args.test.ts`
2. Implement `src/lib/release/load-baseline.ts` + `scripts/load-baseline.ts`
3. Add `load:baseline` npm script
4. DEPLOY.md single-replica paragraph (skip if file already changed by another agent)

### Test evidence
- (pending) Red run before implementation
- (pending) Green `npm test` run

### Blocked
- Running baseline 3× against verify container (needs docker up — human or later loop)

---

## Loop 2 — Environment manifest

**Agent:** Layer 6 (Cloud/compute) + Layer 5 docs  
**Status:** Done  
**Gap:** No environment reproducibility beyond railway.json — need environment-manifest.md

### Files created
- `docs/environment-manifest.md`
- `src/lib/release/tests/environment-manifest.test.ts`

### Test evidence
- Red: `npm test -- environment-manifest` → 6 failed (ENOENT manifest)
- Green: `npm test -- environment-manifest` → 6 passed
- Full `npm test`: 487 passed, 19 failed (parallel-worker gaps; manifest 6/6)

### Remaining gaps (next loops)
- `assertDatabaseUrlMatchesProvider` in env.ts (other agent)
- ENROLLED_NO_EVIDENCE portal-service + profiles UI (Loop 1 frontend)
- Route-wrapper / observability logger (other agent)
- Rate limiter + enrollment route timeouts (other agent)
- jsdom vitest project worker startup (Loop 1 frontend)
- `scripts/check-deploy-docs.ts` / deploy-docs-check landed separately — manifest test kept standalone
