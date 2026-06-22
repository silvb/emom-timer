import { For, Show } from 'solid-js';
import { isRest } from '../timer.js';

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
        <For each={props.workout.exercises.filter((ex) => !isRest(ex))}>
          {(ex) => <li>{ex}</li>}
        </For>
      </ul>
    </li>
  );
}

export default function ScheduleView({ workouts, onSelect }) {
  const byDay = (key) => workouts.filter((w) => w.day === key);
  const scheduledDays = () => DAYS.filter((d) => byDay(d.key).length > 0);
  const unassigned = () => workouts.filter((w) => !w.day);

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
                  {(w) => <WorkoutCard workout={w} onSelect={onSelect} />}
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
                {(w) => <WorkoutCard workout={w} onSelect={onSelect} />}
              </For>
            </ul>
          </section>
        </Show>
      </div>
    </div>
  );
}
