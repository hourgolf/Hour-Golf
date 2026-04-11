export default function BulkBar({ count, onCancel, onDelete, onClear }) {
  if (count === 0) return null;
  return (
    <div className="bulk-bar">
      <span>{count} selected</span>
      <button onClick={onCancel}>Cancel Selected</button>
      <button className="bulk-danger" onClick={onDelete}>Delete Selected</button>
      <button onClick={onClear}>Clear</button>
    </div>
  );
}
