const encoder = new TextEncoder()
const decoder = new TextDecoder()

type ZipEntry = { name: string; bytes: Uint8Array }

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1
  }
  return (crc ^ 0xffffffff) >>> 0
}

export function readStoredZip(bytes: Uint8Array): ZipEntry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const entries: ZipEntry[] = []
  let offset = 0
  while (offset + 30 <= bytes.length && view.getUint32(offset, true) === 0x04034b50) {
    const flags = view.getUint16(offset + 6, true)
    const method = view.getUint16(offset + 8, true)
    const size = view.getUint32(offset + 18, true)
    const nameLength = view.getUint16(offset + 26, true)
    const extraLength = view.getUint16(offset + 28, true)
    if (method !== 0 || flags & 0x08) throw new Error('成本模板压缩方式不受支持')
    const start = offset + 30 + nameLength + extraLength
    const end = start + size
    if (end > bytes.length) throw new Error('成本模板文件不完整')
    entries.push({ name: decoder.decode(bytes.subarray(offset + 30, offset + 30 + nameLength)), bytes: bytes.slice(start, end) })
    offset = end
  }
  if (!entries.length) throw new Error('未读取到成本模板页签')
  return entries
}

export function writeStoredZip(entries: ZipEntry[]) {
  const files = entries.map(entry => ({ ...entry, nameBytes: encoder.encode(entry.name), crc: crc32(entry.bytes) }))
  const localSize = files.reduce((sum, entry) => sum + 30 + entry.nameBytes.length + entry.bytes.length, 0)
  const centralSize = files.reduce((sum, entry) => sum + 46 + entry.nameBytes.length, 0)
  const result = new Uint8Array(localSize + centralSize + 22)
  const view = new DataView(result.buffer)
  let offset = 0
  const locations: number[] = []
  for (const entry of files) {
    locations.push(offset)
    view.setUint32(offset, 0x04034b50, true)
    view.setUint16(offset + 4, 20, true)
    view.setUint16(offset + 8, 0, true)
    view.setUint16(offset + 12, 0x0021, true)
    view.setUint32(offset + 14, entry.crc, true)
    view.setUint32(offset + 18, entry.bytes.length, true)
    view.setUint32(offset + 22, entry.bytes.length, true)
    view.setUint16(offset + 26, entry.nameBytes.length, true)
    result.set(entry.nameBytes, offset + 30)
    result.set(entry.bytes, offset + 30 + entry.nameBytes.length)
    offset += 30 + entry.nameBytes.length + entry.bytes.length
  }
  const centralOffset = offset
  for (const [index, entry] of files.entries()) {
    view.setUint32(offset, 0x02014b50, true)
    view.setUint16(offset + 4, 20, true)
    view.setUint16(offset + 6, 20, true)
    view.setUint16(offset + 12, 0, true)
    view.setUint16(offset + 14, 0x0021, true)
    view.setUint32(offset + 16, entry.crc, true)
    view.setUint32(offset + 20, entry.bytes.length, true)
    view.setUint32(offset + 24, entry.bytes.length, true)
    view.setUint16(offset + 28, entry.nameBytes.length, true)
    view.setUint32(offset + 42, locations[index], true)
    result.set(entry.nameBytes, offset + 46)
    offset += 46 + entry.nameBytes.length
  }
  view.setUint32(offset, 0x06054b50, true)
  view.setUint16(offset + 8, files.length, true)
  view.setUint16(offset + 10, files.length, true)
  view.setUint32(offset + 12, offset - centralOffset, true)
  view.setUint32(offset + 16, centralOffset, true)
  return result
}

function xmlEscape(value: string) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;')
}

function columnIndex(ref: string) {
  return [...ref.match(/^[A-Z]+/)![0]].reduce((value, letter) => value * 26 + letter.charCodeAt(0) - 64, 0)
}

function setCell(xml: string, ref: string, value: string | number) {
  const rowNumber = Number(ref.match(/\d+$/)![0])
  const rowPattern = new RegExp(`<x:row\\b[^>]*\\br="${rowNumber}"[^>]*>[\\s\\S]*?<\\/x:row>`)
  const row = xml.match(rowPattern)?.[0]
  if (!row) throw new Error(`模板缺少第 ${rowNumber} 行`)
  const cellPattern = /<x:c\b[^>]*\br="([A-Z]+\d+)"[^>]*?(?:\/>|>[\s\S]*?<\/x:c>)/g
  const cells = [...row.matchAll(cellPattern)]
  const existing = cells.find(match => match[1] === ref)
  const style = existing?.[0].match(/\bs="(\d+)"/)?.[1]
  const start = `<x:c r="${ref}"${style ? ` s="${style}"` : ''}`
  const replacement = value === '' ? `${start}/>` : typeof value === 'number'
    ? `${start}><x:v>${value}</x:v></x:c>`
    : `${start} t="inlineStr"><x:is><x:t xml:space="preserve">${xmlEscape(value)}</x:t></x:is></x:c>`
  let updated: string
  if (existing) updated = row.replace(existing[0], replacement)
  else {
    const after = cells.find(match => columnIndex(match[1]) > columnIndex(ref))
    updated = after ? row.replace(after[0], replacement + after[0]) : row.replace('</x:row>', replacement + '</x:row>')
  }
  return xml.replace(row, updated)
}

export function fillCostTemplate(templateBytes: Uint8Array, inputs: Record<string, string | number>, options?: { laborRateFromCny?: number }) {
  const entries = readStoredZip(templateBytes)
  const byName = new Map(entries.map(entry => [entry.name, entry]))
  if (options?.laborRateFromCny !== undefined) {
    const rate = options.laborRateFromCny
    if (!Number.isFinite(rate) || rate <= 0) throw new Error('成本模板换算汇率无效')
    const main = byName.get('xl/worksheets/sheet1.xml')
    if (!main) throw new Error('成本模板缺少主表')
    const xml = decoder.decode(main.bytes)
    const formula = "'1.1 调试工时预估'!F14*35000"
    if (!xml.includes(formula)) throw new Error('调试人工公式与预期模板不一致，请核对模板版本')
    main.bytes = encoder.encode(xml.replace(formula, `'1.1 调试工时预估'!F14*${Math.round(35000 * rate * 100) / 100}`))
  }
  for (const [key, value] of Object.entries(inputs)) {
    if (value === null || value === undefined) continue
    const [sheetIndex, ref] = key.split(':')
    if (!/^[1-7]$/.test(sheetIndex) || !/^[A-Z]+\d+$/.test(ref)) continue
    const entry = byName.get(`xl/worksheets/sheet${sheetIndex}.xml`)
    if (!entry) throw new Error(`模板缺少第 ${sheetIndex} 个页签`)
    entry.bytes = encoder.encode(setCell(decoder.decode(entry.bytes), ref, value))
  }
  const workbook = byName.get('xl/workbook.xml')
  if (workbook) {
    let xml = decoder.decode(workbook.bytes)
    xml = xml.replace(/<x:calcPr\b[^>]*\/>/, '')
    xml = xml.replace('</x:workbook>', '<x:calcPr calcId="0" calcMode="auto" fullCalcOnLoad="1" forceFullCalc="1"/></x:workbook>')
    workbook.bytes = encoder.encode(xml)
  }
  return writeStoredZip(entries)
}

type QuoteSheet = {
  project: string
  headers: string[]
  rows: (string | number)[][]
  demo: boolean
  generatedAt?: string
}

function quoteCell(ref: string, value: string | number, style = 34) {
  const start = `<x:c r="${ref}" s="${style}"`
  return typeof value === 'number'
    ? `${start}><x:v>${value}</x:v></x:c>`
    : `${start} t="inlineStr"><x:is><x:t xml:space="preserve">${xmlEscape(value)}</x:t></x:is></x:c>`
}

function quoteFormula(ref: string, formula: string, cached: number, style = 34) {
  return `<x:c r="${ref}" s="${style}"><x:f>${xmlEscape(formula)}</x:f><x:v>${cached}</x:v></x:c>`
}

function quoteWorksheet(data: QuoteSheet) {
  if (data.headers.length !== 16 || data.rows.some(row => row.length !== 16)) throw new Error('报价明细必须包含 16 列')
  const headerRow = 7
  const firstDataRow = 8
  const totalRow = firstDataRow + data.rows.length
  const column = (index: number) => String.fromCharCode(65 + index)
  const row = (number: number, cells: string[]) => `<x:row r="${number}">${cells.join('')}</x:row>`
  const quoteTotal = data.rows.reduce((sum, cells) => sum + (typeof cells[5] === 'number' && typeof cells[11] === 'number' ? cells[5] * cells[11] : 0), 0)
  const costTotal = data.rows.reduce((sum, cells) => sum + (typeof cells[5] === 'number' && typeof cells[6] === 'number' ? cells[5] * cells[6] : 0), 0)
  const date = data.generatedAt && !Number.isNaN(new Date(data.generatedAt).getTime()) ? new Date(data.generatedAt) : new Date()
  const rows = [
    row(1, [quoteCell('A1', `${data.demo ? '【模拟演示】' : ''}${data.project} · 报价单`, 3)]),
    row(2, [quoteCell('A2', '总报价（CNY）', 11), data.demo ? quoteFormula('B2', `M${totalRow}`, quoteTotal, 15) : quoteCell('B2', '待补', 15)]),
    row(3, [quoteCell('A3', '总成本（CNY）', 11), data.demo ? quoteFormula('B3', `H${totalRow}`, costTotal, 15) : quoteCell('B3', '待补', 15)]),
    row(4, [quoteCell('A4', '演示毛利率', 11), data.demo ? quoteFormula('B4', 'IFERROR(1-B3/B2,0)', quoteTotal ? 1 - costTotal / quoteTotal : 0, 19) : quoteCell('B4', '待补', 15)]),
    row(5, [quoteCell('A5', '生成日期', 11), quoteCell('B5', date.toLocaleString('zh-CN'), 15)]),
    row(6, [quoteCell('A6', '说明', 11), quoteCell('B6', data.demo ? '虚构 CRM 和演示计算，仅供内部流程展示，不可对外报价。成本测算见同一文件中的 V6 原模板。' : '依据 V6 成本估算模板整理；数量、价格、来源与审批状态均需人工确认。', 11)]),
    row(headerRow, data.headers.map((text, index) => quoteCell(`${column(index)}${headerRow}`, text, 27))),
  ]
  data.rows.forEach((values, index) => {
    const rowNumber = firstDataRow + index
    const cells = values.map((value, cellIndex) => {
      const letter = column(cellIndex)
      const qty = values[5], unitCost = values[6], quoteUnit = values[11]
      if (data.demo && typeof qty === 'number' && typeof unitCost === 'number' && typeof quoteUnit === 'number') {
        if (letter === 'H') return quoteFormula(`H${rowNumber}`, `F${rowNumber}*G${rowNumber}`, qty * unitCost)
        if (letter === 'I') return quoteUnit ? quoteFormula(`I${rowNumber}`, `IFERROR(J${rowNumber}/G${rowNumber},0)`, unitCost ? quoteUnit / unitCost : 0) : quoteCell(`I${rowNumber}`, '')
        if (letter === 'K') return quoteFormula(`K${rowNumber}`, `F${rowNumber}*J${rowNumber}`, qty * (typeof values[9] === 'number' ? values[9] : quoteUnit))
        if (letter === 'M') return quoteFormula(`M${rowNumber}`, `F${rowNumber}*L${rowNumber}`, qty * quoteUnit)
      }
      return quoteCell(`${letter}${rowNumber}`, value)
    })
    rows.push(row(rowNumber, cells))
  })
  rows.push(row(totalRow, [quoteCell(`D${totalRow}`, '合计', 99), data.demo ? quoteFormula(`H${totalRow}`, `SUM(H${firstDataRow}:H${totalRow - 1})`, costTotal, 101) : quoteCell(`H${totalRow}`, '待核算', 101), data.demo ? quoteFormula(`M${totalRow}`, `SUM(M${firstDataRow}:M${totalRow - 1})`, quoteTotal, 101) : quoteCell(`M${totalRow}`, '待核算', 101)]))
  const widths = [22, 14, 20, 16, 24, 10, 18, 18, 14, 18, 18, 18, 18, 18, 16, 56]
  const columns = widths.map((width, index) => `<x:col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`).join('')
  return `<?xml version="1.0" encoding="utf-8"?><x:worksheet xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><x:dimension ref="A1:P${totalRow}"/><x:sheetViews><x:sheetView workbookViewId="0"><x:pane ySplit="7" topLeftCell="A8" activePane="bottomLeft" state="frozen"/></x:sheetView></x:sheetViews><x:sheetFormatPr defaultRowHeight="18"/><x:cols>${columns}</x:cols><x:sheetData>${rows.join('')}</x:sheetData><x:autoFilter ref="A7:P${totalRow - 1}"/><x:mergeCells count="2"><x:mergeCell ref="A1:P1"/><x:mergeCell ref="B6:P6"/></x:mergeCells></x:worksheet>`
}

// Retain all seven V6 sheets and formulas, while making the quote detail the first tab.
export function addQuoteSheetToCostTemplate(templateBytes: Uint8Array, data: QuoteSheet) {
  const entries = readStoredZip(templateBytes)
  const byName = new Map(entries.map(entry => [entry.name, entry]))
  const workbook = byName.get('xl/workbook.xml')
  const relationships = byName.get('xl/_rels/workbook.xml.rels')
  const types = byName.get('[Content_Types].xml')
  if (!workbook || !relationships || !types || byName.has('xl/worksheets/sheet8.xml')) throw new Error('成本模板结构与预期不符')
  const relationId = 'RF7QuoteSheet'
  const sheet = `<x:sheet name="报价单" sheetId="8" r:id="${relationId}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" />`
  const relationship = `<Relationship Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="/xl/worksheets/sheet8.xml" Id="${relationId}" />`
  const override = '<Override PartName="/xl/worksheets/sheet8.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml" />'
  const workbookXml = decoder.decode(workbook.bytes)
  const relationshipsXml = decoder.decode(relationships.bytes)
  const typesXml = decoder.decode(types.bytes)
  if (!workbookXml.includes('<x:sheets>') || !relationshipsXml.includes('</Relationships>') || !typesXml.includes('</Types>')) throw new Error('成本模板目录与预期不符')
  workbook.bytes = encoder.encode(workbookXml.replace('<x:sheets>', `<x:sheets>${sheet}`))
  relationships.bytes = encoder.encode(relationshipsXml.replace('</Relationships>', `${relationship}</Relationships>`))
  types.bytes = encoder.encode(typesXml.replace('</Types>', `${override}</Types>`))
  entries.push({ name: 'xl/worksheets/sheet8.xml', bytes: encoder.encode(quoteWorksheet(data)) })
  return writeStoredZip(entries)
}
