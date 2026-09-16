import { ulid } from 'ulid';

export const newId = (): string => ulid();
export const nowIso = (): string => new Date().toISOString();

export function slugify(input: string, max = 40): string {
  const s = input
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max)
    .replace(/-+$/g, '');
  return s || 'task';
}
