import { createSignal, Show, Switch, Match } from 'solid-js';
import workouts from './workouts.json';
import { assignColors } from './timer.js';
import { resumeAudio } from './audio.js';
import HomeView from './views/HomeView.jsx';
import DetailView from './views/DetailView.jsx';
import ActiveView from './views/ActiveView.jsx';

export default function App() {
  const [view, setView] = createSignal('home'); // 'home' | 'detail' | 'active'
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
        <Match when={view() === 'home'}>
          <HomeView workouts={workouts} onSelect={selectWorkout} />
        </Match>
        <Match when={view() === 'detail'}>
          <DetailView
            workout={selectedWorkout()}
            onStart={startWorkout}
            onBack={() => setView('home')}
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
