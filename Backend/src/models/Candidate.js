const mongoose = require('mongoose');

const STATUSES = ['New', 'Under Review', 'Shortlisted', 'Rejected', 'Interview', 'Hired'];

const candidateSchema = new mongoose.Schema({
  name: { type: String, required: [true, 'Candidate name is required'], trim: true, maxlength: 150 },
  email: { type: String, trim: true, lowercase: true, maxlength: 254, default: '' },
  phone: { type: String, trim: true, maxlength: 40, default: '' },
  location: { type: String, trim: true, maxlength: 150, default: '' },
  skills: { type: [String], default: [] },
  education: { type: [String], default: [] },
  experience: {
    type: [new mongoose.Schema({ role: String, company: String, years: { type: Number, min: 0, default: 0 }, summary: String, startDate: String, endDate: String, type: String, bullets: [String], achievements: [String] }, { _id: false })],
    default: []
  },
  projects: {
    type: [new mongoose.Schema({ name: String, desc: String, tech: [String], links: [String], bullets: [String] }, { _id: false })],
    default: []
  },
  certifications: { type: [String], default: [] },
  links: { linkedin: { type: String, default: '' }, github: { type: String, default: '' }, portfolio: { type: String, default: '' } },
  summary: { type: String, maxlength: 1000, default: '' },
  achievements: { type: [String], default: [] },
  publications: { type: [String], default: [] },
  // How the profile was extracted (method + warnings only; never resume content).
  extraction: { method: String, aiUsed: Boolean, model: String, warnings: [String] },
  educationDetails: {
    type: [new mongoose.Schema({ degree: String, field: String, institution: String, year: String, startYear: String, grade: String }, { _id: false })],
    default: []
  },
  skillGroups: { type: mongoose.Schema.Types.Mixed, default: undefined }, // { languages, frameworks, libraries, databases, cloud, tools }
  yearsOfExperience: { type: Number, min: 0, max: 60, default: 0 },       // stated on the resume, or calculated from dated roles
  yearsSource: { type: String, enum: ['stated', 'calculated', 'unknown'], default: 'unknown' },
  resumeHash: { type: String, index: true },                                // sha256 of the uploaded file (duplicate detection)
  resumeText: { type: String, select: false, maxlength: 200000 },
  resumeTextStoredAt: { type: Date, index: true }, // retention: the text is removed after RESUME_TEXT_RETENTION_DAYS
  // Metadata only: uploaded files are parsed in memory and not stored (see README).
  resumeFile: {
    originalName: String,
    mimeType: String,
    size: Number,
    uploadedAt: Date
  },
  status: { type: String, enum: STATUSES, default: 'New' },
  notes: { type: String, maxlength: 5000, default: '' },
  job: { type: mongoose.Schema.Types.ObjectId, ref: 'Job', index: true }, // job applied for
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true }
}, { timestamps: true });

candidateSchema.index({ createdBy: 1, job: 1, resumeHash: 1 });
candidateSchema.index({ createdBy: 1, job: 1, email: 1 });
candidateSchema.index({ createdBy: 1, status: 1 });

candidateSchema.statics.STATUSES = STATUSES;

module.exports = mongoose.models.Candidate || mongoose.model('Candidate', candidateSchema);
