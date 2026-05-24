interface USPItem {
  icon: React.ReactNode;
  text: string;
}

interface Props {
  items: USPItem[];
}

export default function USPBar({ items }: Props) {
  const tickerItems = [...items, ...items];

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
