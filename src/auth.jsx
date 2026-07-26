import { createSignal, onCleanup, Show } from 'solid-js';
import { supabase } from './db.js';

const [session, setSession] = createSignal(null);
const [ready, setReady] = createSignal(false);

supabase.auth.getSession().then(({ data }) => {
  setSession(data.session);
  setReady(true);
});

const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));

export const useSession = () => session;
export const signOut = () => supabase.auth.signOut();

export function LoginGate(props) {
  const [email, setEmail] = createSignal('');
  const [password, setPassword] = createSignal('');
  const [error, setError] = createSignal(null);
  const [busy, setBusy] = createSignal(false);

  onCleanup(() => sub?.subscription?.unsubscribe());

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.auth.signInWithPassword({
      email: email(),
      password: password(),
    });
    if (err) setError(err.message);
    setBusy(false);
  }

  return (
    <Show when={ready()} fallback={<div class="app-state">Loading…</div>}>
      <Show
        when={session()}
        fallback={
          <div class="login-view">
            <div class="logo-mark">EMOM</div>
            <form class="login-form" onSubmit={submit}>
              <input
                type="email"
                placeholder="Email"
                autocomplete="username"
                value={email()}
                onInput={(e) => setEmail(e.currentTarget.value)}
                required
              />
              <input
                type="password"
                placeholder="Password"
                autocomplete="current-password"
                value={password()}
                onInput={(e) => setPassword(e.currentTarget.value)}
                required
              />
              <button class="start-btn" type="submit" disabled={busy()}>
                {busy() ? 'Signing in…' : 'Sign in'}
              </button>
              <Show when={error()}>
                <p class="login-error">{error()}</p>
              </Show>
            </form>
          </div>
        }
      >
        {props.children}
      </Show>
    </Show>
  );
}
