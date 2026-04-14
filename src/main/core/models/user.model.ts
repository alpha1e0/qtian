/**
 * User model
 * (Not currently used but kept for future extensibility)
 */
export interface User {
  id: number;
  username: string;
  email?: string;
  create_time: string;
  last_login?: string;
}

/**
 * User creation data
 */
export interface UserCreate {
  username: string;
  email?: string;
}

/**
 * User update data
 */
export interface UserUpdate {
  username?: string;
  email?: string;
}
