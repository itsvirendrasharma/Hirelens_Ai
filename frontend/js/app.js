/* HireLens AI — Application bootstrap: delegated DOM event listeners and startup.
 * Classic (non-module) script: top-level declarations are shared globals; load order is set in index.html. */
'use strict';

document.addEventListener('click', function (e) {
  var dd = $('#dd'); if (dd && !e.target.closest('#dd')) dd.classList.remove('open');
  var el = e.target.closest('[data-act]'); if (!el) return;
  var a = el.getAttribute('data-act');
  if (el.type === 'checkbox' && e.type === 'click') { /* handled below via change */ return; }
  var fn = actions[a]; if (!fn) return;
  try { fn(el, e); } catch (err) { showDevError('Action "' + a + '" failed: ' + err.message); }
  if (el.closest('.dd-menu')) { var d2 = $('#dd'); if (d2) d2.classList.remove('open'); }
});

document.addEventListener('change', function (e) {
  var t = e.target;
  try {
    if (t.matches && t.matches('input[data-act="sel"]')) { actions.sel(t); return; }
    if (t.id === 'upFile') { var picked = t.files ? Array.prototype.slice.call(t.files) : []; t.value = ''; if (picked.length) enqueueResumes(picked); return; }
    if (t.id === 'upJob' && t.value === '__new__') { t.value = uploadJobId || ''; pendingUploadJob = true; actions.newjob(); return; }
    if (t.id === 'upJob') { uploadJobId = t.value; var zone = $('#dropZone'); if (zone) zone.classList.toggle('disabled', !uploadJobId); var st = $('#upSteps'); if (st) st.innerHTML = uploadStepsHTML(); return; }
    if (t.getAttribute('data-change') === 'setstatus') { actions.status({ dataset: { id: t.getAttribute('data-id'), s: t.value } }); return; }
    if (t.id === 'fJob') { filters.jobId = t.value; refreshTable(); }
    else if (t.id === 'fStatus') { filters.status = t.value; refreshTable(); }
    else if (t.id === 'fSort') { filters.sort = t.value; refreshTable(); }
    else if (t.id === 'fExp') { filters.exp = t.value; refreshTable(); }
    else if (t.id === 'rJob') { filters.jobId = t.value; render(); }
    else if (t.id === 'rStatus') { filters.status = t.value; render(); }
    else if (t.id === 'rMin') { filters.min = Number(t.value) || 0; render(); }
    else if (t.id === 'iqCand') { iqSelId = t.value; render(); }
    else if (t.id === 'rReq') { filters.skill = t.value; render(); }
    else if (t.id === 'rSort') { filters.rsort = t.value; render(); }
  } catch (err) { showDevError('Change handler failed: ' + err.message); }
});

document.addEventListener('input', function (e) {
  var t = e.target;
  if (t.getAttribute && t.getAttribute('data-upfield')) { var it = uploadItem(t.getAttribute('data-upid')); if (it) it.edits[t.getAttribute('data-upfield')] = t.value; return; }
  if (t.id === 'fQ') { filters.q = t.value; refreshTable(); }
  else if (t.id === 'fMin') { filters.min = Number(t.value) || 0; refreshTable(); }
  else if (t.id === 'topSearch') { filters.q = t.value; if (parseRoute(location.hash).page === 'candidates') refreshTable(); }
  else if (t.id === 'rMin' && t.type === 'range') { /* simulator slider handled below */ }
  if (t.hasAttribute && t.hasAttribute('data-simw') && simWeights) {
    var k = t.getAttribute('data-simw'), v = Number(t.value) / 100;
    if (k in simWeights) { simWeights[k] = v; render(); var s2 = $('[data-simw="' + k + '"]'); if (s2) s2.focus(); }
  }
});

document.addEventListener('keydown', function (e) {
  if (e.key === 'Escape') closeModal();
  if ((e.key === 'Enter' || e.key === ' ') && e.target && e.target.matches && e.target.matches('th.sortable')) { e.preventDefault(); try { actions.sortk(e.target); } catch (err) { showDevError('Sort failed: ' + err.message); } }
});

document.addEventListener('submit', function (e) {
  var f = e.target; e.preventDefault();
  try {
    if (f.id === 'loginForm') {
      var em = $('#email').value.trim(), pw = $('#password').value, errEl = $('#loginErr'), btn = $('#loginSubmitBtn');
      var isRegister = f.getAttribute('data-mode') === 'register';
      errEl.textContent = ''; btn.disabled = true; btn.innerHTML = '<span class="spin"></span> ' + (isRegister ? 'Creating account…' : 'Signing in…');
      var action = isRegister ? registerWithApi($('#regName').value.trim(), em, pw) : loginWithApi(em, pw);
      action.catch(function (err) {
        if (err instanceof ApiAuthError || (err && err.status) || /already exists|required|must be|valid email/i.test(err.message)) { errEl.textContent = err.message; return; }
        // Server unreachable: say so. Demo Mode is a separate, explicit choice (the "Continue with Demo Account" button).
        backendOnline = false;
        errEl.textContent = isRegister ? 'Could not create the account: ' + err.message : 'Could not sign in: ' + err.message;
      }).then(function () { btn.disabled = false; btn.textContent = isRegister ? 'Create Account' : 'Sign In'; });
      return;
    }
    var kind = f.getAttribute('data-form');
    if (kind === 'job') {
      var title = $('#jfTitle').value.trim(), company = $('#jfCompany').value.trim(), desc = $('#jfDesc').value.trim(), exp = Number($('#jfExp').value) || 0, err = $('#jfErr');
      if (!title || !company || !desc) { err.textContent = 'Job title, company and description are required.'; return; }
      if (exp < 0 || exp > 40) { err.textContent = 'Experience must be between 0 and 40 years.'; return; }
      var data = { title: title, company: company, location: $('#jfLocation').value.trim() || 'Not specified', exp: exp, edu: $('#jfEdu').value.trim(), req: splitSkills($('#jfReq').value), pref: splitSkills($('#jfPref').value), desc: desc };
      var id = f.getAttribute('data-id');
      var submitBtn = f.querySelector('button.primary'); if (submitBtn) { submitBtn.disabled = true; submitBtn.innerHTML = '<span class="spin"></span> Saving…'; }
      var fail = function (e) { if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = id ? 'Save Changes' : 'Create Job'; } err.textContent = 'Could not save the job: ' + (e && e.message ? e.message : 'please try again.'); };
      if (isDemo()) { // Demo Mode: sample data kept in this browser
        if (id) { var dj = findJob(db, id); Object.assign(dj, data); dj.analysis = null; logEvent('Updated job ' + title); closeModal(); afterChange('Job updated'); }
        else { data.id = db.nextJobId++; data.status = 'Open'; data.created = new Date().toISOString(); data.analysis = null; db.jobs.push(data); logEvent('Created job ' + title); closeModal(); saveDB(); toast('Job created successfully'); go('#/jobs'); }
      } else if (id) {
        API.updateJob(id, data).then(function (updated) { var j = findJob(db, id); Object.assign(j, updated); closeModal(); afterChange('Job updated'); }).catch(fail);
      } else {
        API.createJob(data).then(function (created) { db.jobs.push(created); closeModal(); afterChange('Job created successfully'); if (pendingUploadJob) { uploadJobId = created.id; pendingUploadJob = false; go('#/candidates'); } else go('#/jobs'); }).catch(fail);
      }
    } else if (kind === 'editcand') {
      var eid = f.getAttribute('data-id'), ec = findCand(db, eid), eerr = $('#ceErr'); if (!ec) return;
      var lines = function (id) { return String($(id).value).split('\n').map(function (x) { return x.trim(); }).filter(Boolean); };
      var body = { name: $('#ceName').value.trim(), email: $('#ceEmail').value.trim(), phone: $('#cePhone').value.trim(), location: $('#ceLocation').value.trim(),
        skills: String($('#ceSkills').value).split(/[,\n]/).map(function (x) { return x.trim(); }).filter(Boolean), summary: $('#ceSummary').value.trim(), education: lines('#ceEducation'), certifications: lines('#ceCerts') };
      if (!body.name) { eerr.textContent = 'Name is required.'; return; }
      var sbtn = f.querySelector('button[type="submit"]'); if (sbtn) { sbtn.disabled = true; sbtn.textContent = 'Saving…'; }
      API.updateCandidate(eid, body).then(function (u) { Object.assign(ec, u); closeModal(); afterChange('Candidate details saved'); })
        .catch(function (e) { if (sbtn) { sbtn.disabled = false; sbtn.textContent = 'Save changes'; } eerr.textContent = 'Could not save: ' + (e && e.message ? e.message : 'please try again.'); });
    } else if (kind === 'notes') {
      var cid = f.getAttribute('data-id'), c = findCand(db, cid); if (!c) return;
      var notesVal = $('#notesText').value;
      if (isDemo()) { c.notes = notesVal; saveDB(); toast('Notes saved'); }
      else API.updateCandidate(cid, { notes: notesVal }).then(function () { c.notes = notesVal; toast('Notes saved'); }).catch(function (e) { failToast('Could not save notes', e); });
    } else if (kind === 'settings') {
      if ($('#sName')) { db.settings.name = $('#sName').value.trim() || 'Recruiter'; db.settings.email = $('#sEmail').value.trim(); db.settings.company = $('#sCompany').value.trim() || 'Company'; db.settings.notify = $('#sNotify').checked; }
      setTheme($('#sTheme').value);
      afterChange('Settings saved');
    }
  } catch (err2) { showDevError('Form error: ' + err2.message); }
});

document.addEventListener('click', function (e) {
  if (e.target && e.target.id === 'demoBtn') { startDemo(); return; }
  var lab = e.target && e.target.closest ? e.target.closest('label[for="upFile"]') : null;
  if (lab && !uploadJobId) { e.preventDefault(); toast('Select a job before uploading a resume.', true); return; }
  var zone = e.target && e.target.closest ? e.target.closest('#dropZone') : null;
  if (zone && !e.target.closest('label,button,a')) { if (!uploadJobId) toast('Select a job before uploading a resume.', true); else actions.upbrowse(); return; }
  if (e.target && e.target.id === 'authToggle') {
    e.preventDefault();
    var f = $('#loginForm'), isRegister = f.getAttribute('data-mode') === 'register';
    f.setAttribute('data-mode', isRegister ? 'login' : 'register');
    $('#nameField').style.display = isRegister ? 'none' : 'block';
    $('#loginTitle').textContent = isRegister ? 'Sign in to HireLens' : 'Create your HireLens account';
    $('#loginSub').textContent = isRegister ? 'Enter your credentials to access your workspace.' : 'Set up a recruiter account on this backend.';
    $('#loginSubmitBtn').textContent = isRegister ? 'Sign In' : 'Create Account';
    e.target.textContent = isRegister ? 'New here? Create an account' : 'Already have an account? Sign in';
    $('#loginErr').textContent = '';
  }
});

document.addEventListener('keydown', function (e) {
  if ((e.key === 'Enter' || e.key === ' ') && e.target && e.target.id === 'dropZone') { e.preventDefault(); if (!uploadJobId) toast('Select a job before uploading a resume.', true); else actions.upbrowse(); }
});
['dragover', 'dragenter'].forEach(function (ev) { document.addEventListener(ev, function (e) { var z = e.target && e.target.closest ? e.target.closest('#dropZone') : null; if (z) { e.preventDefault(); z.classList.add('over'); } }); });
['dragleave', 'drop'].forEach(function (ev) { document.addEventListener(ev, function (e) {
  var z = e.target && e.target.closest ? e.target.closest('#dropZone') : null; if (!z) return;
  e.preventDefault(); z.classList.remove('over');
  if (ev === 'drop' && e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) enqueueResumes(e.dataTransfer.files);
}); });

window.addEventListener('hashchange', function () { render(); window.scrollTo(0, 0); });

/** Boot screen shown while a stored session is verified against the server. */
function bootHTML() {
  if (bootState === 'error') return '<div class="boot"><div class="card"><h2>Can\u2019t reach the HireLens server</h2><p class="muted">Your session is kept. Check that the backend is running, then try again.</p><div class="row" style="margin-top:12px"><button class="btn primary" data-act="bootretry">Try again</button><button class="btn" data-act="bootsignout">Sign out</button></div></div></div>';
  return '<div class="boot"><div class="card"><div class="spin lg"></div><h2 style="margin-top:12px">Loading your workspace\u2026</h2><p class="muted">Verifying your session and loading jobs and candidates.</p></div></div>';
}
function bootSession() {
  bootState = 'loading'; db.user = null; resetLiveData(); render();
  return API.me().then(function (r) {
    backendOnline = true;
    return syncFromServer().then(function () { bootState = ''; db.user = { email: r.user.email, name: r.user.name }; if (!location.hash || location.hash === '#/' || location.hash === '#') location.hash = '#/dashboard'; render(); });
  }).catch(function (e) {
    if (e instanceof ApiAuthError || (e && e.status === 401)) { setToken(null); bootState = ''; db.user = null; render(); return; }
    bootState = 'error'; render(); // network/server trouble: keep the token and let the user retry
  });
}
actions.bootretry = function () { bootSession(); };
actions.bootsignout = function () { setToken(null); bootState = ''; db = loadDB(); db.user = null; render(); };

function initializeApplication() {
  appEl = document.getElementById('app');
  LOGIN_HTML = appEl.innerHTML;
  db = loadDB();
  var prefs = loadPrefs(); if (prefs.weights) db.settings.weights = prefs.weights;
  applyTheme();
  try { if (window.matchMedia) window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', function () { if (getTheme() === 'system') applyTheme(); }); } catch (e) { /* older browsers */ }
  window.runSelfTest = showTestResults;
  window.HireLens = { runSelfTest: computeSelfTest, scoreCandidate: scoreCandidate, normalizeSkill: normalizeSkill, resetData: function () { localStorage.removeItem(KEY); setToken(null); location.reload(); } };
  if (getToken()) { bootSession(); return; }             // a real session: verify it, then load everything from MongoDB
  if (db.user && !db.user.demo) db.user = null;           // a stale non-demo user without a token is not a session
  render();
  if (pendingNotice && db.user) { toast(pendingNotice); pendingNotice = ''; }
}

try { initializeApplication(); }
catch (error) {
  showDevError('Startup error: ' + (error && error.message ? error.message : error));
}
