export default function AppIcon({ className = '' }) {
  const classes = ['app-icon', className].filter(Boolean).join(' ');

  return (
    <img
      className={classes}
      src="/icons/icon-192.png"
      alt=""
      aria-hidden="true"
      draggable="false"
    />
  );
}
