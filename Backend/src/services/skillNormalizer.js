/**
 * Central skill normalization. Ported from the frontend ALIASES table so the
 * browser demo and the backend agree on canonical skill names.
 */
const ALIASES = {
  'js': 'JavaScript', 'javascript': 'JavaScript', 'ecmascript': 'JavaScript',
  'ts': 'TypeScript', 'typescript': 'TypeScript',
  'reactjs': 'React', 'react.js': 'React', 'react': 'React',
  'node': 'Node.js', 'nodejs': 'Node.js', 'node.js': 'Node.js',
  'mongo db': 'MongoDB', 'mongo': 'MongoDB', 'mongodb': 'MongoDB',
  'express js': 'Express.js', 'expressjs': 'Express.js', 'express': 'Express.js', 'express.js': 'Express.js',
  'rest': 'REST API', 'rest api': 'REST API', 'rest apis': 'REST API', 'restful api': 'REST API',
  'postgres': 'PostgreSQL', 'postgresql': 'PostgreSQL',
  'aws': 'AWS', 'docker': 'Docker', 'git': 'Git', 'sql': 'SQL', 'python': 'Python',
  'html': 'HTML', 'html5': 'HTML', 'css': 'CSS', 'css3': 'CSS',
  'tailwind': 'Tailwind CSS', 'tailwind css': 'Tailwind CSS', 'redux': 'Redux', 'jquery': 'jQuery',
  'java': 'Java', 'excel': 'Excel', 'tableau': 'Tableau', 'power bi': 'Power BI', 'powerbi': 'Power BI',
  'pandas': 'Pandas', 'statistics': 'Statistics', 'redis': 'Redis', 'graphql': 'GraphQL', 'jest': 'Jest',
  'spring boot': 'Spring Boot', 'springboot': 'Spring Boot', 'kubernetes': 'Kubernetes', 'k8s': 'Kubernetes',
  'ci/cd': 'CI/CD', 'mysql': 'MySQL', 'vue': 'Vue.js', 'vuejs': 'Vue.js', 'vue.js': 'Vue.js',
  'angular': 'Angular', 'angularjs': 'Angular', 'next.js': 'Next.js', 'nextjs': 'Next.js',
  'numpy': 'NumPy', 'scikit-learn': 'scikit-learn', 'sklearn': 'scikit-learn', 'c++': 'C++', 'c#': 'C#',
  'c': 'C', 'go': 'Go', 'golang': 'Go', 'rust': 'Rust', 'php': 'PHP', 'kotlin': 'Kotlin', 'swift': 'Swift', 'ruby': 'Ruby', 'r': 'R', 'scala': 'Scala',
  'matlab': 'MATLAB', 'bash': 'Bash', 'dart': 'Dart', 'flutter': 'Flutter', 'react native': 'React Native', 'django': 'Django', 'flask': 'Flask', 'fastapi': 'FastAPI',
  '.net': '.NET', 'asp.net': '.NET', 'dotnet': '.NET', 'laravel': 'Laravel', 'bootstrap': 'Bootstrap', 'sass': 'Sass', 'scss': 'Sass',
  'tensorflow': 'TensorFlow', 'pytorch': 'PyTorch', 'keras': 'Keras', 'opencv': 'OpenCV', 'matplotlib': 'Matplotlib', 'seaborn': 'Seaborn',
  'sqlite': 'SQLite', 'oracle': 'Oracle', 'firebase': 'Firebase', 'dynamodb': 'DynamoDB', 'elasticsearch': 'Elasticsearch',
  'azure': 'Azure', 'gcp': 'GCP', 'google cloud': 'GCP', 'heroku': 'Heroku', 'vercel': 'Vercel', 'netlify': 'Netlify',
  'github': 'GitHub', 'gitlab': 'GitLab', 'linux': 'Linux', 'postman': 'Postman', 'jira': 'Jira', 'figma': 'Figma', 'selenium': 'Selenium', 'cypress': 'Cypress',
  'junit': 'JUnit', 'mocha': 'Mocha', 'webpack': 'Webpack', 'vite': 'Vite', 'nginx': 'Nginx', 'jenkins': 'Jenkins', 'terraform': 'Terraform', 'ansible': 'Ansible',
  'agile': 'Agile', 'scrum': 'Scrum', 'oop': 'OOP', 'object oriented programming': 'OOP', 'data structures': 'Data Structures', 'dsa': 'Data Structures', 'algorithms': 'Algorithms',
  'machine learning': 'Machine Learning', 'ml': 'Machine Learning', 'deep learning': 'Deep Learning', 'nlp': 'NLP', 'natural language processing': 'NLP', 'computer vision': 'Computer Vision',
  'data analysis': 'Data Analysis', 'microservices': 'Microservices', 'jwt': 'JWT', 'oauth': 'OAuth', 'websocket': 'WebSockets', 'websockets': 'WebSockets', 'socket.io': 'Socket.IO',
  'ci cd': 'CI/CD', 'cicd': 'CI/CD', 'spark': 'Spark', 'apache spark': 'Spark', 'hadoop': 'Hadoop', 'kafka': 'Kafka', 'rabbitmq': 'RabbitMQ', 'mern': 'MERN Stack', 'mern stack': 'MERN Stack'
};

// Words that are also common English words: never detected from free text, only from explicit skill lists.
const AMBIGUOUS = new Set(['rest', 'express', 'node', 'vue', 'angular', 'c', 'r', 'go', 'ml', 'spark', 'oracle', 'swift']);

function normalizeSkill(s) {
  const t = String(s == null ? '' : s).trim().replace(/\s+/g, ' ');
  if (!t) return '';
  return ALIASES[t.toLowerCase()] || t;
}

function normalizeSkills(list) {
  const seen = new Set();
  const out = [];
  (Array.isArray(list) ? list : []).forEach((s) => {
    const n = normalizeSkill(s);
    const k = n.toLowerCase();
    if (n && !seen.has(k)) { seen.add(k); out.push(n); }
  });
  return out;
}

const escapeRe = (k) => k.replace(/[.+*?^${}()|[\]\\/]/g, '\\$&');
const SKILL_REGEXES = Object.keys(ALIASES)
  .filter((k) => !AMBIGUOUS.has(k))
  .map((k) => ({ canonical: ALIASES[k], rx: new RegExp('(^|[^a-z0-9+#.])' + escapeRe(k) + '($|[^a-z0-9+#])', 'i') }));

/** Find known skills mentioned in free text (deterministic, dictionary based). */
function findSkillsInText(text) {
  const t = String(text || '');
  const found = new Set();
  SKILL_REGEXES.forEach(({ canonical, rx }) => { if (rx.test(t)) found.add(canonical); });
  return [...found];
}


/** Canonical skill -> resume category (used to group extracted skills; anything unlisted is left ungrouped). */
const CATEGORY = {
  languages: ['JavaScript', 'TypeScript', 'Python', 'Java', 'C', 'C++', 'C#', 'Go', 'Rust', 'PHP', 'Kotlin', 'Swift', 'Ruby', 'R', 'Scala', 'MATLAB', 'Bash', 'Dart', 'SQL', 'HTML', 'CSS'],
  frameworks: ['React', 'Angular', 'Vue.js', 'Next.js', 'Express.js', 'Node.js', 'Spring Boot', 'Django', 'Flask', 'FastAPI', '.NET', 'Laravel', 'Flutter', 'React Native', 'Bootstrap', 'Tailwind CSS', 'MERN Stack'],
  libraries: ['Redux', 'jQuery', 'Pandas', 'NumPy', 'scikit-learn', 'TensorFlow', 'PyTorch', 'Keras', 'OpenCV', 'Matplotlib', 'Seaborn', 'Jest', 'Mocha', 'JUnit', 'Socket.IO', 'Sass'],
  databases: ['MongoDB', 'MySQL', 'PostgreSQL', 'SQLite', 'Oracle', 'Redis', 'Firebase', 'DynamoDB', 'Elasticsearch'],
  cloud: ['AWS', 'Azure', 'GCP', 'Heroku', 'Vercel', 'Netlify'],
  tools: ['Git', 'GitHub', 'GitLab', 'Docker', 'Kubernetes', 'Linux', 'Postman', 'Jira', 'Figma', 'Selenium', 'Cypress', 'Webpack', 'Vite', 'Nginx', 'Jenkins', 'Terraform', 'Ansible', 'CI/CD', 'Excel', 'Tableau', 'Power BI']
};
const CATEGORY_OF = {};
Object.keys(CATEGORY).forEach((cat) => CATEGORY[cat].forEach((s) => { CATEGORY_OF[s.toLowerCase()] = cat; }));

/** { languages, frameworks, libraries, databases, cloud, tools, other } from a skill list (other = domain-specific / uncategorised). */
function groupSkills(list) {
  const out = { languages: [], frameworks: [], libraries: [], databases: [], cloud: [], tools: [], other: [] };
  normalizeSkills(list).forEach((s) => { out[CATEGORY_OF[s.toLowerCase()] || 'other'].push(s); });
  return out;
}

module.exports = { ALIASES, CATEGORY, normalizeSkill, normalizeSkills, findSkillsInText, groupSkills };
