/** Keep technical diagnostics in logs; show a useful Chinese message in the UI. */
export function toUserMessage(value: unknown, fallback = '操作未完成，请重试。'): string {
  const message = value instanceof Error ? value.message
    : typeof value === 'string' ? value
    : value && typeof value === 'object' && 'message' in value && typeof value.message === 'string' ? value.message
    : '';
  if (!message.trim()) return fallback;
  // Chinese messages may legitimately contain a model name, path or HTTP code.
  if (/[\u3400-\u9fff]/.test(message) && !/\b(?:error|exception|failed|traceback|caused by)\b/i.test(message)) return message;
  if (/cancelled|canceled|aborted/i.test(message)) return '操作已取消。';
  if (/no space left|disk full|insufficient disk/i.test(message)) return '磁盘空间不足，请腾出空间后重试。';
  if (/out of memory|memory allocation|insufficient memory/i.test(message)) return '可用内存不足，请关闭其他占用内存的应用或选择较小的模型。';
  if (/permission denied|access denied|not permitted|unauthorized|forbidden|\b40[13]\b/i.test(message)) return '访问被拒绝，请检查系统权限或服务凭据。';
  if (/timed?\s*out|timeout|deadline exceeded/i.test(message)) return '等待超时，请检查服务是否正常运行后重试。';
  if (/connection refused|failed to fetch|fetch failed|network|could not connect|connection error|connection reset/i.test(message)) return '连接失败，请检查所选服务是否已启动，以及网络或服务地址是否正确。';
  if (/not found|no such file|does not exist|\b404\b/i.test(message)) return '未找到所需文件、模型或服务，请检查设置后重试。';
  if (/already running|in progress|is busy/i.test(message)) return '已有任务正在进行，请等待完成后重试。';
  return fallback;
}
