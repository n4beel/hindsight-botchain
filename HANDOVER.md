# Handover: Hindsight (`hindsight-botchain`)

**Date:** 2026-10-25  
**Project:** 11 of 15 (Batch 2 Complete)  
**Slug:** `hindsight`  
**Archetype:** R · Timeline (Petrol `#0E2A35`, Pale Ink `#D9ECF2`, Apricot `#F2B880`, Fonts: `Spectral`, `Commissioner`, `Victor Mono`)

---

## 1. Deliverables Summary

### Contract Layer (`contracts/src/Hindsight.sol`)
- **Zero-Balance Commit-Reveal Forecaster**:
  - `commit(bytes32 commitment, uint64 revealAfter)`
  - `reveal(uint256 id, string calldata text, bytes32 salt)`
  - `judge(uint256 id, bool right)`
  - `predictionOf(uint256 id)`
  - `recordOf(address author)`
  - `latest(uint256 offset, uint256 count, uint8 statusFilter)`
  - `predictionsBy(address author, uint256 offset, uint256 count)`
  - `hasJudged(uint256 id, address voter)`
  - `predictionCount()`
- **Safety Properties**:
  - Packed 3 storage slots for each prediction.
  - Text is strictly log-only; never persists in EVM storage.
  - Zero-balance contract: rejects all ether transfers and holds no tokens.
  - Reveal window enforced at boundary: open for 90 days after `revealAfter`, closed thereafter.
  - Copied commitments are rendered invalid through `msg.sender` inclusion in the preimage.

### Test Suites
- **Foundry (`contracts/test/Hindsight.t.sol`)**:
  - 21 test cases covering commit bounds (min 1h, max 5y), window boundaries (`now == revealAfter`, `now == revealAfter + 90d`, `now == revealAfter + 90d + 1s`), wrong text/salt/author, text length bounds (1..280 bytes), copied commitment protection, judging rules (no author self-judging, one vote per wallet), status calculation, pagination, fuzz test round-trip (256 runs), zero-balance guard, and gas ceilings.
- **Unit Tests (`lib/__tests__/`)**:
  - 68 unit tests across `hindsight.test.ts`, `errors.test.ts`, `contract-limits.test.ts`, `wallet.test.ts`, `amount.test.ts`, `chain.test.ts`, `active-chain.test.ts`, `wagmi-chains.test.ts`, `deployment.test.ts`, and `hook-deps.test.ts`.
- **Integration Tests (`test/integration/hindsight.test.ts`)**:
  - 11 integration tests verifying contract deployment on port 8611 (chain 968), fixed vector hashes matching Solidity, time warping across reveal windows, author reveal event decoding, community judging, and ABI conformance.

### Frontend Application
- **Pages**:
  - `/`: Timeline feed of recently revealed predictions with filter chip row (`All` · `Revealed` · `Waiting` · `Lapsed`), Spectral quotations, and timeline spine nodes.
  - `/new`: 280-byte textarea, reveal date preset selector, live preview of public commitment, limits notice, pre-wallet localStorage persistence, commit transaction with settled-ref pattern (`stage === "confirmed"` FIRST), and "Save your reveal file" download gate (`hindsight-{id}.json`).
  - `/p/[id]`: 5 vertical timeline nodes along spine (Sealed → Waiting → Reveal Window → Revealed/Reveal Form/Lapsed → Community Verdicts), author reveal form with local pre-check, and community judging actions.
  - `/u/[address]`: Track record header (`{author} committed {c}, revealed {r}, and let {l} lapse.`), community verdict totals, and predictions timeline.
  - `/mine`: Predictions grouped by Needs Reveal Now (sorted by closing soonest), Waiting, Revealed, and Lapsed, with import/export reveal backup tools.
- **Design Archetype R · Timeline**:
  - Deep petrol ground `#0E2A35`, surface `#143644`, pale ink `#D9ECF2`, apricot accent `#F2B880`, Spectral serif quotations, Commissioner UI, Victor Mono codes.
  - 2px continuous vertical spine with 4 status node shapes.
  - Zero distinctness conflicts across all 26 compared projects (`check-distinct.py` passes with 0 errors).

---

## 2. Verification Gates

1. **Contracts (Forge Test)**:
   ```bash
   cd contracts && forge build --force && forge test -vv
   ```
   *Result:* 21 passed tests, 0 failures, 256 fuzz runs passed.

2. **TypeScript Compilation**:
   ```bash
   npm run typecheck
   ```
   *Result:* 0 errors.

3. **Frontend Unit & Lint Tests**:
   ```bash
   npm test
   ```
   *Result:* 10 test files passed, 68 tests passed, hook-deps passed.

4. **Integration Tests**:
   ```bash
   npm run test:integration
   ```
   *Result:* 2 test files passed, 11 tests passed on port 8611 (chain 968).

5. **Next.js Production Build**:
   ```bash
   npm run build
   ```
   *Result:* Compiled successfully with static & dynamic routes (`/`, `/new`, `/mine`, `/p/[id]`, `/u/[address]`).

6. **Distinctness Gate**:
   ```bash
   python3 ../scripts/check-distinct.py hindsight
   ```
   *Result:* 26 projects compared; 0 pair/file problem(s). Exits with code 0.

---

## 3. Local Stack

To run the local stack with 6 pre-seeded scenarios (account 0 sealed in 20d, account 0 revealable now with fixture JSON printed, revealed with 5 right / 2 wrong, revealed unjudged by account 0, lapsed, and account 1 record of 6 committed / 4 revealed / 1 lapsed / 1 sealed):
```bash
node scripts/local-stack.mjs
npm run dev
```
Accessible at `http://localhost:3000`.
