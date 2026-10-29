/* HireLens AI — Configuration: storage keys, status list, default scoring weights, API base URL and token storage.
 * Classic (non-module) script: top-level declarations are shared globals; load order is set in index.html. */
'use strict';

var KEY = 'hirelens_demo_v2', TESTKEY = 'hirelens_selftest_tmp';
// Preferences only (theme, saved scoring weights). In a real session this is the ONLY thing kept in localStorage besides the JWT.
var PREFS_KEY = 'hirelens_prefs_v1';

var STATUSES = ['New', 'Under Review', 'Shortlisted', 'Rejected', 'Interview', 'Hired'];

var SCOLOR = { 'New': 'var(--faint)', 'Under Review': 'var(--warn)', 'Shortlisted': 'var(--ok)', 'Rejected': 'var(--bad)', 'Interview': 'var(--accent)', 'Hired': '#7C8BD9' };

var WEIGHTS = { skills: 0.35, experience: 0.20, semantic: 0.25, education: 0.10, projects: 0.10 };

var DEMO_EMAIL = 'demo@hirelens.ai', DEMO_PASS = 'password';

// Single configurable API base URL. Override before this file loads by setting
// window.HIRELENS_API_BASE_URL (e.g. in a small inline snippet placed before this file).
// Defaults to same-origin "/api" (works when the backend serves this file) or localhost:3000 in dev.
// Opening this file directly (file://) has no "origin" to be same-origin with, so a relative "/api"
// would resolve to a broken file:///api path — always use the explicit dev server in that case.
var API_BASE_URL = (window.HIRELENS_API_BASE_URL) ||
  (location.protocol === 'file:' ? 'http://localhost:3000/api' :
    (location.port && location.port !== '3000' ? 'http://localhost:3000/api' : '/api'));

var TOKEN_KEY = 'hirelens_token_v1';

function getToken() { try { return localStorage.getItem(TOKEN_KEY); } catch (e) { return null; } }

function setToken(t) { try { if (t) localStorage.setItem(TOKEN_KEY, t); else localStorage.removeItem(TOKEN_KEY); } catch (e) { /* ignore */ } }

var backendOnline = true; // flips to false after a failed connectivity check; UI shows a small notice
