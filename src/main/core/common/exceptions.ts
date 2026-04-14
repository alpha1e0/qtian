/**
 * Base exception class for Qtian application
 */
export class QtianException extends Error {
  readonly errorCode: string;

  constructor(msg: string, errCode: string = 'B_001') {
    super(msg);
    this.name = this.constructor.name;
    this.errorCode = errCode;
    Object.setPrototypeOf(this, QtianException.prototype);
  }

  toString(): string {
    return `${this.name} [${this.errorCode}] ${this.message}`;
  }

  toJSON() {
    return {
      success: false,
      err_code: this.errorCode,
      err_msg: this.message,
    };
  }
}

/**
 * Database operation error
 */
export class BaseDBError extends QtianException {
  constructor(msg: string) {
    super(msg, 'BASE_001');
  }
}

