const path = require('path');
const dotenv = require('dotenv');

// Always load repo-root .env (fixes "missing keys" when cwd is not project root)
dotenv.config({ path: path.join(__dirname, '..', '.env') });
