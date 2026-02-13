export function isFabEmail(email: string) {
  const e = email.trim().toLowerCase();
  return e.endsWith("@fab.mil.br");
}
