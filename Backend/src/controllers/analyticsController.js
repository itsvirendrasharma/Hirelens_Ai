const mongoose = require('mongoose');
const Job = require('../models/Job');
const Candidate = require('../models/Candidate');
const AuditLog = require('../models/AuditLog');
const { latestScreenings } = require('../services/screeningService');
const { asyncHandler, ok, ownerFilter, parsePaging, escapeRegex, cleanStr } = require('../utils/helpers');

const BUCKETS = [[0, 49], [50, 59], [60, 69], [70, 79], [80, 89], [90, 100]];

/** GET /api/analytics — everything is calculated from MongoDB. */
exports.analytics = asyncHandler(async (req, res) => {
  const owner = ownerFilter(req);
  // Aggregation stages do not auto-cast ids, so build an ObjectId-typed owner filter for them.
  const ownerAgg = req.user.role === 'admin' ? {} : { createdBy: new mongoose.Types.ObjectId(req.user.id) };
  const [jobs, candidates, statusRows, shots, perJob] = await Promise.all([
    Job.countDocuments(owner),
    Candidate.countDocuments(owner),
    Candidate.aggregate([{ $match: ownerAgg }, { $group: { _id: '$status', n: { $sum: 1 } } }]),
    latestScreenings(ownerAgg),
    Candidate.aggregate([
      { $match: { ...ownerAgg, job: { $exists: true, $ne: null } } },
      { $group: { _id: '$job', candidates: { $sum: 1 } } },
      { $lookup: { from: 'jobs', localField: '_id', foreignField: '_id', as: 'job' } },
      { $unwind: '$job' },
      { $project: { _id: 0, jobId: '$_id', title: '$job.title', candidates: 1 } },
      { $sort: { candidates: -1 } }
    ])
  ]);
  const status = Object.fromEntries(statusRows.map((r) => [r._id, r.n]));

  // Average match per job (latest screening per candidate), most-listed candidate skills, and monthly candidate volume.
  const [jobDocs, skillRows, volumeRows] = await Promise.all([
    Job.find(owner).select('title').lean(),
    Candidate.aggregate([{ $match: ownerAgg }, { $unwind: '$skills' }, { $group: { _id: '$skills', count: { $sum: 1 } } }, { $sort: { count: -1, _id: 1 } }, { $limit: 10 }, { $project: { _id: 0, skill: '$_id', count: 1 } }]),
    Candidate.aggregate([{ $match: ownerAgg }, { $group: { _id: { $dateToString: { format: '%Y-%m', date: '$createdAt' } }, count: { $sum: 1 } } }, { $sort: { _id: -1 } }, { $limit: 6 }, { $project: { _id: 0, month: '$_id', count: 1 } }])
  ]);
  const titleOf = new Map(jobDocs.map((j) => [String(j._id), j.title]));
  const scoresByJob = {};
  shots.forEach((x) => { const k = String(x.job); if (titleOf.has(k)) (scoresByJob[k] = scoresByJob[k] || []).push(x.overallScore); });
  const averageScoreByJob = Object.entries(scoresByJob).map(([k, v]) => ({ jobId: k, title: titleOf.get(k), average: Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10, screened: v.length })).sort((a, b) => b.average - a.average);

  const gapCounts = {};
  shots.forEach((s) => (s.missingSkills || []).forEach((k) => { gapCounts[k] = (gapCounts[k] || 0) + 1; }));
  const skillGaps = Object.entries(gapCounts).map(([skill, count]) => ({ skill, count })).sort((a, b) => b.count - a.count || a.skill.localeCompare(b.skill)).slice(0, 10);

  const scoreDistribution = BUCKETS.map(([lo, hi]) => ({ range: `${lo}-${hi}`, count: shots.filter((s) => s.overallScore >= lo && s.overallScore <= hi).length }));
  const averageScore = shots.length ? Math.round((shots.reduce((sum, s) => sum + s.overallScore, 0) / shots.length) * 10) / 10 : 0;

  ok(res, {
    totalJobs: jobs,
    totalCandidates: candidates,
    screened: new Set(shots.map((s) => String(s.candidate))).size,
    shortlisted: status.Shortlisted || 0,
    rejected: status.Rejected || 0,
    pending: (status.New || 0) + (status['Under Review'] || 0),
    averageScore, scoreDistribution, skillGaps, candidatesPerJob: perJob,
    averageScoreByJob, topSkills: skillRows, candidateVolume: volumeRows.reverse(),
    statusBreakdown: status
  });
});

/** GET /api/audit-logs?action=&page=&limit= */
exports.auditLogs = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePaging(req.query);
  const filter = req.user.role === 'admin' ? {} : { user: req.user.id };
  if (req.query.action) filter.action = new RegExp('^' + escapeRegex(cleanStr(req.query.action, 60)) + '$', 'i');
  const [logs, total] = await Promise.all([
    AuditLog.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).populate('user', 'name email').lean(),
    AuditLog.countDocuments(filter)
  ]);
  ok(res, logs, 200, { meta: { total, page, limit } });
});
