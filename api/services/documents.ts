import PDFDocument from "pdfkit";
import {
  AlignmentType,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  TextRun,
} from "docx";
import ExcelJS from "exceljs";
import PptxGenJS from "pptxgenjs";

/**
 * Document renderers — structured content in, real Office/PDF bytes out.
 * Pure-JS libraries only (no headless browser / LibreOffice), so this runs
 * unchanged inside the Cloud Run container.
 */

export type DocFormat = "pdf" | "docx" | "xlsx" | "pptx";

/** Narrative formats (PDF / Word) share one shape. */
export interface DocNarrative {
  title: string;
  subtitle?: string;
  sections: {
    heading?: string;
    paragraphs?: string[];
    bullets?: string[];
  }[];
}

/** Excel workbook. */
export interface WorkbookSpec {
  title: string;
  sheets: {
    name: string;
    columns: string[];
    rows: (string | number)[][];
  }[];
}

/** Slide deck. */
export interface DeckSpec {
  title: string;
  subtitle?: string;
  slides: { title: string; bullets?: string[]; notes?: string }[];
}

export const FORMAT_META: Record<
  DocFormat,
  { ext: string; mime: string; label: string }
> = {
  pdf: { ext: "pdf", mime: "application/pdf", label: "PDF" },
  docx: {
    ext: "docx",
    mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    label: "Word",
  },
  xlsx: {
    ext: "xlsx",
    mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    label: "Excel",
  },
  pptx: {
    ext: "pptx",
    mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    label: "Slides",
  },
};

/** pdfkit's built-in Helvetica covers Latin-1 only — soften anything wider. */
function latin1(s: string): string {
  return s.replace(/[^\x00-\xFF]/g, (ch) => {
    const map: Record<string, string> = {
      "—": "-", "–": "-", "‘": "'", "’": "'", "“": '"', "”": '"',
      "…": "...", "•": "*", "→": "->", "✓": "v",
    };
    return map[ch] ?? "?";
  });
}

export async function renderPdf(spec: DocNarrative): Promise<Buffer> {
  const doc = new PDFDocument({
    size: "A4",
    margins: { top: 64, bottom: 64, left: 64, right: 64 },
    info: { Title: latin1(spec.title), Creator: "SanjeevAI" },
  });
  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  doc.font("Helvetica-Bold").fontSize(24).fillColor("#111111").text(latin1(spec.title));
  if (spec.subtitle) {
    doc.moveDown(0.3).font("Helvetica").fontSize(12).fillColor("#666666").text(latin1(spec.subtitle));
  }
  doc.moveDown(1.2);

  for (const section of spec.sections) {
    if (section.heading) {
      doc.font("Helvetica-Bold").fontSize(14).fillColor("#111111").text(latin1(section.heading));
      doc.moveDown(0.35);
    }
    for (const p of section.paragraphs ?? []) {
      doc
        .font("Helvetica")
        .fontSize(11)
        .fillColor("#222222")
        .text(latin1(p), { lineGap: 3, align: "left" });
      doc.moveDown(0.5);
    }
    for (const b of section.bullets ?? []) {
      doc
        .font("Helvetica")
        .fontSize(11)
        .fillColor("#222222")
        .text(`•  ${latin1(b)}`, { indent: 14, lineGap: 3 });
    }
    if ((section.bullets ?? []).length) doc.moveDown(0.4);
    doc.moveDown(0.6);
  }
  doc.end();
  return done;
}

export async function renderDocx(spec: DocNarrative): Promise<Buffer> {
  const children: Paragraph[] = [
    new Paragraph({
      text: spec.title,
      heading: HeadingLevel.TITLE,
      spacing: { after: 160 },
    }),
  ];
  if (spec.subtitle) {
    children.push(
      new Paragraph({
        children: [new TextRun({ text: spec.subtitle, color: "666666", size: 24 })],
        spacing: { after: 360 },
      }),
    );
  }
  for (const section of spec.sections) {
    if (section.heading) {
      children.push(
        new Paragraph({
          text: section.heading,
          heading: HeadingLevel.HEADING_2,
          spacing: { before: 240, after: 120 },
        }),
      );
    }
    for (const p of section.paragraphs ?? []) {
      children.push(
        new Paragraph({
          text: p,
          spacing: { after: 160, line: 300 },
          alignment: AlignmentType.LEFT,
        }),
      );
    }
    for (const b of section.bullets ?? []) {
      children.push(new Paragraph({ text: b, bullet: { level: 0 }, spacing: { after: 80 } }));
    }
  }
  const doc = new Document({
    creator: "SanjeevAI",
    title: spec.title,
    sections: [{ children }],
  });
  return Packer.toBuffer(doc);
}

export async function renderXlsx(spec: WorkbookSpec): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "SanjeevAI";
  wb.title = spec.title;
  for (const sheet of spec.sheets) {
    const ws = wb.addWorksheet(sheet.name.slice(0, 31) || "Sheet");
    ws.columns = sheet.columns.map((c) => ({
      header: c,
      key: c,
      width: Math.min(42, Math.max(12, c.length + 6)),
    }));
    ws.getRow(1).font = { bold: true };
    ws.getRow(1).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFF1F3F5" },
    };
    for (const row of sheet.rows) {
      // Numbers arrive as strings from the LLM half the time — retype them.
      ws.addRow(
        row.map((v) => {
          if (typeof v === "number") return v;
          const n = Number(String(v).replace(/[$,%\s,]/g, ""));
          return v !== "" && !Number.isNaN(n) && /^[\d$%,.\s-]+$/.test(String(v)) ? n : v;
        }),
      );
    }
  }
  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out as ArrayBuffer);
}

export async function renderPptx(spec: DeckSpec): Promise<Buffer> {
  const pptx = new PptxGenJS();
  pptx.author = "SanjeevAI";
  pptx.title = spec.title;

  // Title slide
  const cover = pptx.addSlide();
  cover.addText(spec.title, {
    x: 0.6, y: 2.1, w: 8.7, h: 1.4,
    fontSize: 34, bold: true, color: "111111", align: "center",
  });
  if (spec.subtitle) {
    cover.addText(spec.subtitle, {
      x: 0.6, y: 3.5, w: 8.7, h: 0.8,
      fontSize: 16, color: "666666", align: "center",
    });
  }

  for (const s of spec.slides) {
    const slide = pptx.addSlide();
    slide.addText(s.title, {
      x: 0.5, y: 0.35, w: 9.0, h: 0.8,
      fontSize: 24, bold: true, color: "111111",
    });
    const bullets = (s.bullets ?? []).map((b) => ({
      text: b,
      options: { bullet: { code: "2022" } as never, fontSize: 15, color: "333333", paraSpaceAfter: 8 },
    }));
    if (bullets.length) {
      slide.addText(bullets, { x: 0.7, y: 1.35, w: 8.6, h: 4.6, valign: "top" });
    }
    if (s.notes) slide.addNotes(s.notes);
  }
  const out = await pptx.write({ outputType: "nodebuffer" });
  return out as Buffer;
}
