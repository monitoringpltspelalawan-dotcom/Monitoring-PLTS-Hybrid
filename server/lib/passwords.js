import crypto from 'node:crypto';

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

export function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(String(password), salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return { salt, hash: hash.toString('hex') };
}

export function verifyPassword(password, salt, expectedHash) {
  try {
    const { hash } = hashPassword(password, salt);
    const a = Buffer.from(hash, 'hex');
    const b = Buffer.from(String(expectedHash), 'hex');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export function passwordIssues(password) {
  const issues = [];
  if (!password || password.length < 10) issues.push('Minimum 10 characters');
  if (!/[A-Z]/.test(password || '')) issues.push('At least one uppercase letter');
  if (!/[a-z]/.test(password || '')) issues.push('At least one lowercase letter');
  if (!/[0-9]/.test(password || '')) issues.push('At least one number');
  if (!/[^A-Za-z0-9]/.test(password || '')) issues.push('At least one symbol');
  return issues;
}
