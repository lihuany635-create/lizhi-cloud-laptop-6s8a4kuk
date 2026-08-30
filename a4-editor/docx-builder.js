(function (root) {
  "use strict";
  const DEFAULT_PAGE = { width: 794, height: 1123 };
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
  function base64Bytes(value) {
    if (typeof atob === "function") { const binary = atob(value), bytes = new Uint8Array(binary.length); for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i); return bytes; }
    if (typeof Buffer !== "undefined") return new Uint8Array(Buffer.from(value, "base64"));
    throw new Error("Base64 decoder unavailable");
  }
  function imageAsset(src) {
    const match = String(src || "").match(/^data:(image\/(?:png|jpeg|jpg));base64,(.+)$/i); if (!match) return null;
    const mime = match[1].toLowerCase() === "image/jpg" ? "image/jpeg" : match[1].toLowerCase(), extension = mime === "image/png" ? "png" : "jpg";
    return { mime, extension, bytes: base64Bytes(match[2]) };
  }
  function runProperties(block) {
    const size = Math.max(12, Math.round((block.fontSize || 14) * 1.5));
    return `<w:rPr><w:rFonts w:ascii="${xml(block.fontFamily)}" w:hAnsi="${xml(block.fontFamily)}" w:eastAsia="${xml(block.fontFamily || "Microsoft JhengHei")}"/>${block.bold ? "<w:b/>" : ""}${block.italic ? "<w:i/>" : ""}${block.underline ? '<w:u w:val="single"/>' : ""}${block.strike ? "<w:strike/>" : ""}<w:color w:val="${hex(block.color)}"/><w:sz w:val="${size}"/><w:szCs w:val="${size}"/>${block.highlight ? `<w:shd w:val="clear" w:color="auto" w:fill="${hex(block.highlight)}"/>` : ""}</w:rPr>`;
  }
  function textParagraphs(block, text = block.text) {
    const align = block.align === "justify" ? "both" : block.align || "left", fontPt = (block.fontSize || 14) * 0.75, line = Math.round(fontPt * (block.lineHeight || 1.5) * 20), indent = Math.round((block.indent || 0) * 15);
    return String(text ?? "").split("\n").map(lineText => `<w:p><w:pPr><w:jc w:val="${align}"/><w:spacing w:before="0" w:after="0" w:line="${line}" w:lineRule="exact"/>${indent ? `<w:ind w:left="${indent}"/>` : ""}</w:pPr><w:r>${runProperties(block)}<w:t xml:space="preserve">${xml(lineText || " ")}</w:t></w:r></w:p>`).join("");
  }
  function pageMetrics(page = DEFAULT_PAGE) {
    const landscape = page.width > page.height;
    return { width: page.width || DEFAULT_PAGE.width, height: page.height || DEFAULT_PAGE.height, ptW: landscape ? 841.89 : 595.28, ptH: landscape ? 595.28 : 841.89, twipsW: landscape ? 16838 : 11906, twipsH: landscape ? 11906 : 16838 };
  }
  function weightValues(values, count) {
    const safe = Array.isArray(values) ? values.slice(0, count).map(value => Math.max(0.05, Number(value) || 1)) : [];
    const average = safe.length ? safe.reduce((sum, value) => sum + value, 0) / safe.length : 1;
    while (safe.length < count) safe.push(average);
    return safe;
  }
  function weightedSizes(values, count, total, minimum) {
    const weights = weightValues(values, count), sum = weights.reduce((amount, value) => amount + value, 0) || 1, floor = Math.min(minimum, Math.floor(total / count * 0.7)), available = Math.max(0, total - floor * count);
    const sizes = weights.map(value => Math.round(floor + available * value / sum));
    sizes[sizes.length - 1] += total - sizes.reduce((amount, value) => amount + value, 0);
    return sizes;
  }
  function tableXml(block, widthPt, heightPt) {
    const rows = Math.max(1, Number(block.rows) || 1), cols = Math.max(1, Number(block.cols) || 1), cells = Array.isArray(block.cells) ? block.cells : [], tableWidth = Math.max(120 * cols, Math.round(widthPt * 20)), tableHeight = Math.max(120 * rows, Math.floor(heightPt * 20 - 60)), columnWidths = weightedSizes(block.colWidths, cols, tableWidth, 120), rowHeights = weightedSizes(block.rowHeights, rows, tableHeight, 120);
    const border = '<w:top w:val="single" w:sz="6" w:space="0" w:color="7F9095"/><w:left w:val="single" w:sz="6" w:space="0" w:color="7F9095"/><w:bottom w:val="single" w:sz="6" w:space="0" w:color="7F9095"/><w:right w:val="single" w:sz="6" w:space="0" w:color="7F9095"/><w:insideH w:val="single" w:sz="6" w:space="0" w:color="7F9095"/><w:insideV w:val="single" w:sz="6" w:space="0" w:color="7F9095"/>';
    const grid = columnWidths.map(cellW => `<w:gridCol w:w="${cellW}"/>`).join("");
    const merges = (Array.isArray(block.merges) ? block.merges : []).filter(m => m && m.rowSpan > 0 && m.colSpan > 0);
    const mergeAt = (row, col) => merges.find(m => row >= m.row && row < m.row + m.rowSpan && col >= m.col && col < m.col + m.colSpan);
    const cellXml = (row, col, region, continuation = false) => {
      const colSpan = Math.max(1, region?.colSpan || 1), rowSpan = Math.max(1, region?.rowSpan || 1), cellW = columnWidths.slice(col, col + colSpan).reduce((sum, value) => sum + value, 0), index = (region?.row ?? row) * cols + (region?.col ?? col), cellText = continuation ? "" : cells[index] || "", image = continuation ? null : block.cellImages?.[index], rid = continuation ? "" : block._cellImageRids?.[index], mergedHeight = continuation ? rowHeights[row] : rowHeights.slice(row, row + rowSpan).reduce((sum, value) => sum + value, 0), maxW = Math.max(18, cellW / 20 - 10), textReserve = String(cellText).trim() ? 26 : 0, maxH = Math.max(18, mergedHeight / 20 - 12 - textReserve), ratio = Number(image?.ratio) || 1, imageW = Math.min(maxW, maxH * ratio), imageH = imageW / ratio, picture = rid ? `<w:p><w:pPr><w:jc w:val="center"/><w:spacing w:before="0" w:after="0"/></w:pPr><w:r><w:pict><v:shape type="#_x0000_t75" style="width:${pt(imageW)}pt;height:${pt(imageH)}pt" stroked="f"><v:imagedata r:id="${rid}" o:title="${xml(image?.name || "儲存格圖片")}"/></v:shape></w:pict></w:r></w:p>` : "", mergeProps = `${colSpan > 1 ? `<w:gridSpan w:val="${colSpan}"/>` : ""}${rowSpan > 1 ? continuation ? "<w:vMerge/>" : '<w:vMerge w:val="restart"/>' : ""}`;
      return `<w:tc><w:tcPr><w:tcW w:w="${cellW}" w:type="dxa"/>${mergeProps}<w:vAlign w:val="center"/><w:tcMar><w:top w:w="50" w:type="dxa"/><w:left w:w="70" w:type="dxa"/><w:bottom w:w="50" w:type="dxa"/><w:right w:w="70" w:type="dxa"/></w:tcMar></w:tcPr>${picture}${textParagraphs(block, cellText)}</w:tc>`;
    };
    const body = Array.from({ length: rows }, (_, row) => { let rowCells = ""; for (let col = 0; col < cols;) { const merge = mergeAt(row, col); if (merge) { if (col !== merge.col) { col += 1; continue; } const continuation = row > merge.row; rowCells += cellXml(row, col, merge, continuation); col += merge.colSpan; } else { rowCells += cellXml(row, col, { row, col, rowSpan: 1, colSpan: 1 }); col += 1; } } return `<w:tr><w:trPr><w:trHeight w:val="${rowHeights[row]}" w:hRule="exact"/></w:trPr>${rowCells}</w:tr>`; }).join("");
    return `<w:tbl><w:tblPr><w:tblW w:w="${tableWidth}" w:type="dxa"/><w:tblLayout w:type="fixed"/><w:tblBorders>${border}</w:tblBorders><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="0" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="0" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>${grid}</w:tblGrid>${body}</w:tbl>`;
  }
  function cropAttributes(block, width, height) {
    if (block.fit !== "cover") return "";
    const imageRatio = Math.max(0.01, Number(block.ratio) || 1), boxRatio = Math.max(0.01, width / height), x = Math.max(0, Math.min(1, Number(block.positionX ?? 50) / 100)), y = Math.max(0, Math.min(1, Number(block.positionY ?? 50) / 100)); let left = 0, right = 0, top = 0, bottom = 0;
    if (imageRatio > boxRatio) { const crop = 1 - boxRatio / imageRatio; left = crop * x; right = crop * (1 - x); } else { const crop = 1 - imageRatio / boxRatio; top = crop * y; bottom = crop * (1 - y); }
    const value = amount => `${Math.round(amount * 65536)}f`;
    return ` cropleft="${value(left)}" cropright="${value(right)}" croptop="${value(top)}" cropbottom="${value(bottom)}"`;
  }
  function shapeXml(block, index, page) {
    const metrics = pageMetrics(page), left = block.x / metrics.width * metrics.ptW, top = block.y / metrics.height * metrics.ptH, width = block.w / metrics.width * metrics.ptW, height = block.h / metrics.height * metrics.ptH, zIndex = block.type === "image" && block.wrap === "behind" ? -251654144 + index : 251659264 + index, position = `position:absolute;margin-left:${pt(left)}pt;margin-top:${pt(top)}pt;width:${pt(width)}pt;height:${pt(height)}pt;z-index:${zIndex};mso-position-horizontal-relative:page;mso-position-vertical-relative:page`;
    if (block.type === "image") return `<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="1" w:lineRule="exact"/></w:pPr><w:r><w:pict><v:shape id="PaperGridImage${index + 1}" type="#_x0000_t75" style="${position}" o:allowincell="f" filled="f" stroked="f"><v:wrap type="none"/><v:imagedata r:id="${block._imageRid}" o:title="${xml(block.name || "圖片")}"${cropAttributes(block, width, height)}/></v:shape></w:pict></w:r></w:p>`;
    const shapeHeight = block.type === "table" ? height + 3 : height, border = !!block.border || block.type === "table", content = block.type === "table" ? tableXml(block, width, height) : textParagraphs(block), inset = block.type === "table" ? "0pt,0pt,0pt,0pt" : "6pt,6pt,6pt,6pt";
    return `<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="1" w:lineRule="exact"/></w:pPr><w:r><w:pict><v:shape id="PaperGridBox${index + 1}" type="#_x0000_t202" style="position:absolute;margin-left:${pt(left)}pt;margin-top:${pt(top)}pt;width:${pt(width)}pt;height:${pt(shapeHeight)}pt;z-index:${251659264 + index};mso-position-horizontal-relative:page;mso-position-vertical-relative:page" o:allowincell="f" filled="f" stroked="${border ? "t" : "f"}"${border ? ' strokecolor="#9AA8AB" strokeweight="0.75pt"' : ""}><v:wrap type="none"/><v:textbox inset="${inset}" style="mso-fit-shape-to-text:f"><w:txbxContent>${content}</w:txbxContent></v:textbox></v:shape></w:pict></w:r></w:p>`;
  }
  function headerXml(text) { return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:pPr><w:jc w:val="left"/><w:pBdr><w:bottom w:val="single" w:sz="4" w:color="DBE2E3"/></w:pBdr></w:pPr><w:r><w:rPr><w:color w:val="6F7D83"/><w:sz w:val="16"/></w:rPr><w:t xml:space="preserve">${xml(text)}</w:t></w:r></w:p></w:hdr>`; }
  function footerXml(text, showPageNumber, align) { const number = showPageNumber ? `<w:p><w:pPr><w:jc w:val="${align || "right"}"/></w:pPr><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>` : ""; return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:pPr><w:jc w:val="left"/><w:pBdr><w:top w:val="single" w:sz="4" w:color="DBE2E3"/></w:pBdr></w:pPr><w:r><w:rPr><w:color w:val="6F7D83"/><w:sz w:val="16"/></w:rPr><w:t xml:space="preserve">${xml(text || " ")}</w:t></w:r></w:p>${number}</w:ftr>`; }
  function documentXml(blocks, page) {
    const metrics = pageMetrics(page), pageCount = Math.max(1, Number(page.pageCount) || 1), pages = Array.from({ length: pageCount }, (_, pageIndex) => { const shapes = blocks.filter(block => (block.page || 0) === pageIndex).map((block, index) => shapeXml(block, pageIndex * 1000 + index, page)).join(""); return `${pageIndex ? '<w:p><w:r><w:br w:type="page"/></w:r></w:p>' : ""}${shapes || "<w:p/>"}`; }).join(""), headerRef = page.headerText ? '<w:headerReference w:type="default" r:id="rIdHeader"/>' : "", footerRef = page.footerText || page.showPageNumber ? '<w:footerReference w:type="default" r:id="rIdFooter"/>' : "";
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office"><w:body><w:p><w:r><w:pict><v:shapetype id="_x0000_t75" coordsize="21600,21600" o:spt="75" o:preferrelative="t" path="m@4@5l@4@11@9@11@9@5xe" filled="f" stroked="f"><v:stroke joinstyle="miter"/><v:formulas><v:f eqn="if lineDrawn pixelLineWidth 0"/><v:f eqn="sum @0 1 0"/><v:f eqn="sum 0 0 @1"/><v:f eqn="prod @2 1 2"/><v:f eqn="prod @3 21600 pixelWidth"/><v:f eqn="prod @3 21600 pixelHeight"/><v:f eqn="sum @0 0 1"/><v:f eqn="prod @6 1 2"/><v:f eqn="prod @7 21600 pixelWidth"/><v:f eqn="sum @8 21600 0"/><v:f eqn="prod @7 21600 pixelHeight"/><v:f eqn="sum @10 21600 0"/></v:formulas><v:path o:extrusionok="f" gradientshapeok="t" o:connecttype="rect"/><o:lock v:ext="edit" aspectratio="t"/></v:shapetype><v:shapetype id="_x0000_t202" coordsize="21600,21600" o:spt="202" path="m,l,21600r21600,l21600,xe"><v:stroke joinstyle="miter"/><v:path gradientshapeok="t" o:connecttype="rect"/></v:shapetype></w:pict></w:r></w:p>${pages}<w:sectPr>${headerRef}${footerRef}<w:pgSz w:w="${metrics.twipsW}" w:h="${metrics.twipsH}"${metrics.width > metrics.height ? ' w:orient="landscape"' : ""}/><w:pgMar w:top="720" w:right="0" w:bottom="720" w:left="0" w:header="340" w:footer="340" w:gutter="0"/><w:cols w:space="0"/><w:docGrid w:linePitch="360"/></w:sectPr></w:body></w:document>`;
  }
  function prepareImages(blocks) {
    const files = {}, relationships = []; let imageIndex = 0;
    const add = source => { const asset = imageAsset(source); if (!asset) return ""; imageIndex += 1; const rid = `rIdImage${imageIndex}`, name = `image${imageIndex}.${asset.extension}`; files[`word/media/${name}`] = asset.bytes; relationships.push(`<Relationship Id="${rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${name}"/>`); return rid; };
    const prepared = blocks.map(block => { const copy = { ...block }; if (block.type === "image") copy._imageRid = add(block.src); if (block.type === "table" && Array.isArray(block.cellImages)) copy._cellImageRids = block.cellImages.map(image => image ? add(image.src) : ""); return copy; });
    return { blocks: prepared, files, relationships };
  }
  function buildDocx(blocks, title, page = DEFAULT_PAGE) {
    const now = new Date().toISOString();
    const prepared = prepareImages(blocks);
    const hasHeader = !!page.headerText, hasFooter = !!page.footerText || !!page.showPageNumber, headerType = hasHeader ? '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>' : "", footerType = hasFooter ? '<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>' : "", headerRel = hasHeader ? '<Relationship Id="rIdHeader" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/>' : "", footerRel = hasFooter ? '<Relationship Id="rIdFooter" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>' : "";
    const files = {
      "[Content_Types].xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Default Extension="jpg" ContentType="image/jpeg"/><Default Extension="jpeg" ContentType="image/jpeg"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>${headerType}${footerType}<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`,
      "_rels/.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`,
      "word/document.xml": documentXml(prepared.blocks, page),
      "word/_rels/document.xml.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${prepared.relationships.join("")}${headerRel}${footerRel}</Relationships>`,
      "word/styles.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:eastAsia="Microsoft JhengHei"/><w:sz w:val="21"/><w:szCs w:val="21"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:before="0" w:after="0"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style></w:styles>`,
      "word/settings.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:displayBackgroundShape/><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>`,
      "docProps/core.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xml(title)}</dc:title><dc:creator>紙上格局</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`,
      "docProps/app.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>紙上格局</Application><Pages>${Math.max(1,Number(page.pageCount)||1)}</Pages><Words>0</Words><Characters>0</Characters></Properties>`
    };
    if (hasHeader) files["word/header1.xml"] = headerXml(page.headerText);
    if (hasFooter) files["word/footer1.xml"] = footerXml(page.footerText, page.showPageNumber, page.pageNumberAlign);
    return zipStore({ ...files, ...prepared.files });
  }
  root.PaperGridDocx = { buildDocx };
})(typeof window !== "undefined" ? window : (typeof global !== "undefined" ? global : this));
