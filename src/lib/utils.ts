export function truncate(value: string | null | undefined, max = 80) {
  if (!value) {
    return '-';
  }
  return value.length <= max ? value : `${value.slice(0, max)}...`;
}

export function formatRelativeLabel(dateValue: string | null | undefined) {
  if (!dateValue) {
    return 'Never';
  }

  const date = new Date(dateValue).getTime();
  const now = Date.now();
  const diffMinutes = Math.floor((now - date) / 60000);

  if (diffMinutes < 1) return 'Just now';
  if (diffMinutes < 60) return `${diffMinutes} min ago`;

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours} hr ago`;

  const diffDays = Math.floor(diffHours / 24);
  if (diffDays === 1) return 'Yesterday';
  return `${diffDays} days ago`;
}
