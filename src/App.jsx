import { createSignal, Show, Switch, Match } from 'solid-js';
import workouts from './workouts.json';
import { assignColors } from './timer.js';
import { resumeAudio } from './audio.js';
import DetailView from './views/DetailView.jsx';
import ActiveView from './views/ActiveView.jsx';
import ScheduleView from './views/ScheduleView.jsx';

export default function App() {
  const [view, setView] = createSignal('schedule'); // 'schedule' | 'detail' | 'active'
  const [selectedWorkout, setSelectedWorkout] = createSignal(null);
  const [colorMap, setColorMap] = createSignal({});

  function selectWorkout(w) {
    setSelectedWorkout(w);
    setView('detail');
  }

  function startWorkout() {
    resumeAudio();
    setColorMap(assignColors(selectedWorkout().exercises));
    setView('active');
  }

  function cancelWorkout() {
    setView('detail');
  }

  function completeWorkout() {
    setView('detail');
  }

  return (
    <div class="app">
      <Switch>
        <Match when={view() === 'schedule'}>
          <ScheduleView workouts={workouts} onSelect={selectWorkout} />
        </Match>
        <Match when={view() === 'detail'}>
          <DetailView
            workout={selectedWorkout()}
            onStart={startWorkout}
            onBack={() => setView('schedule')}
          />
        </Match>
        <Match when={view() === 'active'}>
          <ActiveView
            workout={selectedWorkout()}
            colorMap={colorMap()}
            onCancel={cancelWorkout}
            onComplete={completeWorkout}
          />
        </Match>
      </Switch>
    </div>
  );
}
