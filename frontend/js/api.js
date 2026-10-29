/* HireLens AI — API layer: fetch/auth handling, backend<->UI data adapters, the API object, pagination, remote-data cache.
 * Classic (non-module) script: top-level declarations are shared globals; load order is set in index.html. */
'use strict';

/** Low-level fetch wrapper: JSON in/out, Bearer token, predictable errors. Never throws ApiAuthError except on 401. */
function ApiAuthError(msg) { this.message = msg; this.name = 'ApiAuthError'; }

ApiAuthError.prototype = Object.create(Error.prototype);

function apiFetch(path, opts) {
  opts = opts || {};
  var headers = opts.headers || {};
  var token = getToken();
  if (token) headers['Authorization'] = 'Bearer ' + token;
  var fetchOpts = { method: opts.method || 'GET', headers: headers };
  if (opts.body !== undefined) {
    if (opts.body instanceof FormData) fetchOpts.body = opts.body;
    else { headers['Content-Type'] = 'application/json'; fetchOpts.body = JSON.stringify(opts.body); }
  }
  return fetch(API_BASE_URL + path, fetchOpts).then(function (res) {
    return res.json().catch(function () { return {}; }).then(function (j) {
      if (res.status === 401) {
        var isCredentialCheck = /^\/auth\/(login|register)/.test(path);
        if (!isCredentialCheck) { setToken(null); if (typeof sessionExpired === 'function') sessionExpired(); }
        throw new ApiAuthError((j && j.message) || 'Session expired. Please sign in again.');
      }
      if (!res.ok || j.success === false) throw new Error((j && j.message) || ('Request failed (' + res.status + ')'));
      return j.data !== undefined ? j.data : j;
    });
  }, function () {
    throw new Error('Could not reach the HireLens server. Check your connection or try again later.');
  });
}

/* ------ adapters: backend document shape <-> the shape every view/render function already expects ------ */
function jobIn(j) {
  return { id: String(j._id || j.id), title: j.title || '', company: j.company || '', location: j.location || '',
    exp: j.experience || 0, edu: j.education || '', req: normalizeSkills(j.requiredSkills || []), pref: normalizeSkills(j.preferredSkills || []),
    desc: j.description || '', status: j.status || 'Open', created: j.createdAt || j.created || new Date().toISOString(), analysis: j.analysis ? { req: j.analysis.requiredSkills || [], pref: j.analysis.preferredSkills || [], exp: (j.analysis.experience && j.analysis.experience.text) || 'Not specified', expYears: (j.analysis.experience && j.analysis.experience.years) || 0, edu: j.analysis.education || 'Not specified', resp: j.analysis.responsibilities || [], source: j.analysis.source } : null };
}

function candIn(c) {
  return { id: String(c._id || c.id), jobId: c.job ? String(c.job) : '', name: c.name || '', email: c.email || '', phone: c.phone || '',
    location: c.location || '', skills: normalizeSkills(c.skills || []), education: c.education || [], experience: c.experience || [],
    projects: c.projects || [], certs: c.certifications || c.certs || [], status: c.status || 'New', notes: c.notes || '',
    created: c.createdAt || c.created || new Date().toISOString(),
    links: c.links || {}, summary: c.summary || '', achievements: c.achievements || [], educationDetails: c.educationDetails || [],
    publications: c.publications || [], extraction: c.extraction || null,
    skillGroups: c.skillGroups || null, yearsOfExperience: c.yearsOfExperience || 0, yearsSource: c.yearsSource || 'unknown' };
}

// Real REST calls to the HireLens-AI backend (Backend/src/routes). Every method keeps its original
// signature/return shape so existing callers (ACTIONS, forms) did not need to change. On a network
// failure each method is allowed to throw; callers that must keep working offline catch it themselves
// and fall back to the local deterministic engine (see scoreCandidate / makeQuestions / buildReport above).
function delay(ms) { return new Promise(function (res) { setTimeout(res, ms); }); }

/** The backend caps list endpoints at 100 rows per page (parsePaging), so walk the pages instead of
 *  asking for a larger limit that would be silently truncated. */
function fetchAllPages(basePath, pageSize) {
  var all = [];
  function next(page) {
    return apiFetch(basePath + 'limit=' + pageSize + '&page=' + page).then(function (rows) {
      rows = Array.isArray(rows) ? rows : [];
      all = all.concat(rows);
      return rows.length >= pageSize && page < 50 ? next(page + 1) : all; // page<50 = hard safety stop
    });
  }
  return next(1);
}

var API = {
  login: function (email, password) { return apiFetch('/auth/login', { method: 'POST', body: { email: email, password: password } }); },
  register: function (name, email, password) { return apiFetch('/auth/register', { method: 'POST', body: { name: name, email: email, password: password } }); },
  me: function () { return apiFetch('/auth/me'); },

  getJobs: function () { return fetchAllPages('/jobs?', 100).then(function (list) { return list.map(jobIn); }); },
  createJob: function (data) { return apiFetch('/jobs', { method: 'POST', body: data }).then(jobIn); },
  updateJob: function (id, data) { return apiFetch('/jobs/' + id, { method: 'PUT', body: data }).then(jobIn); },
  analyzeJobApi: function (id) { return apiFetch('/jobs/' + id + '/analyze', { method: 'POST' }); },

  getCandidates: function (jobId) { return fetchAllPages('/candidates?' + (jobId ? 'job=' + jobId + '&' : ''), 100).then(function (list) { return list.map(candIn); }); },
  createCandidate: function (data) { return apiFetch('/candidates', { method: 'POST', body: data }).then(candIn); },
  updateCandidate: function (id, data) { return apiFetch('/candidates/' + id, { method: 'PUT', body: data }).then(candIn); },
  /** Sends a resume to POST /candidates/upload. opts: { preview: bool, overrides: object, onStage: fn('uploading'|'parsing', pct) } */
  uploadResume: function (file, jobId, opts) {
    opts = opts || {};
    return new Promise(function (resolve, reject) {
      var fd = new FormData();
      fd.append('job', jobId);
      if (opts.preview) fd.append('preview', 'true');
      if (opts.overrides) fd.append('overrides', JSON.stringify(opts.overrides));
      fd.append('resume', file); // file last so the text fields are already parsed when multer sees it
      var xhr = new XMLHttpRequest();
      xhr.open('POST', API_BASE_URL + '/candidates/upload');
      var token = getToken(); if (token) xhr.setRequestHeader('Authorization', 'Bearer ' + token);
      if (opts.onStage && xhr.upload) {
        xhr.upload.onprogress = function (e) { if (e.lengthComputable) opts.onStage('uploading', Math.round(e.loaded / e.total * 100)); };
        xhr.upload.onload = function () { opts.onStage('parsing', 100); }; // bytes are on the server; it is now extracting + parsing
      }
      xhr.onerror = function () { reject(new Error('Could not reach the HireLens server. Check your connection and try again.')); };
      xhr.onload = function () {
        var j = {}; try { j = JSON.parse(xhr.responseText); } catch (e) { j = {}; }
        if (xhr.status === 401) { setToken(null); if (typeof sessionExpired === 'function') sessionExpired(); return reject(new ApiAuthError((j && j.message) || 'Session expired. Please sign in again.')); }
        if (xhr.status < 200 || xhr.status >= 300 || j.success === false) { var err = new Error((j && j.message) || ('Upload failed (' + xhr.status + ')')); err.status = xhr.status; return reject(err); }
        var d = j.data || {};
        resolve(d.preview ? { preview: d.preview, file: d.file, resumeHash: d.resumeHash, warnings: d.warnings || [], extraction: d.extraction || null } : { candidate: candIn(d.candidate), warnings: d.warnings || [] });
      };
      xhr.send(fd);
    });
  },
  getUploadConfig: function () { return apiFetch('/candidates/upload-config'); },
  compareCandidates: function (ids, jobId, weights) { return apiFetch('/candidates/compare', { method: 'POST', body: { candidateIds: ids, jobId: jobId, weights: weights } }); },

  screenCandidate: function (candidateId, jobId, weights) { return apiFetch('/screen', { method: 'POST', body: { candidateId: candidateId, jobId: jobId, weights: weights } }); },

  getRanking: function (jobId, sort) { return apiFetch('/jobs/' + jobId + '/ranking' + (sort ? '?sort=' + sort : '')); },
  simulateRanking: function (jobId, weights) { return apiFetch('/jobs/' + jobId + '/ranking/simulate', { method: 'POST', body: { weights: weights } }); },

  generateInterviewQuestions: function (candidateId, jobId) { return apiFetch('/interview/questions', { method: 'POST', body: { candidateId: candidateId, jobId: jobId } }); },
  getReport: function (candidateId, jobId) { return apiFetch('/reports/' + candidateId + (jobId ? '?jobId=' + jobId : '')); },
  getAnalytics: function () { return apiFetch('/analytics'); },
  getAuditLogs: function () { return apiFetch('/audit-logs?limit=100'); }
};

/* ---- tiny async-data cache so the existing synchronous render()/view*() functions can show live API
   data without being rewritten as async: a view asks remoteFetch() for a key; the first call kicks off
   the request and returns {status:'loading'}; render() is called again once it resolves/rejects. ---- */
var remote = {};

function remoteFetch(key, fetcher) {
  if (isDemo()) return { status: 'error', error: 'Demo Mode has no server', demo: true }; // demo data is computed in the browser
  var e = remote[key];
  if (e) return e;
  remote[key] = { status: 'loading' };
  fetcher().then(function (data) { remote[key] = { status: 'ok', data: data }; render(); })
    .catch(function (err) { remote[key] = { status: 'error', error: err.message || String(err) }; render(); });
  return remote[key];
}

function invalidateRemote(prefix) { Object.keys(remote).forEach(function (k) { if (!prefix || k.indexOf(prefix) === 0) delete remote[k]; }); }

function remoteSkeleton(title, sub) { return head(title, sub || 'Loading from the server…') + '<div class="card"><div class="skeleton" style="width:55%"></div><div class="skeleton" style="width:75%;margin-top:10px"></div><div class="skeleton" style="width:40%;margin-top:10px"></div></div>'; }

/** Loads jobs + candidates from the backend into the local db cache after login/refresh. */
function syncFromServer() {
  return Promise.all([API.getJobs(), API.getCandidates()]).then(function (r) {
    db.jobs = r[0]; db.cands = r[1]; backendOnline = true; saveDB();
    API.getUploadConfig().then(function (c) { uploadConfig = c; }, function () { /* keep defaults */ }); // size limit shown in the UI comes from the server
  });
}
