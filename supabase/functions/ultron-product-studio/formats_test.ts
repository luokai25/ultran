import { strFromU8, unzipSync } from "npm:fflate@0.8.2";
import { makeDocx, makePptx, makeXlsx } from "./formats.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("DOCX export is a valid editable Open XML package and preserves RTL text", () => {
  const files = unzipSync(makeDocx("ULTRON guide", "# Getting started\nA practical guide.\nمرحبا بالعالم"));
  assert(files["[Content_Types].xml"], "DOCX content types are missing");
  assert(files["_rels/.rels"], "DOCX package relationships are missing");
  assert(files["word/document.xml"], "DOCX document body is missing");
  assert(files["word/styles.xml"], "DOCX styles are missing");
  const document = strFromU8(files["word/document.xml"]);
  assert(document.includes("w:bidi"), "RTL paragraph direction was not applied");
  assert(document.includes("مرحبا بالعالم"), "Unicode Arabic text was not preserved");
  assert(document.includes("Heading1"), "Heading style was not applied");
});

Deno.test("XLSX export contains a formatted worksheet and stores formula-like text safely", () => {
  const files = unzipSync(makeXlsx('Name,Amount\n"=HYPERLINK(\"https://example.com\")",12\nWidget,4.5'));
  assert(files["xl/workbook.xml"], "XLSX workbook is missing");
  assert(files["xl/worksheets/sheet1.xml"], "XLSX worksheet is missing");
  assert(files["xl/styles.xml"], "XLSX styles are missing");
  const sheet = strFromU8(files["xl/worksheets/sheet1.xml"]);
  assert(sheet.includes('t="inlineStr"'), "Text cells must use inline strings");
  assert(sheet.includes("<v>12</v>"), "Numeric values must remain numeric");
  assert(!sheet.includes("<f>"), "Untrusted CSV text must never become a spreadsheet formula");
  assert(sheet.includes("autoFilter"), "Spreadsheet filter is missing");
});

Deno.test("PPTX export contains editable slides and slide relationships", () => {
  const files = unzipSync(makePptx("ULTRON deck", "# Market\nEvidence\n# Solution\nWorkflow"));
  assert(files["ppt/presentation.xml"], "PPTX presentation manifest is missing");
  assert(files["ppt/slides/slide1.xml"], "First slide is missing");
  assert(files["ppt/slides/slide2.xml"], "Second slide is missing");
  assert(files["ppt/slides/_rels/slide1.xml.rels"], "Slide relationships are missing");
  const first = strFromU8(files["ppt/slides/slide1.xml"]);
  const second = strFromU8(files["ppt/slides/slide2.xml"]);
  assert(first.includes("Market") && first.includes("Evidence"), "First slide content is missing");
  assert(second.includes("Solution") && second.includes("Workflow"), "Second slide content is missing");
});
