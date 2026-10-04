import { createVercelConfig } from './deploy/vercel-config.mjs';

// Evaluated by Vercel at build time. Never put model API keys in frontend assets.
export const config = createVercelConfig(process.env.BACKEND_URL);
