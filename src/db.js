import { createClient } from '@supabase/supabase-js';
import { shapeProgramme } from './model.js';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

export const supabase = createClient(url, key);

// Deliberately not bumped for Phase 2's `archived` field. The cache holds the
// already-shaped programme and is returned as-is, so a v1 entry never passes
// back through shapeProgramme — its exercises simply have no `archived` key,
// which is falsy and therefore reads as active everywhere it is checked.
// Bumping would discard every cache on the first load after a deploy, and if
// that first load happens offline the user gets the error screen instead of
// their workouts.
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

// --- Structural writes ------------------------------------------------------
// Phase 2. Migration 0008 re-granted insert/update/delete on these three
// tables; before it, they were select-only and every structural change was
// dashboard SQL. The invariant triggers from 0001/0002 still police every one
// of these writes, so a rejection here is expected behaviour, not a bug — the
// callers surface the message rather than swallowing it.

function throwIf(error) {
  if (error) throw error;
}

export async function createExercise({ slug, movement, name, type, rounds, unilateral }) {
  const { error } = await supabase.from('exercises').insert({
    slug,
    movement,
    name,
    type,
    // ramp_rounds_present (0001) requires rounds to be null for every kind
    // except ramp_up, so an empty form field must become null, not 0.
    rounds: type === 'ramp_up' ? rounds : null,
    unilateral,
  });
  throwIf(error);
}

export async function updateExercise(slug, fields) {
  const { error } = await supabase.from('exercises').update(fields).eq('slug', slug);
  throwIf(error);
}

export async function setExerciseArchived(slug, archived) {
  const { error } = await supabase.from('exercises').update({ archived }).eq('slug', slug);
  throwIf(error);
}

// Only ever succeeds for an exercise with no prescriptions and no slots: both
// foreign keys are `on delete restrict`. canHardDelete() in structure.js is
// the pre-check that keeps this from being offered when it cannot work.
export async function deleteExercise(slug) {
  const { error } = await supabase.from('exercises').delete().eq('slug', slug);
  throwIf(error);
}

export async function createWorkout({ id, title, day, rounds, position }) {
  const { error } = await supabase.from('workouts').insert({ id, title, day, rounds, position });
  throwIf(error);
}

export async function updateWorkout(id, fields) {
  const { error } = await supabase.from('workouts').update(fields).eq('id', id);
  throwIf(error);
}

// workout_slots cascades; exercises and their prescriptions do not.
export async function deleteWorkout(id) {
  const { error } = await supabase.from('workouts').delete().eq('id', id);
  throwIf(error);
}

// The one RPC in the app. A slot rewrite is a delete plus an insert, and over
// the REST layer those would be two requests with no transaction between them
// — a failure after the delete would leave the workout with no slots at all.
// save_workout_slots (migration 0010) runs both inside one function body, so
// they commit together or not at all. Positions are renumbered from array
// order server-side; send the list in display order and nothing else.
export async function saveWorkoutSlots(workoutId, slots) {
  const { error } = await supabase.rpc('save_workout_slots', {
    p_workout_id: workoutId,
    p_slots: slots.map((s) => ({ exercise_slug: s.exercise_slug, side: s.side ?? null })),
  });
  throwIf(error);
}
