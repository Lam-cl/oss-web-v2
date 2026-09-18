export const MALAYSIAN_POSTCODE_PREFIXES: Record<string, [state: string, city: string]> = {
  '01':['Perlis','Kangar'],'02':['Kedah','Alor Setar'],'03':['Kedah','Sungai Petani'],'04':['Kedah','Sungai Petani'],'05':['Kedah','Alor Setar'],'06':['Kedah','Pendang'],
  '08':['Kedah','Sungai Petani'],'09':['Kedah','Kulim'],
  '10':['Pulau Pinang','Georgetown'],'11':['Pulau Pinang','Bayan Lepas'],'12':['Pulau Pinang','Butterworth'],'13':['Pulau Pinang','Butterworth'],'14':['Pulau Pinang','Bukit Mertajam'],
  '15':['Kelantan','Kota Bharu'],'16':['Kelantan','Kota Bharu'],'17':['Kelantan','Pasir Mas'],'18':['Kelantan','Tanah Merah'],
  '20':['Terengganu','Kuala Terengganu'],'21':['Terengganu','Kuala Terengganu'],'22':['Terengganu','Kemaman'],'23':['Terengganu','Dungun'],'24':['Terengganu','Kemaman'],
  '25':['Pahang','Kuantan'],'26':['Pahang','Kuantan'],'27':['Pahang','Kuantan'],'28':['Pahang','Temerloh'],'29':['Pahang','Pekan'],
  '30':['Perak','Ipoh'],'31':['Perak','Ipoh'],'32':['Perak','Sitiawan'],'33':['Perak','Ipoh'],'34':['Perak','Taiping'],'35':['Perak','Taiping'],'36':['Perak','Teluk Intan'],
  '39':['Pahang','Tanah Rata'],
  '40':['Selangor','Shah Alam'],'41':['Selangor','Klang'],'42':['Selangor','Petaling Jaya'],'43':['Selangor','Kajang'],'44':['Selangor','Kuala Kubu Bharu'],'45':['Selangor','Kuala Selangor'],'46':['Selangor','Petaling Jaya'],'47':['Selangor','Petaling Jaya'],'48':['Selangor','Rawang'],
  '50':['W.P. Kuala Lumpur','Kuala Lumpur'],'51':['W.P. Kuala Lumpur','Kuala Lumpur'],'52':['W.P. Kuala Lumpur','Kuala Lumpur'],'53':['W.P. Kuala Lumpur','Kuala Lumpur'],'54':['W.P. Kuala Lumpur','Kuala Lumpur'],'55':['W.P. Kuala Lumpur','Kuala Lumpur'],'56':['W.P. Kuala Lumpur','Kuala Lumpur'],'57':['W.P. Kuala Lumpur','Kuala Lumpur'],'58':['W.P. Kuala Lumpur','Kuala Lumpur'],'59':['W.P. Kuala Lumpur','Kuala Lumpur'],
  '60':['W.P. Kuala Lumpur','Kuala Lumpur'],'61':['Selangor','Shah Alam'],'62':['W.P. Putrajaya','Putrajaya'],'63':['Selangor','Cyberjaya'],'64':['Selangor','Sepang'],
  '68':['Selangor','Batu Caves'],'69':['Selangor','Gombak'],
  '70':['Negeri Sembilan','Seremban'],'71':['Negeri Sembilan','Port Dickson'],'72':['Negeri Sembilan','Seremban'],'73':['Negeri Sembilan','Tampin'],
  '75':['Melaka','Melaka'],'76':['Melaka','Melaka'],'77':['Melaka','Jasin'],'78':['Melaka','Alor Gajah'],
  '79':['Johor','Johor Bahru'],'80':['Johor','Johor Bahru'],'81':['Johor','Johor Bahru'],'82':['Johor','Pontian'],'83':['Johor','Batu Pahat'],'84':['Johor','Muar'],'85':['Johor','Segamat'],'86':['Johor','Kluang'],'87':['Johor','Kota Tinggi'],
  '88':['Sabah','Kota Kinabalu'],'89':['Sabah','Sandakan'],
  '90':['Sabah','Sandakan'],'91':['Sabah','Tawau'],'93':['Sarawak','Kuching'],'94':['Sarawak','Kuching'],'95':['Sarawak','Samarahan'],'96':['Sarawak','Sibu'],'97':['Sarawak','Miri'],'98':['Sarawak','Miri'],
};

export function lookupMalaysianPostcode(postcode: string) {
  const clean = postcode.replace(/\D/g, '').slice(0, 5);
  if (clean.length !== 5) return null;
  const match = MALAYSIAN_POSTCODE_PREFIXES[clean.slice(0, 2)];
  return match ? { postcode: clean, state: match[0], city: match[1] } : null;
}
