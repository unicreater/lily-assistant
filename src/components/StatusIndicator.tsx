interface Props {
  connected: boolean;
}

export function StatusIndicator({ connected }: Props) {
  return (
    <div className="flex items-center gap-2">
      <div
        className={`w-2.5 h-2.5 rounded-full ${
          connected
            ? "bg-green-400 animate-pulse-dot"
            : "bg-red-400"
        }`}
      />
      <span className="text-xs text-lily-muted">
        {connected ? "Connected" : "Disconnected"}
      </span>
    </div>
  );
}
