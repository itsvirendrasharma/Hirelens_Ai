const router = require('express').Router();
const multer = require('multer');
const rateLimit = require('express-rate-limit');
const c = require('../controllers/candidateController');
const { getMaxBytes } = require('../services/resumeParser');

// Memory storage: the file is parsed in memory and never written to disk (no temp files, nothing publicly reachable).
// Only the structured profile, a sanitized text copy and metadata are saved (see RESUME_TEXT_RETENTION_DAYS).
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: getMaxBytes(), files: 1, fields: 12 } });

// Uploads trigger parsing (and optionally a paid AI call), so they are rate limited per signed-in user.
const uploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: Number(process.env.UPLOAD_RATE_LIMIT) || 40, standardHeaders: true, legacyHeaders: false,
  keyGenerator: (req) => (req.user && req.user.id) || 'anonymous',
  validate: { keyGeneratorIpFallback: false },
  skip: () => process.env.NODE_ENV === 'test',
  message: { success: false, message: 'Too many resume uploads. Please wait a few minutes and try again.' }
});

router.route('/').get(c.list).post(c.create);
router.get('/upload-config', c.uploadConfig); // before "/:id"
router.post('/compare', c.compare);
router.post('/upload', uploadLimiter, upload.single('resume'), c.upload);
router.route('/:id').get(c.get).put(c.update).delete(c.remove);
module.exports = router;
