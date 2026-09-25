// Exercise library. Built-in exercises live in code; custom ones are stored
// (and synced) in the "exercises" collection.

import * as store from '../store.js';

// Category decides which columns a set has.
//   weight: kg × reps · reps: reps only · assisted: −kg × reps · duration: time · cardio: km + time
export const CATEGORIES = {
  barbell: { label: 'Barbell', fields: ['weight', 'reps'] },
  dumbbell: { label: 'Dumbbell', fields: ['weight', 'reps'] },
  machine: { label: 'Machine', fields: ['weight', 'reps'] },
  cable: { label: 'Cable', fields: ['weight', 'reps'] },
  kettlebell: { label: 'Kettlebell', fields: ['weight', 'reps'] },
  weighted: { label: 'Weighted bodyweight', fields: ['weight', 'reps'] },
  assisted: { label: 'Assisted bodyweight', fields: ['weight', 'reps'], assisted: true },
  reps: { label: 'Reps only', fields: ['reps'] },
  duration: { label: 'Duration', fields: ['seconds'] },
  cardio: { label: 'Cardio', fields: ['distance', 'seconds'] },
};

export const BODY_PARTS = ['Chest', 'Back', 'Legs', 'Shoulders', 'Arms', 'Core', 'Full body', 'Cardio', 'Other'];

const LIB = [
  // Chest
  ['Bench Press', 'barbell', 'Chest'], ['Incline Bench Press', 'barbell', 'Chest'], ['Decline Bench Press', 'barbell', 'Chest'],
  ['Bench Press', 'dumbbell', 'Chest'], ['Incline Bench Press', 'dumbbell', 'Chest'], ['Chest Fly', 'dumbbell', 'Chest'],
  ['Cable Crossover', 'cable', 'Chest'], ['Chest Press', 'machine', 'Chest'], ['Pec Deck', 'machine', 'Chest'],
  ['Push Up', 'reps', 'Chest'], ['Chest Dip', 'reps', 'Chest'], ['Chest Dip', 'weighted', 'Chest'],
  // Back
  ['Deadlift', 'barbell', 'Back'], ['Bent Over Row', 'barbell', 'Back'], ['Bent Over Row', 'dumbbell', 'Back'],
  ['Pendlay Row', 'barbell', 'Back'], ['T Bar Row', 'barbell', 'Back'], ['Pull Up', 'reps', 'Back'], ['Pull Up', 'weighted', 'Back'],
  ['Pull Up', 'assisted', 'Back'], ['Chin Up', 'reps', 'Back'], ['Lat Pulldown', 'cable', 'Back'], ['Seated Row', 'cable', 'Back'],
  ['Seated Row', 'machine', 'Back'], ['Face Pull', 'cable', 'Back'], ['Back Extension', 'reps', 'Back'], ['Rack Pull', 'barbell', 'Back'],
  // Legs
  ['Squat', 'barbell', 'Legs'], ['Front Squat', 'barbell', 'Legs'], ['Goblet Squat', 'dumbbell', 'Legs'], ['Hack Squat', 'machine', 'Legs'],
  ['Leg Press', 'machine', 'Legs'], ['Romanian Deadlift', 'barbell', 'Legs'], ['Romanian Deadlift', 'dumbbell', 'Legs'],
  ['Lunge', 'dumbbell', 'Legs'], ['Walking Lunge', 'dumbbell', 'Legs'], ['Bulgarian Split Squat', 'dumbbell', 'Legs'],
  ['Leg Extension', 'machine', 'Legs'], ['Leg Curl', 'machine', 'Legs'], ['Calf Raise', 'machine', 'Legs'],
  ['Standing Calf Raise', 'dumbbell', 'Legs'], ['Hip Thrust', 'barbell', 'Legs'], ['Glute Bridge', 'reps', 'Legs'], ['Step Up', 'dumbbell', 'Legs'],
  // Shoulders
  ['Overhead Press', 'barbell', 'Shoulders'], ['Shoulder Press', 'dumbbell', 'Shoulders'], ['Shoulder Press', 'machine', 'Shoulders'],
  ['Arnold Press', 'dumbbell', 'Shoulders'], ['Lateral Raise', 'dumbbell', 'Shoulders'], ['Lateral Raise', 'cable', 'Shoulders'],
  ['Front Raise', 'dumbbell', 'Shoulders'], ['Rear Delt Fly', 'dumbbell', 'Shoulders'], ['Reverse Fly', 'machine', 'Shoulders'],
  ['Upright Row', 'barbell', 'Shoulders'], ['Shrug', 'dumbbell', 'Shoulders'], ['Shrug', 'barbell', 'Shoulders'],
  // Arms
  ['Bicep Curl', 'barbell', 'Arms'], ['Bicep Curl', 'dumbbell', 'Arms'], ['Bicep Curl', 'cable', 'Arms'], ['Hammer Curl', 'dumbbell', 'Arms'],
  ['Preacher Curl', 'barbell', 'Arms'], ['Concentration Curl', 'dumbbell', 'Arms'], ['Triceps Pushdown', 'cable', 'Arms'],
  ['Triceps Extension', 'dumbbell', 'Arms'], ['Overhead Triceps Extension', 'cable', 'Arms'], ['Skullcrusher', 'barbell', 'Arms'],
  ['Close Grip Bench Press', 'barbell', 'Arms'], ['Triceps Dip', 'reps', 'Arms'], ['Wrist Curl', 'dumbbell', 'Arms'],
  // Core
  ['Plank', 'duration', 'Core'], ['Side Plank', 'duration', 'Core'], ['Crunch', 'reps', 'Core'], ['Cable Crunch', 'cable', 'Core'],
  ['Hanging Leg Raise', 'reps', 'Core'], ['Russian Twist', 'reps', 'Core'], ['Ab Wheel', 'reps', 'Core'], ['Sit Up', 'reps', 'Core'],
  // Full body
  ['Clean and Press', 'barbell', 'Full body'], ['Power Clean', 'barbell', 'Full body'], ['Kettlebell Swing', 'kettlebell', 'Full body'],
  ['Thruster', 'barbell', 'Full body'], ['Burpee', 'reps', 'Full body'], ["Farmer's Walk", 'dumbbell', 'Full body'],
  // Cardio
  ['Running', 'cardio', 'Cardio'], ['Treadmill', 'cardio', 'Cardio'], ['Cycling', 'cardio', 'Cardio'], ['Rowing', 'cardio', 'Cardio'],
  ['Elliptical', 'cardio', 'Cardio'], ['Walking', 'cardio', 'Cardio'], ['Swimming', 'cardio', 'Cardio'], ['Jump Rope', 'duration', 'Cardio'],
  ['Stair Climber', 'duration', 'Cardio'],
];

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export const BUILT_IN = LIB.map(([name, category, bodyPart]) => ({
  id: `x-${slug(name)}-${category}`, name, category, bodyPart, builtIn: true,
}));
const BY_ID = Object.fromEntries(BUILT_IN.map((e) => [e.id, e]));

export function displayName(ex) {
  if (!ex) return 'Unknown exercise';
  const needsTag = ['barbell', 'dumbbell', 'machine', 'cable', 'kettlebell', 'weighted', 'assisted'].includes(ex.category);
  return needsTag ? `${ex.name} (${CATEGORIES[ex.category].label.replace(' bodyweight', '')})` : ex.name;
}

export function allExercises() {
  return [...BUILT_IN, ...store.all('exercises')].sort((a, b) => displayName(a).localeCompare(displayName(b)));
}

export function getExercise(id) {
  return BY_ID[id] || store.get('exercises', id) || null;
}

export function fields(ex) {
  return (CATEGORIES[ex?.category] || CATEGORIES.barbell).fields;
}

export function findByName(name, category) {
  return BUILT_IN.find((e) => e.name === name && (!category || e.category === category)) || null;
}

// Example routines offered to new users (Strong ships similar ones).
export const EXAMPLE_TEMPLATES = [
  { name: 'Push', items: [['Bench Press', 'barbell', 5, 3], ['Overhead Press', 'barbell', 8, 3], ['Incline Bench Press', 'dumbbell', 10, 3], ['Lateral Raise', 'dumbbell', 12, 3], ['Triceps Pushdown', 'cable', 12, 3]] },
  { name: 'Pull', items: [['Deadlift', 'barbell', 5, 3], ['Pull Up', 'reps', 8, 3], ['Seated Row', 'cable', 10, 3], ['Face Pull', 'cable', 15, 3], ['Bicep Curl', 'dumbbell', 12, 3]] },
  { name: 'Legs', items: [['Squat', 'barbell', 5, 3], ['Romanian Deadlift', 'barbell', 8, 3], ['Leg Press', 'machine', 10, 3], ['Leg Curl', 'machine', 12, 3], ['Calf Raise', 'machine', 15, 3]] },
  { name: 'Full Body', items: [['Squat', 'barbell', 5, 3], ['Bench Press', 'barbell', 5, 3], ['Bent Over Row', 'barbell', 8, 3], ['Overhead Press', 'barbell', 8, 3], ['Plank', 'duration', 0, 3]] },
];

export function exampleToTemplate(ex) {
  return {
    name: ex.name,
    exercises: ex.items.map(([name, cat, reps, sets]) => ({
      exId: findByName(name, cat).id,
      sets: Array.from({ length: sets }, () => ({ type: 'normal', reps: reps || null, weight: null, seconds: cat === 'duration' ? 60 : null })),
    })),
  };
}
