// theme.js: the light and dark switch, shared by every page so the choice is remembered everywhere.

import { ICONS } from './icons.js'; // the sun and moon icons

export function initTheme() { // call once when a page loads
  const root = document.documentElement; // the html element carries the chosen theme in data-theme
  try { const saved = localStorage.getItem('sorblab.theme'); if (saved) root.dataset.theme = saved; } catch (e) { /* storage may be blocked, then follow the computer setting */ } // apply a saved choice
  const btn = document.getElementById('theme'); // the toggle button in the header
  if (!btn) return; // some pages might not have it
  const isDark = () => root.dataset.theme === 'dark' || (!root.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches); // true when dark colours are showing
  const paint = () => { btn.innerHTML = isDark() ? ICONS.sun : ICONS.moon; btn.setAttribute('aria-label', isDark() ? 'Switch to light theme' : 'Switch to dark theme'); }; // shows the icon for the opposite theme and labels it for screen readers
  paint(); // draw the first icon
  btn.addEventListener('click', () => { // flip the theme when clicked
    root.dataset.theme = isDark() ? 'light' : 'dark'; // choose the other theme
    try { localStorage.setItem('sorblab.theme', root.dataset.theme); } catch (e) { /* ignore blocked storage */ } // remember the choice
    paint(); // update the icon
  });
}
