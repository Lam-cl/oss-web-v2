type ReferralPrefix = 'TWE' | 'TWP';

type ReferralProfileResponse = {
  nameInfo?: {
    fullName?: unknown;
  };
  accountInfo?: {
    memberID?: unknown;
  };
};

export type ReferralProfile = {
  fullName: string;
  memberID: string;
};

export async function getReferralProfile(prefix: ReferralPrefix, code: string): Promise<ReferralProfile | null> {
  const cleanedCode = code.trim();
  if (!cleanedCode) return null;

  const memberID = `${prefix}-${cleanedCode}`;
  const url = `https://www.tonewow.net/gwp/api/member/referral/x3/mywow/qrlink/${encodeURIComponent(memberID)}`;

  try {
    const res = await fetch(url, {
      cache: 'no-store',
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;

    const data = await res.json() as ReferralProfileResponse;
    const fullName = typeof data.nameInfo?.fullName === 'string' ? data.nameInfo.fullName.trim() : '';
    const returnedMemberID = typeof data.accountInfo?.memberID === 'string' ? data.accountInfo.memberID.trim() : '';

    if (!fullName) return null;

    return {
      fullName,
      memberID: returnedMemberID || memberID,
    };
  } catch {
    return null;
  }
}
