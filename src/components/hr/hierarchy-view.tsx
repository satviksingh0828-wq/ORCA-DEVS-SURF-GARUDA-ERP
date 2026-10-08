import { Building2, UserRound } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useDepartments, useEmployees, usePositions } from "@/lib/hooks";
import { fullName } from "@/lib/types";

export function HierarchyView() {
  const { data: departments = [], isLoading: departmentsLoading } = useDepartments();
  const { data: positions = [], isLoading: positionsLoading } = usePositions();
  const { data: employees = [], isLoading: employeesLoading } = useEmployees();

  if (departmentsLoading || positionsLoading || employeesLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  const roots = departments.filter((department) => !department.reports_to_department_id);
  const renderDepartment = (departmentId: string, depth = 0): React.ReactNode => {
    const department = departments.find((item) => item.id === departmentId);
    if (!department) return null;
    const departmentPositions = positions.filter(
      (position) => position.department_id === department.id,
    );
    const departmentEmployees = employees.filter(
      (employee) => employee.department_id === department.id && employee.status === "active",
    );
    const children = departments.filter((item) => item.reports_to_department_id === department.id);

    return (
      <li key={department.id} className={depth ? "ml-5 border-l border-border pl-4" : ""}>
        <section className="mb-3 rounded-xl border border-border bg-card p-4">
          <h2 className="flex items-center gap-2 font-semibold">
            <Building2 className="size-4 text-primary" />
            {department.name}
          </h2>
          <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {departmentEmployees.map((employee) => {
              const position = departmentPositions.find((item) => item.id === employee.position_id);
              return (
                <div
                  key={employee.id}
                  className="flex items-center gap-2 rounded-lg bg-muted/50 px-3 py-2 text-sm"
                >
                  <UserRound className="size-4 text-muted-foreground" />
                  <span>
                    <span className="block font-medium">{fullName(employee)}</span>
                    <span className="text-xs text-muted-foreground">
                      {position?.name ?? "No position assigned"}
                    </span>
                  </span>
                </div>
              );
            })}
            {!departmentEmployees.length && (
              <p className="text-sm text-muted-foreground">No active employees.</p>
            )}
          </div>
        </section>
        {children.length > 0 && (
          <ul>{children.map((child) => renderDepartment(child.id, depth + 1))}</ul>
        )}
      </li>
    );
  };

  return (
    <div className="space-y-5">
      {roots.length ? (
        <ul>{roots.map((department) => renderDepartment(department.id))}</ul>
      ) : (
        <div className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">
          No departments configured.
        </div>
      )}
    </div>
  );
}
