# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev       # start dev server (Vite)
npm run build     # production build
npm run preview   # preview production build
```

No test runner is configured.

## Architecture

SolidJS single-page app. No router library — navigation is a `view` signal in `App.jsx` with values `'home' | 'detail' | 'active'`.

**Data flow:**
- `workouts.json` — static array of workout objects `{ id, title, minutes, exercises[] }`
- `App.jsx` — holds top-level signals (`view`, `selectedWorkout`, `colorMap`) and passes callbacks down to views
- Views live in `views/` and are stateless except for `ActiveView`

**Key modules:**
- `timer.js` — pure function `deriveTimerState(elapsed, workout, phase)` that derives all display state from elapsed seconds; no side effects, easy to test
- `audio.js` — Web Audio API with lazy `AudioContext` initialization; `resumeAudio()` must be called from a user gesture before sounds will play
- `ActiveView.jsx` — owns the interval (100ms ticks, 0.1s increments), a 10-second countdown phase before the workout starts, pause/resume logic, and `createEffect` hooks that trigger audio cues

**EMOM timing logic** (in `timer.js`):
- Each exercise gets exactly 1 minute
- `exerciseIndex = floor(elapsed / 60) % exercises.length`
- `currentRound = floor(elapsed / (60 * exercises.length)) + 1`
- `totalRounds = workout.minutes / workout.exercises.length`

**Audio cues** (in `ActiveView.jsx`):
- Warning beeps at 3 seconds left in each round
- Halfway beep at 30 seconds into each round
- Warning beeps also fire during the last 3 seconds of the countdown
