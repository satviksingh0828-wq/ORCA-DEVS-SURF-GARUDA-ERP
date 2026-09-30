import { createFileRoute } from "@tanstack/react-router";
import { emailTemplate, sendResendEmail } from "@/lib/email";
import { getEmailSettings, withPriyanshiCc } from "@/lib/email-settings.server";

function validEmail(value: unknown): value is string {
  return typeof value === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function escapeHtml(value: string) {
  return value.replace(
    /[&<>"']/g,
    (char) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[char] ?? char,
  );
}

export const Route = createFileRoute("/api/hr/payroll-email")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const body = (await request.json()) as {
            to?: unknown;
            employeeName?: unknown;
            periodLabel?: unknown;
            filename?: unknown;
            pdfBase64?: unknown;
          };
          const to = typeof body.to === "string" ? body.to.trim() : "";
          const employeeName =
            typeof body.employeeName === "string" ? body.employeeName.trim() : "Employee";
          const periodLabel =
            typeof body.periodLabel === "string" ? body.periodLabel.trim() : "the selected period";
          const filename =
            typeof body.filename === "string" && body.filename.endsWith(".pdf")
              ? body.filename
              : "payslip.pdf";
          const pdfBase64 =
            typeof body.pdfBase64 === "string" ? body.pdfBase64.replace(/\s/g, "") : "";

          if (!validEmail(to))
            return Response.json({ error: "Employee email is invalid." }, { status: 400 });
          if (!pdfBase64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(pdfBase64)) {
            return Response.json({ error: "Generated PDF data is invalid." }, { status: 400 });
          }
          const settings = await getEmailSettings();
          if (!settings.email_auto_send_payroll) {
            return Response.json({ ok: true, skipped: true });
          }

          await sendResendEmail({
            to: [to],
            cc: withPriyanshiCc(),
            subject: `Payslip generated — ${employeeName} — ${periodLabel}`,
            html: emailTemplate({
              title: "Payslip generated",
              eyebrow: "HR payroll",
              intro: `Hello ${escapeHtml(employeeName)}, your payslip for <strong>${escapeHtml(periodLabel)}</strong> is attached to this email.`,
              content: `<p style="font-size:14px;line-height:1.6;color:#475569">Please keep this payslip for your records. For any questions, contact the HR team.</p>`,
              notice: "This is an automated message from Garuda Logistics Solutions.",
            }),
            attachments: [{ filename, content: pdfBase64 }],
            idempotencyKey: `payroll-payslip-${to}-${filename}`,
          });

          return Response.json({ ok: true });
        } catch (error) {
          console.error("[payroll-email] Failed to send payslip:", error);
          return Response.json(
            { error: error instanceof Error ? error.message : "Could not send payroll email." },
            { status: 500 },
          );
        }
      },
    },
  },
});
