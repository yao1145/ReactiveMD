export type LocalObservabilityMessageKey =
  | 'local.worker.timeout'
  | 'local.worker.error'
  | 'local.worker.compile'
  | 'local.worker.compile.detail'
  | 'local.worker.stale-response'
  | 'local.export.failure'
  | 'local.resource.budget';

export const LOCAL_OBSERVABILITY_MESSAGES: Readonly<Record<LocalObservabilityMessageKey, Readonly<{ en: string; zh: string }>>> = Object.freeze({
  'local.worker.timeout': { en: 'The background compilation request timed out after {timeoutMs} ms.', zh: '编译 Worker 请求在 {timeoutMs} 毫秒后超时。' },
  'local.worker.error': { en: 'The background compiler failed while processing the request.', zh: '编译 Worker 处理请求时失败。' },
  'local.worker.compile': { en: 'The background compiler could not complete this request.', zh: '编译 Worker 无法完成此请求。' },
  'local.worker.compile.detail': { en: 'The background compiler could not complete this request: {detail}', zh: '编译 Worker 无法完成此请求：{detail}' },
  'local.worker.stale-response': { en: 'The background compiler returned a response for an older source revision.', zh: '编译 Worker 返回了较旧源码版本的响应。' },
  'local.export.failure': { en: 'The {stage} stage of export failed.', zh: '导出流程的 {stage} 阶段失败。' },
  'local.resource.budget': { en: 'Resource {budget} used {actual} {unit}, exceeding the limit of {limit}.', zh: '资源 {budget} 已使用 {actual} {unit}，超过上限 {limit}。' },
});

export function formatObservabilityMessage(key: LocalObservabilityMessageKey, locale: 'en' | 'zh', params: Readonly<Record<string, string | number | boolean>> = {}): string {
  return LOCAL_OBSERVABILITY_MESSAGES[key][locale].replace(/\{([A-Za-z][A-Za-z0-9_]*)\}/g, (_match, name: string) => String(params[name] ?? ''));
}
