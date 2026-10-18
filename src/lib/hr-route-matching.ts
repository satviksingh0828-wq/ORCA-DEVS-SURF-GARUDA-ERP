export function isHrNavLinkActive(pathname: string, to: string) {
  if (pathname === to || pathname === `${to}/`) return true;
  if (to === "/employees") {
    return (
      pathname.startsWith("/employees/") &&
      !pathname.startsWith("/employees/new") &&
      !pathname.startsWith("/employees/departments")
    );
  }
  if (to === "/employees/departments") {
    return (
      pathname.startsWith("/employees/departments/") &&
      !pathname.startsWith("/employees/departments/new")
    );
  }
  return pathname.startsWith(`${to}/`);
}
