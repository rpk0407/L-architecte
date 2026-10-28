// @ts-check
// The software version the journal records (CPT-01a). The technical log (tick step `jet`, commands/steps/fiscal.js)
// writes a `tech.logged { kind: 'version' }` the first tick a different version runs. Bump the major on any change to
// tickets, closures or the journal format (its proof of compliance must be renewed, BOFiP §380), the minor otherwise;
// the build is the deployed commit (docs/security.md › Signed closures and the technical log).

export const SOFTWARE = Object.freeze({
  name: 'Le Comptoir',
  major: 1,
  minor: 0,
  build: (process.env.VERCEL_GIT_COMMIT_SHA || 'local').slice(0, 7)
});

/** '1.0 (a1b2c3d)' @param {{ major: number, minor: number, build: string }} [sw] */
export const versionOf = (sw = SOFTWARE) => sw.major + '.' + sw.minor + ' (' + sw.build + ')';
