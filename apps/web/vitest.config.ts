import { defineConfig } from 'vitest/config';

// On GitHub, the job summary names the package; locally, the usual reporter only.
export default defineConfig({
  test: {
    // eslint-disable-next-line no-restricted-properties -- the test runner's own config, not app code
    reporters: process.env.GITHUB_ACTIONS
      ? ['default', ['github-actions', { jobSummary: { title: 'Unit tests · web' } }]]
      : ['default'],
  },
});
