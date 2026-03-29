export type Guard<T = unknown> = (value: unknown) => value is T;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export const isString: Guard<string> = (value): value is string => typeof value === "string";
export const isNumber: Guard<number> = (value): value is number => typeof value === "number";
export const isBoolean: Guard<boolean> = (value): value is boolean => typeof value === "boolean";

export const isStringArray: Guard<string[]> = (value): value is string[] => (
  Array.isArray(value) && value.every(isString)
);

export function isArrayOf<T>(guard: Guard<T>): Guard<T[]> {
  return (value: unknown): value is T[] => Array.isArray(value) && value.every(guard);
}

export function isNullable<T>(guard: Guard<T>): Guard<T | null> {
  return (value: unknown): value is T | null => value === null || guard(value);
}

export function isEnumValue<T extends string>(
  allowed: readonly T[] | ReadonlySet<string>,
): Guard<T> {
  return (value: unknown): value is T => (
    typeof value === "string"
    && (
      allowed instanceof Set
        ? allowed.has(value)
        : (allowed as readonly string[]).includes(value)
    )
  );
}

export function validateWith<T>(validator: (value: unknown) => T | null): Guard<T> {
  return (value: unknown): value is T => validator(value) !== null;
}

export function hasShape(
  value: Record<string, unknown>,
  required: Record<string, Guard>,
  optional: Record<string, Guard> = {},
): boolean {
  for (const [key, guard] of Object.entries(required)) {
    if (!guard(value[key])) {
      return false;
    }
  }

  for (const [key, guard] of Object.entries(optional)) {
    if (value[key] !== undefined && !guard(value[key])) {
      return false;
    }
  }

  return true;
}
