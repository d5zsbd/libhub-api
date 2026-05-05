import validator from 'validator';
import type { User } from '../user/service.js';

type SignupError = keyof Pick<User, 'username' | 'account' | 'password'>;

type LoginError = keyof Pick<User, 'account' | 'password'>;

export function login(user: Partial<User>): LoginError[] | null {
  const errors: LoginError[] = [];

  if (!user.account || !validator.isEmail(user.account)) {
    errors.push('account');
  }

  if (!user.password || !validator.isStrongPassword(user.password, { minLength: 6 })) {
    errors.push('password');
  }

  if (errors.length) {
    return errors;
  } else {
    return null;
  }
}

export function signup(user: Partial<User>): SignupError[] | null {
  const errors: SignupError[] = [];

  if (!user.account || !validator.isEmail(user.account)) {
    errors.push('account');
  }

  if (!user.username || !validator.isLength(user.username, { min: 1, max: 12 })) {
    errors.push('username');
  }

  if (!user.password || !validator.isStrongPassword(user.password, { minLength: 6 })) {
    errors.push('password');
  }

  if (errors.length) {
    return errors;
  } else {
    return null;
  }
}

export default {
  signup,
  login
};