const fs = require('node:fs');
const path = require('node:path');

function findDuplicateMigrationPrefixes(directory) {
  const migrations = new Map();
  for (const filename of fs.readdirSync(directory)) {
    const match = /^(\d+)_.*\.sql$/.exec(filename);
    if (!match) continue;
    const files = migrations.get(match[1]) ?? [];
    files.push(filename);
    migrations.set(match[1], files);
  }
  return [...migrations.entries()].filter(([, files]) => files.length > 1);
}

function checkMigrationNumbering(directory) {
  const duplicates = findDuplicateMigrationPrefixes(directory);
  if (duplicates.length === 0) return true;

  console.error('Duplicate Supabase migration number prefixes:');
  for (const [prefix, files] of duplicates) {
    console.error(`  ${prefix}: ${files.join(', ')}`);
  }
  return false;
}

if (require.main === module) {
  const migrationDirectory = path.join(__dirname, '..', 'supabase', 'migrations');
  if (!checkMigrationNumbering(migrationDirectory)) process.exitCode = 1;
}

module.exports = { checkMigrationNumbering, findDuplicateMigrationPrefixes };