// A delimited text file, parsed into rows for the table pane. The port of CSVTable.swift.
//
// RFC 4180 plus the things real files actually do: CRLF, a BOM, ragged rows, blank lines,
// and quotes appearing in the middle of an unquoted field. The delimiter is *guessed*
// rather than assumed, because half the CSVs in the world are semicolon-separated - that
// is what a European Excel writes - and one column per row is not a table anyone can read.
//
// Pure: no DOM, no native calls. The pane parses and hands the result to the csv page.

export interface CSVTable {
  /** The first record. Every CSV viewer treats it as a header, and a file without one
   *  still reads correctly - its first line simply sits in bold at the top. */
  header: string[]
  /** Every record after the header, capped at `CSV_ROW_LIMIT` and padded to `columns`. */
  rows: string[][]
  /** How many records the file holds past the header, before the cap. */
  totalRows: number
  delimiter: string
}

/** Past this many records the table stops growing. One `<td>` per cell is cheap and a
 *  bounded number of them is the point: a million-row export is a file to grep, not one
 *  to scroll, and a page that takes ten seconds to lay out reads as a hang. */
export const CSV_ROW_LIMIT = 5_000

/** Tried in this order, so a tie goes to the comma. */
export const CSV_DELIMITERS = [',', ';', '\t', '|']

/** The widest record, header included. Short rows are padded so the table stays square -
 *  a ragged `<tr>` shifts every cell to its right into the wrong column. */
export const csvColumns = (table: CSVTable) => table.header.length
export const csvIsEmpty = (table: CSVTable) => table.header.length === 0 && table.rows.length === 0
export const csvIsTruncated = (table: CSVTable) => table.rows.length < table.totalRows

export function parseCSV(text: string, limit = CSV_ROW_LIMIT): CSVTable {
  const source = stripBOM(text)
  const delimiter = sniffDelimiter(source)
  const records = split(source, delimiter, limit + 1)

  if (records.rows.length === 0) {
    return { header: [], rows: [], totalRows: 0, delimiter }
  }

  const header = records.rows[0]
  const rows = records.rows.slice(1)
  const width = rows.reduce((max, row) => Math.max(max, row.length), header.length)

  return {
    header: pad(header, width),
    rows: rows.map((row) => pad(row, width)),
    totalRows: Math.max(0, records.total - 1),
    delimiter,
  }
}

/** The delimiter is counted over the first record only - a header names every column, so
 *  it carries one separator per column and nothing else does as reliably. Counting the
 *  whole file would let a prose column full of commas outvote the real separator. */
export function sniffDelimiter(text: string): string {
  const counts = new Map<string, number>()
  let inQuotes = false

  for (const character of text) {
    if (character === '"') {
      inQuotes = !inQuotes
      continue
    }
    if (inQuotes) continue
    if (isNewline(character)) break
    if (CSV_DELIMITERS.includes(character)) counts.set(character, (counts.get(character) ?? 0) + 1)
  }

  const best = Math.max(0, ...counts.values())
  if (best === 0) return ','
  return CSV_DELIMITERS.find((d) => counts.get(d) === best) ?? ','
}

// MARK: Internals

interface Records {
  rows: string[][]
  /** Records in the whole file, including the ones past the limit. */
  total: number
}

/** One pass, character by character. A `\r\n` is taken as one line break - the Swift
 *  original got that for free from `Character`; here the `\r` case peeks at the next one.
 *
 *  Records past `limit` are counted but not kept, so a huge export still reports its real
 *  size without being held in memory twice. */
function split(text: string, delimiter: string, limit: number): Records {
  const rows: string[][] = []
  let total = 0
  let fields: string[] = []
  let field = ''
  let inQuotes = false

  const endRecord = () => {
    fields.push(field)
    const record = fields
    field = ''
    fields = []
    // A blank line is not a record. Files end with one, and a stray one in the middle
    // would otherwise draw an empty stripe across the table.
    if (record.length === 1 && record[0] === '') return
    total += 1
    if (rows.length < limit) rows.push(record)
  }

  let i = 0
  while (i < text.length) {
    const character = text[i]

    if (inQuotes) {
      if (character === '"') {
        // A doubled quote inside a quoted field is one literal quote.
        if (text[i + 1] === '"') {
          field += '"'
          i += 1
        } else {
          inQuotes = false
        }
      } else {
        field += character
      }
    } else if (character === '"' && field === '') {
      // Only at the head of a field. `ab"cd` is a literal quote in the middle of an
      // unquoted field, and refusing to read it would lose the character.
      inQuotes = true
    } else if (character === delimiter) {
      fields.push(field)
      field = ''
    } else if (isNewline(character)) {
      if (character === '\r' && text[i + 1] === '\n') i += 1
      endRecord()
    } else {
      field += character
    }

    i += 1
  }

  // Whatever is left when the file does not end on a newline.
  if (field !== '' || fields.length > 0) endRecord()

  return { rows, total }
}

/** What Swift's `Character.isNewline` answers yes to: LF, CR, VT, FF, NEL, LS, PS. */
const isNewline = (c: string) =>
  c === '\n' || c === '\r' || c === '\v' || c === '\f' || c === '\u0085' || c === '\u2028' || c === '\u2029'

const pad = (row: string[], width: number) =>
  row.length >= width ? row : row.concat(Array<string>(width - row.length).fill(''))

/** A BOM would otherwise ride into the first header cell and show up as a stray glyph. */
const stripBOM = (text: string) => (text.startsWith('\uFEFF') ? text.slice(1) : text)
