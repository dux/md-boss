import Testing
import Foundation
@testable import MdBoss

@Suite("CSV parsing")
struct CSVTableTests {
    @Test("first record is the header, the rest are rows")
    func splitsHeaderFromRows() {
        let table = CSVTable.parse("name,age\nada,36\nalan,41\n")

        #expect(table.header == ["name", "age"])
        #expect(table.rows == [["ada", "36"], ["alan", "41"]])
        #expect(table.totalRows == 2)
        #expect(table.columns == 2)
        #expect(!table.isTruncated)
    }

    @Test("a quoted field keeps its delimiters, newlines and doubled quotes")
    func readsQuotedFields() {
        let table = CSVTable.parse("a,b\n\"x,y\",\"line\nbreak\"\n\"say \"\"hi\"\"\",z")

        #expect(table.rows == [["x,y", "line\nbreak"], ["say \"hi\"", "z"]])
    }

    @Test("a quote in the middle of an unquoted field is a character")
    func keepsStrayQuotes() {
        let table = CSVTable.parse("a,b\n12\",ab\"cd")

        #expect(table.rows == [["12\"", "ab\"cd"]])
    }

    @Test("CRLF and a lone CR both end a record")
    func handlesEveryLineEnding() {
        #expect(CSVTable.parse("a,b\r\n1,2\r\n").rows == [["1", "2"]])
        #expect(CSVTable.parse("a,b\r1,2\r").rows == [["1", "2"]])
    }

    @Test("blank lines are not rows, at the end or in the middle")
    func dropsBlankLines() {
        let table = CSVTable.parse("a,b\n1,2\n\n3,4\n\n")

        #expect(table.rows == [["1", "2"], ["3", "4"]])
        #expect(table.totalRows == 2)
    }

    @Test("a file that does not end on a newline keeps its last record")
    func keepsUnterminatedRecord() {
        #expect(CSVTable.parse("a,b\n1,2").rows == [["1", "2"]])
    }

    @Test("short rows are padded so every row lands in its own column")
    func padsRaggedRows() {
        let table = CSVTable.parse("a,b,c\n1\n2,3")

        #expect(table.columns == 3)
        #expect(table.rows == [["1", "", ""], ["2", "3", ""]])
    }

    @Test("a header shorter than its rows still squares the table")
    func padsShortHeader() {
        let table = CSVTable.parse("a\n1,2,3")

        #expect(table.header == ["a", "", ""])
        #expect(table.rows == [["1", "2", "3"]])
    }

    @Test("the delimiter is read off the first record")
    func sniffsDelimiter() {
        #expect(CSVTable.delimiter(of: "a;b;c\n1;2;3") == ";")
        #expect(CSVTable.delimiter(of: "a\tb\tc\n1\t2\t3") == "\t")
        #expect(CSVTable.delimiter(of: "a|b|c\n1|2|3") == "|")
        #expect(CSVTable.delimiter(of: "a,b,c\n1,2,3") == ",")
        // Nothing separates anything - one column, and a comma is the safe answer.
        #expect(CSVTable.delimiter(of: "just a line") == ",")
    }

    @Test("a comma inside a quoted header cell does not outvote the real delimiter")
    func ignoresQuotedDelimiters() {
        #expect(CSVTable.delimiter(of: "\"a,b,c\";d;e\n1;2;3") == ";")
    }

    @Test("prose full of commas below the header cannot change the delimiter")
    func readsOnlyTheFirstRecord() {
        #expect(CSVTable.delimiter(of: "a;b\nx;one, two, three, four") == ";")
    }

    @Test("a BOM does not ride into the first header cell")
    func stripsByteOrderMark() {
        #expect(CSVTable.parse("\u{FEFF}name,age\nada,36").header == ["name", "age"])
    }

    @Test("an empty file is an empty table rather than one empty row")
    func handlesEmptyFile() {
        let table = CSVTable.parse("")

        #expect(table.isEmpty)
        #expect(table.totalRows == 0)
        #expect(!table.isTruncated)
    }

    @Test("past the row limit the table stops growing but still counts")
    func capsRows() {
        let source = "a,b\n" + (1...20).map { "\($0),x" }.joined(separator: "\n")
        let table = CSVTable.parse(source, limit: 5)

        #expect(table.rows.count == 5)
        #expect(table.totalRows == 20)
        #expect(table.isTruncated)
        #expect(table.rows.last == ["5", "x"])
    }

    @Test("the page is handed JSON, and a cell cannot close the script tag it arrives in")
    func encodesPayload() {
        let payload = CSVPageBuilder.payload(CSVTable.parse("a,b\nx,</script>"))

        #expect(!payload.contains("</script>"))
        #expect(payload.contains("<\\/script>"))
        #expect(payload.contains("\"total\":1"))
    }

    @Test("no table at all is a literal null rather than an empty object")
    func encodesNothing() {
        #expect(CSVPageBuilder.payload(nil) == "null")
    }
}
