/* HireLens AI — Actions: the data-act click handlers, sign-in/register flows, post-change refresh, in-browser self-test.
 * Classic (non-module) script: top-level declarations are shared globals; load order is set in index.html. */
'use strict';

/* Named computeSelfTest (not runSelfTest) because app.js publishes window.runSelfTest = showTestResults for console use;
 * as a shared global that name would otherwise overwrite this function and recurse forever. */
function computeSelfTest() {
  var res = [];
  function t(name, fn) { try { var ok = fn(); res.push({ name: name, ok: ok === true, detail: ok === true ? '' : 'returned ' + String(ok) }); } catch (e) { res.push({ name: name, ok: false, detail: e && e.message ? e.message : String(e) }); } }
  var d = defaultData();
  d.user = { email: DEMO_EMAIL, demo: true }; // the self-test always runs on the sample dataset in Demo Mode, so it never calls the server
  t('initialization: #app and login markup exist', function () { return !!appEl && LOGIN_HTML.indexOf('HireLens') >= 0 && LOGIN_HTML.indexOf('Sign In') >= 0; });
  t('localStorage: write, read and remove', function () { localStorage.setItem(TESTKEY, 'ok'); var v = localStorage.getItem(TESTKEY); localStorage.removeItem(TESTKEY); return v === 'ok'; });
  t('localStorage: corrupted JSON is rejected', function () { return parseStored('{not json') === null && parseStored('{"jobs":1}') === null && parseStored(JSON.stringify(d)) !== null; });
  t('default data: 4 jobs, 8 candidates, valid links', function () { return d.jobs.length === 4 && d.cands.length === 8 && validateDB(d); });
  t('login: demo credentials accepted, wrong rejected', function () { return authenticate(DEMO_EMAIL, DEMO_PASS) && !authenticate(DEMO_EMAIL, 'wrong') && !authenticate('', ''); });
  t('navigation: routes parse', function () { var a = parseRoute('#/jobs/2'), b = parseRoute(''), c = parseRoute('#/nope'); return a.page === 'jobs' && a.id === '2' && b.page === 'dashboard' && c.page === 'notfound' && parseRoute('#/compare').page === 'compare'; });
  t('navigation: every page renders', function () { var keep = db; db = d; try { return [viewDashboard, viewJobs, viewCandidates, viewShortlisted, viewReports, viewAnalytics, viewSettings, viewCompare, viewScreening, viewRanking, viewSimulator, viewInterview, viewEvaluation, viewFairness, viewAudit].every(function (f) { return typeof f() === 'string'; }) && viewProfile(1).length > 100 && viewJob(1).length > 100; } finally { db = keep; } });
  t('evaluation dataset: metrics bounded and consistent', function () { var e = evalDataset(); return e.precision >= 0 && e.precision <= 1 && e.recall >= 0 && e.recall <= 1 && e.f1 >= 0 && e.f1 <= 1 && e.consistent === true && e.cases.every(function (c) { return evalRun(c) === true; }); });
  t('skills: normalization', function () { return normalizeSkill('JS') === 'JavaScript' && normalizeSkill('ReactJS') === 'React' && normalizeSkill('React.js') === 'React' && normalizeSkill('Node') === 'Node.js' && normalizeSkill('Mongo DB') === 'MongoDB' && normalizeSkill('Express JS') === 'Express.js' && normalizeSkills(['JS', 'JavaScript']).length === 1; });
  t('scoring: weights sum to 1, scores bounded, overall is calculated', function () {
    var w = WEIGHTS.skills + WEIGHTS.experience + WEIGHTS.semantic + WEIGHTS.education + WEIGHTS.projects;
    if (Math.abs(w - 1) > 1e-9) return 'weights sum ' + w;
    return scoredAll(d).every(function (r) { var s = r.s, e = Math.round(s.skills * .35 + s.experience * .2 + s.semantic * .25 + s.education * .1 + s.projects * .1); return [s.overall, s.skills, s.experience, s.semantic, s.education, s.projects].every(function (v) { return v >= 0 && v <= 100; }) && s.overall === e; });
  });
  t('scoring: stronger candidate outscores weaker one', function () { var a = scoreCandidate(findCand(d, 1), findJob(d, 3)).overall, b = scoreCandidate(findCand(d, 3), findJob(d, 3)).overall; return a > b || 'Aarav ' + a + ' vs Rahul ' + b; });
  t('ranking: sorted descending within each job', function () { return d.jobs.every(function (j) { var r = rankForJob(d, j.id); return r.every(function (x, i) { return x.rank === i + 1 && (i === 0 || r[i - 1].s.overall >= x.s.overall); }); }); });
  t('filtering: search, job, status, minimum score, sort', function () {
    var a = filterCandidates(d, { q: 'aarav' }), b = filterCandidates(d, { jobId: 3 }), c = filterCandidates(d, { status: 'Rejected' }), all = filterCandidates(d, {}), hi = filterCandidates(d, { min: 80 }), skill = filterCandidates(d, { q: 'reactjs' }), low = filterCandidates(d, { sort: 'low' });
    return a.length === 1 && b.length === 3 && c.length === 1 && all.length === 8 && hi.length < all.length && hi.every(function (r) { return r.s.overall >= 80; }) && skill.length >= 3 && low[0].s.overall <= low[low.length - 1].s.overall;
  });
  t('status update: changes status and counts', function () { var before = countStatus(d, 'Hired'); var ok = setStatus(d, 3, 'Hired'); return ok && findCand(d, 3).status === 'Hired' && countStatus(d, 'Hired') === before + 1 && !setStatus(d, 3, 'Bogus') && !setStatus(d, 999, 'New'); });
  t('report: generated with required sections', function () { var keep = db; db = d; d.user = { email: DEMO_EMAIL, demo: true }; /* the report view needs Demo Mode to compute locally */ try { var r = buildReport(d, 1), h = viewReport(1); return !!r && r.s.overall > 0 && h.indexOf('Candidate Screening Report') >= 0 && h.indexOf('Score') >= 0 && buildReport(d, 999) === null; } finally { db = keep; } });
  t('upload: Demo Mode refuses uploads and never fabricates a sample candidate', function () {
    var keepUser = db.user, keepN = db.cands.length, keepQ = uploadQueue; db.user = { email: DEMO_EMAIL, demo: true }; uploadQueue = [];
    try { enqueueResumes([{ name: 'cv.pdf', size: 10 }]); return uploadQueue.length === 0 && db.cands.length === keepN && typeof POOL === 'undefined'; } finally { db.user = keepUser; uploadQueue = keepQ; }
  });
  t('upload: a job must be selected before a resume is accepted', function () {
    var keepUser = db.user, keepQ = uploadQueue, keepJob = uploadJobId; db.user = { email: 'x@y.z' }; uploadQueue = []; uploadJobId = '';
    try { enqueueResumes([{ name: 'cv.pdf', size: 10 }]); return uploadQueue.length === 0; } finally { db.user = keepUser; uploadQueue = keepQ; uploadJobId = keepJob; }
  });
  t('theme: light, dark and system preferences persist', function () {
    var prev = getTheme();
    try { setTheme('light'); var a = getTheme() === 'light' && resolvedTheme() === 'light'; setTheme('dark'); var b = getTheme() === 'dark' && resolvedTheme() === 'dark'; setTheme('system'); var c = getTheme() === 'system'; setTheme('nonsense'); return a && b && c && getTheme() === 'system'; } finally { setTheme(prev); }
  });
  t('skills: extended aliases normalise (golang, Mongo DB) without inventing skills', function () { return normalizeSkill('golang') === 'Go' && normalizeSkill('Mongo DB') === 'MongoDB' && normalizeSkill('Rust') === 'Rust' && normalizeSkills(['js', 'JavaScript']).length === 1; });
  t('interview: 5 technical, 3 behavioral, 2 project questions', function () { var c = findCand(d, 1), s = scoreCandidate(c, findJob(d, 3)), q = makeQuestions(c, findJob(d, 3), s); return q.technical.length === 5 && q.behavioral.length === 3 && q.project.length === 2; });
  t('job analysis: extracts skills and experience', function () { var a = analyzeJob(findJob(d, 3)); return a.req.indexOf('React') >= 0 && a.pref.indexOf('Docker') >= 0 && a.expYears === 2; });
  return res;
}

function showTestResults() {
  var r = computeSelfTest(), fails = r.filter(function (x) { return !x.ok; }).length;
  try { console.table(r); } catch (e) { /* ignore */ }
  openModal('<h2>Self-Test: ' + (fails ? fails + ' failed' : 'all ' + r.length + ' passed') + '</h2>' + r.map(function (x) { return '<div class="testrow"><span style="color:' + (x.ok ? 'var(--ok)' : 'var(--bad)') + '">' + (x.ok ? '✓' : '✕') + '</span><span>' + esc(x.name) + (x.ok ? '' : '<br><span class="muted small">' + esc(x.detail) + '</span>') + '</span></div>'; }).join('') + '<div class="row" style="margin-top:14px"><button class="btn primary" data-act="close">Close</button></div>');
  return r;
}

function afterChange(msg, isErr) { saveDB(); invalidateRemote('ranking:'); invalidateRemote('report:'); invalidateRemote('compare:'); invalidateRemote('analytics'); invalidateRemote('audit'); if (msg) toast(msg, isErr); render(); }

function refreshTable() { var t = $('#candTable'); if (t) t.innerHTML = tableRows(candRows()); var b = $('#cmpBtn'); if (b) b.textContent = 'Compare Selected (' + sel.length + ')'; }

var actions = {
  demo: function () { startDemo(); },
  menu: function () { var s = $('#side'); if (s) s.classList.toggle('open'); },
  dd: function () { var d = $('#dd'); if (d) d.classList.toggle('open'); },
  gosettings: function () { go('#/settings'); },
  toggletheme: function () { var order = ['light', 'dark', 'system'], next = order[(order.indexOf(getTheme()) + 1) % 3]; setTheme(next); render(); toast('Theme: ' + next.charAt(0).toUpperCase() + next.slice(1)); },
  retry: function (el) { var k = el.getAttribute('data-key'); if (k) delete remote[k]; else invalidateRemote(); render(); },
  logout: function () { var wasDemo = isDemo(); if (wasDemo) saveDB(); db.user = null; setToken(null); invalidateRemote(); uploadQueue = []; uploadJobId = ''; iqResult = null; db = loadDB(); db.user = null; closeModal(); location.hash = ''; render(); },
  close: function () { closeModal(); },
  closebg: function (el, e) { if (e.target === el) closeModal(); },
  print: function () { toast('Report generated'); try { window.print(); } catch (e) { showDevError('Print failed: ' + e.message); } },
  newjob: function () { openModal(jobFormHTML(null)); },
  editjob: function (el) { var j = findJob(db, el.dataset.id); if (j) openModal(jobFormHTML(j)); },
  screen: function (el) { filters.jobId = el.dataset.id; go('#/candidates'); },
  analyze: function (el) {
    var j = findJob(db, el.dataset.id); if (!j) return;
    el.disabled = true; el.innerHTML = '<span class="spin"></span> Analyzing…';
    if (isDemo()) { // Demo Mode only: the in-browser analyzer
      try { j.analysis = analyzeJob(j); logEvent('Analyzed requirements for ' + j.title); afterChange('Requirements analyzed'); } catch (e) { showDevError('Analysis failed: ' + e.message); render(); }
      return;
    }
    API.analyzeJobApi(j.id).then(function (a) {
      j.analysis = { req: a.requiredSkills, pref: a.preferredSkills, exp: a.experience.text, expYears: a.experience.years, edu: a.education, resp: a.responsibilities, source: a.source };
      afterChange('Requirements analyzed');
    }).catch(function (e) { render(); failToast('Could not analyze this job', e); });
  },
  applyreq: function (el) {
    var j = findJob(db, el.dataset.id); if (!j || !j.analysis) return;
    var patch = { req: normalizeSkills(j.analysis.req), pref: normalizeSkills(j.analysis.pref) };
    if (j.analysis.expYears) patch.exp = j.analysis.expYears;
    if (isDemo()) { Object.assign(j, patch); logEvent('Updated requirements for ' + j.title); afterChange('Job requirements updated'); return; }
    el.disabled = true;
    API.updateJob(j.id, patch).then(function (u) { Object.assign(j, u); afterChange('Job requirements updated'); }).catch(function (e) { el.disabled = false; failToast('Could not save the requirements', e); });
  },
  status: function (el) {
    var id = el.dataset.id, s = el.dataset.s, c = findCand(db, id); if (!c) return;
    var msg = s === 'Shortlisted' ? c.name + ' shortlisted' : s === 'Rejected' ? c.name + ' rejected' : c.name + ' moved to ' + s;
    if (isDemo()) { c.status = s; logEvent(msg); afterChange(msg); return; }
    el.disabled = true;
    API.updateCandidate(id, { status: s }).then(function (u) { Object.assign(c, u); afterChange(msg); }).catch(function (e) { el.disabled = false; render(); failToast('Could not update the candidate', e); });
  },
  sel: function (el) { var id = el.dataset.id, i = sel.indexOf(id); if (i >= 0) sel.splice(i, 1); else if (sel.length >= 4) { el.checked = false; toast('You can compare up to 4 candidates', true); } else sel.push(id); refreshTable(); },
  compare: function () { if (sel.length < 2) toast('Select 2 to 4 candidates first', true); else go('#/compare'); },
  cmpone: function (el) { var id = el.dataset.id; if (sel.indexOf(id) < 0) { if (sel.length >= 4) { toast('You can compare up to 4 candidates', true); return; } sel.push(id); } if (sel.length < 2) toast('Added to comparison. Select one more candidate.'); else go('#/compare'); },
  clearsel: function () { sel = []; render(); },
  questions: function (el) {
    var c = findCand(db, el.dataset.id); if (!c) return;
    if (isDemo()) { openModal(questionsHTML(c)); return; }
    el.disabled = true; var prevHtml = el.innerHTML; el.innerHTML = '<span class="spin"></span> Generating…';
    API.generateInterviewQuestions(c.id, c.jobId).then(function (q) {
      el.disabled = false; el.innerHTML = prevHtml;
      openModal(questionsHTML(c, q, q.source === 'ai')); toast(q.source === 'ai' ? 'Interview questions generated by AI' : 'Interview questions generated');
    }).catch(function (e) { el.disabled = false; el.innerHTML = prevHtml; failToast('Could not generate interview questions', e); });
  },
  runscreen: function () {
    var pending = scoredAll(db).filter(function (r) { return r.c.status === 'New' || r.c.status === 'Under Review'; });
    if (!pending.length) { toast('No candidates are pending review', true); return; }
    var w = currentWeights();
    if (isDemo()) {
      pending.forEach(function (r) { var s = scoreCandidate(r.c, r.j, w); db.screenings.unshift({ t: new Date().toISOString(), candId: r.c.id, jobId: r.j.id, overall: s.overall }); });
      db.screenings = db.screenings.slice(0, 50); logEvent('Batch screening completed for ' + pending.length + ' candidate(s)');
      afterChange('Screening completed for ' + pending.length + ' candidate(s)'); return;
    }
    toast('Screening ' + pending.length + ' candidate(s)…');
    // Every screening is saved by the server BEFORE the page refreshes, so Ranking/Analytics never show stale data.
    Promise.all(pending.map(function (r) {
      return API.screenCandidate(r.c.id, r.j.id, w).then(function (x) { db.screenings.unshift({ t: new Date().toISOString(), candId: r.c.id, jobId: r.j.id, overall: x.overallScore }); return true; }, function () { return false; });
    })).then(function (res) {
      var ok = res.filter(Boolean).length, failed = res.length - ok;
      db.screenings = db.screenings.slice(0, 50);
      afterChange(failed ? 'Screened ' + ok + ' of ' + res.length + ' candidate(s); ' + failed + ' failed — try again' : 'Screening completed for ' + ok + ' candidate(s)', !!failed);
    });
  },
  screenone: function (el) {
    var id = el.dataset.id, c = findCand(db, id); if (!c) return;
    var j = findJob(db, c.jobId);
    el.disabled = true; el.innerHTML = '<span class="spin"></span> Screening…';
    if (isDemo()) { var s = scoreCandidate(c, j); db.screenings.unshift({ t: new Date().toISOString(), candId: id, jobId: j.id, overall: s.overall }); afterChange('Screening completed: ' + c.name + ' — ' + s.overall + '%'); return; }
    API.screenCandidate(id, c.jobId, currentWeights()).then(function (r) {
      db.screenings.unshift({ t: new Date().toISOString(), candId: id, jobId: c.jobId, overall: r.overallScore });
      db.screenings = db.screenings.slice(0, 50);
      afterChange('Screening completed: ' + c.name + ' — ' + r.overallScore + '%');
    }).catch(function (e) { render(); failToast('Screening failed', e); });
  },
  runEval: function (el) { el.disabled = true; el.innerHTML = '<span class="spin"></span> Running evaluation…'; setTimeout(function () { try { var out = $('#evalOut'); if (out) out.innerHTML = evalResultsHTML(); el.disabled = false; el.textContent = 'Run Evaluation'; logEvent('AI evaluation run'); saveDB(); toast('Evaluation complete'); } catch (e) { showDevError('Evaluation failed: ' + e.message); el.disabled = false; el.textContent = 'Run Evaluation'; } }, 400); },
  iqtab: function (el) { iqTab = el.getAttribute('data-tab'); render(); },
  iqgen: function (el) {
    var c = findCand(db, iqSelId); if (!c) return;
    el.disabled = true; el.innerHTML = '<span class="spin"></span> Generating…';
    if (isDemo()) { var j = findJob(db, c.jobId); iqResult = makeQuestions(c, j, scoreCandidate(c, j)); iqResult.source = 'template'; iqResultFor = c.id; iqTab = 'technical'; afterChange(); return; }
    API.generateInterviewQuestions(c.id, c.jobId).then(function (q) {
      iqResult = q; iqResultFor = c.id; iqTab = 'technical'; afterChange();
    }).catch(function (e) { render(); failToast('Could not generate interview questions', e); });
  },
  iqcopy: function () {
    if (!iqResult) return;
    var all = [].concat(iqResult.technical || [], iqResult.behavioral || [], iqResult.project || [], iqResult.roleSpecific || [], iqResult.skillGap || [], iqResult.followUp || []);
    try { navigator.clipboard.writeText(all.map(function (q, i) { return (i + 1) + '. ' + q; }).join('\n\n')).then(function () { toast('Questions copied to clipboard'); }, function () { toast('Clipboard unavailable in this browser', true); }); } catch (e) { toast('Clipboard unavailable', true); }
  },
  iqcopyone: function (el) {
    var text = el.getAttribute('data-q') || '';
    try { navigator.clipboard.writeText(text).then(function () { toast('Question copied'); }, function () { toast('Clipboard unavailable in this browser', true); }); } catch (e) { toast('Clipboard unavailable', true); }
  },
  simedit: function () { simWeights = (function () { var w = currentWeights(); return { skills: w.skills, experience: w.experience, semantic: w.semantic, education: w.education, projects: w.projects }; })(); render(); toast('Simulator active — drag the sliders'); },
  simreset: function () { simWeights = null; render(); toast('Reset to saved weights'); },
  simsave: function () {
    if (!simWeights) return;
    var sum = simWeights.skills + simWeights.experience + simWeights.semantic + simWeights.education + simWeights.projects;
    if (Math.abs(sum - 1) > 0.02) { toast('Weights must total 100% before saving (currently ' + Math.round(sum * 100) + '%)', true); return; }
    db.settings.weights = simWeights; simWeights = null; logEvent('Scoring weights updated'); afterChange('Default scoring weights saved');
  },
  selftestbtn: function () { showTestResults(); },
  sortk: function (el) { var k = el.getAttribute('data-k'); if (k === 'score') { filters.sort = filters.sort === 'high' ? 'low' : 'high'; } else { filters.sort = 'new'; } render(); },
  bell: function () {
    openModal('<h2>Notifications</h2>' + (db.log.length ? db.log.slice(0, 5).map(function (l) { return '<div class="row between" style="padding:6px 0;border-bottom:1px solid var(--line)"><span>' + esc(l.m) + '</span><span class="muted small">' + fmtDate(l.t) + '</span></div>'; }).join('') : '<p class="muted">No notifications.</p>') + '<div class="row" style="margin-top:14px"><button class="btn primary" data-act="close">Close</button></div>');
  },
  report: function (el) { toast('Report generated'); go('#/reports/' + el.dataset.id); },
  viewrank: function (el) { filters.jobId = el.dataset.id; go('#/ranking'); },
  upjson: function (el) { var it = uploadItem(el.dataset.id); if (it && it.preview) downloadJson(Object.assign({}, it.preview, { name: uploadEditVal(it, 'name'), email: uploadEditVal(it, 'email'), phone: uploadEditVal(it, 'phone'), location: uploadEditVal(it, 'location'), extraction: it.extraction }), 'candidate-' + it.id + '.json'); },
  candjson: function (el) { var c = findCand(db, el.dataset.id); if (c) downloadJson(candidateExport(c), 'candidate-' + String(c.name || 'profile').toLowerCase().replace(/[^a-z0-9]+/g, '-') + '.json'); },
  editcand: function (el) { var c = findCand(db, el.dataset.id); if (c) openModal(candidateEditHTML(c)); },
  upfor: function (el) { uploadJobId = el.dataset.id || ''; go('#/candidates'); },
  upbrowse: function () { var f = $('#upFile'); if (f) f.click(); },
  upretry: function (el) { var it = uploadItem(el.dataset.id); if (!it) return; it.status = 'queued'; it.error = ''; refreshUploadQueue(); processUploadQueue(); },
  upremove: function (el) { uploadQueue = uploadQueue.filter(function (i) { return String(i.id) !== String(el.dataset.id); }); refreshUploadQueue(); },
  upclear: function () { uploadQueue = uploadQueue.filter(function (i) { return i.status === 'parsing' || i.status === 'saving'; }); refreshUploadQueue(); },
  upcreate: function (el) { var it = uploadItem(el.dataset.id); if (it && it.status === 'ready') createFromUpload(it).then(function (ok) { if (ok) afterChange('Candidate created: ' + it.preview.name); }); },
  upcreateall: function () {
    var ready = uploadQueue.filter(function (i) { return i.status === 'ready'; });
    if (!ready.length) return;
    ready.reduce(function (chain, it) { return chain.then(function (n) { return createFromUpload(it).then(function (ok) { return n + (ok ? 1 : 0); }); }); }, Promise.resolve(0))
      .then(function (n) { if (n) afterChange(n + ' candidate(s) created'); else refreshUploadQueue(); });
  },
  resetask: function () { openModal('<h2>Reset Demo Data?</h2><p class="muted">This restores the original jobs and candidates and clears your changes in this browser.</p><div class="row" style="margin-top:14px"><button class="btn bad" data-act="resetdo">Reset Demo Data</button><button class="btn" data-act="close">Cancel</button></div>'); },
  resetdo: function () { closeModal(); try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ } db = defaultData(); db.user = { email: DEMO_EMAIL }; sel = []; upload = null; filters = { q: '', jobId: '', status: '', min: 0, sort: 'high' }; go('#/dashboard'); saveDB(); render(); toast('Demo data reset'); },
  selftest: function (el, e) { e.preventDefault(); showTestResults(); }
};

/** Structured result as a downloadable JSON file (no resume text, nothing server-side). */
function downloadJson(obj, filename) {
  var blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' }), url = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
}
function candidateExport(c) {
  return { name: c.name, email: c.email, phone: c.phone, location: c.location, links: c.links, summary: c.summary, skills: c.skills, skillGroups: c.skillGroups, yearsOfExperience: c.yearsOfExperience, yearsSource: c.yearsSource,
    education: c.educationDetails && c.educationDetails.length ? c.educationDetails : c.education, experience: c.experience, projects: c.projects, certifications: c.certs, achievements: c.achievements, publications: c.publications, extraction: c.extraction };
}

function failToast(prefix, e) { toast(prefix + (e && e.message ? ': ' + e.message : '.'), true); }

/* ---------------- resume upload: choose job -> upload -> server parses -> review -> create ---------------- */
var uploadSeq = 0, uploadBusy = false;
function uploadItem(id) { return uploadQueue.filter(function (i) { return String(i.id) === String(id); })[0]; }
function maxMb() { return Math.round(uploadConfig.maxBytes / (1024 * 1024) * 10) / 10; }
function clientCheck(f) {
  if (!/\.(pdf|docx)$/i.test(f.name)) return 'Unsupported file type. Upload a PDF or DOCX resume.';
  if (f.size > uploadConfig.maxBytes) return 'Resume exceeds ' + maxMb() + ' MB.';
  if (!f.size) return 'The uploaded file is empty.';
  return '';
}
function enqueueResumes(files) {
  if (isDemo()) { toast('Resume parsing runs on the HireLens server. Sign in with a real account to upload resumes (Demo Mode has sample data only).', true); return; }
  if (!uploadJobId || !findJob(db, uploadJobId)) { toast('Select a job before uploading a resume.', true); return; }
  Array.prototype.slice.call(files).forEach(function (f) {
    var dupe = uploadQueue.some(function (i) { return i.name === f.name && i.size === f.size && i.jobId === uploadJobId && i.status !== 'error'; });
    if (dupe) { toast(f.name + ' is already in the list.', true); return; }
    var bad = clientCheck(f);
    uploadQueue.push({ id: ++uploadSeq, file: f, name: f.name, size: f.size, jobId: uploadJobId, status: bad ? 'error' : 'queued', stage: '', pct: 0, preview: null, edits: {}, warnings: [], error: bad, candId: '' });
  });
  refreshUploadQueue(); processUploadQueue();
}
function processUploadQueue() {
  if (uploadBusy) return;
  var item = uploadQueue.filter(function (i) { return i.status === 'queued'; })[0]; if (!item) return;
  uploadBusy = true; item.status = 'parsing'; item.stage = 'uploading'; item.pct = 0; refreshUploadItem(item);
  API.uploadResume(item.file, item.jobId, { preview: true, onStage: function (stage, pct) { item.stage = stage; item.pct = pct; refreshUploadItem(item); } })
    .then(function (r) { item.status = 'ready'; item.preview = r.preview; item.warnings = r.warnings || []; item.extraction = r.extraction; item.error = ''; })
    .catch(function (e) { item.status = 'error'; item.error = (e && e.message) || 'Unable to upload resume. Please check the file type and try again.'; })
    .then(function () { uploadBusy = false; refreshUploadQueue(); processUploadQueue(); });
}
function uploadEditVal(item, f) { return item.edits[f] !== undefined ? item.edits[f] : (item.preview && item.preview[f]) || ''; }
/** Saves the candidate from a reviewed extraction. The file is re-sent with the recruiter's corrections as overrides. */
function createFromUpload(item) {
  var overrides = { name: String(uploadEditVal(item, 'name')).trim(), email: String(uploadEditVal(item, 'email')).trim(), phone: String(uploadEditVal(item, 'phone')).trim(), location: String(uploadEditVal(item, 'location')).trim() };
  if (item.edits.skills !== undefined) overrides.skills = String(item.edits.skills).split(/[,\n]/).map(function (x) { return x.trim(); }).filter(Boolean);
  if (item.edits.education !== undefined) overrides.education = String(item.edits.education).split('\n').map(function (x) { return x.trim(); }).filter(Boolean);
  if (!overrides.name) { item.error = 'Enter the candidate name to continue.'; refreshUploadItem(item); return Promise.resolve(false); }
  item.status = 'saving'; item.stage = 'uploading'; item.error = ''; refreshUploadItem(item);
  return API.uploadResume(item.file, item.jobId, { overrides: overrides, onStage: function (stage, pct) { item.stage = stage; item.pct = pct; refreshUploadItem(item); } })
    .then(function (r) { db.cands.push(r.candidate); item.status = 'saved'; item.candId = r.candidate.id; item.preview = Object.assign({}, item.preview, { name: r.candidate.name }); refreshUploadItem(item); return true; })
    .catch(function (e) {
      var duplicate = e && e.status === 409;
      item.status = duplicate ? 'error' : 'ready'; item.error = (e && e.message) || 'Unable to create the candidate. Please try again.'; refreshUploadItem(item); return false;
    });
}
function refreshUploadQueue() { var box = $('#upQueue'); if (box) box.innerHTML = uploadQueueHTML(); var st = $('#upSteps'); if (st) st.innerHTML = uploadStepsHTML(); }
function refreshUploadItem(item) { var el = document.getElementById('upi-' + item.id); if (el) { var tmp = document.createElement('div'); tmp.innerHTML = uploadItemHTML(item); if (tmp.firstChild) el.outerHTML = tmp.innerHTML; } else refreshUploadQueue(); var st = $('#upSteps'); if (st) st.innerHTML = uploadStepsHTML(); }

/** Session handling: a 401 from any protected call sends the user back to sign-in with an explanation. */
function sessionExpired() {
  if (!db || !db.user || isDemo()) return;
  db.user = null; setToken(null); resetLiveData(); bootState = ''; render();
  var el = $('#loginErr'); if (el) el.textContent = 'Your session expired. Please sign in again.';
}

/** Explicit offline Demo Mode: sample data kept in this browser; nothing is sent to or read from the server. */
function startDemo() { setToken(null); backendOnline = false; invalidateRemote(); db = loadDB(); loginNow({ email: DEMO_EMAIL, demo: true }); }

/** Demo/offline sign-in: used when the user presses "Continue with Demo Account", or when the real
 *  API is unreachable, so the UI never gets stuck on a broken login screen. */
function loginNow(user) { db.user = user || { email: DEMO_EMAIL, demo: true }; saveDB(); if (!location.hash || location.hash === '#/' || location.hash === '#') location.hash = '#/dashboard'; render(); if (pendingNotice) { toast(pendingNotice); pendingNotice = ''; } }

/** Real sign-in: on success, stores the JWT and pulls jobs/candidates from the server. */
function loginWithApi(email, password) {
  return API.login(email, password).then(function (r) {
    setToken(r.token); backendOnline = true; db.user = null; resetLiveData(); // never mix demo data into a real account
    return syncFromServer().then(function () { loginNow({ email: r.user.email, name: r.user.name }); }, function (e) { setToken(null); throw e; });
  });
}

function registerWithApi(name, email, password) {
  return API.register(name, email, password).then(function (r) {
    setToken(r.token); backendOnline = true; db.user = null; resetLiveData();
    loginNow({ email: r.user.email, name: r.user.name });
    toast('Account created. Add a job to get started.');
  });
}
