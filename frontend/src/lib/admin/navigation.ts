export function resolveAdminNextPath(next: string | null | undefined) {
  return next === '/admin' || next?.startsWith('/admin/') ? next : '/admin';
}
