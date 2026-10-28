import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { EmptyStateSummary } from '../../src/components/EmptyStateSummary';

describe('empty summary state', () => {
  test('renders a persistent retryable error', () => {
    const html = renderToStaticMarkup(
      <EmptyStateSummary
        error="Summary request failed"
        hasModel
        onGenerate={() => {}}
      />,
    );

    expect(html).toContain('role="alert"');
    expect(html).not.toContain('Summary request failed');
    expect(html).toMatch(/[\u3400-\u9fff]/);
    expect(html).toContain('重新生成纪要');
  });
});
