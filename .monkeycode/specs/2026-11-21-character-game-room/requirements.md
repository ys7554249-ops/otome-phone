# Requirements Document

## Introduction

Add a standalone Games app beside Fanfic on the home screen. The app lets the user create local game rooms with multiple existing characters, play three board-game variants, and chat with participating characters during play. Game rules and state transitions are validated locally; the configured chat model supplies character moves and dialogue.

## Glossary

- **Game room**: A locally persisted game session with a game type, participants, state, and conversation.
- **Participant**: The user or an existing character assigned a seat in a game room.
- **Character turn**: A turn where the configured model selects a legal action for a character participant.
- **Multiplayer Gomoku**: A 15-by-15, 2-to-4-seat five-in-a-row variant where each seat has a distinct mark.
- **Flight Chess**: A 2-to-4-seat simplified race game with two tokens per seat, a shared loop, home lanes, and dice.
- **Mini Monopoly**: A 2-to-6-seat local property game with a 24-space track, buying, rent, salary, chance events, and bankruptcy.

## Requirements

### Requirement 1: Games app entry and room lifecycle

**User Story:** AS a user, I want a dedicated Games app, SO THAT I can start and resume games with my characters.

#### Acceptance Criteria

1. WHEN the home screen displays the Fanfic app, THE home screen SHALL display a Games app tile adjacent to Fanfic.
2. WHEN the user opens Games, THE application SHALL list saved rooms and provide a create-room action.
3. WHEN the user creates a room, THE application SHALL allow selection of one supported game and eligible characters bound to the active persona.
4. THE application SHALL enforce participant limits of 2-4 for Multiplayer Gomoku, 2-4 for Flight Chess, and 2-6 for Mini Monopoly, counting the user as one participant.
5. WHEN a room state changes, THE application SHALL persist the room in the current device's application store and restore it after navigation or reload.
6. WHEN the user opens a saved room, THE application SHALL render the saved board, turn, participant data, and chat history.

### Requirement 2: Multiplayer Gomoku

**User Story:** AS a user, I want to play a shared five-in-a-row game with several characters, SO THAT multiple participants can compete in one match.

#### Acceptance Criteria

1. WHEN a Multiplayer Gomoku room starts, THE application SHALL create a 15-by-15 empty board and assign a unique mark to each participant.
2. WHEN the user selects an empty board intersection on the user's turn, THE application SHALL place the user's mark and advance the turn.
3. WHEN a participant places five or more consecutive marks in a horizontal, vertical, or diagonal line, THE application SHALL end the match and identify that participant as the winner.
4. IF a participant selects an occupied intersection, THE application SHALL preserve the board and turn.
5. WHEN the board has no empty intersections and no winner, THE application SHALL end the match as a draw.

### Requirement 3: Flight Chess

**User Story:** AS a user, I want to race tokens with several characters, SO THAT we can play a turn-based flight-chess match together.

#### Acceptance Criteria

1. WHEN a Flight Chess room starts, THE application SHALL assign each participant two tokens in a home base and initialize a shared race track with participant-specific home lanes.
2. WHEN a participant rolls the die, THE application SHALL generate an integer from 1 through 6 and allow a token to leave base on a roll of six.
3. WHEN a participant moves a token, THE application SHALL validate the route, resolve captures on shared spaces, and advance the turn according to the six-roll and capture rules.
4. WHEN a token reaches its participant's finish lane, THE application SHALL update its position and count it toward that participant's completed tokens.
5. WHEN a participant completes both tokens, THE application SHALL end the match and identify that participant as the winner.

### Requirement 4: Mini Monopoly

**User Story:** AS a user, I want to play a compact property game with several characters, SO THAT we can buy spaces, collect rent, and compete to remain solvent.

#### Acceptance Criteria

1. WHEN a Mini Monopoly room starts, THE application SHALL initialize a 24-space board, equal starting funds, participant positions, and unowned properties.
2. WHEN a participant rolls and moves, THE application SHALL award salary for passing Start and resolve the destination space.
3. WHEN a participant lands on an unowned property, THE application SHALL present or select a buy/pass action and update ownership and funds after a valid purchase.
4. WHEN a participant lands on another participant's property, THE application SHALL transfer the configured rent from visitor to owner.
5. IF a participant cannot pay a required cost, THE application SHALL mark that participant bankrupt and continue the game with remaining participants.
6. WHEN one solvent participant remains, THE application SHALL end the match and identify that participant as the winner.

### Requirement 5: Character turns and in-game conversation

**User Story:** AS a user, I want characters to act and talk during a game, SO THAT play feels like a shared social activity.

#### Acceptance Criteria

1. WHEN a character owns the current turn, THE application SHALL request an action and a short in-character line from the configured chat model.
2. THE application SHALL validate every model-proposed action against current legal moves before applying the action.
3. IF a model request fails or returns an invalid action, THE application SHALL choose a deterministic legal fallback and show a recoverable status message.
4. WHEN the user sends a game-room chat message, THE application SHALL append the message and request an in-character reply from selected participating characters.
5. THE application SHALL retain game chat with its room and keep game actions distinct from free-form chat messages.
6. WHEN no chat API is configured, THE application SHALL keep user actions available and explain that character turns require an API configuration.

### Requirement 6: Mobile interaction and accessibility

**User Story:** AS a mobile user, I want the board and chat controls to work on a phone, SO THAT I can play without a desktop layout.

#### Acceptance Criteria

1. WHEN the viewport is at least 320 CSS pixels wide, THE application SHALL keep the active board, current-turn indicator, primary action, and chat input reachable without horizontal page overflow.
2. WHEN a board cell or token is interactive, THE application SHALL expose a button-like accessible name and a visible selected or disabled state.
3. WHEN a room is complete, THE application SHALL provide a new-room action and preserve the completed room in the saved room list.
