import {
  MAX_LOCAL_STRING_LENGTH,
  countLocalCodePoints,
  isLocalEmail,
} from './component-utils';

/**
 * Pure text-field validation shared by the built-in controls and the document
 * renderer. It contains no component state and no localization lookup; callers
 * pass the message table they already use.
 */
export function textProblem(
  value: string,
  options: {
    required: boolean;
    minLength?: number;
    maxLength?: number;
    email?: boolean;
  },
  t: (en: string, zh: string) => string,
): string | null {
  if (options.required && value.length === 0) return t('This field is required', '请填写此字段');
  if (value.length > MAX_LOCAL_STRING_LENGTH) {
    return t(
      `At most ${MAX_LOCAL_STRING_LENGTH} characters`,
      `最多允许 ${MAX_LOCAL_STRING_LENGTH} 个字符`,
    );
  }
  if (options.email && value !== '' && !isLocalEmail(value)) {
    return t('Enter a valid email address', '请输入有效的邮箱地址');
  }
  const length = countLocalCodePoints(value);
  if (options.minLength !== undefined && options.minLength > 0 && value !== '' && length < options.minLength) {
    return t(`At least ${options.minLength} characters`, `至少需要 ${options.minLength} 个字符`);
  }
  if (options.maxLength !== undefined && options.maxLength >= 0 && length > options.maxLength) {
    return t(`At most ${options.maxLength} characters`, `最多允许 ${options.maxLength} 个字符`);
  }
  return null;
}
