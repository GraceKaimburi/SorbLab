// icons.js: small line icons drawn as SVG, so the interface uses classic symbols and not emoji.
// Each icon is a 20 by 20 drawing with a 1.6 pixel stroke that takes its colour from the surrounding text.

const wrap = (body) => `<svg class="icon" viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`; // shared outer shape for all icons

export const ICONS = { // the icon set, looked up by name
  search: wrap('<circle cx="9" cy="9" r="5.5"/><path d="M13.2 13.2L17 17"/>'), // a magnifying glass for the ask button
  copy: wrap('<rect x="7" y="7" width="9" height="9" rx="1.5"/><path d="M13 7V5.5A1.5 1.5 0 0 0 11.5 4h-6A1.5 1.5 0 0 0 4 5.5v6A1.5 1.5 0 0 0 5.5 13H7"/>'), // two overlapping sheets for copy
  download: wrap('<path d="M10 3v9"/><path d="M6.5 8.8L10 12.3l3.5-3.5"/><path d="M4 16h12"/>'), // an arrow into a tray for download
  help: wrap('<circle cx="10" cy="10" r="7"/><path d="M8 8a2 2 0 1 1 3 1.7c-.7.4-1 .9-1 1.6"/><path d="M10 14.2v.1"/>'), // a question mark in a circle
  file: wrap('<path d="M5.5 3h6L15 6.5V16a1 1 0 0 1-1 1H5.5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><path d="M11.5 3v3.5H15"/>'), // a page with a folded corner
  check: wrap('<path d="M4.5 10.5l3.5 3.5 7.5-8"/>'), // a tick to confirm an action
  warn: wrap('<path d="M10 3L18 16.5H2z"/><path d="M10 8.5v3.5"/><path d="M10 14.3v.1"/>'), // a triangle with an exclamation mark for cautions
  info: wrap('<circle cx="10" cy="10" r="7"/><path d="M10 9v5"/><path d="M10 6.2v.1"/>'), // a circle with an i for notes
  sun: wrap('<circle cx="10" cy="10" r="3.2"/><path d="M10 2.5v2M10 15.5v2M2.5 10h2M15.5 10h2M4.7 4.7l1.4 1.4M13.9 13.9l1.4 1.4M4.7 15.3l1.4-1.4M13.9 6.1l1.4-1.4"/>'), // a sun for the light theme
  moon: wrap('<path d="M16 11.5A6.5 6.5 0 0 1 8.5 4a6.5 6.5 0 1 0 7.5 7.5z"/>'), // a crescent for the dark theme
};
