import { useEffect, useState } from 'react';

let pushToast: ((message: string) => void) | null = null;

export function toast(message: string): void {
  pushToast?.(message);
}

export function AppToastHost() {
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let timer: number | undefined;
    pushToast = (msg) => {
      setMessage(msg);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setMessage(null), 2600);
    };
    return () => {
      pushToast = null;
      window.clearTimeout(timer);
    };
  }, []);

  if (!message) return null;
  return <div className="toast">{message}</div>;
}
