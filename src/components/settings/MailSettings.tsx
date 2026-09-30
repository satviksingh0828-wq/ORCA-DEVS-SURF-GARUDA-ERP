import { useEffect, useState } from "react";
import { Mail, Save } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useAppSettings, useUpdateAppSettings } from "@/lib/hooks";

const AUTOMATIONS = [
  [
    "email_auto_send_payroll",
    "Send mail when payroll generated",
    "Email the generated payslip to the employee.",
  ],
  [
    "email_send_admin_notifications",
    "Admin notifications",
    "Send dashboard, compliance, and operational alerts to configured administrators.",
  ],
  [
    "email_send_branch_open_trips",
    "Branch open trip mail notification",
    "Send each branch its daily open-trip summary.",
  ],
  [
    "email_send_expiry_notifications",
    "Vehicle expiry notifications",
    "Send insurance and road-tax expiry alerts.",
  ],
  [
    "email_send_hr_notifications",
    "HR notifications",
    "Allow HR/MIS and HR document notification emails.",
  ],
  [
    "email_send_on_payment",
    "Send on payment",
    "Send an HR document email when a payment action is completed.",
  ],
  [
    "email_send_loan",
    "Loan PDFs",
    "Allow loan statements and payment receipts to be sent by email.",
  ],
  [
    "email_send_advance",
    "Advance PDFs",
    "Allow advance statements and payment receipts to be sent by email.",
  ],
  [
    "email_send_loss_deduction",
    "Loss deduction PDFs",
    "Allow loss deduction statements to be sent by email.",
  ],
  [
    "email_send_attendance_monthly",
    "Attendance PDFs",
    "Allow monthly attendance reports to be sent by email.",
  ],
] as const;

type Key = (typeof AUTOMATIONS)[number][0];
type FormState = Record<Key, boolean>;

const initialState = Object.fromEntries(AUTOMATIONS.map(([key]) => [key, false])) as FormState;

export function MailSettings() {
  const { data: appSettings, isLoading } = useAppSettings();
  const updateSettings = useUpdateAppSettings();
  const [form, setForm] = useState<FormState>(initialState);

  useEffect(() => {
    if (!appSettings) return;
    setForm(
      Object.fromEntries(AUTOMATIONS.map(([key]) => [key, Boolean(appSettings[key])])) as FormState,
    );
  }, [appSettings]);

  function save() {
    if (!appSettings?.id) {
      toast.error("App settings are not available yet.");
      return;
    }
    updateSettings.mutate(
      { id: appSettings.id, values: form as never },
      {
        onSuccess: () => toast.success("Mail settings saved"),
        onError: (error) =>
          toast.error(error instanceof Error ? error.message : "Could not save mail settings"),
      },
    );
  }

  return (
    <div className="animate-fade-up space-y-5">
      <section className="surface-card p-6">
        <div className="flex items-start gap-4">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary">
            <Mail className="size-5" />
          </span>
          <div>
            <h2 className="text-lg font-semibold tracking-tight">Mail notifications</h2>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              Control every automated email independently. All enabled mail uses the same Garuda
              branded format.
            </p>
          </div>
        </div>
        <div className="mt-6 space-y-3">
          {AUTOMATIONS.map(([key, label, description]) => (
            <div
              key={key}
              className="flex items-center justify-between gap-4 rounded-xl border border-border bg-muted/30 p-4"
            >
              <div>
                <p className="text-sm font-medium">{label}</p>
                <p className="mt-1 text-xs text-muted-foreground">{description}</p>
              </div>
              <Switch
                checked={form[key]}
                onCheckedChange={(checked) =>
                  setForm((current) => ({ ...current, [key]: checked }))
                }
              />
            </div>
          ))}
        </div>
        <div className="mt-6 flex justify-end">
          <Button
            type="button"
            onClick={save}
            disabled={isLoading || updateSettings.isPending}
            className="gap-2"
          >
            <Save className="size-4" />
            Save settings
          </Button>
        </div>
      </section>
    </div>
  );
}
