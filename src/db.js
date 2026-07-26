import { createClient } from '@supabase/supabase-js';
import { shapeProgramme } from './model.js';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

export const supabase = createClient(url, key);

const CACHE_KEY = 'emom.programme.v1';

export function writeCache(programme) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), programme }));
  } catch {
    // A full or unavailable localStorage must never break the workout.
  }
}

export function readCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

async function fetchProgramme() {
  const [exercises, prescriptions, workouts, slots] = await Promise.all([
    supabase.from('exercises').select('*'),
    supabase.from('current_prescriptions').select('*'),
    supabase.from('workouts').select('*'),
    supabase.from('workout_slots').select('*'),
  ]);

  const failed = [exercises, prescriptions, workouts, slots].find((r) => r.error);
  if (failed) throw failed.error;

  return shapeProgramme(exercises.data, prescriptions.data, workouts.data, slots.data);
}

// Always prefer live data. Fall back to the last good read so a network blip
// outdoors degrades to stale content rather than an empty screen.
export async function loadProgramme() {
  try {
    const programme = await fetchProgramme();
    writeCache(programme);
    return { programme, stale: false };
  } catch (error) {
    const cached = readCache();
    // cachedAt is what makes the stale banner honest: five seconds offline and
    // three weeks offline are the same screen without it, and only one of them
    // is safe to load a bar from. Older cache entries predate the field.
    if (cached) {
      return { programme: cached.programme, stale: true, cachedAt: cached.at ?? null, error };
    }
    throw error;
  }
}

// Append-only: this inserts a new row, it never updates the previous one.
// The insert history is the training journal.
export async function savePrescription({ exercise_slug, reps_min, reps_max, weights }) {
  const { error } = await supabase.from('prescriptions').insert({
    exercise_slug,
    reps_min,
    reps_max,
    weights,
  });
  if (error) throw error;
}
