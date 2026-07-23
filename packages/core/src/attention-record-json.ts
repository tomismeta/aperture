export function cloneRecordValue<T>(value: T, path: string, seen = new WeakSet<object>()): T {
  if (value === null) {
    return value;
  }

  const valueType = typeof value;
  if (valueType === "string" || valueType === "boolean") {
    return value;
  }
  if (valueType === "number") {
    if (!Number.isFinite(value)) {
      throw new RangeError(
        `Attention decision record cannot contain non-finite number at ${path}.`,
      );
    }
    return value;
  }
  if (valueType === "undefined") {
    throw new TypeError(`Attention decision record cannot contain undefined at ${path}.`);
  }
  if (valueType === "bigint" || valueType === "function" || valueType === "symbol") {
    throw new TypeError(`Attention decision record cannot contain ${valueType} at ${path}.`);
  }

  if (Array.isArray(value)) {
    return cloneRecordArray(value, path, seen) as T;
  }

  if (typeof value === "object") {
    return cloneRecordObject(value, path, seen) as T;
  }

  throw new TypeError(`Attention decision record cannot contain unsupported value at ${path}.`);
}

function cloneRecordArray(value: unknown[], path: string, seen: WeakSet<object>): unknown[] {
  rejectCircularRecordValue(value, path, seen);
  const cloned = value.map((entry, index) => {
    if (entry === undefined) {
      throw new TypeError(
        `Attention decision record cannot contain undefined at ${path}[${index}].`,
      );
    }
    return cloneRecordValue(entry, `${path}[${index}]`, seen);
  });
  seen.delete(value);
  return cloned;
}

function cloneRecordObject(
  value: object,
  path: string,
  seen: WeakSet<object>,
): Record<string, unknown> {
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`Attention decision record cannot contain non-plain object at ${path}.`);
  }
  if (Object.getOwnPropertySymbols(value).length > 0) {
    throw new TypeError(`Attention decision record cannot contain symbol keys at ${path}.`);
  }

  rejectCircularRecordValue(value, path, seen);
  const cloned: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value).sort(compareRecordKeys)) {
    if (entry === undefined) {
      continue;
    }
    cloned[key] = cloneRecordValue(entry, `${path}.${key}`, seen);
  }
  seen.delete(value);
  return cloned;
}

function rejectCircularRecordValue(value: object, path: string, seen: WeakSet<object>): void {
  if (seen.has(value)) {
    throw new TypeError(`Attention decision record cannot contain circular reference at ${path}.`);
  }
  seen.add(value);
}

function compareRecordKeys([left]: [string, unknown], [right]: [string, unknown]): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
