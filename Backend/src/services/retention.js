/**
 * Retention policy for stored resume text.
 *  - Uploaded FILES are never stored (parsed in memory), so there is nothing to purge on disk.
 *  - The sanitized extracted text kept for explainability is removed after RESUME_TEXT_RETENTION_DAYS (0 = keep until the candidate is deleted).
 *  - Deleting a candidate (DELETE /api/candidates/:id) removes the profile, the text and all of its screenings.
 * The structured profile (what the recruiter reviewed and saved) is kept until deleted.
 */
const DAY_MS = 24 * 60 * 60 * 1000;
const retentionDays = () => Math.max(0, Number(process.env.RESUME_TEXT_RETENTION_DAYS) || 0);

async function purgeExpiredResumeText({ days = retentionDays(), now = Date.now(), Candidate = require('../models/Candidate') } = {}) {
  if (!days) return { purged: 0, skipped: true };
  const cutoff = new Date(now - days * DAY_MS);
  const res = await Candidate.updateMany({ resumeTextStoredAt: { $lt: cutoff }, resumeText: { $exists: true } }, { $unset: { resumeText: 1 }, $set: { resumeTextPurgedAt: new Date(now) } });
  return { purged: (res && (res.modifiedCount ?? res.nModified)) || 0, cutoff };
}

/** Runs the purge once at startup and then daily. The timer is unref'd so it never keeps the process alive. */
function scheduleRetention() {
  if (!retentionDays()) return null;
  const run = () => purgeExpiredResumeText().then((r) => { if (r.purged) console.log(`Retention: removed stored resume text from ${r.purged} candidate(s).`); }).catch((e) => console.error('Retention sweep failed:', e.message));
  run();
  const t = setInterval(run, DAY_MS); if (t.unref) t.unref();
  return t;
}

module.exports = { purgeExpiredResumeText, scheduleRetention, retentionDays };
