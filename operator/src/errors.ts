import type {ObjectValue} from './contracts.js';

export class OperatorError extends Error {
  constructor(public readonly code: string, message: string,
    public readonly httpStatus = 400, public readonly retryable = false,
    public readonly details: ObjectValue = {}) {
    super(message);
    this.name = 'OperatorError';
  }
}

export function publicError(error: unknown): ObjectValue {
  if (error instanceof OperatorError) {
    return {code: error.code, message: error.message, retryable: error.retryable,
      ...(error.code==='TOOL_INPUT_INVALID'&&Array.isArray(error.details.validation)?{validation:error.details.validation}:{})};
  }
  return {code: 'INTERNAL_ERROR', message: 'The operation could not finish. Check its recorded status before retrying.', retryable: false};
}

export function assert(condition: unknown, code: string, message: string, status = 400): asserts condition {
  if (!condition) throw new OperatorError(code, message, status);
}
