import { createSignal, createResource, Show, Switch, Match } from 'solid-js';
import { assignColors } from './timer.js';
import { resumeAudio } from './audio.js';
import { loadProgramme } from './db.js';
import { cacheAgeText } from './render.js';
import { LoginGate } from './auth.jsx';
import Toast from './components/Toast.jsx';
import DetailView from './views/DetailView.jsx';
import ActiveView from './views/ActiveView.jsx';
import ScheduleView from './views/ScheduleView.jsx';
import ExerciseLibraryView from './views/ExerciseLibraryView.jsx';
import WorkoutFormSheet from './views/WorkoutFormSheet.jsx';

export default function App() {
  return (
    <div class="app">
      <LoginGate>
        <Programme />
      </LoginGate>
    </div>
  );
}

function Programme() {
  const [data, { refetch }] = createResource(loadProgramme);
  const [view, setView] = createSignal('schedule'); // 'schedule' | 'detail' | 'active' | 'library'
  const [selectedId, setSelectedId] = createSignal(null);
  const [colorMap, setColorMap] = createSignal({});
  const [toast, setToast] = createSignal(null);
  const [workoutForm, setWorkoutForm] = createSignal(null); // null | { workout: object|null }

  const workouts = () => data()?.programme.workouts ?? [];
  const selectedWorkout = () => workouts().find((w) => w.id === selectedId()) ?? null;

  // Structural editing reads the current slot set, changes it, and writes the
  // whole set back. Doing that from a cached copy can silently undo a change
  // made elsewhere, so the editors are closed while the data is known stale.
  // Prescription writes are append-only and carry no such hazard, which is why
  // they stay available.
  const stale = () => Boolean(data()?.stale);

  function selectWorkout(w) {
    setSelectedId(w.id);
    setView('detail');
  }

  function startWorkout() {
    resumeAudio();
    setColorMap(assignColors(selectedWorkout().slots));
    setView('active');
  }

  return (
    <>
      <Show when={!data.error && data()?.stale}>
        <div class="stale-banner">
          Offline — showing workouts saved {cacheAgeText(data().cachedAt) ?? 'earlier'}.
        </div>
      </Show>

      <Switch fallback={<div class="app-state">Loading…</div>}>
        <Match when={data.error}>
          <div class="app-state app-error">
            Could not load your workouts.
            <button class="start-btn" onClick={() => refetch()}>Retry</button>
          </div>
        </Match>

        <Match when={data() && view() === 'schedule'}>
          <ScheduleView
            workouts={workouts()}
            stale={stale()}
            onSelect={selectWorkout}
            onNewWorkout={() => setWorkoutForm({ workout: null })}
            onOpenLibrary={() => setView('library')}
          />
        </Match>

        <Match when={data() && view() === 'detail'}>
          <DetailView
            workout={selectedWorkout()}
            workouts={workouts()}
            exercises={data().programme.exercises}
            stale={stale()}
            onStart={startWorkout}
            onBack={() => setView('schedule')}
            onEditWorkout={(w) => setWorkoutForm({ workout: w })}
            onSaved={refetch}
            onError={(m) => setToast(m)}
          />
        </Match>

        <Match when={data() && view() === 'active'}>
          <ActiveView
            workout={selectedWorkout()}
            colorMap={colorMap()}
            onCancel={() => setView('detail')}
            onComplete={() => setView('detail')}
          />
        </Match>

        <Match when={data() && view() === 'library'}>
          <ExerciseLibraryView
            programme={data().programme}
            workouts={workouts()}
            stale={stale()}
            onBack={() => setView('schedule')}
            onSaved={refetch}
            onError={(m) => setToast(m)}
          />
        </Match>
      </Switch>

      <Show when={workoutForm()} keyed>
        {(form) => (
          <WorkoutFormSheet
            workout={form.workout}
            workouts={workouts()}
            onClose={() => setWorkoutForm(null)}
            onSaved={refetch}
            onError={(m) => setToast(m)}
            // Returned, not fired and forgotten: the sheet awaits this to tell
            // a failed refresh apart from a failed write.
            onDeleted={() => {
              setView('schedule');
              return refetch();
            }}
          />
        )}
      </Show>

      <Toast message={toast()} onDismiss={() => setToast(null)} />
    </>
  );
}
