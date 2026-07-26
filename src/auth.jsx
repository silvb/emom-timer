import { createSignal, Show } from 'solid-js';
import { supabase } from './db.js';

const [session, setSession] = createSignal(null);
const [ready, setReady] = createSignal(false);

supabase.auth
  .getSession()
  .then(({ data }) => {
    setSession(data.session);
  })
  .catch(() => {
    // Network/auth-service failure while checking for an existing session.
    // Fall through to the login form rather than getting stuck on "Loading…"
    // forever — a fresh sign-in retries the underlying request anyway.
    setSession(null);
  })
  .finally(() => setReady(true));

// Page-lifetime singleton: created once at module load and never torn down.
// There is exactly one LoginGate for the life of the app, so there is no
// natural component-cleanup boundary for this — module-scoped session/ready
// signals live for the same lifetime with no disposal either.
supabase.auth.onAuthStateChange((_event, next) => setSession(next));

export const useSession = () => session;
export const signOut = () => supabase.auth.signOut();

export function LoginGate(props) {
  const [email, setEmail] = createSignal('');
  const [password, setPassword] = createSignal('');
  const [error, setError] = createSignal(null);
  const [busy, setBusy] = createSignal(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { error: err } = await supabase.auth.signInWithPassword({
        email: email(),
        password: password(),
      });
      if (err) setError(err.message);
    } catch (err) {
      setError(err?.message ?? 'Sign in failed. Try again.');
    } finally {
      setBusy(false);
    }
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
