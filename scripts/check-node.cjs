#!/usr/bin/env node
// Fail-fast guard: Backstage (@backstage/cli 0.36 / backstage 1.50) only
// supports Node 20 and 22. On Node 24 the native TypeScript type-stripping
// breaks the @internal/* source plugins (backend: ERR_UNSUPPORTED_NODE_MODULES_
// TYPE_STRIPPING, frontend: JSX parse errors). This aborts with a clear message
// instead of the cryptic transpile errors. See .nvmrc / package.json "engines".

const SUPPORTED_MAJORS = [20, 22];
const major = Number(process.versions.node.split('.')[0]);

if (!SUPPORTED_MAJORS.includes(major)) {
  const line = '='.repeat(72);
  process.stderr.write(
    `\n${line}\n` +
      `  Node.js ${process.versions.node} is not supported by this Backstage app.\n` +
      `  Supported versions: ${SUPPORTED_MAJORS.join(' or ')} (see .nvmrc / package.json "engines").\n\n` +
      `  Switch your Node version before running, e.g. with nvm:\n` +
      `      nvm install 22 && nvm use 22 && nvm alias default 22\n` +
      `      node -v            # must print v22.x (or v20.x)\n` +
      `      yarn install       # rebuild native modules for this Node\n\n` +
      `  Running on Node 24 causes ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING\n` +
      `  (backend) and JSX/Rspack parse errors (frontend) in the @internal plugins.\n` +
      `${line}\n\n`,
  );
  process.exit(1);
}
