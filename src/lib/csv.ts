/** One CSV cell: always quoted, and a leading =, +, -, @, tab or return is defused so a spreadsheet never runs it. */
export function csvCell(value: unknown) {
    const text = String(value ?? '');
    return `"${(/^[=+\-@\t\r]/.test(text) ? `'${text}` : text).replace(/"/g, '""')}"`;
}
