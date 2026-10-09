// The single script entry for every page. One entry (no shared chunks) keeps the module graph to
// one request: a chained chunk import delayed the first render enough to make Chrome skip
// cross-document view transitions intermittently.
import './core';
import { initHome } from './home';

if (document.getElementById('picker') && window.__jshSel) initHome();

// Optional Spatial view (homepage). Loaded on demand as its own self-contained chunk, so the
// main entry stays a single module with no chained imports.
if (document.getElementById('spatial')) import('./spatial').then((m) => m.initSpatial());
