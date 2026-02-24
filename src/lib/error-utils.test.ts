import { test } from 'node:test';
import assert from 'node:assert';
import { getErrorMessage } from './error-utils.ts';

test('getErrorMessage', async (t) => {
  await t.test('returns message from Error object', () => {
    const error = new Error('Something went wrong');
    assert.strictEqual(getErrorMessage(error), 'Something went wrong');
  });

  await t.test('returns string as is', () => {
    assert.strictEqual(getErrorMessage('Already a string'), 'Already a string');
  });

  await t.test('converts number to string', () => {
    assert.strictEqual(getErrorMessage(123), '123');
    assert.strictEqual(getErrorMessage(0), '0');
    assert.strictEqual(getErrorMessage(-1), '-1');
    assert.strictEqual(getErrorMessage(NaN), 'NaN');
  });

  await t.test('converts null to string', () => {
    assert.strictEqual(getErrorMessage(null), 'null');
  });

  await t.test('converts undefined to string', () => {
    assert.strictEqual(getErrorMessage(undefined), 'undefined');
  });

  await t.test('converts boolean to string', () => {
    assert.strictEqual(getErrorMessage(true), 'true');
    assert.strictEqual(getErrorMessage(false), 'false');
  });

  await t.test('converts object with custom toString', () => {
    const obj = {
      toString() {
        return 'Custom object error';
      }
    };
    assert.strictEqual(getErrorMessage(obj), 'Custom object error');
  });

  await t.test('converts plain object to string', () => {
    const obj = { foo: 'bar' };
    assert.strictEqual(getErrorMessage(obj), '[object Object]');
  });

  await t.test('handles custom Error subclasses', () => {
    class CustomError extends Error {}
    const error = new CustomError('Custom error message');
    assert.strictEqual(getErrorMessage(error), 'Custom error message');
  });

  await t.test('handles object that looks like an Error but is not an instance of Error', () => {
      // This falls into String(error) case because it's not instanceof Error
      const fakeError = { message: 'Fake error', name: 'Error' };
      assert.strictEqual(getErrorMessage(fakeError), '[object Object]');
  });
});
