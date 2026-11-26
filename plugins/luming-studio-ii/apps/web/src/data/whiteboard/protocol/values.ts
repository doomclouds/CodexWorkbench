export function requireField<Value>(value: Value | undefined, name: string): Value {
  if (value === undefined) {
    throw new Error('Whiteboard response is missing ' + name + '.');
  }

  return value;
}

export function matchIdentity(actual: string, expected: string, name: string): void {
  if (actual !== expected) {
    throw new Error('Whiteboard response has an unexpected ' + name + '.');
  }
}
