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
  const [view, setView] = createSignal('schedule'); // 'schedule' | 'detail' | 'active'
  const [selectedId, setSelectedId] = createSignal(null);
  const [colorMap, setColorMap] = createSignal({});
  const [toast, setToast] = createSignal(null);

  const workouts = () => data()?.programme.workouts ?? [];
  const selectedWorkout = () => workouts().find((w) => w.id === selectedId()) ?? null;

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
          <ScheduleView workouts={workouts()} onSelect={selectWorkout} />
        </Match>

        <Match when={data() && view() === 'detail'}>
          <DetailView
            workout={selectedWorkout()}
            workouts={workouts()}
            onStart={startWorkout}
            onBack={() => setView('schedule')}
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
      </Switch>

      <Toast message={toast()} onDismiss={() => setToast(null)} />
    </>
  );
}
