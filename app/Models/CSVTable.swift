import Foundation

/// A delimited text file, parsed into rows for the table pane.
///
/// RFC 4180 plus the things real files actually do: CRLF, a BOM, ragged rows, blank lines,
/// and quotes appearing in the middle of an unquoted field. The delimiter is *guessed*
/// rather than assumed, because half the CSVs in the world are semicolon-separated - that
/// is what a European Excel writes - and one column per row is not a table anyone can read.
///
/// Pure and off-actor: the pane parses on a detached task and hands the result to the page,
/// the same shape `DocumentSearch` has.
struct CSVTable: Equatable, Sendable {
    /// The first record. Every CSV viewer treats it as a header, and a file without one
    /// still reads correctly - its first line simply sits in bold at the top.
    let header: [String]
    /// Every record after the header, capped at `rowLimit` and padded to `columns`.
    let rows: [[String]]
    /// How many records the file holds past the header, before the cap.
    let totalRows: Int
    let delimiter: Character

    /// The widest record, header included. Short rows are padded so the table stays square -
    /// a ragged `<tr>` shifts every cell to its right into the wrong column.
    var columns: Int { header.count }

    var isEmpty: Bool { header.isEmpty && rows.isEmpty }
    var isTruncated: Bool { rows.count < totalRows }

    /// Past this many records the table stops growing. One `<td>` per cell is cheap and a
    /// bounded number of them is the point: a million-row export is a file to grep, not one
    /// to scroll, and a page that takes ten seconds to lay out reads as a hang.
    static let rowLimit = 5_000

    /// Tried in this order, so a tie goes to the comma.
    static let delimiters: [Character] = [",", ";", "\t", "|"]

    // MARK: Parsing

    static func parse(_ text: String, limit: Int = rowLimit) -> Self {
        let source = stripBOM(text)
        let separator = delimiter(of: source)
        var records = split(source, on: separator, limit: limit + 1)

        guard !records.rows.isEmpty else {
            return Self(header: [], rows: [], totalRows: 0, delimiter: separator)
        }

        let header = records.rows.removeFirst()
        let width = max(header.count, records.rows.reduce(0) { max($0, $1.count) })

        return Self(
            header: pad(header, to: width),
            rows: records.rows.map { pad($0, to: width) },
            totalRows: max(0, records.total - 1),
            delimiter: separator
        )
    }

    /// The delimiter is counted over the first record only - a header names every column, so
    /// it carries one separator per column and nothing else does as reliably. Counting the
    /// whole file would let a prose column full of commas outvote the real separator.
    static func delimiter(of text: String) -> Character {
        var counts: [Character: Int] = [:]
        var inQuotes = false

        for character in text {
            if character == "\"" {
                inQuotes.toggle()
                continue
            }
            guard !inQuotes else { continue }
            if character.isNewline { break }
            if delimiters.contains(character) { counts[character, default: 0] += 1 }
        }

        guard let best = counts.values.max(), best > 0 else { return "," }
        return delimiters.first { counts[$0] == best } ?? ","
    }

    // MARK: Internals

    private struct Records {
        var rows: [[String]]
        /// Records in the whole file, including the ones past the limit.
        var total: Int
    }

    /// One pass, character by character. `Character` rather than a byte or a scalar because
    /// a `\r\n` is a single Swift `Character`, which is what makes the line rule one case
    /// instead of three.
    ///
    /// Records past `limit` are counted but not kept, so a huge export still reports its
    /// real size without being held in memory twice.
    private static func split(_ text: String, on delimiter: Character, limit: Int) -> Records {
        var rows: [[String]] = []
        var total = 0
        var fields: [String] = []
        var field = ""
        var inQuotes = false
        var index = text.startIndex

        func endRecord() {
            fields.append(field)
            let record = fields
            field = ""
            fields = []
            // A blank line is not a record. Files end with one, and a stray one in the
            // middle would otherwise draw an empty stripe across the table.
            guard record.count > 1 || !record[0].isEmpty else { return }
            total += 1
            if rows.count < limit { rows.append(record) }
        }

        while index < text.endIndex {
            let character = text[index]

            if inQuotes {
                if character == "\"" {
                    let next = text.index(after: index)
                    // A doubled quote inside a quoted field is one literal quote.
                    if next < text.endIndex, text[next] == "\"" {
                        field.append("\"")
                        index = next
                    } else {
                        inQuotes = false
                    }
                } else {
                    field.append(character)
                }
            } else if character == "\"", field.isEmpty {
                // Only at the head of a field. `ab"cd` is a literal quote in the middle of
                // an unquoted field, and refusing to read it would lose the character.
                inQuotes = true
            } else if character == delimiter {
                fields.append(field)
                field = ""
            } else if character.isNewline {
                endRecord()
            } else {
                field.append(character)
            }

            index = text.index(after: index)
        }

        // Whatever is left when the file does not end on a newline.
        if !field.isEmpty || !fields.isEmpty { endRecord() }

        return Records(rows: rows, total: total)
    }

    private static func pad(_ row: [String], to width: Int) -> [String] {
        row.count >= width ? row : row + Array(repeating: "", count: width - row.count)
    }

    /// A BOM would otherwise ride into the first header cell and show up as a stray glyph.
    private static func stripBOM(_ text: String) -> String {
        text.hasPrefix("\u{FEFF}") ? String(text.dropFirst()) : text
    }
}
