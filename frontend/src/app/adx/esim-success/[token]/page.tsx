import { EsimSuccessContent } from '@/app/sim/esim-success/EsimSuccessContent';

type AdxEsimSuccessTokenPageProps = {
  params: {
    token: string;
  };
};

export default function AdxEsimSuccessTokenPage({ params }: AdxEsimSuccessTokenPageProps) {
  return <EsimSuccessContent initialTokenId={decodeURIComponent(params.token || '')} isAdx />;
}
