// End-to-end test of the upload controller (validate -> job -> parse -> duplicate check -> preview/save) with
// IN-MEMORY models, so it needs no MongoDB. Real PDF/DOCX binaries are covered in resume.test.js and api.test.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const Module = require('module');

// If mongoose is not installed (sandbox), resolve it to a tiny stub; with real mongoose installed this is skipped.
try { require.resolve('mongoose'); } catch (e) {
  const orig = Module._resolveFilename;
  Module._resolveFilename = function (req, ...rest) { return req === 'mongoose' ? path.join(__dirname, 'helpers', 'mongooseStub.js') : orig.call(this, req, ...rest); };
}

function makeModel(statics = {}) {
  const rows = []; let n = 0;
  const matches = (row, q) => Object.entries(q).every(([k, v]) => {
    if (k === '$or') return v.some((c) => matches(row, c));
    if (v && typeof v === 'object' && '$ne' in v) return String(row[k]) !== String(v.$ne);
    if (v === null) return row[k] == null;
    return String(row[k]) === String(v);
  });
  const withSelect = (value) => { const p = Promise.resolve(value); p.select = () => p; return p; };
  const wrap = (r) => {
    const methods = { toObject: () => JSON.parse(JSON.stringify(r)), set(o) { Object.assign(r, o); }, async save() { return r; }, async deleteOne() { rows.splice(rows.indexOf(r), 1); } };
    for (const [k, f] of Object.entries(methods)) Object.defineProperty(r, k, { value: f, enumerable: false, writable: true });
    return r;
  };
  return Object.assign({
    rows,
    async create(doc) { const r = wrap({ _id: (++n).toString(16).padStart(24, '0'), ...JSON.parse(JSON.stringify(doc)) }); rows.push(r); return r; },
    findOne(q) { return withSelect(rows.find((r) => matches(r, q)) || null); },
    async exists(q) { const r = rows.find((x) => matches(x, q)); return r ? { _id: r._id } : null; }
  }, statics);
}
const models = { Candidate: makeModel({ STATUSES: ['New', 'Under Review', 'Shortlisted', 'Rejected', 'Interview', 'Hired'] }), Job: makeModel(), Screening: makeModel(), AuditLog: makeModel() };
for (const [name, model] of Object.entries(models)) {
  const p = require.resolve(`../src/models/${name}`);
  require.cache[p] = { id: p, filename: p, loaded: true, exports: model };
}

const parser = require('../src/services/resumeParser');
const controller = require('../src/controllers/candidateController');
const engine = require('../src/services/scoringEngine');

const FX = path.join(__dirname, 'fixtures');
const PDF = 'application/pdf';
// The fake "file" carries a marker; the injected extractor returns the matching real-extraction snapshot.
parser.__setExtractorForTests(async (buffer) => {
  const m = buffer.toString('latin1').match(/%marker:([\w.]+)/);
  if (!m) throw new Error('no marker');
  return fs.readFileSync(path.join(FX, 'extracted', `${m[1]}.txt`), 'utf8');
});
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
// Builds a minimal upload that passes validateUpload (right extension, MIME and magic bytes); content is replaced by the extractor.
const pdfFile = (marker, name = marker) => {
  const isDocx = /\.docx$/i.test(name);
  const b = Buffer.from(isDocx ? `PK\x03\x04%marker:${marker}\n` : `%PDF-1.4\n%marker:${marker}\n`, 'latin1');
  return { originalname: name, mimetype: isDocx ? DOCX : PDF, size: b.length, buffer: b };
};

async function call(handler, { user = 'u1', body = {}, query = {}, file } = {}) {
  const req = { user: { id: user, role: 'recruiter' }, body, query, params: {}, file };
  const res = { code: 200, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
  let error; await handler(req, res, (e) => { error = e; });
  return { res, error };
}
const J1 = '0000000000000000000000a1', J2 = '0000000000000000000000a2', OTHER_JOB = '0000000000000000000000b1';
test.before(async () => {
  await models.Job.create({ _id: J1, title: 'Full Stack Developer', description: 'React, Node.js, MongoDB', requiredSkills: ['JavaScript', 'React', 'Node.js', 'MongoDB'], preferredSkills: ['Docker', 'AWS'], experience: 2, education: "Bachelor's", createdBy: 'u1' });
  await models.Job.create({ _id: J2, title: 'Java Developer', requiredSkills: ['Java', 'MySQL'], createdBy: 'u1' });
  await models.Job.create({ _id: OTHER_JOB, title: 'Other tenant job', createdBy: 'u2' });
  for (const j of models.Job.rows) j._id = j._id; // ids supplied explicitly above
});

test('a job is required, and must belong to the user', async () => {
  let r = await call(controller.upload, { file: pdfFile('priya_nair.pdf'), body: {} });
  assert.equal(r.error.status, 400); assert.match(r.error.message, /Select a job/);
  r = await call(controller.upload, { file: pdfFile('priya_nair.pdf'), body: { job: 'nope' } });
  assert.equal(r.error.status, 400);
  r = await call(controller.upload, { file: pdfFile('priya_nair.pdf'), body: { job: OTHER_JOB } });
  assert.equal(r.error.status, 404);
  assert.equal(models.Candidate.rows.length, 0);
});

test('preview extracts the real resume and saves nothing', async () => {
  const r = await call(controller.upload, { file: pdfFile('priya_nair.pdf'), body: { job: J1, preview: 'true' } });
  assert.equal(r.error, undefined);
  const d = r.res.body.data;
  assert.equal(d.preview.name, 'Priya Nair'); assert.equal(d.preview.email, 'priya.nair@example.com');
  assert.ok(d.preview.skills.includes('React')); assert.match(d.resumeHash, /^[a-f0-9]{64}$/);
  assert.equal(d.preview.resumeText, undefined);
  assert.equal(models.Candidate.rows.length, 0);
});

test('multiple different resumes create different candidates - never a demo candidate', async () => {
  const a = await call(controller.upload, { file: pdfFile('priya_nair.pdf'), body: { job: J1 } });
  const b = await call(controller.upload, { file: pdfFile('rohan_mehta.pdf'), body: { job: J1 } });
  const c = await call(controller.upload, { file: pdfFile('ananya_iyer.docx', 'ananya_iyer.docx'), body: { job: J1 } });
  for (const r of [a, b, c]) { assert.equal(r.error, undefined); assert.equal(r.res.code, 201); assert.equal(r.res.body.data.candidate.resumeText, undefined); }
  const names = models.Candidate.rows.map((x) => x.name);
  assert.deepEqual(names, ['Priya Nair', 'Rohan Mehta', 'Ananya Iyer']);
  assert.ok(!JSON.stringify(models.Candidate.rows).match(/Dev Malhotra/i));
  const row = models.Candidate.rows[0];
  assert.equal(row.resumeText.includes('Brightline Apps'), true);       // sanitized extracted text kept for explainability
  assert.equal(row.resumeFile.originalName, 'priya_nair.pdf'); assert.match(row.resumeHash, /^[a-f0-9]{64}$/);
  assert.ok(row.skillGroups.databases.includes('MongoDB')); assert.equal(row.yearsOfExperience, 3);
  assert.equal(row.job, J1); assert.equal(row.createdBy, 'u1');
  // missing data stays empty instead of being invented
  const rohan = models.Candidate.rows[1];
  assert.deepEqual(rohan.experience, []); assert.equal(rohan.links.linkedin, '');
});

test('duplicates are rejected, not silently overwritten', async () => {
  const before = models.Candidate.rows.length;
  let r = await call(controller.upload, { file: pdfFile('priya_nair.pdf'), body: { job: J1 } });
  assert.equal(r.error.status, 409); assert.equal(r.error.message, 'This candidate already exists for this job.');
  r = await call(controller.upload, { file: pdfFile('priya_nair.pdf', 'renamed copy.pdf'), body: { job: J1, preview: 'true' } });
  assert.equal(r.error.status, 409);                                        // same content under another file name, also in preview
  assert.equal(models.Candidate.rows.length, before);
  r = await call(controller.upload, { file: pdfFile('priya_nair.pdf'), body: { job: J2 } }); // same person, different job is allowed
  assert.equal(r.res.code, 201);
});

test('recruiter corrections (overrides) are validated and applied', async () => {
  let r = await call(controller.upload, { file: pdfFile('marcus_webb.docx', 'marcus.docx'), body: { job: J2, overrides: JSON.stringify({ name: 'Marcus J. Webb', phone: '+1 415 555 0000', skills: ['js', 'Java'] }) } });
  assert.equal(r.res.code, 201);
  const row = models.Candidate.rows.find((x) => x.name === 'Marcus J. Webb');
  assert.ok(row); assert.equal(row.phone, '+1 415 555 0000'); assert.ok(row.skills.includes('JavaScript'));
  r = await call(controller.upload, { file: pdfFile('ananya_iyer.docx'), body: { job: J2, overrides: '{not json' } });
  assert.equal(r.error.status, 400);
  r = await call(controller.upload, { file: pdfFile('ananya_iyer.docx'), body: { job: J2, overrides: JSON.stringify({ email: 'not-an-email' }) } });
  assert.equal(r.error.status, 400);
});

test('unreadable name: preview warns, save is refused until the recruiter supplies it', async () => {
  parser.__setExtractorForTests(async () => 'zzz@nameless.example\nSKILLS\nPython, SQL\nEXPERIENCE\nAnalyst | Acme | 2020 - 2022');
  const file = pdfFile('x', 'nameless.pdf');
  let r = await call(controller.upload, { file, body: { job: J2, preview: 'true' } });
  assert.equal(r.res.body.data.preview.name, ''); assert.ok(r.res.body.data.warnings.some((w) => /name/i.test(w)));
  r = await call(controller.upload, { file, body: { job: J2 } });
  assert.equal(r.error.status, 422); assert.match(r.error.message, /name/i);
  r = await call(controller.upload, { file, body: { job: J2, overrides: JSON.stringify({ name: 'Nia Nameless' }) } });
  assert.equal(r.res.code, 201);
  parser.__setExtractorForTests(null);
  parser.__setExtractorForTests(async (buffer) => { const m = buffer.toString('latin1').match(/%marker:([\w.]+)/); return fs.readFileSync(path.join(FX, 'extracted', `${m[1]}.txt`), 'utf8'); });
});

test('invalid uploads fail with friendly errors', async () => {
  const bad = (name, mimetype, content) => ({ originalname: name, mimetype, size: content.length, buffer: Buffer.from(content, 'latin1') });
  let r = await call(controller.upload, { file: bad('evil.exe', 'application/octet-stream', 'MZ....'), body: { job: J1 } });
  assert.equal(r.error.status, 415); assert.match(r.error.message, /Unsupported file type/);
  r = await call(controller.upload, { file: bad('cv.pdf', PDF, '<html>not a pdf</html>'), body: { job: J1 } });
  assert.equal(r.error.status, 415);
  r = await call(controller.upload, { file: bad('cv.pdf', 'image/png', '%PDF-1.4'), body: { job: J1 } });
  assert.equal(r.error.status, 415);
  r = await call(controller.upload, { file: { originalname: 'big.pdf', mimetype: PDF, size: 6 * 1024 * 1024, buffer: Buffer.from('%PDF-1.4') }, body: { job: J1 } });
  assert.equal(r.error.status, 413); assert.equal(r.error.message, 'Resume exceeds 5 MB.');
  r = await call(controller.upload, { body: { job: J1 } });
  assert.equal(r.error.status, 400);
  r = await call(controller.upload, { file: pdfFile('too_little.pdf'), body: { job: J1 } });
  assert.equal(r.error.status, 422); assert.match(r.error.message, /insufficient information/);
});

test('audit trail is written for parsing and creation (no secrets or file content)', () => {
  const actions = new Set(models.AuditLog.rows.map((x) => x.action));
  for (const a of ['RESUME_PARSED', 'RESUME_UPLOADED', 'CANDIDATE_CREATED']) assert.ok(actions.has(a), a);
  assert.ok(!JSON.stringify(models.AuditLog.rows).match(/Brightline|password|token/i));
});

test('screening uses the actual uploaded data, and ranking responds when that data changes', () => {
  const job = models.Job.rows.find((j) => j._id === J1).toObject();
  const [priya, rohan] = models.Candidate.rows.filter((c) => c.job === J1).map((c) => c.toObject());
  const sp = engine.scoreCandidate(priya, job), sr = engine.scoreCandidate(rohan, job);
  assert.ok(sp.overallScore > sr.overallScore, `${sp.overallScore} vs ${sr.overallScore}`);
  assert.deepEqual(sp.missingSkills, []);                                   // Priya states every required skill
  assert.ok(sr.missingSkills.includes('Node.js') && sr.missingSkills.includes('MongoDB'));
  assert.ok(sp.evidence.some((e) => /Hostel Booking Platform/.test(e)));    // evidence quotes her real project
  assert.ok(sp.relevantProjects.includes('Hostel Booking Platform'));
  assert.match(sp.notes.experience, /as stated on the resume/);
  const before = engine.rankRows([{ candidateId: 'p', name: 'P', status: 'New', ...sp }, { candidateId: 'r', name: 'R', status: 'New', ...sr }]);
  assert.equal(before[0].candidateId, 'p');
  const improved = engine.scoreCandidate({ ...rohan, skills: [...rohan.skills, 'Node.js', 'MongoDB', 'JavaScript'], yearsOfExperience: 5 }, job);
  assert.ok(improved.overallScore > sr.overallScore);                        // scores follow the data
  const after = engine.rankRows([{ candidateId: 'p', name: 'P', status: 'New', ...sp }, { candidateId: 'r', name: 'R', status: 'New', ...improved }]);
  assert.ok(after.find((r) => r.candidateId === 'r').overallScore > before.find((r) => r.candidateId === 'r').overallScore);
});

/* ============================ additional coverage ============================ */
const os = require('os');
const parserMod = require('../src/services/resumeParser');
const retention = require('../src/services/retention');
const kavyaExtractor = async (buffer) => { const m = buffer.toString('latin1').match(/%marker:([\w.]+)/); return fs.readFileSync(path.join(FX, 'extracted', `${m[1]}.txt`), 'utf8'); };

test('extractText: scanned, password-protected, corrupted and good PDFs give the right messages (pdf-parse stubbed)', async () => {
  const orig = Module._resolveFilename;
  Module._resolveFilename = function (req, ...rest) { return req === 'pdf-parse/lib/pdf-parse.js' ? path.join(__dirname, 'helpers', 'pdfParseStub.js') : orig.call(this, req, ...rest); };
  try {
    global.__PDF_STUB__ = { text: '   ' };
    await assert.rejects(() => parserMod.extractText(Buffer.from('%PDF-'), '.pdf'), (e) => e.status === 422 && /scanned or image-only/.test(e.message) && /OCR is not supported/.test(e.message));
    global.__PDF_STUB__ = { throws: { name: 'PasswordException', message: 'No password given' } };
    await assert.rejects(() => parserMod.extractText(Buffer.from('%PDF-'), '.pdf'), (e) => e.status === 422 && /password protected/.test(e.message));
    global.__PDF_STUB__ = { throws: { message: 'Invalid PDF structure' } };
    await assert.rejects(() => parserMod.extractText(Buffer.from('%PDF-'), '.pdf'), (e) => e.status === 422 && /corrupted or damaged/.test(e.message));
    global.__PDF_STUB__ = { text: 'Jane Doe\njane@x.io\nSkills: Python, SQL and many other things for the resume' };
    assert.match(await parserMod.extractText(Buffer.from('%PDF-'), '.pdf'), /Jane Doe/);
  } finally { Module._resolveFilename = orig; delete global.__PDF_STUB__; }
});

test('the size limit is configurable (MAX_RESUME_MB) and reported by upload-config', async () => {
  const keep = process.env.MAX_RESUME_MB; process.env.MAX_RESUME_MB = '1';
  try {
    const big = { originalname: 'big.pdf', mimetype: PDF, size: 2 * 1024 * 1024, buffer: Buffer.from('%PDF-1.4') };
    let r = await call(controller.upload, { file: big, body: { job: J1 } });
    assert.equal(r.error.status, 413); assert.equal(r.error.message, 'Resume exceeds 1 MB.');
    r = await call(controller.uploadConfig, {});
    assert.equal(r.res.body.data.maxBytes, 1024 * 1024); assert.deepEqual(r.res.body.data.accepts, ['.pdf', '.docx']); assert.equal(r.res.body.data.aiExtraction, false);
  } finally { if (keep === undefined) delete process.env.MAX_RESUME_MB; else process.env.MAX_RESUME_MB = keep; }
});

test('no temporary files are written, on success or failure (uploads are parsed in memory)', async () => {
  const names = ['writeFileSync', 'writeFile', 'appendFileSync', 'createWriteStream', 'mkdtempSync', 'copyFileSync', 'renameSync'];
  const orig = {}; let writes = 0; names.forEach((n) => { orig[n] = fs[n]; fs[n] = function (...a) { writes += 1; return orig[n].apply(this, a); }; });
  const origPromiseWrite = fs.promises.writeFile; fs.promises.writeFile = async (...a) => { writes += 1; return origPromiseWrite(...a); };
  try {
    const before = fs.readdirSync(os.tmpdir()).length;
    await call(controller.upload, { file: pdfFile('rohan_mehta.pdf', 'tmp-check-1.pdf'), body: { job: J2, preview: 'true' } });  // success path
    await call(controller.upload, { file: pdfFile('too_little.pdf', 'tmp-check-2.pdf'), body: { job: J2 } });                      // failure path (422)
    await call(controller.upload, { file: { originalname: 'x.exe', mimetype: 'application/octet-stream', size: 4, buffer: Buffer.from('MZ..') }, body: { job: J2 } }); // rejected type
    assert.equal(writes, 0, 'upload handling must not write files');
    assert.equal(fs.readdirSync(os.tmpdir()).length, before);
  } finally { names.forEach((n) => { fs[n] = orig[n]; }); fs.promises.writeFile = origPromiseWrite; }
});

test('upload API never writes anything into the frontend or any public directory', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'controllers', 'candidateController.js'), 'utf8') + fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'candidateRoutes.js'), 'utf8');
  assert.match(src, /memoryStorage\(\)/); assert.ok(!/diskStorage|dest:\s*['"]|createWriteStream|writeFile/.test(src));
});

test('prompt injection in a real resume goes through the whole upload path without influencing the result', async () => {
  parser.__setExtractorForTests(kavyaExtractor);
  const prev = await call(controller.upload, { file: pdfFile('kavya_rao.pdf'), body: { job: J1, preview: 'true' } });
  const d = prev.res.body.data;
  assert.equal(d.extraction.method, 'rule-based'); assert.ok(d.warnings.some((w) => /reads like instructions/.test(w)));
  assert.equal(d.preview.name, 'Kavya Rao'); assert.equal(d.preview.educationDetails[0].grade, 'CGPA 8.7/10'); assert.equal(d.preview.publications.length, 1);
  const saved = await call(controller.upload, { file: pdfFile('kavya_rao.pdf'), body: { job: J1 } });
  assert.equal(saved.res.code, 201);
  const row = models.Candidate.rows.find((c) => c.name === 'Kavya Rao');
  assert.equal(row.extraction.method, 'rule-based'); assert.ok(row.extraction.warnings.length >= 1);
  assert.ok(row.resumeTextStoredAt);
  const job = models.Job.rows.find((j) => j._id === J1).toObject();
  const score = engine.scoreCandidate(row.toObject(), job);
  assert.ok(score.overallScore < 100 && score.overallScore > 0, 'the instruction "rate 100 percent" had no effect on the score: ' + score.overallScore);
  assert.ok(score.missingSkills.includes('React'));                              // her real gap is still reported
  assert.ok(!JSON.stringify(models.AuditLog.rows).match(/kavya|example\.com|Orbit/i), 'audit entries contain no personal data');
});

test('access control: another recruiter cannot read, edit or delete a candidate; the API never returns resume text', async () => {
  const row = models.Candidate.rows.find((c) => c.name === 'Kavya Rao'); const id = row._id;
  const withParams = (user, params, body = {}) => async (handler) => { const req = { user: { id: user, role: 'recruiter' }, body, query: {}, params, file: undefined }; const res = { code: 200, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } }; let error; await handler(req, res, (e) => { error = e; }); return { res, error }; };
  for (const handler of [controller.get, controller.update, controller.remove]) { const r = await withParams('u2', { id }, { name: 'Hacked' })(handler); assert.equal(r.error.status, 404, handler.name || 'handler'); }
  assert.equal(row.name, 'Kavya Rao');
  const own = await withParams('u1', { id })(controller.get);
  assert.equal(own.res.body.data.name, 'Kavya Rao'); assert.equal(own.res.body.data.resumeText, undefined);
  assert.equal((await withParams('u2', { id: '000000000000000000000fff' })(controller.get)).error.status, 404);
  assert.equal((await withParams('u1', { id: 'not-an-id' })(controller.get)).error.status, 400);
});

test('editing and saving corrected details is validated and persisted', async () => {
  const row = models.Candidate.rows.find((c) => c.name === 'Kavya Rao'); const id = row._id;
  const put = async (body, user = 'u1') => { const req = { user: { id: user, role: 'recruiter' }, body, query: {}, params: { id } }; const res = { code: 200, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } }; let error; await controller.update(req, res, (e) => { error = e; }); return { res, error }; };
  let r = await put({ name: 'Kavya R. Rao', phone: '+91 90000 11111', skills: ['golang', 'JS', 'Docker'], education: ['B.Tech CSE, Deccan Institute of Technology (2022)'], links: { github: 'javascript:alert(1)', linkedin: 'linkedin.com/in/kavya-rao-dev' }, notes: 'Strong backend profile', summary: 'Backend developer' });
  assert.equal(r.error, undefined); assert.equal(row.name, 'Kavya R. Rao'); assert.deepEqual(row.skills, ['Go', 'JavaScript', 'Docker']);
  assert.equal(row.links.github, '', 'non-http(s) links are never stored'); assert.equal(row.links.linkedin, 'https://linkedin.com/in/kavya-rao-dev');
  assert.ok(row.skillGroups.languages.includes('Go'));                                                // groups are re-derived server-side
  assert.equal(row.notes, 'Strong backend profile');
  for (const bad of [{ email: 'nope' }, { status: 'Hired!!' }, { yearsOfExperience: -3 }, { yearsOfExperience: 99 }, { experience: 'x' }, { name: '   ' }]) { r = await put(bad); assert.equal(r.error.status, 400, JSON.stringify(bad)); }
  r = await put({ createdBy: 'u2', resumeHash: 'x', job: undefined, _id: 'zzz', resumeText: 'owned' });          // mass assignment attempt
  assert.equal(row.createdBy, 'u1'); assert.notEqual(row.resumeHash, 'x'); assert.notEqual(row.resumeText, 'owned');
  r = await put({ status: 'Shortlisted' }); assert.equal(row.status, 'Shortlisted');
  assert.ok(models.AuditLog.rows.some((l) => l.action === 'CANDIDATE_SHORTLISTED'));
});

test('retention: stored resume text is purged after RESUME_TEXT_RETENTION_DAYS; files are never stored', async () => {
  let seen; const FakeCandidate = { updateMany: async (filter, update) => { seen = { filter, update }; return { modifiedCount: 3 }; } };
  const now = Date.UTC(2026, 9, 1);
  const r = await retention.purgeExpiredResumeText({ days: 30, now, Candidate: FakeCandidate });
  assert.equal(r.purged, 3); assert.equal(seen.filter.resumeTextStoredAt.$lt.getTime(), now - 30 * 86400000);
  assert.deepEqual(seen.update.$unset, { resumeText: 1 }); assert.ok(!('name' in seen.update.$unset), 'only the text is removed, not the profile');
  assert.deepEqual(await retention.purgeExpiredResumeText({ days: 0, Candidate: FakeCandidate }), { purged: 0, skipped: true });
});
