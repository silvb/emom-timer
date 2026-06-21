import { For } from 'solid-js';
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

export default function ScheduleView({ workouts, onSelect, onBack }) {
  const byDay = (key) => workouts.filter((w) => w.day === key);
  const scheduledDays = () => DAYS.filter((d) => byDay(d.key).length > 0);

  return (
    <div class="schedule-view">
      <button class="back-btn" onClick={onBack}>← Back</button>

      <div class="schedule-content">
        <h1 class="schedule-title">Week</h1>

        <For each={scheduledDays()}>
          {(day) => (
            <section class="schedule-day">
              <h2 class="schedule-day-label">{day.label}</h2>
              <ul class="schedule-day-list">
                <For each={byDay(day.key)}>
                  {(w) => (
                    <li class="schedule-card" onClick={() => onSelect(w)}>
                      <div class="schedule-card-head">
                        <span class="workout-title">{w.title}</span>
                        <span class="meta-pill">{w.minutes} min</span>
                      </div>
                      <ul class="schedule-card-ex">
                        <For each={w.exercises.filter((ex) => !isRest(ex))}>
                          {(ex) => <li>{ex}</li>}
                        </For>
                      </ul>
                    </li>
                  )}
                </For>
              </ul>
            </section>
          )}
        </For>
      </div>
    </div>
  );
}
