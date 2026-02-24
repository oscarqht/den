import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getDirName } from './path.ts';

describe('getDirName', () => {
  it('should return the directory name of a file path', () => {
    assert.equal(getDirName('/a/b/c.txt'), '/a/b');
  });

  it('should return the parent directory of a directory path', () => {
    assert.equal(getDirName('/a/b/c'), '/a/b');
  });

  it('should handle trailing slashes correctly', () => {
    assert.equal(getDirName('/a/b/c/'), '/a/b');
  });

  it('should handle Windows separators', () => {
    assert.equal(getDirName('C:\\a\\b\\c.txt'), 'C:/a/b');
  });

  it('should handle mixed separators', () => {
    assert.equal(getDirName('C:\\a/b\\c.txt'), 'C:/a/b');
  });

  it('should return root for files in root', () => {
    assert.equal(getDirName('/file.txt'), '/');
  });

  it('should return . for files in current directory', () => {
    assert.equal(getDirName('file.txt'), '.');
  });

  it('should return . for relative paths without separators', () => {
    assert.equal(getDirName('dir'), '.');
  });

  it('should handle . and ..', () => {
    assert.equal(getDirName('.'), '.');
    assert.equal(getDirName('..'), '.');
  });

  it('should handle root path /', () => {
    assert.equal(getDirName('/'), '/');
  });

  it('should handle Windows root C:\\', () => {
    assert.equal(getDirName('C:\\'), 'C:/');
  });

  it('should handle Windows drive C:', () => {
    assert.equal(getDirName('C:'), 'C:');
  });

  it('should return empty string for empty input', () => {
    assert.equal(getDirName(''), '');
  });
});
