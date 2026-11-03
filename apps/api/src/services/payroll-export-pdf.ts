import PDFDocument from "pdfkit";
import {
  payrollPayslipLines,
  type PayrollExportModel,
  type PayrollExportStaff,
} from "./payroll-export-data.js";

const MARGIN = 48;
/** A4 width minus margins; PDFKit's default page size is A4. */
const WIDTH = 595.28 - MARGIN * 2;

function amountRow(
  doc: PDFKit.PDFDocument,
  model: PayrollExportModel,
  label: string,
  amount: string,
  bold = false,
) {
  const y = doc.y;
  doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(10);
  doc.text(label, MARGIN, y, { width: WIDTH - 110 });
  doc.text(`${model.currency} ${amount}`, MARGIN + WIDTH - 110, y, { width: 110, align: "right" });
  doc
    .moveTo(MARGIN, y + 14)
    .lineTo(MARGIN + WIDTH, y + 14)
    .strokeColor("#e2e2e2")
    .stroke();
  doc.x = MARGIN;
  doc.y = y + 20;
}

function sectionTitle(doc: PDFKit.PDFDocument, title: string) {
  doc.moveDown(0.6);
  doc
    .font("Helvetica-Bold")
    .fontSize(11)
    .fillColor("#111111")
    .text(title, MARGIN, doc.y, { width: WIDTH });
  doc.moveDown(0.2);
}

/** One staff payslip per page, reproduced only from the frozen approved statement. */
function drawPayslip(
  doc: PDFKit.PDFDocument,
  model: PayrollExportModel,
  staff: PayrollExportStaff,
) {
  doc.font("Helvetica-Bold").fontSize(18).fillColor("#111111");
  doc.text(`Payslip ${model.periodKey}`);
  doc.font("Helvetica").fontSize(9).fillColor("#555555");
  doc.text(`Approved frozen statement - ${model.currency} - ${model.timeZone}`);
  doc.moveDown(0.8);

  doc.fillColor("#111111").fontSize(10);
  doc.text(`Staff: ${staff.staff.name} (${staff.staff.id})`, MARGIN, doc.y, { width: WIDTH });
  doc.text(
    `Plan: ${staff.plan ? `${staff.plan.planId} version ${staff.plan.versionId}` : "No plan assigned"}`,
    MARGIN,
    doc.y,
    { width: WIDTH },
  );
  doc.text(
    `Stage: ${staff.result.stageKey} - tenure month ${staff.result.tenureMonth ?? "not applicable"}`,
    MARGIN,
    doc.y,
    { width: WIDTH },
  );
  doc.text(`Approved at: ${model.approval.at}`, MARGIN, doc.y, { width: WIDTH });
  doc.moveDown(0.8);

  doc.font("Helvetica-Bold").fontSize(11).text("Payroll", MARGIN, doc.y, { width: WIDTH });
  doc.moveDown(0.2);
  for (const line of payrollPayslipLines(staff))
    amountRow(doc, model, line.label, line.amount, line.label === "Take home");
  amountRow(doc, model, "Employer levy (not paid out)", staff.payroll.levy);
  amountRow(doc, model, "Collection", staff.payroll.collection);
  doc.font("Helvetica").fontSize(10);
  doc.text(
    `Payroll / sales: ${staff.payroll.payrollSalesPct === null ? "not applicable" : `${staff.payroll.payrollSalesPct}%`}`,
    MARGIN,
    doc.y,
    { width: WIDTH },
  );
  doc.text(`Sales alert: ${staff.payroll.alert ? "YES" : "NO"}`, MARGIN, doc.y, { width: WIDTH });

  if (staff.result.components.length) {
    sectionTitle(doc, "Commission components");
    for (const component of staff.result.components)
      amountRow(
        doc,
        model,
        `${component.componentName} (${component.componentKey})`,
        component.amount,
      );
  }
  if (staff.result.incentives.length) {
    sectionTitle(doc, "Incentives");
    for (const incentive of staff.result.incentives)
      amountRow(doc, model, `${incentive.ruleKey} (${incentive.scope})`, incentive.amount);
  }
  if (staff.result.carryWriteOffs.length) {
    sectionTitle(doc, "Carry write-offs");
    for (const writeOff of staff.result.carryWriteOffs)
      amountRow(doc, model, `${writeOff.componentKey} - ${writeOff.reason}`, writeOff.base);
  }

  doc.moveDown(1);
  doc.font("Helvetica").fontSize(8).fillColor("#666666");
  doc.text(
    `Calculation ${model.calculation.version} - input hash ${model.calculation.inputHash}`,
    MARGIN,
    doc.y,
    {
      width: WIDTH,
    },
  );
  doc.text(`Approval reason: ${model.approval.reason}`, MARGIN, doc.y, { width: WIDTH });
  doc.text(
    "This payslip reproduces an approved payroll close and is not a payment instruction.",
    MARGIN,
    doc.y,
    { width: WIDTH },
  );
}

/**
 * Uncompressed content streams keep the payslip text extractable for audit and support.
 * Text is never rasterised, so the exported PDF equals the frozen statement line by line.
 */
export async function renderPayrollPayslips(model: PayrollExportModel): Promise<Buffer> {
  const doc = new PDFDocument({
    size: "A4",
    margin: MARGIN,
    compress: false,
    info: {
      Title: `Payslips ${model.periodKey}`,
      Author: "Glampro Suite",
      Subject: "Frozen approved payroll statements",
      CreationDate: new Date(model.approval.at),
    },
  });
  const chunks: Buffer[] = [];
  doc.on("data", (chunk: Buffer) => chunks.push(chunk));
  const ended = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
  if (!model.staff.length)
    doc
      .font("Helvetica")
      .fontSize(12)
      .text("No staff statements were included in this approved payroll close.", MARGIN, doc.y, {
        width: WIDTH,
      });
  model.staff.forEach((staff, index) => {
    if (index) doc.addPage();
    drawPayslip(doc, model, staff);
  });
  doc.end();
  return ended;
}
