import { isUspBarEnabled } from '@/lib/features';

interface USPItem {
  icon: React.ReactNode;
  text: string;
}

interface Props {
  items: USPItem[];
}

export default function USPBar({ items }: Props) {
  if (!isUspBarEnabled()) return null;

  const repeatCount = items.length < 5 ? 4 : 2;
  const tickerItems = Array.from({ length: repeatCount }, () => items).flat();

  return (
    <div className="usp-bar" aria-label="ToneWow benefits">
      <div className="usp-track">
        {tickerItems.map((item, i) => (
          <div key={`${item.text}-${i}`} className="usp-item">
            {item.icon}
            <span>{item.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
