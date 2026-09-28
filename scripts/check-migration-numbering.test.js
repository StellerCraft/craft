const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { afterEach, describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { findDuplicateMigrationPrefixes } = require('./check-migration-numbering');

const fixtureDirectories = [];

function makeFixture(filenames) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'migration-numbering-'));
  fixtureDirectories.push(directory);
  for (const filename of filenames) fs.writeFileSync(path.join(directory, filename), '');
  return directory;
}

afterEach(() => {
  for (const directory of fixtureDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('findDuplicateMigrationPrefixes', () => {
  it('returns no groups when migration numbers are unique', () => {
    const directory = makeFixture(['001_initial.sql', '002_next.sql']);
    assert.deepEqual(findDuplicateMigrationPrefixes(directory), []);
  });

  it('lists every file in each duplicate prefix group', () => {
    const directory = makeFixture(['014_first.sql', '014_second.sql', '015_next.sql']);
    assert.deepEqual(findDuplicateMigrationPrefixes(directory), [
      ['014', ['014_first.sql', '014_second.sql']],
    ]);
  });
});