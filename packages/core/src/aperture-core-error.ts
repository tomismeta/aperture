export class ApertureCoreError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = new.target.name;
    this.code = code;
  }
}

export class ApertureCoreValidationError extends ApertureCoreError {
  readonly field: string | undefined;

  constructor(message: string, options: { field?: string; code?: string } = {}) {
    super(options.code ?? "validation_error", message);
    this.field = options.field;
  }
}

export class ApertureCoreResponseExpiredError extends ApertureCoreError {
  readonly taskId: string;
  readonly interactionId: string;
  readonly expiredAt: string;

  constructor(options: { taskId: string; interactionId: string; expiredAt: string }) {
    super(
      "response_expired",
      `response for interaction ${options.interactionId} expired at ${options.expiredAt} and must be revalidated before submission`,
    );
    this.taskId = options.taskId;
    this.interactionId = options.interactionId;
    this.expiredAt = options.expiredAt;
  }
}

export function isApertureCoreError(error: unknown): error is ApertureCoreError {
  return error instanceof ApertureCoreError;
}

export function isApertureCoreValidationError(
  error: unknown,
): error is ApertureCoreValidationError {
  return error instanceof ApertureCoreValidationError;
}

export function isApertureCoreResponseExpiredError(
  error: unknown,
): error is ApertureCoreResponseExpiredError {
  return error instanceof ApertureCoreResponseExpiredError;
}
