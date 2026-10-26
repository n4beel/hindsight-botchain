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

## Feedback round 1

All items from `docs/specs/FEEDBACK-hindsight.md` fixed in order:

- **Item 1 (Nested links in feed cards):** Fixed. Replaced the outer card `<Link>` wrapper in `components/hindsight/TimelineFeed.tsx` with a stretched-link pattern (`<Link href={`/p/${p.id}`} className="absolute inset-0 z-0" />`) covering the card background, while elevating inner author link (`/u/${p.author}`) and permalink to `relative z-10`. Eliminates HTML nested `<a>` inside `<a>` and resolved the React hydration error.
- **Item 2 (Feed doesn't show predicted text):** Fixed. Added one-block log fetching in `TimelineFeed.tsx` for revealed predictions (`status === 2`) using `client.getLogs` over `revealedBlock` for the `Revealed` event. Revealed predictions now render their exact quotation in Spectral serif in the timeline feed.
- **Item 3 (Local stack environment variables):** Fixed. Added `NEXT_PUBLIC_BOTCHAIN_NETWORK=testnet` and `NEXT_PUBLIC_BOHR_RPC=http://127.0.0.1:8711` to the `.env.local` block written by `scripts/local-stack.mjs`.
- **Item 4 (Seeded chain timestamp alignment):** Fixed. Updated `scripts/local-stack.mjs` to spawn anvil with `--timestamp (realNow - 100 * 86400)`, committed all 6 scenarios with past and future reveal dates at Day 0, warped 3 days to reveal #3, #4, and #6's predictions, then warped forward 97 days so the final chain time equals `realNow` (asserted diff `<= 120s`, measured: `0s`). Formatted role table added to script output.
- **Item 5 (Browser walkthrough):** Executed full walkthrough on seeded local stack (`http://localhost:3011` + anvil `8711`) across all routes from §3.2 using `mock-wallet.js`. Fixed clientRef lint constraint in `hook-deps.test.ts`. Verified 0 console errors and 0 hydration warnings.

### Browser Walkthrough Results

| Route | Role / Connected Address | Action / Observation | Result | Console Errors / Hydration Warnings |
|---|---|---|---|---|
| `/` | Visitor (No Wallet) | Timeline feed renders with filter chips, vertical spine, and revealed text quotes | PASS | 0 / 0 |
| `/new` | Acc 0 (`0xf39F...2266`) | Entered 280-char prediction, downloaded JSON backup, committed tx (`stage === 'confirmed'`) | PASS | 0 / 0 |
| `/p/1` | Visitor (No Wallet) | Displays sealed commitment #1 with waiting countdown | PASS | 0 / 0 |
| `/p/2` | Acc 0 (`0xf39F...2266`) | Unlocked reveal form for scenario #2, revealed text with salt | PASS | 0 / 0 |
| `/p/3` | Visitor (No Wallet) | Displays revealed quote with community verdicts breakdown | PASS | 0 / 0 |
| `/p/4` | Acc 1 (`0x7099...79C8`) | Connected as non-author, voted "Called it", incrementing verdict tally | PASS | 0 / 0 |
| `/p/5` | Visitor (No Wallet) | Displays lapsed prediction banner (missed 90-day window) | PASS | 0 / 0 |
| `/u/0x70997970C51812dc3A010C7d01b50e0d17dc79C8` | Visitor (No Wallet) | Author record page shows summary header (6 committed, 4 revealed) and history | PASS | 0 / 0 |
| `/mine` | Acc 0 (`0xf39F...2266`) | My Predictions tab partitions items into Waiting, Revealed, and Lapsed | PASS | 0 / 0 |

## Feedback round 2

- **Item 1 (Local-stack autonomous mining):** Added `"--block-time", "1"` to Anvil startup args in `scripts/local-stack.mjs`. Seeding continues to complete cleanly with the final timestamp difference within ~2 minutes of real time (`diff: 104s`).
  - Command run to confirm blocks advance on their own:
    ```bash
    b1=$(cast block-number --rpc-url http://127.0.0.1:8711); sleep 3; b2=$(cast block-number --rpc-url http://127.0.0.1:8711); echo "$b1 -> $b2"
    ```
    Output: `118 -> 121` (+3 blocks produced automatically in 3 seconds).
- **Item 3 (Housekeeping):**
  - Removed tracked `AGENTS.md` and 0-byte `public/favicon.ico` via `git rm`.
  - Added `AGENTS.md` to `.gitignore`.
  - Added dedicated 192x192 PNG `app/icon.png` in project brand styling (`#F2B880`).
  - Configured `icons: { icon: "/icon.png" }` in `metadata` in `app/layout.tsx` so browsers request `/icon.png` directly and never request `/favicon.ico`.

## Feedback round 3

- **Footer Three-Link Compliance & Helper:**
  - Added fixed constants `BOTCHAIN_SITE_URL = "https://botchain.ai"` and `BOTCHAIN_EXPLORER_URL = "https://scan.botchain.ai"` in `lib/botchain/chain.ts`.
  - Added exported `footerLinks(chainId?: number): FooterLinks` returning `{ contract, site, explorer }` where `contract` is `<explorer for that chain>/address/<address>` (or `null` when undeployed).
  - Updated `BuiltOnBotChain` to use `footerLinks(activeBotChain.id).contract`.
  - Updated colophon footer in `components/layout/PageShell.tsx` to reference `site` and `explorer` from `footerLinks()`.
  - Added `app/not-found.tsx` wrapped in `PageShell` ensuring footer renders on 404 and unrouted states.
  - Added unit test suite in `lib/botchain/__tests__/chain.test.ts` covering chain IDs 677 and 968 for both deployed and undeployed configurations.

- **Browser-Check with Local Stack (port 8711 / 3011):**
  - `/` (Home): Verified all three links present (`https://scan.bohr.life/address/0x5fbdb2315678afecb367f032d93f642f64180aa3`, `https://botchain.ai`, `https://scan.botchain.ai`).
  - `/p/1` (Detail): Verified all three links present.
  - `/nonexistent` (Not Found): Verified all three links present.

## Feedback round 4

- **Item 1 (Shared CSS Tokens & Contrast):**
  - Defined missing tokens in `app/globals.css`:
    - `--success: #7BD3A1` (5.71:1 contrast on `--bg-elevated: #1B4556`, WCAG AA)
    - `--danger: #FF9E96` (5.14:1 contrast on `--bg-elevated`, WCAG AA)
    - `--warning: #F5C082` (6.19:1 contrast on `--bg-elevated`, WCAG AA)
  - Updated `ConnectButton.tsx` menu items with readable typography, defined surfaces, and hover state (`hover:bg-[rgba(217,236,242,0.08)]`).
  - Added unit test `test/lint/tokens.test.ts`.
  - Verified `python3 scripts/check-tokens.py hindsight` exits 0 with zero undefined tokens.




