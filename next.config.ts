import type { NextConfig } from 'next';

const config: NextConfig = {
  // Database drivers stay as runtime Node modules instead of being bundled.
  serverExternalPackages: ['snowflake-sdk', 'pg'],
  // SQL and PDF options are read from core-files/ at runtime, so ship them with every server function.
  outputFileTracingIncludes: { '/**': ['./core-files/**/*'] },
  // The backend uses Node-style ESM imports ('./x.js' for x.ts). Webpack maps them; Turbopack does not,
  // so dev and build run with --webpack.
  webpack: config => {
    config.resolve.extensionAlias = { '.js': ['.ts', '.tsx', '.js'] };
    return config;
  },
};

export default config;
