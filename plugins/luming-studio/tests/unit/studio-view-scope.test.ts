import { expect, it } from 'vitest';
import { isCurrentStudioViewScope } from '../../src/app/shared/studio-view-scope';

it('checks the current navigation even when a view returns to the same work', () => {
  const request = { viewId: 'view-one', artifactId: 'board-a', navigationGeneration: 0 };

  expect(isCurrentStudioViewScope(request, { ...request })).toBe(true);
  expect(
    isCurrentStudioViewScope(request, {
      viewId: 'view-one',
      artifactId: 'board-b',
      navigationGeneration: 1,
    }),
  ).toBe(false);
  expect(
    isCurrentStudioViewScope(request, {
      ...request,
      navigationGeneration: 2,
    }),
  ).toBe(false);
});

it('keeps request ownership local to the mounted view', () => {
  const request = { viewId: 'view-one', artifactId: 'board-a', navigationGeneration: 0 };

  expect(isCurrentStudioViewScope(request, { ...request, viewId: 'view-two' })).toBe(false);
  expect(isCurrentStudioViewScope(request, undefined)).toBe(false);
});
