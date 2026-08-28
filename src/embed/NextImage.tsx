import type { ImgHTMLAttributes } from 'react';

type Props = ImgHTMLAttributes<HTMLImageElement> & {
  fill?: boolean;
  priority?: boolean;
  unoptimized?: boolean;
};

export default function NextImage({ fill, priority, unoptimized: _unoptimized, style, ...props }: Props) {
  const fillStyle = fill ? { position:'absolute',height:'100%',width:'100%',left:0,top:0 } as const : {};
  return <img {...props} style={{...fillStyle,...style}} loading={priority ? 'eager' : props.loading} />;
}
