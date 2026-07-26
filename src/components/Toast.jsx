import { Show, createEffect, onCleanup } from 'solid-js';

export default function Toast(props) {
  createEffect(() => {
    if (!props.message) return;
    const id = setTimeout(() => props.onDismiss(), 5000);
    onCleanup(() => clearTimeout(id));
  });

  return (
    <Show when={props.message}>
      <div class="toast" role="alert" onClick={() => props.onDismiss()}>
        {props.message}
      </div>
    </Show>
  );
}
