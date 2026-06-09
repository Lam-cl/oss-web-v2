import { EsimSuccessContent } from '../EsimSuccessContent';

type EsimSuccessTokenPageProps = {
  params: {
    token: string;
  };
};

export default function EsimSuccessTokenPage({ params }: EsimSuccessTokenPageProps) {
  return <EsimSuccessContent initialTokenId={decodeURIComponent(params.token || '')} />;
}
