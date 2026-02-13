/**
 * pnpm hook to fix VerusCoin/bitcoin-ops package.
 *
 * The fork adds evals.json but the package.json `files` array doesn't include it.
 * This hook patches the files array so pnpm includes evals.json in the install.
 */
function readPackage(pkg) {
  if (pkg.name === 'bitcoin-ops' && Array.isArray(pkg.files) && !pkg.files.includes('evals.json')) {
    pkg.files.push('evals.json');
  }
  return pkg;
}

module.exports = { hooks: { readPackage } };
