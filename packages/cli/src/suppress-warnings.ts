// Imported first so it runs before `node:sqlite` is loaded by core.
// Hides only Node's "SQLite is an experimental feature" warning; everything else still prints.
const original = process.listeners('warning');
process.removeAllListeners('warning');
process.on('warning', (warning) => {
  if (warning.name === 'ExperimentalWarning' && /SQLite/i.test(warning.message)) return;
  for (const l of original) (l as (w: Error) => void)(warning);
});

export {};
