// Resume parsing tests. Text snapshots in fixtures/extracted/ are what pdf-parse / mammoth return for the real
// PDF/DOCX fixtures, so these always run. The "real extraction" tests below need `npm install` (pdf-parse, mammoth).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { parseResumeText, assertEnoughInformation, validateUpload, extractText, parseResumeFile } = require('../src/services/resumeParser');

const FX = path.join(__dirname, 'fixtures');
const snap = (n) => parseResumeText(fs.readFileSync(path.join(FX, 'extracted', `${n}.txt`), 'utf8'));
const buf = (n) => fs.readFileSync(path.join(FX, n));
const file = (n, mimetype) => ({ originalname: n, mimetype, size: buf(n).length, buffer: buf(n) });

test('resume A (PDF): every extracted field comes from the resume', () => {
  const p = snap('priya_nair.pdf');
  assert.equal(p.name, 'Priya Nair');
  assert.equal(p.email, 'priya.nair@example.com');
  assert.match(p.phone, /98450 11223/);
  assert.equal(p.location, 'Pune, India');
  assert.equal(p.links.linkedin, 'https://linkedin.com/in/priya-nair-dev');
  assert.equal(p.links.github, 'https://github.com/priyanair-dev');
  for (const s of ['JavaScript', 'TypeScript', 'Python', 'SQL', 'React', 'Node.js', 'Express.js', 'Django', 'MongoDB', 'PostgreSQL', 'Git', 'Docker', 'AWS']) assert.ok(p.skills.includes(s), s);
  assert.ok(p.skillGroups.databases.includes('MongoDB') && p.skillGroups.cloud.includes('AWS') && p.skillGroups.languages.includes('Python'));
  assert.equal(p.experience.length, 2);
  assert.equal(p.experience[0].company, 'Brightline Apps');
  assert.equal(p.experience[0].years, 2);
  assert.equal(p.yearsOfExperience, 3); assert.equal(p.yearsSource, 'stated');
  assert.equal(p.education.length, 1); assert.match(p.education[0], /B\.Tech in Computer Science, Riverbend Institute of Technology \(2020\)/);
  assert.equal(p.educationDetails[0].year, '2020');
  assert.equal(p.projects.length, 2); assert.equal(p.projects[0].name, 'Hostel Booking Platform');
  assert.deepEqual(p.projects[0].tech.slice(0, 3), ['React', 'Node.js', 'MongoDB']);
  assert.deepEqual(p.certifications, ['AWS Certified Cloud Practitioner', 'MongoDB Developer Associate']);
  assert.equal(p.achievements.length, 1);
  assert.match(p.summary, /Full stack developer/);
});

test('resume B (PDF, fresher): missing information stays empty - nothing is invented', () => {
  const p = snap('rohan_mehta.pdf');
  assert.equal(p.name, 'Rohan Mehta');
  assert.equal(p.email, 'rohan.mehta@example.org');
  assert.equal(p.phone, '9876543210');
  assert.equal(p.location, 'Indore, Madhya Pradesh');
  assert.equal(p.links.linkedin, ''); assert.equal(p.links.portfolio, '');
  assert.deepEqual(p.experience, []); assert.equal(p.yearsOfExperience, 0); assert.equal(p.yearsSource, 'unknown');
  assert.ok(p.skills.includes('Java') && p.skills.includes('C++') && p.skills.includes('React') && p.skills.includes('MySQL'));
  assert.ok(!p.skills.includes('JavaScript'), 'React.js must not imply a JavaScript skill the resume never states');
  assert.ok(!p.skills.includes('GitHub'), 'a github.com URL is not a skill');
  assert.match(p.education[0], /Bachelor of Technology in Information Technology/); assert.equal(p.educationDetails[0].year, '2024');
  assert.equal(p.projects.length, 2); assert.deepEqual(p.certifications, ['Java Programming Masterclass (Udemy)']);
});

test('resume C and D (DOCX text): different layouts parse to different people', () => {
  const c = snap('ananya_iyer.docx'), d = snap('marcus_webb.docx');
  assert.equal(c.name, 'Ananya Iyer'); assert.equal(c.location, 'Bengaluru, Karnataka');
  assert.ok(['Python', 'SQL', 'Pandas', 'Tableau', 'Power BI', 'Excel'].every((s) => c.skills.includes(s)));
  assert.equal(c.experience[0].role, 'Data Analyst'); assert.equal(c.experience[0].company, 'Northwind Retail');
  assert.match(c.education[0], /M\.Sc in Statistics/); assert.equal(c.yearsOfExperience, 4);
  assert.equal(d.name, 'Marcus Webb'); assert.equal(d.email, 'marcus.webb@example.com'); assert.equal(d.location, 'Austin, Texas');
  assert.equal(d.links.portfolio, 'https://marcuswebb.dev'); assert.equal(d.experience[0].role, 'Backend Engineer'); assert.equal(d.experience[0].company, 'Cloudly Inc.');
  assert.ok(['Java', 'Spring Boot', 'Kubernetes', 'PostgreSQL', 'Redis'].every((s) => d.skills.includes(s)));
  assert.match(d.education[0], /Bachelor of Science in Computer Engineering/);
});

test('all four resumes are distinct and none contains the old demo candidate', () => {
  const all = ['priya_nair.pdf', 'rohan_mehta.pdf', 'ananya_iyer.docx', 'marcus_webb.docx'].map(snap);
  assert.equal(new Set(all.map((p) => p.name)).size, 4);
  assert.equal(new Set(all.map((p) => p.email)).size, 4);
  for (const p of all) { assert.ok(!/dev malhotra/i.test(JSON.stringify(p))); assert.ok(p.resumeText.length > 100); }
});

test('a resume with too little information is rejected, and a skills-only list is not enough', () => {
  assert.throws(() => assertEnoughInformation(snap('too_little.pdf')), /insufficient information/);
  assert.throws(() => assertEnoughInformation(parseResumeText('Skills\nJava')), /insufficient/);
  assert.doesNotThrow(() => assertEnoughInformation(snap('rohan_mehta.pdf')));
});

test('parser handles unusual text without crashing or inventing data', () => {
  for (const t of ['', '   \n\n  ', '%%%% ### ???', 'a'.repeat(5000), 'John\njohn@x.io', 'SKILLS\n,,,;;;|||\nEDUCATION\n2020 2021']) {
    const p = parseResumeText(t);
    assert.ok(Array.isArray(p.skills) && Array.isArray(p.experience) && Array.isArray(p.education));
    assert.equal(p.phone, ''); assert.equal(p.links.linkedin, '');
  }
  const p = parseResumeText('Jane Roe\njane@x.io\nEXPERIENCE\nEngineer | Acme | 2019 - 2021\nSKILLS\nPython');
  assert.equal(p.experience[0].years, 2); assert.equal(p.education.length, 0); assert.equal(p.phone, '');
});

test('file validation: MIME, signature, size, extension', () => {
  assert.equal(validateUpload(file('priya_nair.pdf', 'application/pdf')), '.pdf');
  assert.equal(validateUpload(file('marcus_webb.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')), '.docx');
  assert.throws(() => validateUpload(file('fake.exe', 'application/octet-stream')), /Unsupported/);
  assert.throws(() => validateUpload(file('not_a_pdf.pdf', 'application/pdf')), /not a valid PDF/);
  assert.throws(() => validateUpload(file('priya_nair.pdf', 'image/png')), /does not match/);
  assert.throws(() => validateUpload({ originalname: 'big.pdf', mimetype: 'application/pdf', size: 6 * 1024 * 1024, buffer: Buffer.from('%PDF-') }), /exceeds 5 MB/);
  assert.throws(() => validateUpload({ originalname: 'x.docx', mimetype: 'application/octet-stream', size: 4, buffer: Buffer.from('MZ..') }), /not a valid DOCX/);
  for (const ext of ['png', 'jpg', 'zip', 'js', 'html']) assert.throws(() => validateUpload({ originalname: `x.${ext}`, mimetype: 'application/octet-stream', size: 4, buffer: Buffer.from('PK..') }), /Unsupported/);
});

// ---- real extraction: needs the production dependencies (npm install) ----
let libs = false;
try { require('pdf-parse/lib/pdf-parse.js'); require('mammoth'); libs = true; } catch (e) { /* not installed */ }
const skip = libs ? false : 'pdf-parse / mammoth not installed (run npm install)';

test('REAL PDF extraction -> parsed candidate', { skip }, async () => {
  const { parsed, hash } = await parseResumeFile(file('priya_nair.pdf', 'application/pdf'));
  assert.equal(parsed.name, 'Priya Nair'); assert.equal(parsed.email, 'priya.nair@example.com');
  assert.ok(parsed.skills.includes('React') && parsed.skills.includes('MongoDB')); assert.match(hash, /^[a-f0-9]{64}$/);
  const b = (await parseResumeFile(file('rohan_mehta.pdf', 'application/pdf'))).parsed;
  assert.equal(b.name, 'Rohan Mehta'); assert.notEqual(b.email, parsed.email);
});
test('REAL DOCX extraction -> parsed candidate', { skip }, async () => {
  const c = (await parseResumeFile(file('ananya_iyer.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'))).parsed;
  assert.equal(c.name, 'Ananya Iyer'); assert.ok(c.skills.includes('Tableau'));
  const d = (await parseResumeFile(file('marcus_webb.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'))).parsed;
  assert.equal(d.name, 'Marcus Webb');
});
test('REAL extraction rejects corrupted, image-only and empty documents with friendly errors', { skip }, async () => {
  const pdf = 'application/pdf', docx = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  await assert.rejects(() => parseResumeFile(file('corrupted.pdf', pdf)), /Unable to extract readable text/);
  await assert.rejects(() => parseResumeFile(file('empty_text.pdf', pdf)), /Unable to extract readable text/);
  await assert.rejects(() => parseResumeFile(file('corrupted.docx', docx)), /Unable to extract readable text/);
  await assert.rejects(() => parseResumeFile(file('empty_document.docx', docx)), /Unable to extract readable text/);
  await assert.rejects(() => parseResumeFile(file('too_little.pdf', pdf)), /insufficient information/);
  assert.ok(typeof extractText === 'function');
});
