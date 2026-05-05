export default function DataTable({ columns, data, onRowClick }) {
  if (!data || data.length === 0) {
    return (
      <div className="empty-state">
        <div className="icon">📭</div>
        <p>No data available</p>
      </div>
    );
  }

  return (
    <table className="data-table">
      <thead>
        <tr>
          {columns.map((col) => (
            <th key={col.key} style={col.style}>{col.label}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {data.map((row, i) => (
          <tr
            key={row.id || i}
            onClick={() => onRowClick?.(row)}
            style={onRowClick ? { cursor: 'pointer' } : {}}
          >
            {columns.map((col) => (
              <td key={col.key} style={col.style}>
                {col.render ? col.render(row[col.key], row) : row[col.key] || '—'}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
