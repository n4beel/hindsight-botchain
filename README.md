# Hindsight

Commit to a prediction now. Reveal it later.

Part of the BOT Chain application ecosystem. A commit-reveal prediction ledger where predictions are sealed cryptographically before the event, revealed strictly within a 90-day window, and judged by the community.

---

## What It Does

1. **Cryptographic Commitment**: The author drafts a prediction up to 280 bytes, chooses a reveal date between 1 hour and 5 years in the future, and generates a random 32-byte salt. The browser computes `keccak256(abi.encode(msg.sender, text, salt))`.
2. **On-Chain Sealing**: The commitment hash and reveal timestamp are recorded in the `Hindsight` contract via `commit(commitment, revealAfter)`. The text itself is **never** sent to the chain or stored in state.
3. **Strict 90-Day Reveal Window**:
   - Before `revealAfter`: the prediction is **Sealed** (`status = 0`). It cannot be revealed early.
   - Between `revealAfter` and `revealAfter + 90 days`: the prediction is **Revealable** (`status = 1`). Only the original author can reveal it by supplying the original text and salt.
   - After `revealAfter + 90 days`: the prediction is permanently **Lapsed** (`status = 3`). No reveal is accepted under any circumstances.
4. **Log-Only Text Publication**: When revealed via `reveal(id, text, salt)`, the contract verifies the commitment against `msg.sender`, sets `revealedAt = block.timestamp`, and emits the `Revealed(id, author, text)` event. The text is permanently archived in block logs without consuming persistent contract storage slots.
5. **Community Verdicts**: Any wallet other than the author can evaluate a revealed prediction once by calling `judge(id, right: bool)`, registering "Called it" or "Missed it" counters.

---

## What It Deliberately Cannot Do

- **No funds or tokens**: Hindsight is a zero-balance contract. It holds no BOT, accepts no payments, and does not conduct wagering.
- **No text in persistent state**: The prediction text is never stored in contract storage slots; it is published solely as an event log parameter upon verification.
- **No early reveals**: Calling `reveal` before `revealAfter` strictly reverts with `TooEarly`.
- **No late reveals**: Calling `reveal` after `revealAfter + 90 days` strictly reverts with `WindowClosed`.
- **No copied commitments**: Because `msg.sender` is part of `keccak256(abi.encode(msg.sender, text, salt))`, copying someone else's commitment hash into your own transaction creates an unrevealable commitment that only the original author's address could satisfy.
- **No author self-judging**: Calling `judge` from the author address reverts with `AuthorCannotJudge`.
- **No duplicate judging**: Wallets can only judge a prediction once (`AlreadyJudged`).
- **No admin or owner**: The contract is unowned, non-upgradeable, and without censorship controls.

---

## Gas Characteristics

Measured across Foundry tests on EVM:
- **`commit`**: ~158k gas max (target ceiling: < 175k gas; creates 3 packed slots and appends author prediction index).
- **`reveal`**: ~59k gas max (target ceiling: < 80k gas; updates revealed block and emits log).
- **`judge`**: ~54k gas max (target ceiling: < 65k gas; records voter bitmap mapping and increments verdict tally).
- **`predictionOf` / `recordOf`**: ~5k–8k gas (read-only views).

---

## Design Archetype: R · Timeline

Hindsight embodies a historical chronicle of foresight and outcome:
- **Ground (`--bg-base: #0E2A35`)**: Deep petrol canvas with an atmospheric dark tint.
- **Surface (`--bg-surface: #143644`)**: Elevated container panels with thin teal hairlines (`#24505F`).
- **Inks & Accents**:
  - Primary text: Pale ink `#D9ECF2` (contrast 12.5:1 AAA on petrol).
  - Secondary text: Muted blue-grey `#8FB0BC` (contrast 7.3:1 AAA on petrol).
  - Accent: Apricot `#F2B880` (contrast 9.2:1 AAA on petrol, 9.2:1 AAA against `#0E2A35`).
  - Right: Sage green `#7BD3A1` (contrast 9.6:1 AAA on petrol).
  - Wrong: Muted coral `#F28B82` (contrast 6.7:1 AA on petrol).
- **Spine Structure**:
  - Continuous 2px vertical spine running down the page.
  - Four distinct node states:
    - *Future / Sealed*: Hollow pale ring.
    - *Active / Revealable*: Filled glowing apricot node.
    - *Past / Revealed*: Solid pale/green node.
    - *Lapsed*: Dashed coral ring.
- **Typography**:
  - `Spectral`: Elegant serif for large prediction quotations and historical headlines.
  - `Commissioner`: Clean modern sans for UI controls and forms.
  - `Victor Mono`: Crisp monospace for timestamps, hashes, and byte counters.
- **Colophon**: The footer attribution is styled as the terminal node of the spine.

---

## Contrast Report

| Foreground | Background | Ratio | Rating |
|---|---|---|---|
| Pale Ink `#D9ECF2` | Petrol `#0E2A35` | 12.5:1 | AAA |
| Apricot `#F2B880` | Petrol `#0E2A35` | 9.2:1 | AAA |
| Dark Petrol `#0E2A35` | Apricot `#F2B880` | 9.2:1 | AAA |
| Sage Green `#7BD3A1` | Petrol `#0E2A35` | 9.6:1 | AAA |
| Muted Blue `#8FB0BC` | Petrol `#0E2A35` | 7.3:1 | AAA |
| Muted Coral `#F28B82` | Petrol `#0E2A35` | 6.7:1 | AA |

---

## Honest Limits

- **Lost Salt or Text**: If the author loses either the exact text string (down to byte casing and punctuation) or the random salt, the commitment can **never** be revealed. The local JSON backup downloaded at creation time is mandatory.
- **280-Byte Ceiling**: Prediction length is capped at 280 bytes (reverting `BadText`).
- **Strict 90-Day Window**: If the author forgets to reveal the prediction within 90 days after `revealAfter`, the prediction lapses permanently.
- **Social Verdicts**: Community votes ("Called it" / "Missed it") reflect decentralized wallet sentiment, not objective real-world verification or dispute resolution.
