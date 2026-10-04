export function createVercelConfig(backendUrl) {
  if (!backendUrl?.trim()) {
    throw new Error('Set BACKEND_URL to the deployed Render HTTPS origin before deploying Vercel.');
  }
  const backend = new URL(backendUrl.trim());
  if (backend.protocol !== 'https:' || backend.username || backend.password ||
      backend.search || backend.hash || backend.pathname !== '/') {
    throw new Error('BACKEND_URL must be an HTTPS origin, without credentials, a path, query, or fragment.');
  }
  return {
    framework: null,
    buildCommand: 'node deploy/build-frontend.mjs',
    outputDirectory: 'dist',
    rewrites: [{ source: '/api/:path*', destination: `${backend.origin}/api/:path*` }],
    headers: [
      { source: '/api/:path*', headers: [
        { key: 'Cache-Control', value: 'no-store' },
        { key: 'CDN-Cache-Control', value: 'no-store' },
        { key: 'Vercel-CDN-Cache-Control', value: 'no-store' },
        { key: 'x-vercel-enable-rewrite-caching', value: '0' },
      ] },
      { source: '/(.*)', headers: [
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'Referrer-Policy', value: 'no-referrer' },
      ] },
    ],
  };
}
