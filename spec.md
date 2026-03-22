# Sky Jump Hero

## Current State
New project, no existing code.

## Requested Changes (Diff)

### Add
- Canvas-based 2D mobile web game
- Hero character that jumps between floating platforms
- Moving platforms that occasionally disappear
- Tap/click to jump mechanic
- Coin collectibles on some platforms
- Score system (+1 per successful jump, +1 per coin)
- Speed increase every 10 points
- Start screen with Start button
- Game Over screen with score and high score
- High score persisted in localStorage
- Sound effects via Web Audio API (jump, coin collect, game over)
- Mobile-optimized canvas layout

### Modify
- N/A

### Remove
- N/A

## Implementation Plan
1. Backend: minimal stub (no backend data needed, all state is frontend)
2. Frontend: single-page game using Canvas API + requestAnimationFrame
   - GameCanvas component with full game loop
   - Platform generation, movement, and disappear logic
   - Hero physics (gravity, jump velocity)
   - Coin placement and collection
   - Score, high score, speed scaling
   - Start / Playing / GameOver state machine
   - Web Audio API for sound effects
   - Touch and mouse input
