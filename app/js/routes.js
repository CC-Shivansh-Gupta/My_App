// Section names, icons and bottom-bar configuration (shared by the shell and Settings).

import * as store from './store.js';

export const ROUTE_META = {
  today: { title: 'Today', icon: 'today', sub: 'Your day at a glance' },
  calendar: { title: 'Calendar', icon: 'calendar', sub: 'Events and your month' },
  tasks: { title: 'Tasks', icon: 'tasks', sub: 'Everything on your plate, under headings' },
  habits: { title: 'Habits', icon: 'habits', sub: 'Streaks and trends' },
  goals: { title: 'Goals', icon: 'goals', sub: 'Monthly, yearly and life goals' },
  gym: { title: 'Gym', icon: 'gym', sub: 'Workouts, routines and PRs' },
  money: { title: 'Money', icon: 'money', sub: 'Spending and budget' },
  notes: { title: 'Notes', icon: 'notes', sub: 'Quick notes and checklists' },
  reading: { title: 'Reading', icon: 'reading', sub: 'What you’re reading & up next' },
  news: { title: 'News', icon: 'news', sub: 'Papers, jobs & posts for you' },
  settings: { title: 'Settings', icon: 'settings', sub: 'Sync, voice, budget, backup' },
  more: { title: 'More', icon: 'more', sub: '' },
};

export const SIDEBAR = ['today', 'calendar', 'tasks', 'habits', 'goals', 'gym', 'money', 'notes', 'reading', 'news'];
export const DEFAULT_TABS = ['today', 'calendar', 'tasks', 'habits', 'money'];

// The five sections pinned to the phone's bottom bar (the sixth slot is always "More").
export function bottomTabs() {
  const tabs = store.pref('navTabs', DEFAULT_TABS).filter((k) => SIDEBAR.includes(k));
  return tabs.length ? tabs.slice(0, 5) : DEFAULT_TABS;
}
