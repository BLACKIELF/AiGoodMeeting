import { describe, expect, it } from 'bun:test';
import { toUserMessage } from '../../src/lib/user-message';

describe('user-facing diagnostics', () => {
  it('keeps Chinese explanations and model names intact', () => {
    expect(toUserMessage('Whisper 模型未就绪，请先下载。')).toBe('Whisper 模型未就绪，请先下载。');
  });
  it('handles Error and serialized backend errors consistently', () => {
    expect(toUserMessage(new Error('Connection refused (os error 61)'))).toBe(toUserMessage({ message: 'Connection refused' }));
    expect(toUserMessage({ message: 'Connection refused' })).toContain('连接失败');
  });
  it('does not expose unknown diagnostics or paths as UI copy', () => {
    expect(toUserMessage('Error: decoder panic at /private/session', '转写未完成，请重试。')).toBe('转写未完成，请重试。');
    expect(toUserMessage(null, '未能保存。')).toBe('未能保存。');
    expect(toUserMessage({ message: 42 }, '未能保存。')).toBe('未能保存。');
  });
  it('distinguishes actionable resource, memory, permission, timeout and cancellation errors', () => {
    expect(toUserMessage('No space left on device')).toContain('磁盘空间不足');
    expect(toUserMessage('Out of memory')).toContain('内存不足');
    expect(toUserMessage('Permission denied')).toContain('访问被拒绝');
    expect(toUserMessage('Request timed out')).toContain('等待超时');
    expect(toUserMessage('Operation canceled')).toBe('操作已取消。');
  });
});
