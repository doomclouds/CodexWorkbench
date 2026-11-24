import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { Field, type FieldBinding } from '../../src/ui/base/index.js';
import { createControlFixture } from '../support/render-control.js';

function renderInput(binding: FieldBinding) {
  return (
    <input
      id={binding.id}
      required={binding.required}
      aria-describedby={binding.describedBy}
      aria-invalid={binding.invalid}
    />
  );
}

describe('Field', () => {
  let fixture: ReturnType<typeof createControlFixture>;

  beforeEach(() => {
    fixture = createControlFixture();
  });

  afterEach(() => {
    fixture.dispose();
  });

  it('associates the label, description and error with the caller control', () => {
    fixture.render(
      <Field
        id="whiteboard-title"
        label="白板标题"
        description="请输入白板名称"
        error="标题不能为空"
        required
      >
        {renderInput}
      </Field>,
    );

    const input = fixture.host.querySelector('input');
    expect(fixture.host.querySelector('label')?.control).toBe(input);
    expect(input?.id).toBe('whiteboard-title');
    expect(input?.required).toBe(true);
    expect(input?.getAttribute('aria-invalid')).toBe('true');
    expect(input?.getAttribute('aria-describedby')).toBe(
      'whiteboard-title-description whiteboard-title-error',
    );
    expect(document.getElementById('whiteboard-title-description')?.textContent).toBe(
      '请输入白板名称',
    );
    expect(document.getElementById('whiteboard-title-error')?.textContent).toBe('标题不能为空');
  });

  it('keeps each generated id stable when the field messages change', () => {
    fixture.render(
      <>
        <Field label="白板标题" error="标题不能为空">
          {renderInput}
        </Field>
        <Field label="归档名称">{renderInput}</Field>
      </>,
    );

    const [title, archive] = fixture.host.querySelectorAll('input');
    const titleId = title?.id;
    const archiveId = archive?.id;
    expect(titleId).toBeTruthy();
    expect(archiveId).toBeTruthy();
    expect(titleId).not.toBe(archiveId);

    fixture.render(
      <>
        <Field label="白板标题" description="标题可用于搜索">
          {renderInput}
        </Field>
        <Field label="归档名称">{renderInput}</Field>
      </>,
    );

    const [currentTitle, currentArchive] = fixture.host.querySelectorAll('input');
    expect(currentTitle?.id).toBe(titleId);
    expect(currentArchive?.id).toBe(archiveId);
    expect(currentTitle?.getAttribute('aria-invalid')).toBeNull();
    expect(currentTitle?.getAttribute('aria-describedby')).toBe(titleId + '-description');
    expect(document.getElementById(titleId + '-error')).toBeNull();
    expect(currentArchive?.getAttribute('aria-describedby')).toBeNull();
    expect(currentArchive?.required).toBe(false);
  });
});
