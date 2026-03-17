import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  completeQuickCreateJob,
  getActiveQuickCreateJobCount,
  registerQuickCreateJob,
} from './quick-create-jobs.ts';

describe('quick create jobs', () => {
  it('tracks active job counts across register and complete', () => {
    const firstJobId = 'quick-create-job-1';
    const secondJobId = 'quick-create-job-2';

    const initialCount = getActiveQuickCreateJobCount();

    assert.equal(registerQuickCreateJob({ jobId: firstJobId }), initialCount + 1);
    assert.equal(registerQuickCreateJob({ jobId: secondJobId }), initialCount + 2);
    assert.equal(getActiveQuickCreateJobCount(), initialCount + 2);

    assert.equal(completeQuickCreateJob(firstJobId), initialCount + 1);
    assert.equal(completeQuickCreateJob(secondJobId), initialCount);
    assert.equal(getActiveQuickCreateJobCount(), initialCount);
  });
});
