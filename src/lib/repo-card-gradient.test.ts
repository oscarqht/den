import { describe, test } from 'node:test';
import assert from 'node:assert';
import { getStableRepoCardGradient } from './repo-card-gradient.ts';

describe('repo-card-gradient', () => {
  test('returns a stable gradient for the same repository name', () => {
    const gradientA = getStableRepoCardGradient('my-awesome-repo');
    const gradientB = getStableRepoCardGradient('my-awesome-repo');
    assert.deepStrictEqual(gradientA, gradientB);
  });

  test('normalizes casing and whitespace when deriving gradients', () => {
    const gradientA = getStableRepoCardGradient('  My-Awesome-Repo  ');
    const gradientB = getStableRepoCardGradient('my-awesome-repo');
    assert.deepStrictEqual(gradientA, gradientB);
  });

  test('returns different gradients for different repository names', () => {
    const gradientA = getStableRepoCardGradient('repo-one');
    const gradientB = getStableRepoCardGradient('repo-two');
    assert.notStrictEqual(gradientA.backgroundImage, gradientB.backgroundImage);
  });

  test('uses layered gradients suitable for light card backgrounds', () => {
    const gradient = getStableRepoCardGradient('visual-test-repo');
    assert.match(gradient.backgroundImage, /radial-gradient/);
    assert.match(gradient.backgroundImage, /linear-gradient/);
    assert.match(gradient.backgroundImage, /hsl\(/);
  });
});
