import { For, Show } from 'solid-js';
import { signOut } from '../auth.jsx';
import { isRest } from '../timer.js';
import { describeSlot } from '../render.js';
import ExerciseLine from '../components/ExerciseLine.jsx';

const DAYS = [
  { key: 'monday', label: 'Monday' },
  { key: 'tuesday', label: 'Tuesday' },
  { key: 'wednesday', label: 'Wednesday' },
  { key: 'thursday', label: 'Thursday' },
  { key: 'friday', label: 'Friday' },
  { key: 'saturday', label: 'Saturday' },
  { key: 'sunday', label: 'Sunday' },
];

function WorkoutCard(props) {
  return (
    <li class="schedule-card" onClick={() => props.onSelect(props.workout)}>
      <div class="schedule-card-head">
        <span class="workout-title">{props.workout.title}</span>
        <span class="meta-pill">{props.workout.minutes} min</span>
      </div>
      <ul class="schedule-card-ex">
        <For each={props.workout.slots.filter((slot) => !isRest(slot.exercise))}>
          {(slot) => <li><ExerciseLine parts={describeSlot(slot, null)} /></li>}
        </For>
      </ul>
    </li>
  );
}

export default function ScheduleView(props) {
  const byDay = (key) => props.workouts.filter((w) => w.day === key);
  const scheduledDays = () => DAYS.filter((d) => byDay(d.key).length > 0);
  const unassigned = () => props.workouts.filter((w) => !w.day);

  return (
    <div class="schedule-view">
      <header class="home-header">
        <div class="logo-mark">EMOM</div>
        <p class="home-sub">Your training week</p>
      </header>

      <div class="schedule-content">
        <For each={scheduledDays()}>
          {(day) => (
            <section class="schedule-day">
              <h2 class="schedule-day-label">{day.label}</h2>
              <ul class="schedule-day-list">
                <For each={byDay(day.key)}>
                  {(w) => <WorkoutCard workout={w} onSelect={props.onSelect} />}
                </For>
              </ul>
            </section>
          )}
        </For>

        <Show when={unassigned().length > 0}>
          <section class="schedule-day">
            <h2 class="schedule-day-label">Unassigned</h2>
            <ul class="schedule-day-list">
              <For each={unassigned()}>
                {(w) => <WorkoutCard workout={w} onSelect={props.onSelect} />}
              </For>
            </ul>
          </section>
        </Show>

        <div class="schedule-actions">
          <button
            class="secondary-btn"
            disabled={props.stale}
            onClick={() => props.onNewWorkout()}
          >
            + New workout
          </button>
          <button
            class="secondary-btn"
            disabled={props.stale}
            onClick={() => props.onOpenLibrary()}
          >
            Exercises
          </button>
        </div>

        <Show when={props.stale}>
          <p class="schedule-stale-note">
            Editing is unavailable while showing saved data.
          </p>
        </Show>

        {/* The only way out of the session. Deliberately at the bottom of the
            schedule screen and nowhere near the detail or active screens:
            signing out by accident mid-workout would end the workout. */}
        <button class="sign-out-btn" onClick={() => signOut()}>Sign out</button>
      </div>
    </div>
  );
}
