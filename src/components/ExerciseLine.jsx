import { Show, For } from 'solid-js';

export default function ExerciseLine(props) {
  return (
    <span class="ex-line">
      <Show when={props.parts.reps}><span class="ex-reps">{props.parts.reps}</span>{' '}</Show>
      <span class="ex-name">{props.parts.name}</span>
      <Show when={props.parts.weights.length}>
        {' '}<span class="ex-at">@</span>
        <For each={props.parts.weights}>
          {(w, i) => (
            <>
              <Show when={i() > 0}><span class="ex-weight-sep">–</span></Show>
              <span classList={{ 'ex-weight': true, 'ex-weight-current': w.current }}>{w.value}</span>
            </>
          )}
        </For>
        <span class="ex-unit">kg</span>
      </Show>
      <Show when={props.parts.side}>{' '}<span class="ex-side">[{props.parts.side}]</span></Show>
    </span>
  );
}
