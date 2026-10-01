import JSZip from "jszip";
import mammoth from "mammoth";
import { createHash, randomUUID } from "node:crypto";
import { assert, AppError } from "./errors";
import { imageText } from "./ai";
import type { MaterialKind, Material, Source } from "./types";
export const MAX_BYTES = 3_500_000;
const decode = (s: string) =>
  s
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
export async function extract(
  buffer: Buffer,
  filename: string,
  mime: string,
  courseId: string,
  kind: MaterialKind,
): Promise<Material> {
  assert(
    buffer.length > 0 && buffer.length <= MAX_BYTES,
    "Each file must be nonempty and under 3.5 MB. Split larger decks first.",
  );
  const ext = filename.split(".").pop()?.toLowerCase();
  const canonicalMime: Record<string, string> = {
    pdf: "application/pdf",
    txt: "text/plain",
    pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  };
  mime = canonicalMime[ext || ""] || mime;
  assert(
    ["pdf", "pptx", "docx", "txt", "png", "jpg", "jpeg", "webp"].includes(
      ext || "",
    ),
    "Use PDF, PPTX, DOCX, TXT, PNG, JPG, or WebP.",
  );
  const id = randomUUID(),
    sources: Source[] = [],
    warnings: string[] = [];
  const add = (text: string, page: number, location: string) => {
    sources.push({
      id: randomUUID(),
      materialId: id,
      filename,
      location,
      page,
      text: text.trim(),
    });
  };
  if (ext === "txt") {
    const text = buffer.toString("utf8");
    assert(!text.includes("\u0000"), "This file is not readable plain text.");
    text
      .split(/\n\s*\n/)
      .filter((x) => x.trim())
      .forEach((text, i) => add(text, i + 1, `Paragraph ${i + 1}`));
  } else if (ext === "pdf") {
    assert(
      buffer.subarray(0, 5).toString() === "%PDF-",
      "The file is not a valid PDF.",
    );
    const pdf = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const task = pdf.getDocument({
      data: new Uint8Array(buffer),
      useSystemFonts: true,
    });
    const document = await task.promise;
    try {
      assert(
        document.numPages <= 80,
        "This PDF exceeds 80 pages. Split it into lecture-sized files.",
      );
      for (let page = 1; page <= document.numPages; page++) {
        const p = await document.getPage(page);
        const content = await p.getTextContent();
        const text = content.items
          .map((item) => ("str" in item ? item.str : ""))
          .join(" ");
        add(text, page, `Page ${page}`);
        if (text.trim().length < 25)
          warnings.push(
            `Page ${page}: little or no readable text. Upload a screenshot for visual interpretation.`,
          );
        const ops = await p.getOperatorList();
        if (
          ops.fnArray.some((n) =>
            [
              pdf.OPS.paintImageXObject,
              pdf.OPS.paintInlineImageXObject,
              pdf.OPS.constructPath,
            ].includes(n),
          )
        )
          warnings.push(
            `Page ${page}: visual content detected; text extraction does not interpret its diagrams. Upload relevant screenshots.`,
          );
      }
    } finally {
      await task.destroy();
    }
  } else if (ext === "pptx" || ext === "docx") {
    assert(
      buffer.subarray(0, 2).toString() === "PK",
      "This file is not a valid Office document.",
    );
    const zip = await JSZip.loadAsync(buffer);
    const entries = Object.values(zip.files).filter((f) => !f.dir);
    assert(
      entries.length <= 2500,
      "Office document contains too many entries.",
    );
    let expanded = 0;
    for (const entry of entries) {
      const size =
        (entry as unknown as { _data?: { uncompressedSize?: number } })._data
          ?.uncompressedSize || 0;
      expanded += size;
      assert(
        size <= 15_000_000 && expanded <= 30_000_000,
        "Expanded document is too large. Split this file.",
      );
    }
    if (ext === "docx") {
      assert(zip.file("word/document.xml"), "This is not a DOCX document.");
      const result = await mammoth.extractRawText({ buffer });
      result.value
        .split(/\n\s*\n/)
        .filter((x) => x.trim())
        .forEach((text, i) => add(text, i + 1, `Paragraph ${i + 1}`));
      if (entries.some((x) => x.name.startsWith("word/media/")))
        warnings.push(
          "Embedded images were not interpreted. Upload diagrams as images.",
        );
      warnings.push(...result.messages.map((m) => m.message));
    } else {
      const slides = entries
        .filter((x) => /^ppt\/slides\/slide\d+\.xml$/.test(x.name))
        .sort(
          (a, b) =>
            Number(a.name.match(/slide(\d+)/)![1]) -
            Number(b.name.match(/slide(\d+)/)![1]),
        );
      assert(
        slides.length > 0 && slides.length <= 80,
        "Use a PPTX with 1–80 slides.",
      );
      for (const slide of slides) {
        const page = Number(slide.name.match(/slide(\d+)/)![1]);
        const xml = await slide.async("string");
        const texts = Array.from(
          xml.matchAll(/<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/g),
          (m) => decode(m[1]),
        );
        add(texts.join("\n"), page, `Slide ${page}`);
        if (/<p:pic|<c:chart|<a:graphicData/.test(xml))
          warnings.push(
            `Slide ${page}: image/chart detected. Upload its screenshot to interpret visual details.`,
          );
        const notes = zip.file(`ppt/notesSlides/notesSlide${page}.xml`);
        if (notes) {
          const n = await notes.async("string");
          const note = Array.from(
            n.matchAll(/<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/g),
            (m) => decode(m[1]),
          ).join(" ");
          if (note)
            sources[sources.length - 1].text += "\nSpeaker notes: " + note;
        }
      }
    }
  } else {
    const detected = buffer
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      ? "image/png"
      : buffer[0] === 255 && buffer[1] === 216
        ? "image/jpeg"
        : buffer.subarray(0, 4).toString() === "RIFF" &&
            buffer.subarray(8, 12).toString() === "WEBP"
          ? "image/webp"
          : null;
    assert(detected, "Image content does not match a supported image format.");
    mime = detected;
    add(await imageText(buffer, mime), 1, "Image");
    warnings.push(
      "Image text and diagrams were interpreted by AI; verify uncertain symbols against the original.",
    );
  }
  assert(
    sources.some((x) => x.text.length > 0),
    "No readable content found. Upload clear screenshots or pasted notes instead.",
  );
  assert(
    sources.reduce((n, s) => n + s.text.length, 0) <= 200_000,
    "Extracted text exceeds 200,000 characters. Split this file.",
  );
  return {
    id,
    courseId,
    filename: filename.slice(0, 180),
    kind,
    hash: createHash("sha256").update(buffer).digest("hex"),
    sources,
    warnings,
    mime,
    createdAt: new Date().toISOString(),
  };
}
