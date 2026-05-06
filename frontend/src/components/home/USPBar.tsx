interface USPItem {
  icon: React.ReactNode;
  text: string;
}

interface Props {
  items: USPItem[];
}

export default function USPBar({ items }: Props) {
  return (
    <div className="usp-bar">
      {items.map((item, i) => (
        <div key={i} className="usp-item">
          {item.icon}
          <span>{item.text}</span>
        </div>
      ))}
    </div>
  );
}
