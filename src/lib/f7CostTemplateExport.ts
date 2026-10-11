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
