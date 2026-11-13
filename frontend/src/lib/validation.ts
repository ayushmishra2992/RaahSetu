/** Same rule as the backend password schema (zPassword): 8–128 characters with a letter and a digit. */
export function passwordProblem(p: string): string | null {
  if (p.length < 8) return "Use at least 8 characters.";
  if (p.length > 128) return "Use at most 128 characters.";
  if (!/[A-Za-z]/.test(p) || !/\d/.test(p)) return "Include at least one letter and one number.";
  return null;
}
