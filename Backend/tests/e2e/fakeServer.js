/**
 * Developer verification server (NOT used in production, not part of `npm test`).
 * Serves ../../../frontend and routes /api/* to the REAL backend controllers over in-memory models, with real
 * multipart parsing. Differences from production: no Express/JWT/MongoDB (any credentials are accepted), and PDF/DOCX text
 * comes from pdfjs-dist / `unzip` (equivalent to pdf-parse / mammoth). Run: node tests/e2e/fakeServer.js  (PORT=3000)
 */
const http = require('http'), fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process'), Module = require('module');
const BE = path.join(__dirname, '..', '..') + path.sep, FE = path.join(BE, '..', 'frontend') + path.sep;
const PDFJS = process.env.PDFJS_PATH || '/home/claude/.npm-global/lib/node_modules/pdfjs-dist/legacy/build/pdf.mjs';
try { require.resolve('mongoose'); } catch (e) { const orig = Module._resolveFilename; Module._resolveFilename = function (r, ...a) { return r === 'mongoose' ? BE + 'tests/helpers/mongooseStub.js' : orig.call(this, r, ...a); }; }

function makeModel(statics = {}) {
  const rows = []; let n = 0;
  const match = (row, q) => Object.entries(q || {}).every(([k, v]) => { if (k === '$or') return v.some((c) => match(row, c)); if (v && typeof v === 'object' && '$in' in v) return v.$in.map(String).includes(String(row[k])); if (v && typeof v === 'object' && '$ne' in v) return String(row[k]) !== String(v.$ne); if (v instanceof RegExp) return v.test(String(row[k])); if (v === null) return row[k] == null; return String(row[k]) === String(v); });
  const wrap = (r) => { for (const [k, f] of Object.entries({ toObject: () => JSON.parse(JSON.stringify(r)), set(o) { Object.assign(r, o); }, async save() { return r; }, async deleteOne() { rows.splice(rows.indexOf(r), 1); } })) Object.defineProperty(r, k, { value: f, enumerable: false, writable: true }); return r; };
  const chain = (l) => { const c = { _l: l, sort() { return c; }, skip(k) { c._l = c._l.slice(k); return c; }, limit(k) { c._l = c._l.slice(0, k); return c; }, select() { return c; }, lean() { return c; }, populate() { return c; }, then(a, b) { return Promise.resolve(c._l).then(a, b); } }; return c; };
  return Object.assign({ rows, async create(d) { const r = wrap({ _id: (++n).toString(16).padStart(24, '0'), createdAt: new Date().toISOString(), ...JSON.parse(JSON.stringify(d)) }); rows.push(r); return r; }, find: (q) => chain(rows.filter((r) => match(r, q))),
    findOne(q) { const p = Promise.resolve(rows.find((r) => match(r, q)) || null); p.select = () => p; p.sort = () => p; return p; }, async exists(q) { const r = rows.find((x) => match(x, q)); return r ? { _id: r._id } : null; },
    async countDocuments(q) { return rows.filter((r) => match(r, q)).length; }, async deleteMany() {}, async updateMany() {},
    async aggregate(pipe) { const m = pipe[0].$match || {}; const list = rows.filter((r) => match(r, Object.fromEntries(Object.entries(m).map(([k, v]) => [k, String(v)])))); const seen = new Map(); [...list].reverse().forEach((r) => { const k = `${r.candidate}|${r.job}`; if (!seen.has(k)) seen.set(k, r); }); return [...seen.values()].map((r) => JSON.parse(JSON.stringify(r))); } }, statics);
}
const models = { Candidate: makeModel({ STATUSES: ['New', 'Under Review', 'Shortlisted', 'Rejected', 'Interview', 'Hired'] }), Job: makeModel(), Screening: makeModel(), AuditLog: makeModel() };
for (const [name, m] of Object.entries(models)) { const p = require.resolve(BE + `src/models/${name}`); require.cache[p] = { id: p, filename: p, loaded: true, exports: m }; }
const parser = require(BE + 'src/services/resumeParser');
const C = { job: require(BE + 'src/controllers/jobController'), cand: require(BE + 'src/controllers/candidateController'), scr: require(BE + 'src/controllers/screeningController'), iq: require(BE + 'src/controllers/interviewController'), rep: require(BE + 'src/controllers/reportController') };

let pdfjs; async function pdfText(buf) { pdfjs = pdfjs || await import(PDFJS);
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf), useSystemFonts: true, verbosity: 0 }).promise; let out = '';
  for (let p = 1; p <= doc.numPages; p++) { const tc = await (await doc.getPage(p)).getTextContent(); let last, t = ''; for (const it of tc.items) { if (last == it.transform[5] || !last) t += it.str; else t += '\n' + it.str; last = it.transform[5]; } out += '\n\n' + t; } return out; }
function docxText(buf) { const f = path.join(os.tmpdir(), 'hl-' + Date.now() + Math.random() + '.docx'); fs.writeFileSync(f, buf);
  try { const xml = cp.execFileSync('unzip', ['-p', f, 'word/document.xml'], { stdio: ['ignore', 'pipe', 'ignore'] }).toString('utf8');
    return xml.split('</w:p>').map((p) => p.replace(/<w:tab\/>/g, ' ').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')).filter((t) => t.trim()).join('\n\n'); } finally { fs.unlinkSync(f); } }
parser.__setExtractorForTests(async (buf, ext) => { let t = ''; try { t = ext === '.pdf' ? await pdfText(buf) : docxText(buf); } catch (e) { throw parser.classifyExtractionError(e); }
  t = parser.sanitizeText(t); if (t.length < 40) throw new parser.ResumeError('Unable to extract readable text. This looks like a scanned or image-only document; OCR is not supported, so upload a text-based PDF or DOCX.', 422); return t; });

const USER = { id: 'u1', role: 'recruiter', email: 'recruiter@example.com', name: 'Rita Recruiter' };
function parseMultipart(buf, boundary) { const body = {}; let file; const sep = Buffer.from('--' + boundary); let pos = buf.indexOf(sep);
  while (pos >= 0) { const next = buf.indexOf(sep, pos + sep.length); if (next < 0) break; const part = buf.subarray(pos + sep.length + 2, next - 2); const hEnd = part.indexOf('\r\n\r\n'); const head = part.subarray(0, hEnd).toString('utf8'); const data = part.subarray(hEnd + 4);
    const name = (head.match(/name="([^"]+)"/) || [])[1], fname = (head.match(/filename="([^"]*)"/) || [])[1]; const ct = (head.match(/Content-Type:\s*([^\r\n]+)/i) || [])[1];
    if (fname !== undefined) file = { originalname: fname, mimetype: ct || 'application/octet-stream', size: data.length, buffer: Buffer.from(data) }; else body[name] = data.toString('utf8'); pos = next; } return { body, file }; }
async function dispatch(method, url, body, file, authed) {
  const [p, qs] = url.split('?'); const query = Object.fromEntries(new URLSearchParams(qs || '')); const s = p.split('/').filter(Boolean).slice(1);
  if (s[0] === 'health') return { code: 200, body: { status: 'ok', database: 'connected' } };
  if (s[0] === 'auth' && s[1] !== 'me') { const b = body || {}; if (!b.email || !b.password || (s[1] === 'register' && !b.name)) return { code: 400, body: { success: false, message: 'Name, email and password are required' } }; return { code: s[1] === 'register' ? 201 : 200, body: { success: true, data: { token: 'tok-1', user: { id: 'u1', name: b.name || USER.name, email: b.email, role: 'recruiter' } } } }; }
  if (!authed) return { code: 401, body: { success: false, message: 'Authentication required' } };
  const req = { user: USER, body: body || {}, query, params: {}, file }; const res = { code: 200, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } }; let h;
  if (s[0] === 'auth') return { code: 200, body: { success: true, data: { user: { id: 'u1', name: USER.name, email: USER.email, role: 'recruiter' } } } };
  if (s[0] === 'jobs') { if (s.length === 1) h = method === 'GET' ? C.job.list : C.job.create; else { req.params.id = s[1]; h = s[2] === 'analyze' ? C.job.analyze : s[2] === 'ranking' ? (s[3] ? C.job.simulate : C.job.ranking) : method === 'PUT' ? C.job.update : C.job.get; } }
  else if (s[0] === 'candidates') { if (s[1] === 'upload-config') h = C.cand.uploadConfig; else if (s[1] === 'upload') h = C.cand.upload; else if (s[1] === 'compare') h = C.cand.compare; else if (s.length === 1) h = method === 'GET' ? C.cand.list : C.cand.create; else { req.params.id = s[1]; h = method === 'PUT' ? C.cand.update : C.cand.get; } }
  else if (s[0] === 'screen') h = C.scr.screen; else if (s[0] === 'interview') h = C.iq.questions; else if (s[0] === 'reports') { req.params.candidateId = s[1]; h = C.rep.candidateReport; }
  else if (s[0] === 'analytics') { const S = models.Screening.rows, K = models.Candidate.rows; const st = {}; K.forEach((c) => { st[c.status] = (st[c.status] || 0) + 1; }); const avg = S.length ? Math.round(S.reduce((a, r) => a + r.overallScore, 0) / S.length * 10) / 10 : 0;
    const gaps = {}; S.forEach((r) => (r.missingSkills || []).forEach((k) => { gaps[k] = (gaps[k] || 0) + 1; })); const skills = {}; K.forEach((c) => (c.skills || []).forEach((k) => { skills[k] = (skills[k] || 0) + 1; }));
    return { code: 200, body: { success: true, data: { totalJobs: models.Job.rows.length, totalCandidates: K.length, screened: new Set(S.map((r) => r.candidate)).size, shortlisted: st.Shortlisted || 0, rejected: st.Rejected || 0, pending: (st.New || 0), averageScore: avg,
      scoreDistribution: [[0, 49], [50, 59], [60, 69], [70, 79], [80, 89], [90, 100]].map(([a, b]) => ({ range: a + '-' + b, count: S.filter((r) => r.overallScore >= a && r.overallScore <= b).length })), skillGaps: Object.entries(gaps).map(([skill, count]) => ({ skill, count })).sort((a, b) => b.count - a.count).slice(0, 10),
      candidatesPerJob: models.Job.rows.map((j) => ({ jobId: j._id, title: j.title, candidates: K.filter((c) => c.job === j._id).length })), statusBreakdown: st, averageScoreByJob: models.Job.rows.map((j) => { const v = S.filter((r) => r.job === j._id); return { jobId: j._id, title: j.title, average: v.length ? Math.round(v.reduce((a, r) => a + r.overallScore, 0) / v.length * 10) / 10 : 0, screened: v.length }; }).filter((x) => x.screened),
      topSkills: Object.entries(skills).map(([skill, count]) => ({ skill, count })).sort((a, b) => b.count - a.count).slice(0, 10), candidateVolume: [{ month: new Date().toISOString().slice(0, 7), count: K.length }] } } }; }
  else if (s[0] === 'audit-logs') return { code: 200, body: { success: true, data: models.AuditLog.rows.slice().reverse().map((l) => ({ ...l, user: { name: USER.name } })) } };
  if (!h) return { code: 404, body: { success: false, message: 'Route not found' } };
  let error; await h(req, res, (e) => { error = e; }); if (error) return { code: error.status || 500, body: { success: false, message: error.expose ? error.message : 'Internal server error' } }; return { code: res.code, body: res.body };
}
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
http.createServer(async (req, res) => {
  const u = req.url.split('?')[0];
  if (u.startsWith('/api/')) { const chunks = []; req.on('data', (c) => chunks.push(c)); req.on('end', async () => { const raw = Buffer.concat(chunks); let body = {}, file; const ct = req.headers['content-type'] || '';
      if (ct.startsWith('multipart/form-data')) ({ body, file } = parseMultipart(raw, ct.split('boundary=')[1])); else if (raw.length) { try { body = JSON.parse(raw.toString()); } catch (e) { /* ignore */ } }
      const r = await dispatch(req.method, req.url, body, file, !!req.headers.authorization); res.writeHead(r.code, { 'content-type': 'application/json' }); res.end(JSON.stringify(r.body)); }); return; }
  const f = path.join(FE, u === '/' ? 'index.html' : u); if (!f.startsWith(FE) || !fs.existsSync(f)) { res.writeHead(404); return res.end('not found'); }
  res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' }); res.end(fs.readFileSync(f));
}).listen(process.env.PORT || 3000, () => console.log('verification server on ' + (process.env.PORT || 3000)));
