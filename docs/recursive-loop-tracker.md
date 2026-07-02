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
