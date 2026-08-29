(function (root) {
  "use strict";
  const PAGE_W = 794, PAGE_H = 1123, A4_W_PT = 595.28, A4_H_PT = 841.89;
  const encoder = new TextEncoder();
  const xml = value => String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
  const hex = value => String(value || "#000000").replace("#", "").toUpperCase();
  const pt = value => Number(value).toFixed(2);
  const crcTable = (() => { const table = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; table[n] = c >>> 0; } return table; })();
  const crc32 = bytes => { let crc = 0xffffffff; for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8); return (crc ^ 0xffffffff) >>> 0; };
  const u16 = value => new Uint8Array([value & 255, (value >>> 8) & 255]);
  const u32 = value => new Uint8Array([value & 255, (value >>> 8) & 255, (value >>> 16) & 255, (value >>> 24) & 255]);
  const join = parts => { const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let offset = 0; parts.forEach(part => { out.set(part, offset); offset += part.length; }); return out; };
  function dosDateTime(date) { return { time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1), date: ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate() }; }
  function zipStore(files) {
    const localParts = [], centralParts = []; let offset = 0; const stamp = dosDateTime(new Date());
    Object.entries(files).forEach(([name, content]) => {
      const nameBytes = encoder.encode(name), data = typeof content === "string" ? encoder.encode(content) : content, crc = crc32(data);
      const local = join([u32(0x04034b50), u16(20), u16(0), u16(0), u16(stamp.time), u16(stamp.date), u32(crc), u32(data.length), u32(data.length), u16(nameBytes.length), u16(0), nameBytes, data]);
      localParts.push(local);
      const central = join([u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(stamp.time), u16(stamp.date), u32(crc), u32(data.length), u32(data.length), u16(nameBytes.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), nameBytes]);
      centralParts.push(central); offset += local.length;
    });
    const locals = join(localParts), central = join(centralParts), end = join([u32(0x06054b50), u16(0), u16(0), u16(centralParts.length), u16(centralParts.length), u32(central.length), u32(locals.length), u16(0)]);
    return join([locals, central, end]);
  }
  function runProperties(block) {
    const size = Math.max(12, Math.round((block.fontSize || 14) * 1.5));
    return `<w:rPr><w:rFonts w:ascii="${xml(block.fontFamily)}" w:hAnsi="${xml(block.fontFamily)}" w:eastAsia="${xml(block.fontFamily || "Microsoft JhengHei")}"/>${block.bold ? "<w:b/>" : ""}${block.italic ? "<w:i/>" : ""}${block.underline ? '<w:u w:val="single"/>' : ""}${block.strike ? "<w:strike/>" : ""}<w:color w:val="${hex(block.color)}"/><w:sz w:val="${size}"/><w:szCs w:val="${size}"/>${block.highlight ? `<w:shd w:val="clear" w:color="auto" w:fill="${hex(block.highlight)}"/>` : ""}</w:rPr>`;
  }
  function textParagraphs(block) {
    const align = block.align === "justify" ? "both" : block.align || "left", fontPt = (block.fontSize || 14) * 0.75, line = Math.round(fontPt * (block.lineHeight || 1.5) * 20), indent = Math.round((block.indent || 0) / PAGE_W * 11906);
    return String(block.text ?? "").split("\n").map(lineText => `<w:p><w:pPr><w:jc w:val="${align}"/><w:spacing w:before="0" w:after="0" w:line="${line}" w:lineRule="exact"/>${indent ? `<w:ind w:left="${indent}"/>` : ""}</w:pPr><w:r>${runProperties(block)}<w:t xml:space="preserve">${xml(lineText || " ")}</w:t></w:r></w:p>`).join("");
  }
  function shapeXml(block, index) {
    const left = block.x / PAGE_W * A4_W_PT, top = block.y / PAGE_H * A4_H_PT, width = block.w / PAGE_W * A4_W_PT, height = block.h / PAGE_H * A4_H_PT, border = !!block.border;
    return `<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="1" w:lineRule="exact"/></w:pPr><w:r><w:pict><v:shape id="PaperGridBox${index + 1}" type="#_x0000_t202" style="position:absolute;margin-left:${pt(left)}pt;margin-top:${pt(top)}pt;width:${pt(width)}pt;height:${pt(height)}pt;z-index:${251659264 + index};mso-position-horizontal-relative:page;mso-position-vertical-relative:page" o:allowincell="f" filled="f" stroked="${border ? "t" : "f"}"${border ? ' strokecolor="#9AA8AB" strokeweight="0.75pt"' : ""}><v:wrap type="none"/><v:textbox inset="6pt,6pt,6pt,6pt" style="mso-fit-shape-to-text:f"><w:txbxContent>${textParagraphs(block)}</w:txbxContent></v:textbox></v:shape></w:pict></w:r></w:p>`;
  }
  function documentXml(blocks) {
    const shapes = blocks.map(shapeXml).join("");
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office"><w:body><w:p><w:r><w:pict><v:shapetype id="_x0000_t202" coordsize="21600,21600" o:spt="202" path="m,l,21600r21600,l21600,xe"><v:stroke joinstyle="miter"/><v:path gradientshapeok="t" o:connecttype="rect"/></v:shapetype></w:pict></w:r></w:p>${shapes}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="0" w:right="0" w:bottom="0" w:left="0" w:header="0" w:footer="0" w:gutter="0"/><w:cols w:space="0"/><w:docGrid w:linePitch="360"/></w:sectPr></w:body></w:document>`;
  }
  function buildDocx(blocks, title) {
    const now = new Date().toISOString();
    const files = {
      "[Content_Types].xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`,
      "_rels/.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`,
      "word/document.xml": documentXml(blocks),
      "word/styles.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:eastAsia="Microsoft JhengHei"/><w:sz w:val="21"/><w:szCs w:val="21"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:before="0" w:after="0"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style></w:styles>`,
      "word/settings.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:displayBackgroundShape/><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>`,
      "docProps/core.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xml(title)}</dc:title><dc:creator>紙上格局</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`,
      "docProps/app.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>紙上格局</Application><Pages>1</Pages><Words>0</Words><Characters>0</Characters></Properties>`
    };
    return zipStore(files);
  }
  root.PaperGridDocx = { buildDocx };
})(typeof window !== "undefined" ? window : (typeof global !== "undefined" ? global : this));
