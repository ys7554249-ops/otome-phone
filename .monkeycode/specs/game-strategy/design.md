# Game Strategy Design

## Scope

Improve the existing game engine in index.html without changing persisted room schemas or introducing difficulty settings.

## Decisions

- Gomoku ranks nearby empty intersections using contiguous lines, five-cell windows, open ends and compound threats. Immediate wins outrank immediate blocks. The model selects among at most six near-best choices; invalid or weaker choices use the local best move.
- Flight Chess ranks legal tokens using finishing, captures, progress and estimated exposure over the six possible opponent rolls. Clearly weaker model actions use the local best move.
- Monopoly uses a boolean purchase protocol. Local fallback retains a cash reserve and avoids purchases too close to the cash-only end condition.
- Existing request-completion checks, legal move validation, persistence and room lifecycle remain in place.

## Limits

The strategy uses bounded tactical heuristics, not exhaustive game-tree search. Multiple simultaneous opponent threats can be impossible to block. Dice-based games retain chance outcomes. Model dialogue may describe a proposed move that the strategy corrects.

## Verification

Run `node --test tests/*.test.js`. Cover all Gomoku winning axes, defensive blocks, split threats, multiplayer threats, opening placement, stronger attacking shapes, malformed actions, Flight Chess captures and finishes, Monopoly reserves and final turns, and existing room-exit regressions. Tests use mocked model responses; real-match win rates require gameplay evaluation.
