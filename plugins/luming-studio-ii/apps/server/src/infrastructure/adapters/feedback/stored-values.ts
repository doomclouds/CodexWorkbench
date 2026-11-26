export function readText(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    throw new Error(`Invalid stored feedback text for ${field}.`);
  }

  return value;
}

export function readFinite(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Invalid stored feedback number for ${field}.`);
  }

  return value;
}

export function readUnsigned(value: unknown, field: string): bigint {
  if (typeof value !== 'bigint' || value < 0n) {
    throw new Error(`Invalid stored feedback integer for ${field}.`);
  }

  return value;
}

export function readOptionalUnsigned(value: unknown, field: string): bigint | undefined {
  return value === null ? undefined : readUnsigned(value, field);
}

export function readBool(value: unknown, field: string): boolean {
  if (value !== 0n && value !== 1n) {
    throw new Error(`Invalid stored feedback boolean for ${field}.`);
  }

  return value === 1n;
}
