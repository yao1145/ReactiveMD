import type { Diagnostic } from '../local/types';
import { buildDiagnostic } from './diagnostics';
import { sha256, utf8ByteLength } from './digest';

const MAX_NOTICE_ID_LENGTH = 192;
const MAX_NOTICE_FIELD_LENGTH = 2048;
const MAX_NOTICE_TEXT_LENGTH = 1_048_576;
const MAX_NOTICES_TOTAL_BYTES = 1_048_576;
const NOTICE_ID = /^[A-Za-z0-9@][A-Za-z0-9@._/-]*$/;
const NOTICE_URL = /^https?:\/\/[^\s]+$/i;

/** One explicit host notice or license record attached by the package author. */
export interface LocalBuildNoticeInput {
  readonly id: string;
  readonly name?: string;
  readonly version?: string;
  readonly license?: string;
  readonly url?: string;
  readonly text?: string;
}

export interface LocalBuildNotice {
  readonly id: string;
  readonly name?: string;
  readonly version?: string;
  readonly license?: string;
  readonly url?: string;
  readonly text?: string;
  readonly digest: string;
}

export interface LocalBuildNotices {
  readonly text: string;
  readonly digest: string;
  readonly entries: readonly LocalBuildNotice[];
}

function readText(value: unknown, path: string, limit: number, diagnostics: Diagnostic[]): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') {
    diagnostics.push(buildDiagnostic('local.build.notice-invalid', `${path} must be a string.`));
    return undefined;
  }
  if (value.length > limit) {
    diagnostics.push(buildDiagnostic('local.build.notice-invalid', `${path} exceeds ${limit} characters.`));
    return undefined;
  }
  return value;
}

function readNotice(value: unknown, index: number, diagnostics: Diagnostic[]): LocalBuildNotice | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    diagnostics.push(buildDiagnostic('local.build.notice-invalid', `notices[${index}] must be an object.`));
    return null;
  }
  const record = value as Record<string, unknown>;
  const id = record.id;
  if (typeof id !== 'string' || id.length === 0 || id.length > MAX_NOTICE_ID_LENGTH || !NOTICE_ID.test(id)) {
    diagnostics.push(buildDiagnostic(
      'local.build.notice-invalid',
      `notices[${index}].id must be a bounded package-like identifier.`,
    ));
    return null;
  }
  const name = readText(record.name, `notices[${index}].name`, MAX_NOTICE_FIELD_LENGTH, diagnostics);
  const version = readText(record.version, `notices[${index}].version`, MAX_NOTICE_FIELD_LENGTH, diagnostics);
  const license = readText(record.license, `notices[${index}].license`, MAX_NOTICE_FIELD_LENGTH, diagnostics);
  const text = readText(record.text, `notices[${index}].text`, MAX_NOTICE_TEXT_LENGTH, diagnostics);
  let url: string | undefined;
  if (record.url !== undefined) {
    url = readText(record.url, `notices[${index}].url`, MAX_NOTICE_FIELD_LENGTH, diagnostics);
    if (url !== undefined && !NOTICE_URL.test(url)) {
      diagnostics.push(buildDiagnostic(
        'local.build.notice-invalid',
        `notices[${index}].url must be an http(s) URL.`,
      ));
      url = undefined;
    }
  }
  const identity = JSON.stringify({ name, version, license, url, text });
  return Object.freeze({
    id,
    ...(name === undefined ? {} : { name }),
    ...(version === undefined ? {} : { version }),
    ...(license === undefined ? {} : { license }),
    ...(url === undefined ? {} : { url }),
    ...(text === undefined ? {} : { text }),
    digest: sha256(identity),
  }) as LocalBuildNotice;
}

function formatNotice(notice: LocalBuildNotice): string {
  const identity = [notice.name, notice.version].filter((part): part is string => typeof part === 'string' && part.length > 0).join(' ');
  const lines = [identity.length > 0 ? `${notice.id} (${identity})` : notice.id];
  if (notice.license) lines.push(`License: ${notice.license}`);
  if (notice.url) lines.push(notice.url);
  if (notice.text) lines.push(notice.text);
  return lines.join('\n');
}

/**
 * Merge explicit notice sources deterministically. Duplicate identities
 * deduplicate; the same id with different contents is a conflict.
 */
export function collectLocalBuildNotices(
  sources: readonly unknown[],
  diagnostics: Diagnostic[],
): LocalBuildNotices {
  const strings: string[] = [];
  const byId = new Map<string, LocalBuildNotice>();
  let index = 0;
  for (const source of sources) {
    if (source === undefined || source === null) continue;
    if (typeof source === 'string') {
      if (source.length > MAX_NOTICES_TOTAL_BYTES) {
        diagnostics.push(buildDiagnostic('local.build.notice-budget', 'The notice text exceeds its 1 MiB budget.'));
      } else if (source.trim().length > 0) {
        strings.push(source);
      }
      continue;
    }
    if (!Array.isArray(source)) {
      diagnostics.push(buildDiagnostic('local.build.notice-invalid', 'notices must be an array or a string.'));
      continue;
    }
    for (const entry of source) {
      const notice = readNotice(entry, index, diagnostics);
      index += 1;
      if (!notice) continue;
      const previous = byId.get(notice.id);
      if (previous) {
        if (previous.digest !== notice.digest) {
          diagnostics.push(buildDiagnostic(
            'local.build.notice-conflict',
            `Notice "${notice.id}" is declared with conflicting contents.`,
          ));
        }
        continue;
      }
      byId.set(notice.id, notice);
    }
  }
  const entries = [...byId.values()].sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
  const blocks = [...strings, ...entries.map(formatNotice)];
  const text = blocks.join('\n\n');
  const bytes = utf8ByteLength(text);
  if (bytes > MAX_NOTICES_TOTAL_BYTES) {
    diagnostics.push(buildDiagnostic('local.build.notice-budget', 'Collected notices exceed the 1 MiB budget.'));
  }
  return Object.freeze({ text, digest: sha256(text), entries: Object.freeze(entries) });
}
