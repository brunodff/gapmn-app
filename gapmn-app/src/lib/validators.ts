// src/lib/validators.ts
export function isFabEmail(email: string) {
  return email.trim().toLowerCase().endsWith("@fab.mil.br");
}
