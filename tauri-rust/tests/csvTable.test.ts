import { describe, expect, test } from 'bun:test'
import { csvColumns, csvIsEmpty, csvIsTruncated, parseCSV, sniffDelimiter } from '../src/models/csvTable'
import { buildCSVPage, csvPayload } from '../src/preview/csvPage'

describe('CSV parsing', () => {
  test('first record is the header, the rest are rows', () => {
    const table = parseCSV('name,age\nada,36\nalan,41\n')
    expect(table.header).toEqual(['name', 'age'])
    expect(table.rows).toEqual([['ada', '36'], ['alan', '41']])
    expect(table.totalRows).toBe(2)
    expect(csvColumns(table)).toBe(2)
    expect(csvIsTruncated(table)).toBe(false)
  })

  test('a quoted field keeps its delimiters, newlines and doubled quotes', () => {
    const table = parseCSV('a,b\n"x,y","line\nbreak"\n"say ""hi""",z')
    expect(table.rows).toEqual([['x,y', 'line\nbreak'], ['say "hi"', 'z']])
  })

  test('a quote in the middle of an unquoted field is a character', () => {
    const table = parseCSV('a,b\n12",ab"cd')
    expect(table.rows).toEqual([['12"', 'ab"cd']])
  })

  test('CRLF and a lone CR both end a record', () => {
    expect(parseCSV('a,b\r\n1,2\r\n').rows).toEqual([['1', '2']])
    expect(parseCSV('a,b\r1,2\r').rows).toEqual([['1', '2']])
  })

  test('blank lines are not rows, at the end or in the middle', () => {
    const table = parseCSV('a,b\n1,2\n\n3,4\n\n')
    expect(table.rows).toEqual([['1', '2'], ['3', '4']])
    expect(table.totalRows).toBe(2)
  })

  test('a file that does not end on a newline keeps its last record', () => {
    expect(parseCSV('a,b\n1,2').rows).toEqual([['1', '2']])
  })

  test('short rows are padded so every row lands in its own column', () => {
    const table = parseCSV('a,b,c\n1\n2,3')
    expect(csvColumns(table)).toBe(3)
    expect(table.rows).toEqual([['1', '', ''], ['2', '3', '']])
  })

  test('a header shorter than its rows still squares the table', () => {
    const table = parseCSV('a\n1,2,3')
    expect(table.header).toEqual(['a', '', ''])
    expect(table.rows).toEqual([['1', '2', '3']])
  })

  test('the delimiter is read off the first record', () => {
    expect(sniffDelimiter('a;b;c\n1;2;3')).toBe(';')
    expect(sniffDelimiter('a\tb\tc\n1\t2\t3')).toBe('\t')
    expect(sniffDelimiter('a|b|c\n1|2|3')).toBe('|')
    expect(sniffDelimiter('a,b,c\n1,2,3')).toBe(',')
    // Nothing separates anything - one column, and a comma is the safe answer.
    expect(sniffDelimiter('just a line')).toBe(',')
  })

  test('a tie goes to the comma', () => {
    expect(sniffDelimiter('a,b;c\n')).toBe(',')
    expect(parseCSV('a;b,c\n1;2,3').delimiter).toBe(',')
  })

  test('a comma inside a quoted header cell does not outvote the real delimiter', () => {
    expect(sniffDelimiter('"a,b,c";d;e\n1;2;3')).toBe(';')
  })

  test('prose full of commas below the header cannot change the delimiter', () => {
    expect(sniffDelimiter('a;b\nx;one, two, three, four')).toBe(';')
  })

  test('the sniffed delimiter is the one the rows are split on', () => {
    const table = parseCSV('name;note\nada;"one, two"\n')
    expect(table.delimiter).toBe(';')
    expect(table.rows).toEqual([['ada', 'one, two']])
  })

  test('a BOM does not ride into the first header cell', () => {
    expect(parseCSV('\uFEFFname,age\nada,36').header).toEqual(['name', 'age'])
  })

  test('an empty file is an empty table rather than one empty row', () => {
    const table = parseCSV('')
    expect(csvIsEmpty(table)).toBe(true)
    expect(table.totalRows).toBe(0)
    expect(csvIsTruncated(table)).toBe(false)
  })

  test('past the row limit the table stops growing but still counts', () => {
    const lines = Array.from({ length: 20 }, (_, i) => `${i + 1},x`)
    const table = parseCSV('a,b\n' + lines.join('\n'), 5)
    expect(table.rows.length).toBe(5)
    expect(table.totalRows).toBe(20)
    expect(csvIsTruncated(table)).toBe(true)
    expect(table.rows[4]).toEqual(['5', 'x'])
  })

  test('characters outside the BMP survive the split', () => {
    expect(parseCSV('a,b\n\u{1F600},"\u{1F600},x"').rows).toEqual([['\u{1F600}', '\u{1F600},x']])
  })
})

describe('CSV page', () => {
  test('the page is handed JSON, and a cell cannot close the script tag it arrives in', () => {
    const payload = csvPayload(parseCSV('a,b\nx,</script>'))
    expect(payload).not.toContain('</script>')
    expect(payload).toContain('<\\/script>')
    expect(payload).toContain('"total":1')
    expect(JSON.parse(payload)).toEqual({ header: ['a', 'b'], rows: [['x', '</script>']], total: 1, delimiter: ',' })
  })

  test('no table at all is a literal null rather than an empty object', () => {
    expect(csvPayload(null)).toBe('null')
  })

  test('the page inlines the theme, the size and the table', () => {
    const page = buildCSVPage({ themeCSS: ':root { --bg: #fff; }', fontSize: 17.4, table: parseCSV('a\n1') })
    expect(page).toContain('<style id="theme">:root { --bg: #fff; }</style>')
    expect(page).toContain('--body-size: 17px;')
    expect(page).toContain('csvRender({"header":["a"],"rows":[["1"]],"total":1,"delimiter":","});')
    expect(page).toContain('id="sheet"')
    expect(page).not.toContain('img-src')
  })
})
