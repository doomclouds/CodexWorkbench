export type ArchiveData = Readonly<Record<string, unknown>>;
export type SourceResolver = (source: string, kind: 'reference' | 'text') => string;

export class ArchiveObjectError extends Error {}

const assetPath = /(?<![\w/:.])\/assets\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+(?![\w./%-])/gu;

export function record(value: unknown, name: string): ArchiveData {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new ArchiveObjectError(`Invalid archived ${name}.`);
  }

  return value as ArchiveData;
}

export function sequence(value: unknown, name: string): readonly unknown[] {
  if (!Array.isArray(value)) {
    throw new ArchiveObjectError(`Invalid archived ${name}.`);
  }

  return value;
}

export function stringValue(value: unknown, name: string): string {
  if (typeof value !== 'string') {
    throw new ArchiveObjectError(`Invalid archived ${name}.`);
  }

  return value;
}

export function optionalString(value: unknown, name: string): string | undefined {
  return value === undefined ? undefined : stringValue(value, name);
}

export function requiredId(value: unknown, name: string): string {
  const id = stringValue(value, name);
  if (!id) {
    throw new ArchiveObjectError(`Missing archived ${name}.`);
  }

  return id;
}

export function numberValue(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ArchiveObjectError(`Invalid archived ${name}.`);
  }

  return value;
}

export function optionalNumber(value: unknown, name: string): number | undefined {
  return value === undefined ? undefined : numberValue(value, name);
}

export function unsignedInteger(value: unknown, name: string): number {
  const integer = numberValue(value, name);
  if (!Number.isSafeInteger(integer) || integer < 0) {
    throw new ArchiveObjectError(`Invalid archived ${name}.`);
  }

  return integer;
}

export function booleanValue(value: unknown, name: string, defaultValue = false): boolean {
  if (value === undefined) {
    return defaultValue;
  }
  if (typeof value !== 'boolean') {
    throw new ArchiveObjectError(`Invalid archived ${name}.`);
  }

  return value;
}

export function remapSource(value: unknown, name: string, resolveSource: SourceResolver) {
  const source = optionalString(value, name);

  return source ? resolveSource(source, 'reference') : source;
}

export function remapMarkup(text: string, resolveSource: SourceResolver): string {
  return text.replace(assetPath, (source) => resolveSource(source, 'text'));
}

export function remapContent(value: unknown, resolveSource: SourceResolver): unknown {
  if (typeof value === 'string') {
    return remapMarkup(value, resolveSource);
  }
  if (Array.isArray(value)) {
    return value.map((item: unknown) => remapContent(item, resolveSource));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, remapContent(item, resolveSource)]),
    );
  }

  return value;
}
