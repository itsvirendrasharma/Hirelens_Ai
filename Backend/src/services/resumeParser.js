/**
 * Resume text extraction + deterministic structured parsing.
 *
 * Principles:
 *  - The uploaded file is the only source of truth. Nothing is invented or defaulted to sample data:
 *    a field that cannot be found is returned empty ('' / [] / 0) and the UI shows "Not specified".
 *  - Protected attributes (gender, religion, caste, age, marital status, photo) are deliberately not extracted.
 *  - Files are validated (extension + MIME + magic bytes + size) and parsed in memory; the file itself is never stored.
 */
const path = require('path');
const crypto = require('crypto');
const { ALIASES, normalizeSkills, findSkillsInText, groupSkills } = require('./skillNormalizer');
const { looksLikeInjection } = require('./resumeSchema');

// Maximum upload size, configurable with MAX_RESUME_MB (1-20, default 5). Read on every call so tests/config changes apply.
const getMaxBytes = () => Math.round(Math.min(20, Math.max(1, Number(process.env.MAX_RESUME_MB) || 5)) * 1024 * 1024);
const MAX_BYTES = getMaxBytes();
const maxMbLabel = () => String(Math.round((getMaxBytes() / (1024 * 1024)) * 10) / 10);
const MIN_TEXT_CHARS = 40;
const ALLOWED = {
  '.pdf': ['application/pdf'],
  '.docx': ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/octet-stream']
};

class ResumeError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; this.expose = true; }
}

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

function sanitizeFilename(name) {
  const base = path.basename(String(name || '')).replace(/[^\w.\- ()]/g, '_').slice(0, 120);
  return base || 'resume';
}

/** Validates filename, size, extension, MIME type and magic bytes. Returns the normalized extension. */
function validateUpload(file) {
  if (!file || !file.buffer) throw new ResumeError('No resume file uploaded. Choose a PDF or DOCX file.');
  const ext = path.extname(String(file.originalname || '')).toLowerCase();
  if (!ALLOWED[ext]) throw new ResumeError('Unsupported file type. Upload a PDF or DOCX resume.', 415);
  if (!ALLOWED[ext].includes(file.mimetype)) throw new ResumeError('File content type does not match its extension.', 415);
  if (file.size > getMaxBytes() || file.buffer.length > getMaxBytes()) throw new ResumeError(`Resume exceeds ${maxMbLabel()} MB.`, 413);
  if (!file.buffer.length) throw new ResumeError('The uploaded file is empty.', 422);
  const head = file.buffer.subarray(0, 5).toString('latin1');
  if (ext === '.pdf' && !head.startsWith('%PDF-')) throw new ResumeError('File is not a valid PDF.', 415);
  if (ext === '.docx' && !head.startsWith('PK')) throw new ResumeError('File is not a valid DOCX.', 415);
  return ext;
}

/** Removes control characters and normalises whitespace so the parser sees clean lines. */
function sanitizeText(raw) {
  return String(raw || '')
    .replace(/\r\n?/g, '\n')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/\u00A0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Turns a pdf-parse / mammoth failure into a friendly error (password-protected vs. corrupted). */
function classifyExtractionError(err) {
  const m = String((err && (err.message || err.name)) || '');
  if ((err && err.name === 'PasswordException') || /password|encrypt/i.test(m)) return new ResumeError('This PDF is password protected. Remove the password and upload it again.', 422);
  return new ResumeError('Unable to extract readable text. The file may be corrupted or damaged.', 422);
}

async function extractTextFromFile(buffer, ext) {
  let text = '';
  try {
    if (ext === '.pdf') {
      const pdfParse = require('pdf-parse/lib/pdf-parse.js'); // avoids pdf-parse's debug-mode index.js
      text = (await pdfParse(buffer)).text;
    } else {
      text = (await require('mammoth').extractRawText({ buffer })).value;
    }
  } catch (err) {
    throw classifyExtractionError(err);
  }
  text = sanitizeText(text);
  if (text.length < MIN_TEXT_CHARS) {
    throw new ResumeError('Unable to extract readable text. This looks like a scanned or image-only document; OCR is not supported, so upload a text-based PDF or DOCX.', 422);
  }
  return text;
}

/* ------------------------------ sections ------------------------------ */
const HEADINGS = {
  summary: /^((professional|career|executive) )?(summary|profile|objective|about( me)?|career objective|personal statement)$/i,
  skills: /^(technical |key |core |it )?(skills?|competencies|technologies|tech(nical)? stack|skills? (&|and) tools|tools (&|and) technologies)$/i,
  education: /^(education|academic (background|qualifications?|details)|qualifications?|educational (background|qualifications?))( (&|and) training)?$/i,
  experience: /^((work|professional|relevant|industry|internship) )?(experience|employment( history)?|work history|internships?)$/i,
  projects: /^((academic|personal|key|selected|notable) )?projects?( (&|and) experience)?$/i,
  certifications: /^(certifications?|licenses?( (&|and) certifications?)?|certificates?|courses|training( (&|and) certifications?)?)$/i,
  publications: /^(publications?|research( papers?| work)?|papers?( published)?)$/i,
  achievements: /^(achievements?|awards?( (&|and) honou?rs)?|honou?rs|accomplishments|extra[- ]?curricular( activities)?)$/i,
  other: /^(interests|hobbies|languages|references|declaration|personal (details|information)|contact( details| information)?)$/i
};

function splitSections(text) {
  const sections = { header: [] };
  let current = 'header';
  text.split('\n').forEach((raw) => {
    const line = raw.trim();
    if (!line) return;
    const label = line.replace(/[:\-–—_*#|]+$/g, '').replace(/^[#*\s]+/, '').trim();
    if (label.length <= 42) {
      const key = Object.keys(HEADINGS).find((k) => HEADINGS[k].test(label));
      if (key) { current = key; sections[current] = sections[current] || []; return; }
    }
    (sections[current] = sections[current] || []).push(line);
  });
  return sections;
}

const BULLET_CHARS = '•●▪◦○■□★➢➤►·*\\-–—';
const BULLET = new RegExp(`^[\\s${BULLET_CHARS}]+`);
const isBullet = (l) => new RegExp(`^\\s*[${BULLET_CHARS}]\\s+\\S`).test(l);
const stripBullet = (l) => l.replace(BULLET, '').trim();

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const MON = '(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.?';
const DATE_RANGE = new RegExp(
  `(?:(${MON})\\s*,?\\s*|(\\d{1,2})[\\/.-])?((?:19|20)\\d{2})\\s*(?:-|–|—|to|until)\\s*(?:(?:(${MON})\\s*,?\\s*|(\\d{1,2})[\\/.-])?((?:19|20)\\d{2})|(present|current|now|ongoing|till date|today))`, 'i');

const monthNum = (name, num) => {
  if (name) return MONTHS[name.toLowerCase().slice(0, 3)] || null;
  const n = Number(num); return n >= 1 && n <= 12 ? n : null;
};

/** Length of a dated range in years (one decimal). Uses months when both are known, otherwise whole years. */
function rangeYears(m, now = new Date()) {
  const sy = Number(m[3]), sm = monthNum(m[1], m[2]);
  const present = Boolean(m[7]);
  const ey = present ? now.getFullYear() : Number(m[6]);
  const em = present ? now.getMonth() + 1 : monthNum(m[4], m[5]);
  let years;
  if (sm && em) years = ((ey * 12 + em) - (sy * 12 + sm) + 1) / 12;
  else years = ey - sy;
  if (!Number.isFinite(years) || years < 0 || years > 50) return 0;
  return Math.round(years * 10) / 10;
}

/* ------------------------------ individual fields ------------------------------ */
const TITLE_WORDS = /\b(developer|engineer|designer|analyst|manager|intern|student|consultant|architect|scientist|programmer|full[- ]?stack|front[- ]?end|back[- ]?end|fresher|graduate|specialist|administrator|resume|curriculum|vitae|profile|summary|objective|contact|address|email|phone|mobile|portfolio|linkedin|github)\b/i;
const titleCase = (s) => s.split(/\s+/).map((w) => (w === w.toUpperCase() && w.length > 2 ? w.charAt(0) + w.slice(1).toLowerCase() : w)).join(' ');

function extractName(headerLines, all) {
  for (const l of all.slice(0, 12)) {
    const m = l.match(/^name\s*[:\-]\s*(.{3,60})$/i);
    if (m && !/[@\d]/.test(m[1])) return titleCase(m[1].trim());
  }
  const candidates = (headerLines.length ? headerLines : all).slice(0, 6);
  for (const l of candidates) {
    if (/[@\d/:]|https?|www\./i.test(l) || TITLE_WORDS.test(l)) continue;
    const words = l.split(/\s+/);
    if (words.length >= 2 && words.length <= 4 && l.length <= 50 && words.every((w) => /^[A-Za-z][A-Za-z.'’-]*$/.test(w))) return titleCase(l);
  }
  return '';
}

function extractPhone(headerBlock, text) {
  const rx = /(?:\+\d{1,3}[\s.-]?)?(?:\(?\d{2,5}\)?[\s.-]?)?\d{3,5}[\s.-]?\d{3,5}(?:[\s.-]?\d{2,4})?/g;
  const pick = (s) => {
    for (const m of s.match(rx) || []) {
      const digits = m.replace(/\D/g, '');
      if (digits.length < 10 || digits.length > 13) continue;
      if (/^(?:19|20)\d{2}\D*(?:19|20)\d{2}/.test(m.trim())) continue; // a date range, not a phone number
      return m.trim();
    }
    return '';
  };
  const labelled = text.match(/(?:phone|mobile|mob|contact|tel|cell)\s*(?:no\.?|number)?\s*[:\-]?\s*([+\d][\d\s().-]{8,18})/i);
  if (labelled && pick(labelled[1])) return pick(labelled[1]);
  return pick(headerBlock);
}

const cleanUrl = (u) => {
  let url = String(u || '').trim().replace(/[),.;]+$/, '');
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  try { const p = new URL(url); return /^https?:$/.test(p.protocol) ? p.toString().replace(/\/$/, '') : ''; } catch (e) { return ''; }
};

function extractLinks(text, headerBlock) {
  const linkedin = (text.match(/(?:https?:\/\/)?(?:[a-z]{2,3}\.)?linkedin\.com\/(?:in|pub)\/[A-Za-z0-9_%.-]+/i) || [''])[0];
  const gh = text.match(/(?:https?:\/\/)?(?:www\.)?github\.com\/([A-Za-z0-9_-]+)/i);
  let portfolio = '';
  const labelled = text.match(/(?:portfolio|website|web ?site|blog|personal site)\s*[:\-]\s*((?:https?:\/\/)?[A-Za-z0-9][\w.-]+\.[a-z]{2,}[^\s,;|]*)/i);
  if (labelled) portfolio = labelled[1];
  else {
    const urls = headerBlock.match(/(?:https?:\/\/|www\.)[^\s,;|]+/gi) || [];
    portfolio = urls.find((u) => !/linkedin\.com|github\.com|mailto:/i.test(u)) || '';
  }
  return {
    linkedin: linkedin ? cleanUrl(linkedin) : '',
    github: gh ? cleanUrl(`github.com/${gh[1]}`) : '',
    portfolio: portfolio && !/linkedin\.com|github\.com/i.test(portfolio) ? cleanUrl(portfolio) : ''
  };
}

function extractLocation(headerLines, text) {
  const labelled = text.match(/(?:^|\n)\s*(?:location|address|city|based in|current location)\s*[:\-]\s*([^\n|•]{3,80})/i);
  if (labelled && !/\d{4,}/.test(labelled[1])) return labelled[1].trim().replace(/[,.;]+$/, '');
  for (const l of headerLines.slice(0, 8)) {
    for (const seg of l.split(/\s*[|•·●▪]\s*/)) {
      const s = seg.trim();
      if (!s || /@|https?|www\.|linkedin|github/i.test(s) || /\d{5,}/.test(s.replace(/\D/g, ''))) continue;
      if (/^[A-Z][A-Za-z.'-]+(?:\s[A-Z][A-Za-z.'-]+)*,\s*[A-Z][A-Za-z.'-]+(?:\s[A-Za-z.'-]+){0,2}$/.test(s) && !TITLE_WORDS.test(s)) return s;
    }
  }
  return '';
}

const SKILL_SPLIT = new RegExp(`[,;|•●▪·\\u2022]`);
function parseSkills(lines, fullText) {
  const listed = [];
  lines.forEach((l) => {
    const body = l.includes(':') ? l.slice(l.indexOf(':') + 1) : l; // drop "Languages:" style labels
    stripBullet(body).split(SKILL_SPLIT).forEach((s) => {
      const t = s.trim().replace(/[.]+$/, '').replace(/^\(|\)$/g, '');
      if (t && t.length <= 40 && t.split(/\s+/).length <= 4 && !/^\d/.test(t) && !/^(and|etc)$/i.test(t)) listed.push(t);
    });
  });
  // Links and e-mail addresses are not evidence of skills (a github.com/... URL is not a "GitHub" skill).
  const scanText = fullText.replace(/\bgit(?:hub|lab)\s+actions\b/gi, ' ').replace(/\b(?:github|gitlab|linkedin|portfolio|website)\s*:/gi, ' ').replace(/\S+@\S+|(?:https?:\/\/|www\.)\S+|\b[\w-]+(?:\.[\w-]+)*\.(?:com|org|net|io|dev|ai|in)\/\S*/gi, ' ');
  return normalizeSkills([...listed, ...findSkillsInText(scanText)]);
}

const MEASURABLE = /\d/;
const MEASURE_WORDS = /%|\b(?:increas|reduc|improv|sav|grew|grow|boost|cut|deliver|serv|handl|process|scal|lower|speed)\w*/i;
function dateLabel(mon, num, year) { return num ? `${num}/${year}` : `${mon ? mon.replace('.', '') + ' ' : ''}${year}`; }

function parseExperience(lines) {
  const entries = [];
  let cur = null, lastPlain = '';
  const addBullet = (e, t) => { const clean = t.trim(); if (clean) { e.bullets.push(clean.slice(0, 400)); e.summary = (e.summary + ' ' + clean).trim().slice(0, 600); } };
  lines.forEach((raw) => {
    const m = raw.match(DATE_RANGE);
    if (m) {
      const head = stripBullet(raw.replace(DATE_RANGE, ' ')).replace(/[()[\]|,–—:-]+\s*$/g, '').replace(/^[|,–—:-]+\s*/, '').trim();
      const parts = head.split(/\s+(?:at|@)\s+|\s*[|–—]\s*|\s+-\s+|,\s+/).map((s) => s.trim()).filter(Boolean);
      let role = parts[0] || '', company = parts[1] || '';
      if (!role && lastPlain) { role = lastPlain; lastPlain = ''; }
      else if (role && !company && lastPlain) { company = role; role = lastPlain; lastPlain = ''; } // "Role" line above, "Company  dates" line below
      cur = {
        role: role.slice(0, 120), company: company.slice(0, 120), years: rangeYears(m), summary: '',
        startDate: dateLabel(m[1], m[2], m[3]), endDate: m[7] ? 'Present' : dateLabel(m[4], m[5], m[6]),
        type: /intern/i.test(`${role} ${company}`) ? 'internship' : '', bullets: [], achievements: []
      };
      entries.push(cur);
    } else if (isBullet(raw)) {
      if (cur) addBullet(cur, stripBullet(raw));
    } else if (cur && /^[a-z]/.test(raw)) { // wrapped continuation of the previous bullet
      if (cur.bullets.length) { cur.bullets[cur.bullets.length - 1] = (cur.bullets[cur.bullets.length - 1] + ' ' + raw).slice(0, 400); cur.summary = (cur.summary + ' ' + raw).trim().slice(0, 600); }
      else cur.summary = (cur.summary + ' ' + raw).trim().slice(0, 600);
    } else if (raw.length <= 90 && !/[.;]$/.test(raw)) {
      lastPlain = raw; // possible role/company line that precedes its date line
    } else if (cur) {
      addBullet(cur, raw);
    }
  });
  entries.forEach((e) => { e.achievements = e.bullets.filter((b) => MEASURABLE.test(b) && MEASURE_WORDS.test(b)).slice(0, 8); });
  return entries.filter((e) => e.role || e.company || e.summary).slice(0, 15);
}

const PROJECT_URL = /https?:\/\/[^\s)]+|(?:github\.com|gitlab\.com|bitbucket\.org)\/[^\s)]+|[\w-]+\.(?:vercel\.app|netlify\.app|herokuapp\.com|onrender\.com|github\.io)[^\s)]*/gi;

function parseProjects(lines) {
  const projects = [];
  let cur = null;
  lines.forEach((raw) => {
    const techLine = raw.match(/^(?:tech(?:nologies)?(?: stack)?|built with|tools|stack|technologies used)\s*[:\-]\s*(.+)$/i);
    if (techLine && cur) { cur.tech = normalizeSkills([...cur.tech, ...techLine[1].split(/[,;|]/).map((s) => s.trim())]); return; }
    const bullet = isBullet(raw);
    const looksLikeTitle = !bullet && raw.length <= 100 && /^[A-Z0-9]/.test(raw) && !/[.,;]$/.test(raw) && !/^(and|or|with|using|to|for|in|of)\b/i.test(raw) && !/^(?:github|demo|live|link|repo|repository|source)\s*[:\-]/i.test(raw);
    if (looksLikeTitle && (!cur || cur.desc)) {
      const [name, rest] = stripBullet(raw).split(/\s+[|–—:-]\s+(.*)/s);
      const restTokens = (rest || '').split(/[,;|]/).map((t) => t.trim()).filter(Boolean);
      const isTechList = restTokens.length > 0 && restTokens.every((t) => ALIASES[t.toLowerCase()]);
      cur = { name: (name || '').trim().slice(0, 150), desc: isTechList ? '' : (rest || '').trim(), tech: isTechList ? normalizeSkills(restTokens) : [], links: [], bullets: [], raw: [raw] };
      projects.push(cur);
    } else if (cur) {
      cur.raw.push(raw);
      // A line that only carries labelled links ("GitHub: https://...  Demo: https://...") is recorded as links, not description.
      const withoutLinks = raw.replace(PROJECT_URL, ' ').replace(/\b(?:github|gitlab|demo|live(?: link)?|link|repo(?:sitory)?|source(?: code)?)\s*[:\-]/gi, ' ').trim();
      if (!withoutLinks && /https?:|github\.com|\.app\b|\.io\b/i.test(raw)) return;
      cur.desc = (cur.desc + ' ' + stripBullet(raw)).trim().slice(0, 800);
      if (bullet) cur.bullets.push(stripBullet(raw).slice(0, 400));
    }
  });
  projects.forEach((p) => {
    p.tech = normalizeSkills([...p.tech, ...findSkillsInText(`${p.name} ${p.desc}`)]);
    p.links = [...new Set((p.raw.join(' ').match(PROJECT_URL) || []).map(cleanUrl).filter(Boolean))].slice(0, 5);
    delete p.raw;
  });
  return projects.filter((p) => p.name).slice(0, 15);
}

const DEGREES = [
  [/(?<![A-Za-z])(?:ph\.?\s?d\.?|doctorate)(?![A-Za-z])/i, 'Ph.D'],
  [/(?<![A-Za-z])(?:m\.?\s?tech|mtech)(?![A-Za-z])/i, 'M.Tech'],
  [/(?<![A-Za-z])(?:m\.?\s?sc\.?|msc)(?![A-Za-z])/i, 'M.Sc'],
  [/(?<![A-Za-z])mca(?![A-Za-z])/i, 'MCA'],
  [/(?<![A-Za-z])mba(?![A-Za-z])/i, 'MBA'],
  [/(?<![A-Za-z])master(?:'s|s)?(?:\s+of\s+(?:technology|engineering|science|arts|commerce|computer applications|business administration))?(?![A-Za-z])/i, 'Master'],
  [/(?<![A-Za-z])(?:b\.?\s?tech|btech)(?![A-Za-z])/i, 'B.Tech'],
  [/(?<![A-Za-z])(?:b\.?\s?sc\.?|bsc)(?![A-Za-z])/i, 'B.Sc'],
  [/(?<![A-Za-z])bca(?![A-Za-z])/i, 'BCA'],
  [/(?<![A-Za-z])bba(?![A-Za-z])/i, 'BBA'],
  [/(?<![A-Za-z])b\.?\s?com(?![A-Za-z])/i, 'B.Com'],
  [/(?<![A-Za-z])(?:B\.E\.?|BE)(?![A-Za-z])/, 'B.E'], // case-sensitive: "be" is a common word
  [/(?<![A-Za-z])bachelor(?:'s|s)?(?:\s+of\s+(?:technology|engineering|science|arts|commerce|computer applications|business administration))?(?![A-Za-z])/i, 'Bachelor'],
  [/(?<![A-Za-z])diploma(?![A-Za-z])/i, 'Diploma']
];
// Used only when the resume has no recognisable Education heading: unambiguous degree words only.
const SAFE_DEGREE_SCAN = [DEGREES[0], DEGREES[1], DEGREES[2], DEGREES[3], DEGREES[4], DEGREES[5], DEGREES[6], DEGREES[7], DEGREES[8], DEGREES[12]];
const INSTITUTION = /\b(university|college|institute|institution|school|academy|iit|nit|iiit|polytechnic|vidyalaya)\b/i;

/** One display/scoring string per education entry, e.g. "B.Tech in Computer Science, Riverbend Institute (2020)". */
function educationStrings(details) {
  return details
    .map((e) => [e.degree && (e.field ? `${e.degree} in ${e.field}` : e.degree), e.institution].filter(Boolean).join(', ') + (e.year ? ` (${e.year})` : ''))
    .filter((s) => s.trim());
}

/** Education entries: only what the resume states. A degree keyword or an institution line is required. */
function parseEducation(lines, allLines) {
  const source = lines.length ? lines : allLines.filter((l) => l.length < 180 && SAFE_DEGREE_SCAN.some(([rx]) => rx.test(l)));
  const entries = [];
  let cur = null;
  const lineYear = (l) => { const y = l.match(/(?:19|20)\d{2}/g); return y ? y[y.length - 1] : ''; };
  const lineStartYear = (l) => { const r = l.match(/((?:19|20)\d{2})\s*(?:-|–|—|to)\s*(?:(?:19|20)\d{2}|present|current)/i); return r ? r[1] : ''; };
  // Only an explicitly written grade: "CGPA: 8.7/10", "GPA 3.8", or "85%". Never guessed.
  const gradeOf = (l) => {
    const g = l.match(/\b(?:cgpa|gpa|cpi|sgpa)\b\s*[:\-–]?\s*(\d{1,2}(?:\.\d{1,2})?)(?:\s*\/\s*(\d{1,2}(?:\.\d+)?))?/i);
    if (g) return `${/gpa|cpi/i.test(g[0]) ? g[0].match(/cgpa|gpa|cpi|sgpa/i)[0].toUpperCase() : 'CGPA'} ${g[1]}${g[2] ? '/' + g[2] : ''}`;
    const pc = l.match(/(?<![\d.])(\d{2}(?:\.\d{1,2})?)\s*%/);
    return pc ? `${pc[1]}%` : '';
  };
  const instOf = (l) => (l.split(/\s*[|,–—-]\s*/).find((p) => INSTITUTION.test(p)) || '').replace(/\(?(?:19|20)\d{2}.*$/, '').trim();
  const fieldOf = (l, end) => {
    const rest = l.slice(end).replace(/^[\s,:–—-]*(?:in|of)?\s+/i, '');
    const m = rest.match(/^([A-Z][A-Za-z&]*(?:\s+(?:and|&|of)?\s*[A-Z&][A-Za-z&]*){0,4})/);
    return m && !INSTITUTION.test(m[1]) ? m[1].trim() : '';
  };
  source.forEach((raw) => {
    const l = stripBullet(raw);
    const found = DEGREES.map(([rx, label]) => { const m = l.match(rx); return m ? { label, token: m[0], end: m.index + m[0].length } : null; }).find(Boolean);
    if (found) {
      const label = found.label === 'Master' || found.label === 'Bachelor' ? found.token.replace(/\s+/g, ' ').replace(/^./, (c) => c.toUpperCase()) : found.label;
      cur = { degree: label, field: fieldOf(l, found.end), institution: instOf(l), year: lineYear(l), startYear: lineStartYear(l), grade: gradeOf(l) };
      entries.push(cur);
    } else if (cur && !cur.institution && INSTITUTION.test(l)) {
      cur.institution = instOf(l) || l;
      cur.year = cur.year || lineYear(l);
    } else if (cur && !cur.year && lineYear(l) && l.length < 60) {
      cur.year = lineYear(l);
    } else if (!cur && lines.length && INSTITUTION.test(l)) {
      cur = { degree: '', field: '', institution: instOf(l) || l, year: lineYear(l), startYear: lineStartYear(l), grade: gradeOf(l) };
      entries.push(cur);
    }
    if (cur) { cur.startYear = cur.startYear || lineStartYear(l); cur.grade = cur.grade || gradeOf(l); }
  });
  const details = entries.slice(0, 6).map((e) => ({ degree: e.degree, field: e.field, institution: e.institution.slice(0, 150), year: e.year, startYear: e.startYear || '', grade: e.grade || '' }));
  return { education: educationStrings(details), educationDetails: details };
}

function statedYears(text) {
  const rxs = [
    /(\d+(?:\.\d+)?)\s*\+?\s*(?:years?|yrs?)\s*(?:of\s+)?(?:total |professional |work |relevant |industry |hands[- ]on )?(?:experience|exp)\b/i,
    /(?:total |overall |work |professional )?experience\s*[:\-–]?\s*(?:of\s+)?(\d+(?:\.\d+)?)\s*\+?\s*(?:years?|yrs?)/i
  ];
  for (const rx of rxs) {
    const m = text.match(rx);
    if (m) { const n = Number(m[1]); if (n >= 0 && n <= 50) return n; }
  }
  return null;
}

/** Deterministic parse of (already extracted) resume text into the Candidate shape. */
function parseResumeText(rawText) {
  const text = sanitizeText(rawText);
  const sections = splitSections(text);
  const allLines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const header = sections.header || [];
  const headerBlock = (header.length ? header : allLines).slice(0, 10).join('\n');

  const email = (text.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/) || [''])[0].toLowerCase();
  const skills = parseSkills(sections.skills || [], text);
  const experience = parseExperience(sections.experience || []);
  const { education, educationDetails } = parseEducation(sections.education || [], allLines);
  const stated = statedYears(text);
  const calculated = Math.round(experience.reduce((s, e) => s + (Number(e.years) || 0), 0) * 10) / 10;

  return {
    name: extractName(header, allLines),
    email,
    phone: extractPhone(headerBlock, text),
    location: extractLocation(header.length ? header : allLines, text),
    links: extractLinks(text, headerBlock),
    // Lines that read like instructions to an AI are not kept as profile content (a warning is raised separately).
    summary: (sections.summary || []).map(stripBullet).filter((l) => !looksLikeInjection(l)).join(' ').slice(0, 700),
    skills,
    skillGroups: groupSkills(skills),
    yearsOfExperience: stated != null ? stated : calculated,
    yearsSource: stated != null ? 'stated' : calculated > 0 ? 'calculated' : 'unknown',
    education, educationDetails,
    experience,
    projects: parseProjects(sections.projects || []),
    certifications: (sections.certifications || []).map(stripBullet).filter((l) => l.length > 2).slice(0, 15),
    achievements: (sections.achievements || []).map(stripBullet).filter((l) => l.length > 2).map((l) => l.slice(0, 300)).slice(0, 12),
    publications: (sections.publications || []).map(stripBullet).filter((l) => l.length > 5).map((l) => l.slice(0, 300)).slice(0, 10),
    resumeText: text
  };
}

/** A parse is useful only if the resume gave us at least two identifying/job-relevant signals. */
function assertEnoughInformation(p) {
  const signals = [p.name, p.email, p.phone, p.skills.length, p.experience.length, p.education.length, p.projects.length].filter(Boolean).length;
  const content = p.skills.length + p.experience.length + p.education.length + p.projects.length;
  if (signals < 2 || content === 0) throw new ResumeError('Resume contains insufficient information to build a candidate profile.', 422);
}

// Test seam: lets unit tests supply pre-extracted text instead of running pdf-parse/mammoth. Not used in production.
let extractImpl = extractTextFromFile;
function __setExtractorForTests(fn) { extractImpl = fn || extractTextFromFile; }

async function parseResumeFile(file) {
  const ext = validateUpload(file);
  const text = await extractImpl(file.buffer, ext);
  let parsed = parseResumeText(text);
  assertEnoughInformation(parsed);
  // Optional AI-assisted extraction. Always safe: on any failure the rule-based result is kept and a warning is added.
  const enhanced = await require('./resumeAiExtractor').enhanceWithAi(parsed);
  parsed = enhanced.parsed;
  return {
    parsed, extraction: enhanced.extraction,
    hash: sha256(file.buffer),
    meta: { originalName: sanitizeFilename(file.originalname), mimeType: file.mimetype, size: file.size || file.buffer.length, uploadedAt: new Date() }
  };
}

module.exports = { getMaxBytes, classifyExtractionError, educationStrings, DATE_RANGE, parseResumeFile, parseResumeText, validateUpload, sanitizeFilename, sanitizeText, extractText: extractTextFromFile, __setExtractorForTests, assertEnoughInformation, sha256, rangeYears, ResumeError, MAX_BYTES };
