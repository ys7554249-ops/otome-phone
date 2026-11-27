# Game Strategy Requirements

## Goal

Characters provide a competitive baseline in existing board games while retaining character dialogue.

## Acceptance Criteria

1. WHEN a Gomoku character can complete five stones, the game SHALL select a winning move.
2. WHEN an opponent has an immediate winning intersection and the character has no immediate win, the game SHALL select a blocking intersection.
3. WHEN requesting a Gomoku action, the game SHALL provide the character index, player mapping, board, rules and ranked legal choices.
4. IF a model action fails validation or falls outside the strategic choices, the game SHALL execute the highest-ranked local choice.
5. WHEN ranking Flight Chess moves, the game SHALL account for finishing, captures, progress and exposure to captures.
6. WHEN requesting a Monopoly purchase, the game SHALL specify a boolean buy action and provide the cash-based turn-limit rule.
7. IF a Monopoly request fails, the game SHALL decide using cash reserves and remaining turns.
8. WHEN a room ends during a pending request, the game SHALL preserve the ended board state.
